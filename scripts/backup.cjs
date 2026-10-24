'use strict';
require('dotenv').config();
const fs=require('node:fs/promises'),{MongoClient}=require('mongoose').mongo;
const {encryptBackup,decryptBackup,exportDatabase,restoreDatabase}=require('../backupTools');
(async()=>{const mode=process.argv[2],password=process.env.BACKUP_PASSPHRASE,file=process.env.BACKUP_FILE;if(!['export','restore-test'].includes(mode)||!file||!password||password.length<20)throw Error('Set BACKUP_FILE and BACKUP_PASSPHRASE (20+ characters), then choose export or restore-test');
 const uri=mode==='export'?process.env.MONGO_URI:process.env.RESTORE_MONGO_URI;if(!uri)throw Error('Database connection setting is missing');
 const client=new MongoClient(uri,{serverSelectionTimeoutMS:15000});try{await client.connect();const db=client.db();if(mode==='export'){const data=await exportDatabase(client,db);await fs.writeFile(file,encryptBackup(data,password),{flag:'wx',mode:0o600});console.log('Encrypted backup saved. Verify it with restore-test and store it offsite.');}else{const data=decryptBackup(await fs.readFile(file),password);const result=await restoreDatabase(db,data,process.env.RESTORE_CONFIRM_DATABASE);console.log('Disposable restore verified:',result);}}finally{await client.close();}
})().catch(()=>{console.error('Backup operation failed. Check settings, passphrase, permissions, supported limits and the empty restore-test target. No database was deleted.');process.exitCode=1;});
