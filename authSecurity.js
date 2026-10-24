'use strict';
const jwt=require('jsonwebtoken');
function createAuthMiddleware({User,secret,databaseReady,access,allowedEmail='',publicEnabled=false}){
 return async(req,res,next)=>{
  const h=req.headers.authorization||'';
  if(!h.startsWith('Bearer ')||h.length>4103)return res.status(401).json({error:'Sign in to continue.'});
  let decoded;try{decoded=jwt.verify(h.slice(7),secret,{algorithms:['HS256']});if(typeof decoded?.id!=='string'||!/^[a-f0-9]{24}$/i.test(decoded.id))throw Error('No user');}
  catch(_){return res.status(401).json({error:'Session expired or invalid. Sign in again.'});}
  if(!databaseReady())return res.status(503).json({error:'Account database unavailable. Please retry.'});
  try{
   const user=await User.findById(decoded.id).select('tokenVersion email name emailVerified');
   if(!user||(decoded.v??0)!==(user.tokenVersion||0))return res.status(401).json({error:'Session expired. Sign in again.'});
   if((publicEnabled||!allowedEmail)&&user.emailVerified===false)return res.status(403).json({error:'Verify your email before using StockAI.'});
   if(!access.isLoginAllowed(user.email))return res.status(403).json({error:'This instance is restricted to the owner.'});
   req.user={id:String(user._id),email:user.email,name:user.name};next();
  }catch(_){return res.status(503).json({error:'Account service unavailable. Please retry.'});}
 };
}
module.exports={createAuthMiddleware};
