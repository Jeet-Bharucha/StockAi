'use strict';
require('dotenv').config();
const mongoose=require('mongoose');
const {Resend}=require('resend');
const {createResearchModels}=require('./researchModels');
const {createResearchData}=require('./researchData');
const {getMarketQuote}=require('./marketQuotes');
const {runBackgroundCycle}=require('./backgroundResearch');
const {siteAccess}=require('./siteAccess');
async function main(){
 if(process.env.BACKGROUND_ALERTS_ENABLED!=='true')throw Error('Set BACKGROUND_ALERTS_ENABLED=true explicitly to start the worker');
 if(!process.env.MONGO_URI)throw Error('Worker requires the same MongoDB database as the website');
 await mongoose.connect(process.env.MONGO_URI);
 const models=createResearchModels(mongoose);
 const Alert=mongoose.model('PriceAlert',new mongoose.Schema({}, {strict:false,collection:'pricealerts'}));
 const User=mongoose.model('User',new mongoose.Schema({}, {strict:false,collection:'users'}));
 const access=siteAccess(process.env);const resend=process.env.RESEND_API_KEY?new Resend(process.env.RESEND_API_KEY):null;
 const data=createResearchData({key:process.env.FINNHUB_KEY,quote:async symbol=>{const q=await getMarketQuote(symbol,{key:process.env.FINNHUB_KEY});return {price:q.c,observedAt:new Date(q.t*1000).toISOString(),source:q.source};}});

 const tick=async()=>{
  try{const result=await runBackgroundCycle({...models,Alert,User,data,snapshots:true,isAllowedUser:email=>access.isLoginAllowed(email),sendEmail:async message=>{
   if(!resend||!process.env.RESEND_FROM_EMAIL)throw Error('Email sender unavailable');
   const result=await resend.emails.send({from:process.env.RESEND_FROM_EMAIL,to:message.to,subject:message.subject,text:message.text},{idempotencyKey:'stockai-price-alert-'+message.id,signal:AbortSignal.timeout(15000)});if(result.error)throw Error('Email provider rejected delivery');
  }});console.log('[ResearchWorker]',JSON.stringify(result));}catch(e){console.error('[ResearchWorker] Cycle failed');}
 };
 // Await each cycle before scheduling another, including during slow provider responses.
 while(true){await tick();await new Promise(resolve=>setTimeout(resolve,120000));}
}
if(require.main===module)main().catch(()=>{console.error('Research worker could not start: verify database, enable flag and provider configuration');process.exitCode=1;});
module.exports={main};
