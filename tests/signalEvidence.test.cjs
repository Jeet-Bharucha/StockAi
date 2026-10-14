'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const scripts=['js/aiPredictor.js','js/signalEvidence.js']
  .map(file => fs.readFileSync(path.join(__dirname,'..',file),'utf8')).join('\n');
const context={setTimeout,console};
vm.createContext(context);
vm.runInContext(scripts+'\n;globalThis.validator=SignalEvidence;globalThis.predictor=AIPredictor;',context);
const evidence=context.validator;

function history(n=420) {
  const bars=[];
  for(let i=0;i<n;i++){
    const close=100+i*.07+Math.sin(i*.15)*2.5, open=close-0.18;
    bars.push({
      time:1600000000+i*86400,
      open, close, high:Math.max(open,close)+1.5,
      low:Math.min(open,close)-1.5, volume:1000000+i*10
    });
  }
  return bars;
}

test('historical check requires valid, chronological OHLCV data',()=>{
  assert.throws(()=>evidence.evaluate(null),/missing/);
  assert.throws(()=>evidence.evaluate([{time:1,open:10,high:10,low:9,close:100,volume:30}]),/Invalid/);
  const b=history(220);b[20].time=b[19].time;
  assert.throws(()=>evidence.evaluate(b),/unsorted/);
});

test('first signal uses >=210 prior trading sessions and next-open entry',()=>{
  const bars=history(245);
  const result=evidence.evaluate(bars);
  assert.ok(result.evaluations>0);
  assert.equal(result.horizonSessions,5);
  assert.equal(result.roundTripCostPct,.1);
  assert.equal(result.errors.length,0);
  assert.ok(result.rows.every(r=>r.signalTime>=bars[209].time));
  assert.ok(result.rows.every(r=>r.entryTime>r.signalTime && r.exitTime>r.entryTime));
  assert.ok(result.rows.every(r=>Math.abs((r.marketReturnPct-r.baselineLongReturnPct)-.10)<.011));
});

test('evaluation windows cannot overlap; historical signals are determined without future bars',()=>{
  const bars=history(445);
  const candidates=evidence._indices(bars.length);
  assert.ok(candidates.length>15);
  assert.ok(candidates.every((idx,j)=>j===0 || idx-candidates[j-1]>=5));
  const at=candidates[0], originals=bars.slice(0,at+1);
  const saved=context.predictor.predict;
  const observed=[];
  context.predictor.predict=(prefix)=>{
    observed.push(prefix.length);
    return {direction:prefix.at(-1).close>prefix.at(-2).close?'UP':'DOWN'};
  };
  try{
    const initial=evidence._runAt(bars,at);
    const changed=history(445);
    changed[at+5].close*=1.13;
    changed[at+5].high=Math.max(changed[at+5].high,changed[at+5].close);
    const second=evidence._runAt(changed,at);
    assert.equal(initial.direction,second.direction);
    assert.notEqual(initial.marketReturnPct,second.marketReturnPct);
    assert.deepEqual(observed,[at+1,at+1]);
    assert.equal(originals.length,at+1);
  }finally{ context.predictor.predict=saved; }
});

test('Wilson uncertainty reports no confidence band without directional evidence',()=>{
  assert.equal(evidence._wilson(0,0),null);
  const bounds=evidence._wilson(6,10);
  assert.equal(bounds.length,2);
  assert.ok(bounds[0]>=0 && bounds[1]<=100 && bounds[0]<60 && bounds[1]>60);
  const rows=[{direction:'NEUTRAL',correct:null},{direction:'NEUTRAL',correct:null}];
  const result=evidence._summarize(rows,[]);
  assert.equal(result.hitRatePct,null);
  assert.equal(result.evidenceLevel,'insufficient');
});

test('async historical replay matches synchronous summary',async()=>{
  const b=history(250);
  const sync=evidence.evaluate(b), asyncResult=await evidence.evaluateAsync(b);
  assert.equal(asyncResult.directionalSignals,sync.directionalSignals);
  assert.equal(asyncResult.hitRatePct,sync.hitRatePct);
  assert.equal(asyncResult.avgDirectionalReturnPct,sync.avgDirectionalReturnPct);
});
