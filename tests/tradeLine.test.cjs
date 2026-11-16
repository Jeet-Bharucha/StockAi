'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const vm=require('node:vm'), fs=require('node:fs');
const source=fs.readFileSync('js/tradeLine.js','utf8');
function fixture(){
  const nodes=new Map(),host={dataset:{},querySelector(key){
    if(!nodes.has(key)) nodes.set(key,{setAttribute(k,v){this[k]=v;}});
    return nodes.get(key);
  }};
  const api={_wsStatus:'connected'};
  const line=vm.runInNewContext(source+';createTradeLine(host)',{host,StockAPI:api});
  line.reset('AAPL');
  return {line,api,host,nodes};
}
test('plots the last trade per second and honors the direction and observation time',()=>{
  const {line,host,nodes}=fixture(), t=1700000000000;
  for(const [time,price] of [[t,100],[t+500,101],[t+1000,98]])assert.ok(line.record({price,time},time));
  line.draw(t+1000);
  assert.equal(host.dataset.direction,'down');
  assert.equal((nodes.get('path').d.match(/[ML]/g)||[]).length,2);
  assert.match(nodes.get('[data-trade-status]').textContent,/Live trade.*AAPL.*98/);
  for(const tick of [{time:t,price:99},{price:55},{time:t+9000,price:99},{time:t+1000,price:0}]){
    assert.equal(line.record(tick,t+1000),false);
  }
  assert.equal(line.latest.price,98);
  line.draw(t+62000);
  assert.match(nodes.get('[data-trade-status]').textContent,/^Last trade/);
});
test('gaps, silence and symbol changes never produce a fabricated trade',()=>{
  const {line,api,nodes}=fixture(),t=1700000000000;
  line.record({price:100,time:t},t);api._wsStatus='disconnected';line.disconnect();
  line.draw(t);assert.match(nodes.get('[data-trade-status]').textContent,/offline/);
  api._wsStatus='connected';line.record({price:102,time:t+4000},t+4000);line.draw(t+4000);
  assert.match(nodes.get('path').d,/^M[^L]+M/);
  line.record({price:101,time:t+306000},t+306000);line.draw(t+306000);
  assert.equal((nodes.get('path').d.match(/M/g)||[]).length,1);
  line.reset('MSFT');assert.equal(line.latest,null);assert.equal(nodes.get('path').d,'');
  assert.match(nodes.get('[data-trade-status]').textContent,/Waiting.*MSFT/);
});
