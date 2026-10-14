'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {completedBars,resolvedOutcome,summarize,wilson,installForwardTrackingRoutes}=require('../forwardTracking');
const TODAY=Date.parse('2026-10-13T16:00:00Z');
const DAY=86400000;

function history(count=250) {
 const start=TODAY-(count+3)*DAY;
 return Array.from({length:count},(_,i)=>{
   const close=100+i*.06+Math.sin(i*.2);
   return {time:Math.floor((start+i*DAY)/1000),open:close-.1,
     close,high:close+1,low:close-1,volume:1000000+i};
 });
}
test('exclude incomplete same-day daily candle, never use it for a forward outcome',()=>{
 const b=history();
 const today={time:Math.floor(TODAY/1000),open:103,high:104,low:102,close:103,volume:2};
 b.push(today);
 assert.equal(completedBars(b,TODAY).length,b.length-1);
});

test('forward outcome uses NEXT session OPEN and FIFTH future CLOSE',()=>{
 const b=history(225),idx=215;
 const out=resolvedOutcome(b,b[idx].time,TODAY);
 assert.ok(out);
 assert.equal(out.entryTime,b[idx+1].time);
 assert.equal(out.exitTime,b[idx+5].time);
 assert.equal(out.entryPrice,+b[idx+1].open.toFixed(6));
 assert.equal(out.exitPrice,+b[idx+5].close.toFixed(6));
 assert.equal(out.marketReturnPct,+((b[idx+5].close/b[idx+1].open-1)*100).toFixed(4));
 assert.equal(resolvedOutcome(b,b[b.length-3].time,TODAY),null);
});

test('never publish measured hit rate before thirty real forward directional outcomes',()=>{
 const pending={status:'pending',direction:'UP'};
 const matured={status:'resolved',direction:'UP',correct:true};
 const small=summarize([pending,...Array.from({length:29},()=>matured)]);
 assert.equal(small.hitRatePct,null);
 assert.equal(small.directionalResolved,29);
 const enough=summarize([pending,...Array.from({length:30},()=>matured)]);
 assert.equal(enough.hitRatePct,100);
 assert.ok(enough.hitRate95Pct[0]<100);
 assert.equal(enough.pending,1);
 assert.equal(wilson(0,0),null);
});

test('server recomputes signal from trusted candle bars and ignores forged direction',async()=>{
 const bars=history(220);
 const routes=new Map(),app={};
 for(const method of ['get','post'])app[method]=(path,...fns)=>routes.set(method+' '+path,fns.at(-1));
 let issued=[],predictCount=0;
 const Prediction={
   countDocuments:async()=>0,
   async findOneAndUpdate(query,update){
     issued.push({query,update});
     return {_id:'saved-id',...query,...update.$setOnInsert};
   }
 };
 const predictor={predict(input){
   predictCount++;
   assert.equal(input.length,bars.length);
   return {direction:'DOWN',confidence:57};
 }};
 const fetchHistoricalBars=async(symbol,opts)=>{assert.equal(symbol,'AAPL');return bars};
 installForwardTrackingRoutes(app,{Prediction,authMW:()=>{},dbRequired:()=>{},rateLimit:()=>{},
   AIPredictor:predictor,fetchHistoricalBars,now:()=>TODAY});
 const handler=routes.get('post /api/user/forward-signals');
 const res={code:200,status(n){this.code=n;return this;},set(){return this;},json(v){this.body=v;return this;}};
 await handler({user:{id:'account-1'},body:{symbol:'AAPL',direction:'UP',indicatorScore:99.9}},res);
 assert.equal(res.code,200);
 assert.equal(predictCount,1);
 assert.equal(issued[0].query.userId,'account-1');
 assert.equal(issued[0].update.$setOnInsert.direction,'DOWN');
 assert.equal(issued[0].update.$setOnInsert.status,'pending');
 assert.equal(res.body.signal.direction,'DOWN');
});
