'use strict';
const crypto=require('node:crypto');
const {BSON}=require('mongoose').mongo;
const COLLECTIONS=['users','holdings','predictions','pricealerts','researchaccounts','portfoliosnapshots'];
const MAX_BYTES=64*1024*1024;
function encryptBackup(data,password){
 if(typeof password!=='string'||password.length<20)throw Error('Use a backup passphrase of at least 20 characters');
 const plain=Buffer.from(BSON.EJSON.stringify(data,{relaxed:false}));if(plain.length>MAX_BYTES)throw Error('Backup exceeds the supported 64 MB limit; use Atlas backups');
 const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),key=crypto.scryptSync(password,salt,32),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 return Buffer.concat([Buffer.from('STKAI001'),salt,iv,...(()=>{const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);return [cipher.getAuthTag(),encrypted];})()]);
}
function decryptBackup(buffer,password){
 if(buffer.length<53||buffer.length>MAX_BYTES+52||buffer.subarray(0,8).toString()!=='STKAI001')throw Error('Invalid encrypted backup');
 try{const key=crypto.scryptSync(password,buffer.subarray(8,24),32),decipher=crypto.createDecipheriv('aes-256-gcm',key,buffer.subarray(24,36));decipher.setAuthTag(buffer.subarray(36,52));const raw=Buffer.concat([decipher.update(buffer.subarray(52)),decipher.final()]);return BSON.EJSON.parse(raw.toString(),{relaxed:false});}
 catch(_){throw Error('Backup authentication failed: wrong passphrase or damaged file');}
}
async function exportDatabase(client,db){
 const session=client.startSession();let result;
 try{await session.withTransaction(async()=>{const collections=[];for(const name of COLLECTIONS){const exists=await db.listCollections({name}).hasNext();if(!exists)continue;const documents=await db.collection(name).find({},{session}).limit(20001).toArray();if(documents.length>20000)throw Error('Collection exceeds 20,000 documents; use Atlas backups');collections.push({name,documents});}
 result={format:1,at:new Date(),collections};if(Buffer.byteLength(BSON.EJSON.stringify(result))>MAX_BYTES)throw Error('Backup exceeds supported limit');},{readConcern:{level:'snapshot'},readPreference:'primary'});
 // Index definitions do not contain account data. Capture outside the transaction.
 for(const c of result.collections)c.indexes=await db.collection(c.name).listIndexes().toArray();return result;
 }finally{await session.endSession();}
}
async function restoreDatabase(db,data,confirmation){
 if(!db.databaseName.endsWith('_restore_test')||confirmation!==db.databaseName)throw Error('Restore requires an explicitly confirmed database ending in _restore_test');
 if((await db.listCollections().toArray()).length)throw Error('Restore target must be empty');
 if(Number(data?.format)!==1||!Array.isArray(data.collections)||data.collections.length>COLLECTIONS.length)throw Error('Unsupported backup format');
 const names=new Set();for(const c of data.collections){if(!COLLECTIONS.includes(c.name)||names.has(c.name)||!Array.isArray(c.documents)||c.documents.length>20000||!Array.isArray(c.indexes))throw Error('Invalid backup collection');names.add(c.name);}
 // A failure leaves the disposable target for inspection. Never overwrite or delete a database.
 for(const c of data.collections){const col=await db.createCollection(c.name);if(c.documents.length)await col.insertMany(c.documents.map(doc=>{if(c.name!=='users')return doc;const user={...doc,tokenVersion:(Number(doc.tokenVersion)||0)+1};for(const key of ['passwordResetHash','passwordResetExpires','emailVerifyHash','emailVerifyExpires'])delete user[key];return user;}));
  for(const index of c.indexes){if(index.name==='_id_')continue;const options={};for(const key of ['name','unique','sparse','expireAfterSeconds','partialFilterExpression','collation'])if(index[key]!==undefined)options[key]=index[key];await col.createIndex(index.key,options);}}
 return {collections:data.collections.length,documents:data.collections.reduce((n,c)=>n+c.documents.length,0)};
}
module.exports={encryptBackup,decryptBackup,exportDatabase,restoreDatabase,COLLECTIONS};
