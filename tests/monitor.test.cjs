'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {monitor}=require('../scripts/monitor.cjs');
test('deployment monitor detects database failure, version drift and invalid destinations',async()=>{
 const fetchImpl=async url=>({ok:true,json:async()=>url.pathname==='/api/health'?{ok:true,database:'connected'}:{commit:'expected'}});
 assert.deepEqual(await monitor({base:'https://example.invalid',expected:'expected',fetchImpl}),{ok:true});
 await assert.rejects(monitor({base:'https://example.invalid',expected:'different',fetchImpl}),/commit/);
 await assert.rejects(monitor({base:'https://example.invalid',fetchImpl:async()=>({ok:false,status:503})}),/503/);
 await assert.rejects(monitor({base:'http://example.invalid',fetchImpl}),/HTTPS/);
 await assert.rejects(monitor({base:'https://user:password@example.invalid',fetchImpl}),/credentials/);
});

test('deployment monitor rejects fabricated or stale successful quote payloads',async()=>{
 const fetchImpl=async url=>({ok:true,json:async()=>url.pathname==='/api/health'?{ok:true,database:'connected'}:{c:0,pc:0,t:1}});
 await assert.rejects(monitor({base:'https://example.invalid',checkQuotes:true,fetchImpl}),/missing or stale/);
});
