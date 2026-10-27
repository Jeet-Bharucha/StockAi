'use strict';
const {verifiedPrice}=require('./researchCore');
const {isTriggered}=require('./priceAlerts');
const {captureSnapshot}=require('./researchRoutes');
const {randomUUID}=require('node:crypto');
async function runBackgroundCycle({Alert,User,ResearchAccount,PortfolioSnapshot,WorkerHeartbeat,data,sendEmail,isAllowedUser=()=>true,now=()=>Date.now(),snapshots=false,userId=null}){
 const scope=userId?{userId}:{};
 const counts={checked:0,triggered:0,sent:0,failed:0,snapshots:0};const time=new Date(now());
 const leaseId=randomUUID();
 // Single database lease prevents overlapping worker processes checking the same batch.
 let lease;try{lease=await WorkerHeartbeat.findOneAndUpdate({_id:'research-worker',$or:[{leaseUntil:{$lt:time}},{leaseUntil:{$exists:false}}]},{$set:{leaseId,leaseUntil:new Date(now()+240000),lastStarted:time}},{upsert:true,new:true});}catch(e){if(e.code===11000)return {busy:true};throw e;}
 if(!lease)return {busy:true};
 let leaseLost=false;
 const renewal=setInterval(()=>{WorkerHeartbeat.updateOne({_id:'research-worker',leaseId},{$set:{leaseUntil:new Date(now()+240000)}}).then(result=>{if(result.matchedCount===0)leaseLost=true;}).catch(()=>{leaseLost=true;});},60000);
 renewal.unref?.();
 const checkLease=()=>{if(leaseLost)throw Error('Worker lease lost');};
 try{
  const alerts=await Alert.find({...scope,triggered:false}).sort({lastBackgroundCheck:1,createdAt:1}).limit(100).lean();
  const symbols=[...new Set(alerts.map(a=>a.symbol))].slice(0,25);const quotes=await data.quotes(symbols);
  for(const a of alerts){checkLease();if(!symbols.includes(a.symbol))continue;counts.checked++;
   await Alert.updateOne({_id:a._id,triggered:false},{$set:{lastBackgroundCheck:time}});
   const q=quotes[a.symbol];if(!verifiedPrice(q,now())||!isTriggered(a,q))continue;
   const updated=await Alert.findOneAndUpdate({_id:a._id,userId:a.userId,triggered:false},{$set:{triggered:true,triggeredAt:time,observedPrice:q.price,observedAt:new Date(q.observedAt),source:q.source,deliveryStatus:'pending',deliveryAttempts:0}},{new:true});if(updated)counts.triggered++;
  }
  // Browser-triggered alerts also enter delivery, if triggered after email opt-in.
  const deliveries=await Alert.find({...scope,triggered:true,deliveryStatus:{$nin:['sent','skipped']},$or:[{deliveryLease:{$lt:time}},{deliveryLease:{$exists:false}}]}).sort({triggeredAt:1}).limit(50).lean();
  for(const a of deliveries){checkLease();
   const prefs=await ResearchAccount.findOne({userId:a.userId}).lean();
   const user=await User.findById(a.userId).select('email emailVerified').lean();
   if(!prefs?.emailAlerts||!prefs.emailEnabledAt||new Date(a.triggeredAt)<new Date(prefs.emailEnabledAt)||!user||user.emailVerified===false||!isAllowedUser(user.email)){
    await Alert.updateOne({_id:a._id},{$set:{deliveryStatus:'skipped'}});continue;
   }
   if((a.deliveryAttempts||0)>=5)continue;
   const claimed=await Alert.findOneAndUpdate({_id:a._id,deliveryStatus:{$nin:['sent','skipped']},$or:[{deliveryLease:{$lt:time}},{deliveryLease:{$exists:false}}]},{$set:{deliveryLease:new Date(now()+300000)},$inc:{deliveryAttempts:1}},{new:true});if(!claimed)continue;
   try{
    await sendEmail({to:user.email,id:String(a._id),subject:`StockAI price alert: ${a.symbol}`,text:`${a.symbol} reached your ${a.direction} target of $${a.targetPrice}. Observed price: $${a.observedPrice}. Source: ${a.source||'Market provider'}. Observed: ${new Date(a.observedAt).toISOString()}. Quotes may be delayed. Manage email preferences in StockAI > Stock Movers. This is a price notification, not investment advice.`});
    await Alert.updateOne({_id:a._id},{$set:{deliveryStatus:'sent',deliveredAt:new Date(now())},$unset:{deliveryLease:1,deliveryError:1}});counts.sent++;
   }catch(_){await Alert.updateOne({_id:a._id},{$set:{deliveryStatus:'failed',deliveryError:'Email delivery failed; worker will retry'},$unset:{deliveryLease:1}});counts.failed++;}
  }
  if(snapshots){
   const accounts=await ResearchAccount.find({...scope,'transactions.0':{$exists:true},$or:[{lastSnapshotAttempt:{$lt:new Date(now()-3600000)}},{lastSnapshotAttempt:{$exists:false}}]}).sort({lastSnapshotAttempt:1}).limit(1).lean();
   for(const account of accounts){checkLease();await ResearchAccount.updateOne({_id:account._id},{$set:{lastSnapshotAttempt:time}});try{await captureSnapshot({account,ResearchAccount,PortfolioSnapshot,data,now});counts.snapshots++;}catch(_){counts.failed++;}}
  }
  await WorkerHeartbeat.updateOne({_id:'research-worker',leaseId},{$set:{lastSuccess:new Date(now()),lastError:counts.failed?'Some checks or deliveries failed; inspect counts':null,counts},$unset:{leaseUntil:1,leaseId:1}});return counts;
 }catch(e){await WorkerHeartbeat.updateOne({_id:'research-worker',leaseId},{$set:{lastError:'Background cycle failed'},$unset:{leaseUntil:1,leaseId:1}});throw e;}finally{clearInterval(renewal);}
}
module.exports={runBackgroundCycle};
