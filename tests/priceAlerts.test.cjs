'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateAlert,isTriggered,installPriceAlertRoutes}=require('../priceAlerts');

function service(price=150, time=Date.parse('2026-10-15T16:00:00Z')) {
 const now=()=>time;
 const registered=new Map(), records=[];
 const app={};
 for(const method of ['get','post','delete'])
   app[method]=(route,...fns)=>registered.set(method+' '+route,fns.at(-1));
 const Alert={
   async findOne(query){return records.find(a=>a.userId===query.userId &&
      a.symbol===query.symbol&&a.targetPrice===query.targetPrice&&a.direction===query.direction)??null;},
   async countDocuments(query){return records.filter(a=>a.userId===query.userId).length;},
   async create(input){
     const alert={...input,_id:'a'.repeat(23)+(records.length+1).toString(16),triggered:false};
     records.push(alert);return alert;
   },
   find(query){
     let list=records.filter(a=>a.userId===query.userId &&
       (query.triggered===undefined||a.triggered===query.triggered));
     const chain={
       sort(){return this;},
       limit(n){list=list.slice(0,n);return this;},
       async lean(){return list.map(a=>({...a}));}
     };return chain;
   },
   async findOneAndDelete(query) {
     const idx=records.findIndex(a=>a.userId===query.userId&&a._id===query._id);
     return idx<0?null:records.splice(idx,1)[0];
   },
   async findOneAndUpdate(query,ops){
     const a=records.find(a=>a._id===query._id&&a.userId===query.userId&&!a.triggered);
     if(!a)return null;Object.assign(a,ops.$set);return a;
   },
   async deleteMany(query){const arr=records.filter(a=>a.userId!==query.userId);records.splice(0,records.length,...arr);}
 };
 installPriceAlertRoutes(app,{
   Alert,authMW:()=>{},dbRequired:()=>{},rateLimit:()=>{},now,
   fetchQuote:async()=>({price,observedAt:new Date(time-5*60000).toISOString(),source:'Fixture Feed'})
 });
 function res(){return{code:200,status(v){this.code=v;return this;},
   set(){return this;},json(v){this.body=v;return this;}}}
 async function call(method,path,user='owner',body={}){
   const reply=res();
   const req={user:{id:user},body,params:{id:body?.id}};
   await registered.get(method+' '+path)(req,reply);
   return reply;
 }
 return {registered,records,res,call};
}

test('alert validation rejects incorrect targets and accepts ticker with dot',()=>{
 assert.deepEqual(validateAlert({symbol:'brk.b',direction:'above',targetPrice:400}),
   {symbol:'BRK.B',direction:'above',targetPrice:400});
 assert.throws(()=>validateAlert({symbol:'AAPL',direction:'above',targetPrice:-2}),/valid/);
 assert.throws(()=>validateAlert({symbol:'AAPL',direction:'sideways',targetPrice:200}),/valid/);
 assert.equal(isTriggered({direction:'above',targetPrice:145},{price:150}),true);
 assert.equal(isTriggered({direction:'below',targetPrice:145},{price:150}),false);
});

test('account alerts are saved, scoped to user and trigger only once',async()=>{
 const s=service();
 const a=await s.call('post','/api/user/alerts','owner',
   {symbol:'AAPL',direction:'above',targetPrice:145});
 assert.equal(a.code,201);
 assert.equal(a.body.alert.triggered,false);
 const id=a.body.alert.id;
 const second=await s.call('post','/api/user/alerts','owner',
   {symbol:'AAPL',direction:'above',targetPrice:145});
 assert.equal(second.body.existing,true);
 assert.equal(s.records.length,1);
 const other=await s.call('get','/api/user/alerts','friend');
 assert.equal(other.body.alerts.length,0);
 const checked=await s.call('post','/api/user/alerts/check','owner');
 assert.equal(checked.body.fired.length,1);
 assert.equal(checked.body.fired[0].observedPrice,150);
 const repeat=await s.call('post','/api/user/alerts/check','owner');
 assert.equal(repeat.body.fired.length,0);
 assert.equal(repeat.body.throttled,true);
 const noDelete=await s.call('delete','/api/user/alerts/:id','friend',{id});
 assert.equal(noDelete.code,404);
 const deleted=await s.call('delete','/api/user/alerts/:id','owner',{id});
 assert.equal(deleted.code,200);
 assert.equal(s.records.length,0);
});

test('provider price that never crossed a target cannot trigger the alert',async()=>{
 const s=service(100);
 await s.call('post','/api/user/alerts','owner',{symbol:'NVDA',direction:'above',targetPrice:200});
 const v=await s.call('post','/api/user/alerts/check','owner');
 assert.equal(v.body.fired.length,0);
 assert.equal(s.records[0].triggered,false);
});

test('clear all deletes only the caller’s alerts',async()=>{
 const s=service();
 await s.call('post','/api/user/alerts','owner',{symbol:'AAPL',direction:'above',targetPrice:200});
 await s.call('post','/api/user/alerts','friend',{symbol:'NVDA',direction:'below',targetPrice:110});
 await s.call('delete','/api/user/alerts','owner');
 assert.equal(s.records.length,1);
 assert.equal(s.records[0].userId,'friend');
});
