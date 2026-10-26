'use strict';
const path=require('node:path');process.env.MONGOMS_DOWNLOAD_DIR=path.resolve('.mongodb-binaries');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const mongoose=require('mongoose'),express=require('express'),jwt=require('jsonwebtoken');
const {createResearchModels}=require('../researchModels'),{installResearchRoutes}=require('../researchRoutes'),{createAuthMiddleware}=require('../authSecurity');
const {exportDatabase,restoreDatabase,encryptBackup,decryptBackup}=require('../backupTools');
test('real isolated Mongo: two-account persistence, write conflicts, session revocation and encrypted restore', {timeout:180000},async()=>{
 const dbPath=require('node:fs').mkdtempSync(path.resolve('.mongodb-test-data-'));const mongo=await MongoMemoryReplSet.create({replSet:{count:1},instanceOpts:[{storageEngine:'wiredTiger',dbPath,args:['--wiredTigerCacheSizeGB','0.25']}]});let server;
 try{await mongoose.connect(mongo.getUri('stockai_integration'));const User=mongoose.model('IntegrationUser',new mongoose.Schema({email:String,name:String,emailVerified:Boolean,tokenVersion:{type:Number,default:0}}),'users');const models=createResearchModels(mongoose);await Promise.all(Object.values(models).map(m=>m.init()));
 const alice=await User.create({email:'alice@example.invalid',name:'Alice',emailVerified:true}),bob=await User.create({email:'bob@example.invalid',name:'Bob',emailVerified:true});const secret='only-an-isolated-test-secret';let ready=true;const authMW=createAuthMiddleware({User,secret,databaseReady:()=>ready,access:{isLoginAllowed:()=>true},publicEnabled:true});const app=express();app.use(express.json());const pass=(_r,_s,n)=>n();const now=Date.now();
 installResearchRoutes(app,{...models,authMW,dbRequired:pass,ownerOnly:pass,rateLimit:pass,data:{usdQuotes:async symbols=>Object.fromEntries(symbols.map(s=>[s,{price:100,currency:'USD',observedAt:new Date(now).toISOString()}]))}});
 server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base='http://127.0.0.1:'+server.address().port;
 const token=(u,opts={})=>jwt.sign({id:String(u._id),v:u.tokenVersion||0},secret,{expiresIn:'5m',...opts});
 async function call(user,method='GET',route='/api/user/research',body,override){const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+(override||token(user)),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 assert.equal((await call(alice,'PUT',undefined,{version:0,lists:[{name:'Alice private',sort:'alpha',items:[]}],screens:[],emailAlerts:false})).status,200);
 assert.deepEqual((await call(bob)).data.lists,[]);assert.equal((await call(alice)).data.lists[0].name,'Alice private');
 const concurrent=await Promise.all([1,2].map(()=>call(alice,'PUT',undefined,{version:1,lists:[],screens:[],emailAlerts:false})));assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 const entry={version:2,type:'deposit',amount:1000,clientId:'real-mongo-test-1234',at:new Date(now-1000).toISOString()};assert.equal((await call(alice,'POST','/api/user/ledger',entry)).status,201);assert.equal((await call(alice,'POST','/api/user/ledger',entry)).data.duplicate,true);assert.equal((await call(bob,'GET','/api/user/ledger')).data.transactions.length,0);
 assert.equal((await call(alice,'POST','/api/user/ledger/snapshot',{})).status,201);assert.equal((await call(bob,'GET','/api/user/ledger')).data.snapshots.length,0);
 const expired=token(alice,{expiresIn:-1});assert.equal((await call(alice,'GET',undefined,undefined,expired)).status,401);
 const old=token(alice);await User.updateOne({_id:alice._id},{$inc:{tokenVersion:1}});assert.equal((await call(alice,'GET',undefined,undefined,old)).status,401);
 await User.updateOne({_id:bob._id},{$set:{emailVerified:false}});assert.equal((await call(bob)).status,403);ready=false;assert.equal((await call(bob)).status,503);ready=true;
 const client=mongoose.connection.getClient(),backup=await exportDatabase(client,mongoose.connection.db),password='isolated-backup-roundtrip-password';const target=client.db('qa_restore_test');const result=await restoreDatabase(target,decryptBackup(encryptBackup(backup,password),password),'qa_restore_test');assert.equal(result.documents,4);assert.equal(await target.collection('researchaccounts').countDocuments(),1);const saved=await target.collection('users').findOne({_id:alice._id});assert.equal(saved.tokenVersion,2);assert.equal(await target.collection('portfoliosnapshots').countDocuments({userId:alice._id}),1);await assert.rejects(restoreDatabase(target,backup,'qa_restore_test'),/empty/);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await mongoose.disconnect();await mongo.stop();}
});
