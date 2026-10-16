'use strict';

// Account-scoped price alerts. Checks are on-demand while an authenticated
// browser is active. Render free services sleep: this is NOT 24/7 monitoring.
const SYMBOL = /^[A-Z0-9.\-^]{1,16}$/;
const MAX_ALERTS = 35;
const MAX_CHECK_SYMBOLS = 12;
const MIN_CHECK_MS = 120000;

function validateAlert(value) {
  const symbol = typeof value?.symbol === 'string' ? value.symbol.trim().toUpperCase() : '';
  const targetPrice = value?.targetPrice;
  const direction = value?.direction;
  if (!SYMBOL.test(symbol) || !['above','below'].includes(direction) ||
      typeof targetPrice !== 'number' || !Number.isFinite(targetPrice) ||
      targetPrice <= 0 || targetPrice > 1e8)
    throw Error('Enter a valid stock symbol, direction, and target price.');
  return {symbol,direction,targetPrice};
}

function safeAlert(a) {
  return {
    id:String(a._id), symbol:a.symbol, direction:a.direction,
    targetPrice:a.targetPrice, triggered:Boolean(a.triggered),
    triggeredAt:a.triggeredAt || null, observedPrice:a.observedPrice??null,
    observedAt:a.observedAt || null, source:a.source || null,
    createdAt:a.createdAt || null
  };
}

function isTriggered(alert, quote) {
  return Number.isFinite(quote?.price) && quote.price>0 &&
    ((alert.direction==='above' && quote.price>=alert.targetPrice) ||
     (alert.direction==='below' && quote.price<=alert.targetPrice));
}

function installPriceAlertRoutes(app,{Alert,authMW,dbRequired,rateLimit,fetchQuote,now=()=>Date.now()}) {
  const lastChecked = new Map();
  const checking = new Set();
  const checkHandlers = [authMW,rateLimit,dbRequired];

  app.get('/api/user/alerts',authMW,dbRequired,async(req,res)=>{
    try {
      const alerts=await Alert.find({userId:req.user.id}).sort({createdAt:-1}).limit(MAX_ALERTS).lean();
      res.set('Cache-Control','private, no-store');
      return res.json({alerts:alerts.map(safeAlert),backgroundMonitoring:false,
        note:'Alerts are checked only while you have StockAI open. Prices may be delayed; no background delivery is guaranteed.'});
    } catch(e){ return res.status(500).json({error:'Could not load saved alerts.'}); }
  });

  app.post('/api/user/alerts',...checkHandlers,async(req,res)=>{
    let input;
    try {input=validateAlert(req.body);} catch(e){return res.status(400).json({error:e.message});}
    try {
      const existing=await Alert.findOne({userId:req.user.id,...input});
      if (existing) return res.json({alert:safeAlert(existing),existing:true});
      const count=await Alert.countDocuments({userId:req.user.id});
      if (count>=MAX_ALERTS) return res.status(409).json({error:'Maximum of 35 alerts per account. Delete an old alert first.'});
      const a=await Alert.create({userId:req.user.id,...input,createdAt:new Date(now())});
      return res.status(201).json({alert:safeAlert(a),existing:false});
    }catch(e){return res.status(500).json({error:'Unable to save alert in MongoDB.'});}
  });

  app.delete('/api/user/alerts/:id',...checkHandlers,async(req,res)=>{
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id))
      return res.status(400).json({error:'Invalid alert identifier.'});
    try {
      const deleted=await Alert.findOneAndDelete({_id:req.params.id,userId:req.user.id});
      if (!deleted) return res.status(404).json({error:'Alert not found.'});
      return res.json({ok:true});
    }catch(e){return res.status(500).json({error:'Unable to remove alert.'});}
  });

  app.delete('/api/user/alerts',...checkHandlers,async(req,res)=>{
    try{await Alert.deleteMany({userId:req.user.id});return res.json({ok:true});}
    catch(e){return res.status(500).json({error:'Unable to clear alerts.'});}
  });

  app.post('/api/user/alerts/check',...checkHandlers,async(req,res)=>{
    const id=String(req.user.id);
    const time=now();
    if (checking.has(id) || time-(lastChecked.get(id)||0)<MIN_CHECK_MS)
      return res.json({fired:[],throttled:true,
        note:'Alerts can be checked at most once every two minutes.'});
    if(lastChecked.size>10000)lastChecked.clear();
    checking.add(id);
    lastChecked.set(id,time);
    try {
      const alerts=await Alert.find({userId:id,triggered:false})
        .sort({createdAt:1}).limit(MAX_ALERTS).lean();
      const groups=new Map();
      for(const alert of alerts){
        if(!groups.has(alert.symbol) && groups.size>=MAX_CHECK_SYMBOLS)break;
        if(!groups.has(alert.symbol))groups.set(alert.symbol,[]);
        groups.get(alert.symbol).push(alert);
      }
      const fired=[], errors=[];
      for(const [symbol,items]of groups){
        try{
          const q=await fetchQuote(symbol);
          const observedMs=Date.parse(q?.observedAt);
          if(!Number.isFinite(q?.price) || q.price<=0 ||
             !Number.isFinite(observedMs) || observedMs>now()+60000 ||
             now()-observedMs>4*86400000)
            throw Error('Verified quote is unavailable or too stale.');
          for(const a of items){
            if(!isTriggered(a,q))continue;
            // Atomic one-way resolution prevents duplicates on concurrent checks.
            const updated=await Alert.findOneAndUpdate({
              _id:a._id,userId:id,triggered:false
            },{$set:{
              triggered:true,triggeredAt:new Date(now()),observedPrice:q.price,
              observedAt:new Date(observedMs),source:String(q.source||'Market feed')
            }},{new:true});
            if(updated)fired.push(safeAlert(updated));
          }
        }catch(e){errors.push(symbol);}
      }
      res.set('Cache-Control','no-store');
      return res.json({fired,checked:groups.size,skipped:Math.max(0,alerts.length-groups.size),
        unavailableSymbols:errors,
        note:'Checked latest available verified quotes. No delivery is guaranteed while StockAI is closed.'});
    }catch(e){return res.status(502).json({error:'Market alert check failed. Please retry later.'});}
    finally{checking.delete(id);}
  });
}

module.exports={validateAlert,safeAlert,isTriggered,installPriceAlertRoutes};
