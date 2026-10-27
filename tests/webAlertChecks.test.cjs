'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {alertProcessingMode,startWebAlertChecks}=require('../webAlertChecks');
const {capabilities}=require('../serviceCapabilities');
function clock(){const tasks=[],cancelled=[];return {tasks,cancelled,schedule(fn,delay){const t={fn,delay,unref(){}};tasks.push(t);return t;},cancel(t){cancelled.push(t);}};}
test('free alert mode is explicitly enabled, labeled and yields to a dedicated worker',()=>{
 assert.equal(alertProcessingMode({}),'disabled');assert.equal(alertProcessingMode({WEB_ALERT_CHECKS_ENABLED:'false'}),'disabled');assert.equal(alertProcessingMode({WEB_ALERT_CHECKS_ENABLED:'true'}),'web-best-effort');assert.equal(alertProcessingMode({WEB_ALERT_CHECKS_ENABLED:'true',BACKGROUND_ALERTS_ENABLED:'true'}),'always-on-worker');
 const c=capabilities({WEB_ALERT_CHECKS_ENABLED:'true'});assert.equal(c.email.processingMode,'web-best-effort');assert.equal(c.email.backgroundWorkerEnabled,false);assert.equal(c.email.deliveryVerified,false);
});
test('web alert checks do not overlap and stopping waits for the active cycle without rescheduling',async()=>{
 const time=clock();let release,calls=0;const checks=startWebAlertChecks({enabled:true,...time,cycle:()=>{calls++;return new Promise(resolve=>release=resolve);}});assert.equal(time.tasks[0].delay,30000);const task=time.tasks.shift().fn();await Promise.resolve();assert.equal(calls,1);assert.equal(time.tasks.length,0);let stopped=false;const stopping=checks.stop().then(()=>stopped=true);await Promise.resolve();assert.equal(stopped,false);release();await Promise.all([task,stopping]);assert.equal(time.tasks.length,0);assert.equal(stopped,true);
});
test('web alert checks skip a disconnected database, retry failures and remain absent when disabled',async()=>{
 const time=clock();let ready=false,calls=0,failures=0;const checks=startWebAlertChecks({enabled:true,...time,isReady:()=>ready,cycle:async()=>{calls++;throw Error('fixture failure');},onError:()=>failures++});await time.tasks.shift().fn();assert.equal(calls,0);assert.equal(time.tasks[0].delay,300000);ready=true;await time.tasks.shift().fn();assert.equal(calls,1);assert.equal(failures,1);assert.equal(time.tasks.length,1);await checks.stop();assert.equal(time.cancelled.length,1);const off=clock();await startWebAlertChecks({...off,cycle:async()=>{throw Error('must not run');}}).stop();assert.equal(off.tasks.length,0);
});
