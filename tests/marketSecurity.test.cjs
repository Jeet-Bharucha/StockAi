'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
 MAX_BROWSER_WS_CLIENTS,MAX_BROWSER_WS_SYMBOLS,MAX_UPSTREAM_WS_SYMBOLS,
 MAX_WS_MESSAGE_BYTES,normalizeMarketSymbol,parseWsMessage,canSubscribe
}=require('../marketSecurity');

test('normalizes legitimate stock, ETF, index and crypto symbols',()=>{
  for(const [v,expect] of [
    [' aapl ','AAPL'],['brk.b','BRK.B'],['BINANCE:BTCUSDT','BINANCE:BTCUSDT'],
    ['^GSPC','^GSPC'],['BTC-USD','BTC-USD'],['EURUSD=X','EURUSD=X']
  ])assert.equal(normalizeMarketSymbol(v),expect,v);
});

test('invalid symbols cannot inject provider URL parameters or arbitrarily long payloads',()=>{
  const invalid=[
    '',null,{},['AAPL'],'AAPL&token=attacker','X?category=general',
    'AAPL%26token%3Da','../server.js', 'MSFT/TEST',
    'A'.repeat(25),'\nAAPL','<script>alert(1)</script>'
  ];
  for(const value of invalid) assert.equal(normalizeMarketSymbol(value),null,String(value));
});

test('client messages accept only expected actions and valid symbols',()=>{
  assert.deepEqual(parseWsMessage(JSON.stringify({type:'subscribe',symbol:'aapl'})),
    {type:'subscribe',symbol:'AAPL'});
  assert.equal(parseWsMessage(JSON.stringify({type:'unsubscribe',symbol:'SPY'})).type,'unsubscribe');
  for(const v of [
    'junk',null,Buffer.alloc(MAX_WS_MESSAGE_BYTES+1,97),
    JSON.stringify({type:'subscribe',symbol:'AAPL&token=hack'}),
    JSON.stringify({type:'admin',symbol:'AAPL'}),
    JSON.stringify({type:'subscribe',symbol:'AAPL',extra:'x'}).replace('subscribe','status')
  ])assert.equal(parseWsMessage(v),null);
});

test('limits each client and global subscription cardinality while allowing existing symbols',()=>{
  assert.ok(MAX_BROWSER_WS_CLIENTS>=1);
  const mine=new Set(Array.from({length:MAX_BROWSER_WS_SYMBOLS},(_,i)=>'X'+i));
  const global=new Map(Array.from(mine, k=>[k,new Set()]));
  assert.equal(canSubscribe(mine,global,'NEW'),false);
  assert.equal(canSubscribe(mine,global,'X1'),true);
  assert.equal(canSubscribe(new Set(),global,'X1'),true);
  const filled=new Map(Array.from({length:MAX_UPSTREAM_WS_SYMBOLS},(_,i)=>['S'+i,new Set()]));
  assert.equal(canSubscribe(new Set(),filled,'EXTRA'),false);
  assert.equal(canSubscribe(new Set(),filled,'S1'),true);
});
