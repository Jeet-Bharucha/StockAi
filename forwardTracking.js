'use strict';

// Forward signal journal: every saved signal comes from SERVER-SIDE historical data,
// never a client-supplied "prediction", and is locked at the time it is created.
// Later outcomes are computed only from completed FUTURE daily candles.
const MODEL_VERSION = 'indicators-v1-2026';
const HORIZON_SESSIONS = 5;
const COST_PCT = .10;
const tickerPattern = /^[A-Z0-9.^=-]{1,15}$/;
const etDay = timestamp => new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(timestamp*1000));

function completedBars(bars, now = Date.now()) {
  if (!Array.isArray(bars)) throw new Error('Missing historical market data');
  const currentDay = etDay(Math.floor(now/1000));
  const valid = bars.filter(b=>b && Number.isFinite(b.time) &&
    Number.isFinite(b.open)&&b.open>0 &&
    Number.isFinite(b.close)&&b.close>0 &&
    Number.isFinite(b.high)&&Number.isFinite(b.low)&&
    b.high>=Math.max(b.open,b.close,b.low)&&
    b.low<=Math.min(b.open,b.close,b.high));
  // Deliberately exclude a same-day bar even after close to avoid partially
  // updated provider data or exchange closing-time assumptions.
  return valid.filter(b=>etDay(b.time)!==currentDay);
}

function resolvedOutcome(bars, signalTime, now=Date.now()) {
  const closed=completedBars(bars,now);
  const idx=closed.findIndex(b=>b.time===signalTime);
  if (idx<0 || idx+HORIZON_SESSIONS>=closed.length) return null;
  const entry=closed[idx+1], exit=closed[idx+HORIZON_SESSIONS];
  if (!entry || !exit) return null;
  const gross=(exit.close/entry.open-1)*100;
  if (!Number.isFinite(gross)) return null;
  return {
    entryTime:entry.time, exitTime:exit.time,
    entryPrice:+entry.open.toFixed(6),exitPrice:+exit.close.toFixed(6),
    marketReturnPct:+gross.toFixed(4)
  };
}

function wilson(wins,n) {
  if (!n) return null;
  const z=1.96,z2=z*z,p=wins/n,d=1+z2/n;
  const c=(p+z2/(2*n))/d;
  const m=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/d;
  return [+(100*Math.max(0,c-m)).toFixed(1),+(100*Math.min(1,c+m)).toFixed(1)];
}

function summarize(journal) {
  const settled=journal.filter(p=>p.status==='resolved');
  const directional=settled.filter(p=>p.direction==='UP'||p.direction==='DOWN');
  const wins=directional.filter(p=>p.correct===true).length;
  const n=directional.length;
  return {
    allSaved:journal.length,
    pending:journal.filter(p=>p.status==='pending').length,
    resolved:settled.length,
    directionalResolved:n,
    wins,
    hitRatePct:n>=30?+(wins/n*100).toFixed(1):null,
    hitRate95Pct:n>=30?wilson(wins,n):null,
    evidence:n>=30?'observed-early': 'insufficient',
    note:'Actual saved forward signals only; at least 30 matured directional outcomes are required before displaying a hit rate. Results are selection-biased and not a calibrated probability or guarantee.'
  };
}
function serialize(record) {
  return {
    id:String(record._id),symbol:record.symbol,modelVersion:record.modelVersion,
    signalTime:record.signalTime,horizonSessions:record.horizonSessions,
    direction:record.direction,indicatorScore:record.indicatorScore,
    status:record.status,createdAt:record.createdAt,
    entryTime:record.entryTime||null,exitTime:record.exitTime||null,
    marketReturnPct:record.marketReturnPct??null,
    correct:record.correct??null
  };
}
function installForwardTrackingRoutes(app,{
  Prediction,authMW,dbRequired,fetchHistoricalBars,AIPredictor,
  rateLimit,now=()=>Date.now()
}) {
  async function loadBars(symbol, from) {
    const end=Math.floor(now()/1000);
    return fetchHistoricalBars(symbol,{
      resolution:'D',
      from: Math.max(1,Math.floor(from)),
      to:end
    });
  }

  app.post('/api/user/forward-signals',authMW,rateLimit,dbRequired,async(req,res)=>{
    const symbol=typeof req.body?.symbol==='string'?req.body.symbol.trim().toUpperCase():'';
    if(!tickerPattern.test(symbol))
      return res.status(400).json({error:'Choose a valid stock or ETF ticker.'});
    try {
      const count=await Prediction.countDocuments({userId:req.user.id});
      if(count>=400)
        return res.status(409).json({error:'Signal journal capacity reached. Export your history before creating more.'});
      const bars=completedBars(await loadBars(symbol,Math.floor(now()/1000)-730*86400),now());
      if(bars.length<210)
        return res.status(422).json({error:'Insufficient completed verified daily candles to save a signal.'});
      const last=bars[bars.length-1];
      if(now()-last.time*1000>8*86400000)
        return res.status(422).json({error:'Market history is stale; no new prediction has been saved.'});
      // Independently recompute the rule from price data. Never trust browser
      // scores or directions, which can otherwise be forged to inflate "accuracy".
      const result=AIPredictor.predict(bars);
      const record=await Prediction.findOneAndUpdate(
        {userId:req.user.id,symbol,signalTime:last.time,
          modelVersion:MODEL_VERSION,horizonSessions:HORIZON_SESSIONS},
        {$setOnInsert:{
          userId:req.user.id,symbol,signalTime:last.time,
          modelVersion:MODEL_VERSION,horizonSessions:HORIZON_SESSIONS,
          direction:result.direction,indicatorScore:result.confidence,
          status:'pending',createdAt:new Date(now())
        }},
        {upsert:true,new:true,setDefaultsOnInsert:true}
      );
      res.set('Cache-Control','no-store');
      return res.json({ok:true,signal:serialize(record),note:'Saved as a dated, immutable rule-based observation. It will be evaluated only after five future completed trading sessions; no success rate is claimed now.'});
    }catch(err){
      console.error('[ForwardSignals] Save failed:',err.message);
      res.status(502).json({error:'Unable to verify market history and save a forward signal right now.'});
    }
  });

  app.get('/api/user/forward-signals',authMW,rateLimit,dbRequired,async(req,res)=>{
    try{
      // Lazy settlement makes this work on sleeping Render services that miss
      // scheduled jobs; bounded by the most recent pending signals per request.
      const pending=await Prediction.find({userId:req.user.id,status:'pending'})
        .sort({signalTime:1}).limit(8);
      const cached=new Map();
      for(const p of pending){
        try {
          if(!cached.has(p.symbol)) {
            const from=p.signalTime-10*86400;
            cached.set(p.symbol,await loadBars(p.symbol,from));
          }
          const outcome=resolvedOutcome(cached.get(p.symbol),p.signalTime,now());
          if(!outcome)continue;
          const gain=p.direction==='UP'?outcome.marketReturnPct-COST_PCT:
            p.direction==='DOWN'?-outcome.marketReturnPct-COST_PCT:null;
          const correct=p.direction==='UP'?outcome.marketReturnPct>0:
            p.direction==='DOWN'?outcome.marketReturnPct<0:null;
          await Prediction.updateOne(
            {_id:p._id,userId:req.user.id,status:'pending'},
            {$set:{
              status:'resolved',entryTime:outcome.entryTime,exitTime:outcome.exitTime,
              entryPrice:outcome.entryPrice,exitPrice:outcome.exitPrice,
              marketReturnPct:outcome.marketReturnPct,
              correct, hypotheticalNetReturnPct:gain===null?null:+gain.toFixed(4),
              resolvedAt:new Date(now())
            }}
          );
        } catch(e){ console.warn('[ForwardSignals] Could not resolve',p.symbol,e.message); }
      }
      const journal=await Prediction.find({userId:req.user.id})
        .sort({createdAt:-1}).limit(400).lean();
      res.set('Cache-Control','private, no-store');
      res.json({signals:journal.slice(0,50).map(serialize),performance:summarize(journal)});
    }catch(e){
      console.error('[ForwardSignals] List failed:',e.message);
      res.status(500).json({error:'Could not load saved forward signals.'});
    }
  });
}
module.exports={MODEL_VERSION,HORIZON_SESSIONS,completedBars,resolvedOutcome,wilson,summarize,installForwardTrackingRoutes};