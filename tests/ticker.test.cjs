'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = name => fs.readFileSync('js/' + name + '.js','utf8');

test('ticker and chart share a socket subscription and reconnect to Render on Netlify', () => {
  const sent = [];
  class Socket {
    static OPEN = 1;
    constructor(url) { this.url=url; this.readyState=1; }
    send(raw) { sent.push(JSON.parse(raw).type); }
  }
  const ctx = { WebSocket:Socket, location:{host:'stockai-app.netlify.app',hostname:'stockai-app.netlify.app',protocol:'https:'} };
  vm.runInNewContext(script('stockApi')+';this.api=StockAPI;',ctx);
  const api=ctx.api;
  assert.equal(api._ws.url,'wss://stockai-main.onrender.com/ws');
  let trades=0;
  const tape=()=>trades++,chart=()=>{};
  api.subscribeSymbol('AAPL',tape);
  api.subscribeSymbol('AAPL',chart);
  api.unsubscribeSymbol('AAPL',chart);
  api._ws.onmessage({data:JSON.stringify({type:'trade',symbol:'AAPL',price:120,time:1000})});
  assert.equal(trades,1);
  assert.deepEqual(sent,['subscribe']);
  api._ws.onopen();
  api.unsubscribeSymbol('AAPL',tape);
  assert.deepEqual(sent,['subscribe','subscribe','unsubscribe']);
});

test('both copies update, ignore older prices, and distinguish streaming from cached quotes', async () => {
  function element(){return {children:[],setAttribute(){},append(...nodes){this.children.push(...nodes);}};}
  const track=element(), listeners={}, timers={};
  const stamp=Date.now()-2000;
  let data={AAPL:{price:100,change24h:0,observedAt:new Date(stamp).toISOString()}};
  const ctx={document:{querySelector:()=>track,createElement:element,addEventListener(){}},
    window:{addEventListener(){}},setInterval:(fn,ms)=>{timers[ms]=fn;},
    StockAPI:{_wsStatus:'connected',_get:async()=>data,subscribeSymbol:(s,cb)=>{listeners[s]=cb;}}};
  vm.runInNewContext(script('marketTicker'),ctx);
  await new Promise(resolve=>setImmediate(resolve));
  const copies=track.children.filter(e=>e.children[0].textContent==='AAPL');
  assert.equal(copies.length,2);
  assert.equal(copies[0].children[3].textContent,'Last quote');
  listeners.AAPL({price:102,time:stamp+1000});
  listeners.AAPL({price:50,time:stamp});
  await timers[30000]();
  for(const item of copies){
    assert.equal(item.children[1].textContent,'$102.00');
    assert.equal(item.children[2].textContent,'+2.00%');
    assert.equal(item.children[3].textContent,'Live trade');
  }
  ctx.StockAPI._wsStatus='disconnected';
  timers[1000]();
  assert.equal(copies[0].children[3].textContent,'Last quote');
  assert.ok(track.children.some(item=>item.children[3].textContent==='Unavailable'));
});
