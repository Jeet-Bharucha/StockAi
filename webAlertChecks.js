'use strict';
function alertProcessingMode(env=process.env){
 if(env.BACKGROUND_ALERTS_ENABLED==='true')return 'always-on-worker';
 return env.WEB_ALERT_CHECKS_ENABLED==='true'?'web-best-effort':'disabled';
}
// Runs only while the web process is awake. No keep-alive requests or paid services.
function startWebAlertChecks({enabled=false,cycle,isReady=()=>true,onError=()=>{},schedule=setTimeout,cancel=clearTimeout,intervalMs=300000,initialDelayMs=30000}){
 let stopped=!enabled,timer=null,active=null;
 function queue(delay){if(stopped)return;timer=schedule(run,delay);timer?.unref?.();}
 async function run(){
  timer=null;if(stopped)return;
  try{if(isReady()){active=Promise.resolve().then(cycle);await active;}}
  catch(_){try{onError();}catch(_){}}
  finally{active=null;queue(intervalMs);}
 }
 queue(initialDelayMs);
 return {async stop(){stopped=true;if(timer!==null)cancel(timer);timer=null;if(active)await active.catch(()=>{});}};
}
module.exports={alertProcessingMode,startWebAlertChecks};
