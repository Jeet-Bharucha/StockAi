'use strict';
function createTelemetry(now=()=>Date.now()){
 const counters=new Map(),client={};const limits=[100,300,1000,3000,10000,60000,Infinity];
 function category(path){if(path==='/api/quote'||path==='/api/candle')return 'market';if(path.startsWith('/api/auth/'))return 'authentication';if(path.includes('/ledger'))return 'ledger';if(path.startsWith('/api/research/'))return 'research';if(path.includes('/alerts'))return 'alerts';if(path.startsWith('/api/user/'))return 'account';return path.startsWith('/api/')?'other-api':null;}
 return {
  middleware(req,res,next){const group=category(req.path);if(!group)return next();const start=now();res.once('finish',()=>{const elapsed=Math.max(0,now()-start),row=counters.get(group)||{requests:0,errors:0,totalMs:0,histogram:limits.map(()=>0)};row.requests++;row.errors+=res.statusCode>=400?1:0;row.totalMs+=elapsed;row.histogram[limits.findIndex(n=>elapsed<=n)]++;counters.set(group,row);});next();},
  client(kind,view){if(!['script-error','promise-error'].includes(kind)||!['dashboard','ai','watchlist','portfolio','markets','news','trending','screener'].includes(view))throw Error('Invalid reliability signal');const key=kind+':'+view;client[key]=(client[key]||0)+1;},
  report(){return {sinceProcessStart:true,requests:Object.fromEntries([...counters].map(([k,r])=>[k,{requests:r.requests,errors:r.errors,averageMs:Math.round(r.totalMs/r.requests),under300ms:r.histogram[0]+r.histogram[1],over3seconds:r.histogram.slice(4).reduce((a,b)=>a+b,0)}])),clientSignals:{...client}};}
 };
}
module.exports={createTelemetry};
