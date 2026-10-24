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
 async function usdQuotes(symbols){
  const result=await quotes(symbols);let cursor=0;const names=Object.keys(result);
  await Promise.all(Array.from({length:3},async()=>{while(cursor<names.length){const name=names[cursor++];try{const info=await fundamentals(name);let currency=info.profile?.currency;
      if(!currency){const r=await fetchImpl('https://query2.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(name)+'?interval=1d&range=1d',{signal:AbortSignal.timeout(8000),headers:{'User-Agent':'StockAI/1.0'}});if(r.ok){const d=await r.json();currency=d?.chart?.result?.[0]?.meta?.currency;}}
      if(currency==='USD')result[name].currency='USD';else delete result[name];}catch(_){delete result[name];}}}));return result;
 }
 return {fundamentals,quotes,usdQuotes};
}
module.exports={createResearchData};
