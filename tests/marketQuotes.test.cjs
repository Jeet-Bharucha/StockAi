'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  getMarketQuote,quoteFinnhub,quoteYahoo,normalizedQuote,symbolValid
}=require('../marketQuotes');

const NOW=Date.parse('2026-10-16T15:00:00Z');
const T=Math.floor((NOW-15*60000)/1000);
const response=(ok,data,status=200)=>({
  ok,status,json:async()=>data
});

test('Finnhub quote keeps correct observed time, previous close and source',async()=>{
  const q=await quoteFinnhub('SPY',{
    key:'fake-key',now:NOW,fetchImpl:async url=>{
      assert.match(url,/quote\?symbol=SPY&token=fake-key/);
      return response(true,{c:689.4,pc:687.1,h:691,l:686,o:688,t:T});
    }
  });
  assert.equal(q.source,'Finnhub');
  assert.equal(q.t,T);
  assert.equal(q.c,689.4);
  assert.ok(q.dp>0.3&&q.dp<0.4);
});

test('Yahoo fallback uses previous session close, never five-day chart baseline',async()=>{
 const q=await quoteYahoo('XLK',{now:NOW,fetchImpl:async url=>{
   assert.match(url,/XLK/);
   return response(true,{chart:{result:[{meta:{
     regularMarketPrice:300.2,regularMarketPreviousClose:295.1,
     chartPreviousClose:267.0,
     regularMarketTime:T,regularMarketDayHigh:301,
     regularMarketDayLow:297,regularMarketOpen:298
   }}]}});
 }});
 assert.equal(q.source,'Yahoo latest available');
 assert.equal(q.pc,295.1);
 assert.ok(q.dp<2);
});

test('a Yahoo quote without current-session previous close is rejected instead of fabricating gain',async()=>{
 await assert.rejects(quoteYahoo('XLV',{now:NOW,fetchImpl:async()=>response(true,{
   chart:{result:[{meta:{
     regularMarketPrice:200,chartPreviousClose:160,regularMarketTime:T
   }}]}
 })}),/previous close|stale/i);
});

test('old market quotes never become fake current data',()=>{
 assert.throws(()=>normalizedQuote(100,99,null,null,null,
   T-10*86400,'outdated',NOW),/stale/);
 assert.throws(()=>normalizedQuote(100,0,null,null,null,T,'missing',NOW),/missing|stale/);
 assert.throws(()=>normalizedQuote(-4,99,null,null,null,T,'bad',NOW),/missing|stale/);
});

test('quote lookup falls back from 403 / rate limit without returning demo prices',async()=>{
 let fCalls=0,yCalls=0;
 const got=await getMarketQuote('XLF',{
  now:()=>NOW,key:'key',
  finnhub:async()=>{fCalls++;throw Error('HTTP 403');},
  yahoo:async()=>{yCalls++;return normalizedQuote(60,59,61,58,59,T,'Yahoo latest available',NOW);}
 });
 assert.equal(got.source,'Yahoo latest available');
 assert.equal(fCalls,1);assert.equal(yCalls,1);
 const cached=await getMarketQuote('XLF',{
   now:()=>NOW+10000,key:'key',
   finnhub:async()=>{throw Error('should not fetch');},
   yahoo:async()=>{throw Error('should not fetch');}
 });
 assert.equal(cached.c,60);
});

test('duplicate concurrent lookup makes one upstream call',async()=>{
 let calls=0;
 const op={key:'',now:()=>NOW,yahoo:async()=>{calls++;
   await new Promise(r=>setTimeout(r,1));
   return normalizedQuote(200,198,201,197,198,T,'Yahoo latest available',NOW);
 }};
 const [a,b,c]=await Promise.all([
    getMarketQuote('XLRE',op),getMarketQuote('XLRE',op),getMarketQuote('XLRE',op)
 ]);
 assert.equal(calls,1);
 assert.equal(a.c,b.c);assert.equal(a.c,c.c);
});

test('both providers down returns explicit unavailable, not random simulation',async()=>{
 await assert.rejects(
  getMarketQuote('XLB',{
    now:()=>NOW,key:'key',
    finnhub:async()=>{throw Error('Finnhub quota');},
    yahoo:async()=>{throw Error('Yahoo outage');}
  }),
  /No verified current quote/
 );
});

test('rejects injected symbols before reaching provider',async()=>{
 for(const sym of ['AAPL&token=hijack','../server.js','',null,'SPY?x=1'])
   assert.equal(symbolValid(sym),false,String(sym));
 await assert.rejects(getMarketQuote('SPY&token=x',{now:()=>NOW}),/Invalid market symbol/);
});
