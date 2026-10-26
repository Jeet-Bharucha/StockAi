'use strict';
const {symbol,verifiedPrice}=require('./researchCore');
function createResearchData({key='',fetchImpl=fetch,quote,now=()=>Date.now()}){
 const cache=new Map(),pending=new Map();
 async function vendor(path,params){
  if(!key)throw Error('Fundamental data provider is not configured');
  const url=new URL('https://finnhub.io/api/v1/'+path);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);url.searchParams.set('token',key);
  const r=await fetchImpl(url,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Provider data unavailable');const data=await r.json();if(data?.error)throw Error('Provider data unavailable');return data;
 }
 async function fundamentals(sym){
  sym=symbol(sym);if(cache.has(sym)&&now()-cache.get(sym).at<300000)return cache.get(sym).value;
  if(pending.has(sym))return pending.get(sym);
  const task=(async()=>{const [profile,metrics,earnings]=await Promise.allSettled([
   vendor('stock/profile2',{symbol:sym}),vendor('stock/metric',{symbol:sym,metric:'all'}),vendor('calendar/earnings',{symbol:sym,from:new Date(now()).toISOString().slice(0,10),to:new Date(now()+90*86400000).toISOString().slice(0,10)})]);
   const metric=metrics.status==='fulfilled'?metrics.value?.metric:null;
   const safe=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
   const p=profile.status==='fulfilled'&&profile.value?.name?profile.value:null;
   const value={symbol:sym,source:'Finnhub',fetchedAt:new Date(now()).toISOString(),profile:p?{name:p.name,industry:p.finnhubIndustry,country:p.country,exchange:p.exchange,currency:p.currency,weburl:p.weburl,marketCapMillions:safe(p.marketCapitalization)}:null,
    metrics:metric?{pe:safe(metric.peTTM),eps:safe(metric.epsTTM),roe:safe(metric.roeTTM),revenueGrowth:safe(metric.revenueGrowthTTMYoy),dividendYield:safe(metric.dividendYieldIndicatedAnnual),high52:safe(metric['52WeekHigh']),low52:safe(metric['52WeekLow']),averageVolume10dMillions:safe(metric['10DayAverageTradingVolume'])}:null,
    earnings:earnings.status==='fulfilled'&&Array.isArray(earnings.value?.earningsCalendar)?earnings.value.earningsCalendar.filter(e=>e.symbol===sym&&e.date>=new Date(now()).toISOString().slice(0,10)).slice(0,4).map(e=>({date:e.date,epsEstimate:safe(e.epsEstimate),revenueEstimate:safe(e.revenueEstimate),hour:e.hour||null})):null};
   if(cache.size>150)cache.clear();cache.set(sym,{at:now(),value});return value;
  })();pending.set(sym,task);try{return await task;}finally{pending.delete(sym);}
 }
 async function quotes(symbols){const result={};let cursor=0;const list=[...new Set(symbols)];await Promise.all(Array.from({length:4},async()=>{while(cursor<list.length){const s=list[cursor++];try{const q=await quote(s);if(verifiedPrice(q,now()))result[s]=q;}catch(_){} }}));return result;}
 async function currency(sym){
  sym=symbol(sym);const id='currency:'+sym;if(cache.has(id)&&now()-cache.get(id).at<300000)return cache.get(id).value;if(pending.has(id))return pending.get(id);
  const task=(async()=>{const saved=cache.get(sym);let value=saved&&now()-saved.at<300000?saved.value.profile?.currency:null;
   if(!value){try{const p=await vendor('stock/profile2',{symbol:sym});value=p?.currency;}catch(_){}}
   if(!value){const r=await fetchImpl('https://query2.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(sym)+'?interval=1d&range=1d',{signal:AbortSignal.timeout(8000),headers:{'User-Agent':'StockAI/1.0'}});if(r.ok){const d=await r.json();value=d?.chart?.result?.[0]?.meta?.currency;}}
   const result=typeof value==='string'&&/^[A-Z]{3}$/.test(value)?value:null;if(cache.size>150)cache.clear();cache.set(id,{at:now(),value:result});return result;
  })();pending.set(id,task);try{return await task;}finally{pending.delete(id);}
 }
 async function usdQuotes(symbols){
  const result=await quotes(symbols);let cursor=0;const names=Object.keys(result);
  await Promise.all(Array.from({length:3},async()=>{while(cursor<names.length){const name=names[cursor++];try{if(await currency(name)==='USD')result[name].currency='USD';else delete result[name];}catch(_){delete result[name];}}}));return result;
 }
 async function companyDetails(sym){
  sym=symbol(sym);const id='details:'+sym;if(cache.has(id)&&now()-cache.get(id).at<300000)return cache.get(id).value;if(pending.has(id))return pending.get(id);
  const task=(async()=>{const from=new Date(now()-2*366*86400000).toISOString().slice(0,10),to=new Date(now()+90*86400000).toISOString().slice(0,10);
   const results=await Promise.allSettled([vendor('stock/financials-reported',{symbol:sym,freq:'annual',from}),vendor('stock/dividend',{symbol:sym,from,to}),vendor('stock/split',{symbol:sym,from,to})]);
   const safe=n=>typeof n==='number'&&Number.isFinite(n)?n:null, text=v=>typeof v==='string'?v.slice(0,200):null;
   const reports=results[0].status==='fulfilled'&&Array.isArray(results[0].value?.data)?results[0].value.data.filter(r=>!r.symbol||r.symbol===sym).sort((a,b)=>String(b.endDate).localeCompare(String(a.endDate))).slice(0,3).map(r=>{
    const sections={};for(const key of ['ic','bs','cf']){const raw=r.report?.[key];const rows=Array.isArray(raw)?raw:raw&&typeof raw==='object'?Object.entries(raw).map(([concept,value])=>({concept,value})):[];sections[key]=rows.slice(0,100).map(x=>({concept:text(x.concept),label:text(x.label),unit:text(x.unit),value:safe(x.value)}));}
    return {startDate:text(r.startDate),endDate:text(r.endDate),filedDate:text(r.filedDate),form:text(r.form),accessNumber:text(r.accessNumber),sections};}):null;
   const events=(index,fn)=>results[index].status==='fulfilled'&&Array.isArray(results[index].value)?results[index].value.filter(x=>!x.symbol||x.symbol===sym).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,80).map(fn):null;
   const value={symbol:sym,source:'Finnhub',fetchedAt:new Date(now()).toISOString(),from,to,reports,dividends:events(1,x=>({date:text(x.date),payDate:text(x.payDate),amount:safe(x.amount),currency:text(x.currency)})),splits:events(2,x=>({date:text(x.date),fromFactor:safe(x.fromFactor),toFactor:safe(x.toFactor)}))};
   if(cache.size>150)cache.clear();cache.set(id,{at:now(),value});return value;
  })();pending.set(id,task);try{return await task;}finally{pending.delete(id);}
 }
 return {fundamentals,quotes,usdQuotes,companyDetails,currency};
}
module.exports={createResearchData};
