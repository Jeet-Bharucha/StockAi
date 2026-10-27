'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../researchCore');
const {installResearchRoutes,captureSnapshot}=require('../researchRoutes');
const {createResearchData}=require('../researchData');
const {runBackgroundCycle}=require('../backgroundResearch');
const {memoryModel}=require('./helpers/memoryStore.cjs');
const NOW=Date.parse('2026-10-24T15:00:00Z');
const tx=(type,more={})=>Core.validateTransaction({clientId:'fixture-1234',type,at:new Date(NOW-1000).toISOString(),...more},NOW);
test('ledger handles cash, fees, average-cost sales and dividends without altering existing holdings',()=>{
 const book=Core.ledger([tx('deposit',{amount:1000}),tx('buy',{symbol:'SPY',quantity:5,price:100,fee:5}),tx('sell',{symbol:'SPY',quantity:2,price:120,fee:2}),tx('dividend',{symbol:'SPY',amount:10})]);
 assert.equal(book.cash,743);assert.equal(book.realized,36);assert.equal(book.dividends,10);assert.deepEqual(book.holdings,[{symbol:'SPY',quantity:3,cost:303}]);
 assert.throws(()=>Core.ledger([tx('buy',{symbol:'SPY',quantity:1,price:100})]),/cash/);
 assert.throws(()=>Core.ledger([tx('deposit',{amount:1000}),tx('sell',{symbol:'SPY',quantity:1,price:100})]),/shares/);
 assert.throws(()=>tx('deposit',{amount:NaN}),/numeric/);assert.throws(()=>tx('deposit',{amount:1,at:'2035-01-01'}),/time/);
});
test('snapshot valuation rejects missing, stale, future and non-USD quotes',()=>{
 const book=Core.ledger([tx('deposit',{amount:1000}),tx('buy',{symbol:'SPY',quantity:2,price:100})]);
 const quote={price:120,currency:'USD',observedAt:new Date(NOW).toISOString()};
 assert.equal(Core.valueLedger(book,{SPY:quote},NOW).equity,1040);
 for(const q of [{...quote,currency:'GBP'},{...quote,observedAt:'2020-01-01'},{...quote,observedAt:new Date(NOW+120000).toISOString()},null])assert.equal(Core.valueLedger(book,{SPY:q},NOW).equity,null);
});
test('Modified Dietz weights external flows and SPY comparison uses actual snapshots',()=>{
 const start={at:new Date(NOW-10000),equity:1000,spy:100},end={at:new Date(NOW),equity:1210,spy:105};
 const result=Core.performance(start,end,[{type:'deposit',amount:100,at:new Date(NOW-5000)}]);
 assert.ok(Math.abs(result.returnPct-110/1050*100)<1e-8);assert.equal(result.gain,110);assert.ok(Math.abs(result.benchmarkPct-5)<1e-8);
 assert.equal(Core.performance(start,start,[]),null);assert.equal(Core.performance({...start,equity:0},{...end,equity:0},[]),null);
});
test('research state validates symbols, numeric targets and bounded lists; unknown fields do not persist',()=>{
 const valid={lists:[{name:'Core',sort:'alpha',items:[{symbol:'spy',note:'<literal text>',target:100}]}],screens:[{name:'Value',filters:{maxPE:'30',evil:'ignore'}}],emailAlerts:false,admin:true};
 const state=Core.validateWorkspace(valid);assert.equal(state.lists[0].items[0].symbol,'SPY');assert.equal(state.admin,undefined);assert.equal(state.screens[0].filters.evil,undefined);
 assert.throws(()=>Core.validateWorkspace({...valid,lists:[...valid.lists,...valid.lists]}),/unique/);
 assert.throws(()=>Core.validateWorkspace({...valid,lists:[{...valid.lists[0],items:[{symbol:'SPY&token=x'}]}]}),/symbol/);
});
function service(){
 const ResearchAccount=memoryModel(['userId']),PortfolioSnapshot=memoryModel(),WorkerHeartbeat=memoryModel(),routes=new Map(),middleware=()=>{};
 const app={};for(const method of ['get','post','put'])app[method]=(path,...fns)=>{assert.ok(fns.includes(middleware));routes.set(method+' '+path,fns.at(-1));};
 const data={usdQuotes:async symbols=>Object.fromEntries(symbols.map(s=>[s,{price:100,currency:'USD',observedAt:new Date(NOW).toISOString()}])),fundamentals:async sym=>({symbol:sym})};
 installResearchRoutes(app,{ResearchAccount,PortfolioSnapshot,WorkerHeartbeat,authMW:middleware,dbRequired:middleware,rateLimit:middleware,ownerOnly:middleware,data,now:()=>NOW,emailConfigured:true});
 async function call(method,path,user,body={}){const res={code:200,set(){return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await routes.get(method+' '+path)({user:{id:user},body},res);return res;}
 return {ResearchAccount,PortfolioSnapshot,WorkerHeartbeat,data,call};
}
test('account state is isolated, optimistic saves reject stale revisions and ledger retries are idempotent',async()=>{
 const s=service(),state={version:0,lists:[{name:'Private',sort:'alpha',items:[]}],screens:[],emailAlerts:false};
 assert.equal((await s.call('put','/api/user/research','alice',state)).code,200);
 assert.equal((await s.call('get','/api/user/research','bob')).body.lists.length,0);
 assert.equal((await s.call('put','/api/user/research','alice',state)).code,409);
 const entry={...tx('deposit',{amount:1000}),version:1};assert.equal((await s.call('post','/api/user/ledger','alice',entry)).code,201);
 assert.equal((await s.call('post','/api/user/ledger','alice',entry)).body.duplicate,true);
 assert.equal((await s.call('get','/api/user/ledger','alice')).body.transactions.length,1);
 assert.equal((await s.call('get','/api/user/ledger','bob')).body.transactions.length,0);
});
test('only verified real snapshots are recorded and concurrent ledger edits abort valuation',async()=>{
 const s=service();const a=await s.ResearchAccount.create({userId:'a',transactions:[tx('deposit',{amount:1000})]});
 const first=await captureSnapshot({...s,account:a,now:()=>NOW});assert.equal(first.equity,1000);assert.equal(first.spy,100);
 const newer={...a,version:20};await assert.rejects(captureSnapshot({...s,account:newer,now:()=>NOW+120000}),/changed/);
 assert.equal(s.PortfolioSnapshot.records.length,1);
});
test('fundamentals are cached, malformed symbols are rejected before provider and absent metrics stay absent',async()=>{
 let count=0;const data=createResearchData({key:'test',now:()=>NOW,quote:async()=>{},fetchImpl:async url=>{count++;return {ok:true,json:async()=>url.pathname.endsWith('profile2')?{name:'Test',currency:'GBP'}:{}};}});
 const a=await data.fundamentals('SPY');assert.equal(a.metrics,null);assert.equal(a.earnings,null);assert.equal(a.profile.currency,'GBP');await data.fundamentals('SPY');assert.equal(count,3);await assert.rejects(data.fundamentals('../x'),/symbol/);assert.equal(count,3);
});
async function workerFixture({quotePrice=101,sendFails=false,optIn=true}={}){
 const Alert=memoryModel(),User=memoryModel(),ResearchAccount=memoryModel(),PortfolioSnapshot=memoryModel(),WorkerHeartbeat=memoryModel();
 await User.create({_id:'alice',email:'alice@example.invalid',emailVerified:true});await ResearchAccount.create({userId:'alice',emailAlerts:optIn,emailEnabledAt:new Date(NOW-60000)});
 await Alert.create({userId:'alice',symbol:'SPY',targetPrice:100,direction:'above',triggered:false,createdAt:new Date(NOW-20000)});
 let sent=0;const options={Alert,User,ResearchAccount,PortfolioSnapshot,WorkerHeartbeat,now:()=>NOW,data:{quotes:async()=>({SPY:{price:quotePrice,observedAt:new Date(NOW).toISOString(),source:'Test'}})},sendEmail:async()=>{if(sendFails)throw Error('mail down');sent++;}};
 return {...options,options,sent:()=>sent};
}
test('worker atomically triggers alerts, honors opt-in and does not redeliver sent alerts',async()=>{
 const s=await workerFixture();const first=await runBackgroundCycle(s.options);assert.equal(first.triggered,1);assert.equal(first.sent,1);assert.equal(s.sent(),1);await runBackgroundCycle(s.options);assert.equal(s.sent(),1);
 const off=await workerFixture({optIn:false});await runBackgroundCycle(off.options);assert.equal(off.sent(),0);assert.equal(off.Alert.records[0].deliveryStatus,'skipped');
});
test('email failure is recorded and retryable; stale quotes never trigger an alert',async()=>{
 const s=await workerFixture({sendFails:true});await runBackgroundCycle(s.options);assert.equal(s.Alert.records[0].deliveryStatus,'failed');assert.equal(s.Alert.records[0].deliveryAttempts,1);
 s.options.sendEmail=async()=>{};await runBackgroundCycle(s.options);assert.equal(s.Alert.records[0].deliveryStatus,'sent');assert.equal(s.Alert.records[0].deliveryAttempts,2);
 const stale=await workerFixture();stale.options.data.quotes=async()=>({SPY:{price:200,observedAt:'2020-01-01'}});await runBackgroundCycle(stale.options);assert.equal(stale.Alert.records[0].triggered,false);assert.equal(stale.sent(),0);
});
test('worker lease rejects overlapping cycles',async()=>{
 const s=await workerFixture();await s.WorkerHeartbeat.create({_id:'research-worker',leaseUntil:new Date(NOW+60000)});assert.equal((await runBackgroundCycle(s.options)).busy,true);assert.equal(s.sent(),0);
});

test('USD valuation confirms ETF currency from Yahoo metadata if the stock profile is missing',async()=>{
 const data=createResearchData({key:'test',now:()=>NOW,quote:async()=>({price:100,observedAt:new Date(NOW).toISOString()}),fetchImpl:async url=>{
  const value=String(url);return {ok:true,json:async()=>value.includes('query2.finance.yahoo.com')?{chart:{result:[{meta:{currency:'USD'}}]}}:{}};
 }});
 assert.equal((await data.usdQuotes(['SPY'])).SPY.currency,'USD');
});
test('ledger entries cannot be backdated across an existing performance snapshot',async()=>{
 const s=service();await s.ResearchAccount.create({userId:'a',transactions:[tx('deposit',{amount:1000})]});await s.PortfolioSnapshot.create({userId:'a',at:new Date(NOW-500)});
 const result=await s.call('post','/api/user/ledger','a',{...tx('dividend',{symbol:'SPY',amount:5,clientId:'different-id-123'}),version:0});assert.equal(result.code,400);assert.match(result.body.error,/snapshot/);assert.equal(s.ResearchAccount.records[0].transactions.length,1);
});
test('clear-all-data includes account research collections without touching another account',async()=>{
 const {installAccountRoutes}=require('../accountRoutes');let handler;const deleted=[];
 const app={get(){},post(){},patch(){},delete(path,...fns){if(path==='/api/user/data')handler=fns.at(-1);}};
 const model=name=>({deleteMany:async query=>deleted.push({name,...query})});
 installAccountRoutes(app,{User:{findByIdAndUpdate:async()=>{}},Holding:model('holdings'),ResearchAccount:model('research'),PortfolioSnapshot:model('snapshots'),authMW(){},dbRequired(){}});
 const res={status(){return this;},json(){return this;}};await handler({user:{id:'alice'}},res);
 assert.deepEqual(deleted,[{name:'holdings',userId:'alice'},{name:'research',userId:'alice'},{name:'snapshots',userId:'alice'}]);
});


test('private free checks only quote, trigger and deliver alerts belonging to the scoped owner',async()=>{
 const s=await workerFixture();await s.Alert.create({userId:'bob',symbol:'MSFT',targetPrice:100,direction:'above',triggered:false,createdAt:new Date(NOW-30000)});await s.Alert.create({userId:'bob',symbol:'GLD',targetPrice:100,direction:'above',triggered:true,triggeredAt:new Date(NOW-10000),deliveryStatus:'pending'});let symbols;const old=s.options.data.quotes;s.options.data.quotes=async input=>{symbols=input;return old(input);};const result=await runBackgroundCycle({...s.options,userId:'alice'});assert.deepEqual(symbols,['SPY']);assert.equal(result.checked,1);assert.equal(result.sent,1);const other=s.Alert.records.filter(a=>a.userId==='bob');assert.equal(other[0].triggered,false);assert.equal(other[0].lastBackgroundCheck,undefined);assert.equal(other[1].deliveryStatus,'pending');assert.equal(other[1].deliveryAttempts,undefined);
});
