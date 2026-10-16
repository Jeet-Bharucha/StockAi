'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','js/auth.js'),'utf8');
const quoteSource=fs.readFileSync(path.join(__dirname,'..','js/stockApi.js'),'utf8');

function storage(){
 const map=new Map();
 return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),
 removeItem:k=>map.delete(k)};
}
function authWith(fetchImpl){
 const context={fetch:fetchImpl,localStorage:storage(),sessionStorage:storage(),
   AbortController,setTimeout,clearTimeout,Date,console};
 vm.createContext(context);
 vm.runInContext(source+'\n;globalThis.underTest=Auth;',context);
 return context.underTest;
}
const reply=(status,data)=>({ok:status>=200&&status<300,status,headers:{get:()=> 'application/json'},
 json:async()=>data});

test('MongoDB watchlist only updates in-memory state after successful server confirmation',async()=>{
 let writes=0;
 const auth=authWith(async(_url,opt)=>{
   if(opt.method==='PUT'){writes++;return reply(503,{error:'DB unavailable'});}
   return reply(200,{watchlist:['AAPL']});
 });
 auth._watchlistCache=['AAPL'];
 await assert.rejects(auth.addToWatchlist('NVDA'),/DB unavailable/);
 assert.deepEqual([...auth.getWatchlist()],['AAPL']);
 assert.equal(writes,1);
});

test('rapid additions are serialized so the second write includes the first',async()=>{
 const payloads=[];
 const auth=authWith(async(_url,opt)=>{
  if(opt.method==='PUT'){payloads.push(JSON.parse(opt.body));return reply(200,{ok:true});}
  return reply(200,{watchlist:['AAPL']});
 });
 auth._watchlistCache=['AAPL'];
 await Promise.all([auth.addToWatchlist('NVDA'),auth.addToWatchlist('MSFT')]);
 assert.deepEqual(payloads,[{watchlist:['AAPL','NVDA']},{watchlist:['AAPL','NVDA','MSFT']}]);
 assert.deepEqual([...auth.getWatchlist()],['AAPL','NVDA','MSFT']);
});

test('unavailable initial account watchlist never gets replaced by empty state',async()=>{
 let writes=0;
 const auth=authWith(async(_url,opt)=>{
  if(opt.method==='PUT')writes++;
  return reply(503,{error:'MongoDB unavailable'});
 });
 await assert.rejects(auth.addToWatchlist('NVDA'),/not loaded/);
 assert.equal(writes,0);
});

test('delayed account read never rolls back an acknowledged MongoDB watchlist write',async()=>{
 let releaseRead;
 const auth=authWith(async(_url,opt)=>{
   if(opt.method==='PUT')return reply(200,{ok:true});
   return new Promise(resolve=>{releaseRead=resolve;});
 });
 auth._watchlistCache=['AAPL'];
 const oldRead=auth.loadWatchlist();
 await auth.addToWatchlist('NVDA');
 releaseRead(reply(200,{watchlist:['AAPL']}));
 await oldRead;
 assert.deepEqual([...auth.getWatchlist()],['AAPL','NVDA']);
});

test('watchlist input is normalized and rejects invalid ticker syntax',async()=>{
 const auth=authWith(async(_url,opt)=>reply(200,{ok:true}));
 auth._watchlistCache=[];
 await assert.rejects(auth.addToWatchlist('AAPL&token=hack'),/valid/);
 await auth.addToWatchlist(' brk.b ');
 assert.deepEqual([...auth.getWatchlist()],['BRK.B']);
});

test('quote percent is computed from the real previous close when provider omits change',async()=>{
 const ctx={
  location:{host:'',protocol:'https:'},
  fetch:async()=>reply(200,{c:105,pc:100,h:108,l:99,o:101,t:1900000000}),
  AbortController,setTimeout,clearTimeout,console,Date
 };
 vm.createContext(ctx);
 vm.runInContext(quoteSource+'\n;globalThis.testStockAPI=StockAPI;',ctx);
 const q=await ctx.testStockAPI.getQuote('AAPL');
 assert.equal(q.price,105);
 assert.equal(q.changePct,5);
 assert.equal(q.change,5);
 assert.ok(q.observedAt);
});

test('quote missing both provider change and prior-close rejects instead of showing 0%',async()=>{
 const ctx={location:{host:'',protocol:'https:'},
  fetch:async()=>reply(200,{c:100,h:101,l:99,o:99}),
  AbortController,setTimeout,clearTimeout,console,Date
 };
 vm.createContext(ctx);
 vm.runInContext(quoteSource+'\n;globalThis.testStockAPI=StockAPI;',ctx);
 await assert.rejects(ctx.testStockAPI.getQuote('AAPL'),/verifiable session change/);
});
