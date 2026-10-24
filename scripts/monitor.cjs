'use strict';
async function monitor({base=process.env.MONITOR_URL,expected=process.env.MONITOR_EXPECTED_SHA,checkQuotes=process.env.MONITOR_CHECK_QUOTES==='true',fetchImpl=fetch}={}){
 if(!base)throw Error('Set MONITOR_URL to the production HTTPS origin');const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password)throw Error('Monitoring requires an HTTPS URL without embedded credentials');
 for(const endpoint of ['/ping','/api/health']){const r=await fetchImpl(new URL(endpoint,url),{signal:AbortSignal.timeout(60000),redirect:'error'});if(!r.ok)throw Error(endpoint+' returned HTTP '+r.status);if(endpoint.endsWith('health')){const d=await r.json();if(d.ok!==true||d.database!=='connected')throw Error('Database readiness failed');}}
 if(checkQuotes){const r=await fetchImpl(new URL('/api/quote?symbol=SPY',url),{signal:AbortSignal.timeout(45000),redirect:'error'});if(!r.ok)throw Error('Quote provider check failed with HTTP '+r.status);const q=await r.json();if(!Number.isFinite(q.c)||q.c<=0||!Number.isFinite(q.pc)||q.pc<=0||!Number.isFinite(q.t)||q.t*1000>Date.now()+60000||Date.now()-q.t*1000>7*86400000)throw Error('Quote provider returned missing or stale data');}
 if(expected){const r=await fetchImpl(new URL('/api/version',url),{signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('Deployment version unavailable');const d=await r.json();if(d.commit!==expected)throw Error('Production commit does not match expected revision');}
 return {ok:true};
}
if(require.main===module)monitor().then(()=>console.log('StockAI liveness, database readiness and configured revision checks passed')).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={monitor};
