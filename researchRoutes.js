'use strict';
const Core=require('./researchCore');
function publicState(doc){return {version:doc?.version||0,lists:doc?.lists||[],screens:doc?.screens||[],emailAlerts:doc?.emailAlerts===true};}
async function captureSnapshot({account,ResearchAccount,PortfolioSnapshot,data,now=()=>Date.now()}){
 const at=new Date(now());const recent=await PortfolioSnapshot.findOne({userId:account.userId,ledgerVersion:account.version,at:{$gte:new Date(now()-60000)}}).sort({at:-1}).lean();if(recent)return recent;
 const book=Core.ledger(account.transactions||[]);if(!account.transactions?.length)throw Error('Record a ledger transaction before capturing performance');
 const quotes=await data.usdQuotes([...book.holdings.map(h=>h.symbol),'SPY']);
 const valued=Core.valueLedger(book,quotes,now());if(valued.equity===null)throw Error('Snapshot not recorded: verified prices missing for '+valued.missing.join(', '));
 // Do not record a valuation against a concurrently changed ledger.
 const current=await ResearchAccount.findOne({userId:account.userId}).lean();if(!current||current.version!==account.version)throw Error('Ledger changed during valuation; retry');
 try {const snapshot=await PortfolioSnapshot.create({userId:account.userId,bucket:Math.floor(now()/60000),at,equity:valued.equity,cash:valued.cash,spy:quotes.SPY?.price??null,quotes,ledgerVersion:account.version});return snapshot;}catch(e){if(e.code!==11000)throw e;return PortfolioSnapshot.findOne({userId:account.userId,bucket:Math.floor(now()/60000),ledgerVersion:account.version}).lean();}
}
function installResearchRoutes(app,{ResearchAccount,PortfolioSnapshot,WorkerHeartbeat,Alert,telemetry,authMW,dbRequired,rateLimit,ownerOnly,data,backgroundEnabled=false,emailConfigured=false,now=()=>Date.now()}){
 const handlers=[authMW,dbRequired,rateLimit];
 const account=async id=>await ResearchAccount.findOne({userId:id}).lean()||{userId:id,version:0,lists:[],screens:[],transactions:[],emailAlerts:false};
 async function mutate(id,version,set,extra={}){
  if(!Number.isInteger(version)||version<0)throw Object.assign(Error('Reload this view before saving'),{status:409});
  let current=await ResearchAccount.findOne({userId:id}).lean();
  if(!current){try{await ResearchAccount.create({userId:id});}catch(e){if(e.code!==11000)throw e;}}
  const updated=await ResearchAccount.findOneAndUpdate({userId:id,version},{$set:{...set,updatedAt:new Date(now())},$inc:{version:1},...extra},{new:true}).lean();
  if(!updated)throw Object.assign(Error('Another window changed this account. Reload before saving.'),{status:409});return updated;
 }
 const wrap=fn=>async(req,res)=>{try{res.set('Cache-Control','private, no-store');await fn(req,res);}catch(e){console.warn('[Research]',e.message);const internal=/Mongo|Mongoose|Cast|Validation/.test(e.name);res.status(internal?500:e.status||400).json({error:internal?'Account service unavailable. Please retry.':e.message});}};
 app.get('/api/user/research',...handlers,wrap(async(req,res)=>res.json({...publicState(await account(req.user.id)),backgroundEnabled,emailConfigured})));
 app.put('/api/user/research',...handlers,wrap(async(req,res)=>{
  const input=Core.validateWorkspace(req.body);const current=await account(req.user.id);
  if(input.emailAlerts&&!emailConfigured)throw Error('Email sender is not configured on this service');
  const updated=await mutate(req.user.id,req.body.version,{...input,emailEnabledAt:input.emailAlerts?(current.emailAlerts?current.emailEnabledAt:new Date(now())):null});res.json(publicState(updated));
 }));
 app.get('/api/research/overview/:symbol',...handlers,wrap(async(req,res)=>res.json(await data.fundamentals(Core.symbol(req.params.symbol)))));
 app.get('/api/research/currency/:symbol',...handlers,wrap(async(req,res)=>res.json({currency:await data.currency(Core.symbol(req.params.symbol))})));
 app.get('/api/research/company-details/:symbol',...handlers,wrap(async(req,res)=>res.json(await data.companyDetails(Core.symbol(req.params.symbol)))));
 app.get('/api/user/ledger',...handlers,wrap(async(req,res)=>{
  const a=await account(req.user.id),transactions=a.transactions||[],book=Core.ledger(transactions);
  const snapshots=await PortfolioSnapshot.find({userId:req.user.id}).sort({at:-1}).limit(365).lean();snapshots.reverse();
  const quotes=await data.usdQuotes(book.holdings.map(h=>h.symbol));
  res.json({version:a.version,transactions,book,valuation:Core.valueLedger(book,quotes,now()),snapshots,performance:Core.performance(snapshots[0],snapshots.at(-1),transactions),currency:'USD'});
 }));
 app.post('/api/user/ledger',...handlers,wrap(async(req,res)=>{
  const a=await account(req.user.id),entry=Core.validateTransaction(req.body,now());
  const existing=(a.transactions||[]).find(t=>t.clientId===entry.clientId);
  if(existing){
    const signature=t=>JSON.stringify(['type','symbol','quantity','price','fee','amount','memo','numerator','denominator'].map(key=>t[key]??null).concat(+new Date(t.at)));
    if(signature(existing)!==signature(entry))throw Object.assign(Error('Transaction identifier was already used for different data'),{status:409});
    return res.json({ok:true,duplicate:true});
  }
  if((a.transactions||[]).length>=1000)throw Error('Ledger limit reached (1,000 entries)');
  if(a.transactions?.length&&+new Date(entry.at)<Math.max(...a.transactions.map(t=>+new Date(t.at))))throw Error('Record entries in chronological order, at or after the latest entry');
  const latestSnapshot=await PortfolioSnapshot.findOne({userId:req.user.id}).sort({at:-1}).lean();
  if(latestSnapshot&&+new Date(entry.at)<=+new Date(latestSnapshot.at))throw Error('Entry time must be after the latest performance snapshot. Use the actual current transaction time.');
  const book=Core.ledger([...(a.transactions||[]),entry]);if(book.holdings.length>30)throw Error('Maximum 30 open ledger positions');
  const updated=await mutate(req.user.id,req.body.version,{},{$push:{transactions:entry}});res.status(201).json({ok:true,version:updated.version});
 }));
 app.post('/api/user/ledger/snapshot',...handlers,wrap(async(req,res)=>res.status(201).json(await captureSnapshot({account:await account(req.user.id),ResearchAccount,PortfolioSnapshot,data,now}))));
 if(Alert)app.post('/api/user/alerts/:id/retry-email',...handlers,wrap(async(req,res)=>{
  if(!/^[0-9a-fA-F]{24}$/.test(req.params.id))throw Error('Invalid alert identifier');
  const prefs=await account(req.user.id);if(!prefs.emailAlerts||!emailConfigured)throw Error('Enable email alerts and configure the sender first');
  const updated=await Alert.findOneAndUpdate({_id:req.params.id,userId:req.user.id,triggered:true,deliveryStatus:'failed'},{$set:{deliveryStatus:'pending',deliveryAttempts:0},$unset:{deliveryLease:1}},{new:true});
  if(!updated)throw Error('No failed delivery found for this account');res.json({ok:true});
 }));
 if(telemetry)app.post('/api/user/reliability-signal',...handlers,wrap(async(req,res)=>{
  telemetry.client(req.body.kind,req.body.view);res.json({ok:true});
 }));
 app.get('/api/admin/operations',...handlers,ownerOnly,wrap(async(_req,res)=>{
  const heartbeat=await WorkerHeartbeat.findById('research-worker').lean();
  res.json({ok:true,reliability:telemetry?.report()||null,database:'connected',uptimeSeconds:Math.floor(process.uptime()),backgroundEnabled,emailConfigured,worker:heartbeat?{lastStarted:heartbeat.lastStarted,lastSuccess:heartbeat.lastSuccess,lastError:heartbeat.lastError,counts:heartbeat.counts}:null,workerStale:backgroundEnabled&&(!heartbeat?.lastSuccess||now()-new Date(heartbeat.lastSuccess)>10*60000)});
 }));
}
module.exports={installResearchRoutes,captureSnapshot,publicState};
