'use strict';
// Isolated static host for browser API-fixture tests. Production routes are
// tested separately; this host never reads credentials or connects to MongoDB.
const express=require('express');
const {securityHeaders,protectStaticFiles}=require('../siteSecurity');
module.exports=async function(){
 const app=express();app.use(securityHeaders);app.use(protectStaticFiles);app.use(express.static(require('node:path').resolve(__dirname,'..')));
 const server=await new Promise(resolve=>{const listening=app.listen(4188,'127.0.0.1',()=>resolve(listening));});
 return async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
};
