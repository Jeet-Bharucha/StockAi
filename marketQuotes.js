'use strict';

/* A source-marked quote adapter for Finnhub plus a verified Yahoo fallback.
   These are latest-available quotes, not a guarantee of exchange-real-time data.
   Never replace missing or stale market fields with random/demo values. */
const TTL_MS = 30_000;
const MAX_AGE_MS = 7 * 86400000;
const CACHE_MAX = 200;
const cache = new Map();
const inFlight = new Map();

function symbolValid(symbol) {
  return typeof symbol === 'string' && /^[A-Z0-9^][A-Z0-9.\-^:=]{0,23}$/.test(symbol);
}

function normalizedQuote(price,prevClose,high,low,open,observedAt,source,now=Date.now()) {
  if (!Number.isFinite(price)||price<=0 ||
      !Number.isFinite(prevClose)||prevClose<=0 ||
      !Number.isFinite(observedAt)||observedAt<=0 ||
      observedAt*1000>now+3600000 ||
      now-observedAt*1000>MAX_AGE_MS)
    throw Error('Price, prior close or quote timestamp missing or stale');
  return {
    c:price,pc:prevClose,d:+(price-prevClose).toFixed(4),
    dp:+((price/prevClose-1)*100).toFixed(4),
    h:Number.isFinite(high)&&high>0?high:null,
    l:Number.isFinite(low)&&low>0?low:null,
    o:Number.isFinite(open)&&open>0?open:null,
    t:observedAt,source
  };
}

async function quoteFinnhub(symbol,{fetchImpl=fetch,key,now=Date.now()}) {
  if(!key) throw Error('Finnhub not configured');
  const url=new URL('https://finnhub.io/api/v1/quote');
  url.searchParams.set('symbol',symbol);
  url.searchParams.set('token',key);
  const response=await fetchImpl(url.toString(),{signal:AbortSignal.timeout(7500)});
  if(!response.ok)throw Error('Finnhub quote rejected HTTP '+response.status);
  const d=await response.json();
  if(!d||!Number.isFinite(d.c)||d.c<=0)throw Error('Finnhub returned no quote');
  return normalizedQuote(d.c,d.pc,d.h,d.l,d.o,d.t,'Finnhub',now);
}

async function quoteYahoo(symbol,{fetchImpl=fetch,now=Date.now()}) {
  const url='https://query2.finance.yahoo.com/v8/finance/chart/'+
    encodeURIComponent(symbol)+'?interval=1d&range=5d';
  const response=await fetchImpl(url,{
    signal:AbortSignal.timeout(9000),
    headers:{'User-Agent':'Mozilla/5.0 (compatible; StockAI/1.0)','Accept':'application/json'}
  });
  if(!response.ok)throw Error('Yahoo chart rejected HTTP '+response.status);
  const data=await response.json();
  const meta=data?.chart?.result?.[0]?.meta;
  if(!meta)throw Error('Yahoo quote metadata unavailable');
  // chartPreviousClose can be several sessions old for a multi-day chart;
  // it must NEVER be substituted for the most recent previous-session close.
  const prev=Number.isFinite(meta.regularMarketPreviousClose)
    ? meta.regularMarketPreviousClose : meta.previousClose;
  return normalizedQuote(
    meta.regularMarketPrice,prev,
    meta.regularMarketDayHigh,meta.regularMarketDayLow,meta.regularMarketOpen,
    meta.regularMarketTime,'Yahoo latest available',now
  );
}

async function getMarketQuote(symbol,{
  fetchImpl=fetch,key='',now=()=>Date.now(),
  finnhub=quoteFinnhub,yahoo=quoteYahoo
}={}) {
  if(!symbolValid(symbol)) throw Error('Invalid market symbol');
  const ts=now();
  const cached=cache.get(symbol);
  if(cached&&ts-cached.savedAt<TTL_MS)return cached.value;
  if(inFlight.has(symbol))return inFlight.get(symbol);
  const task=(async()=>{
    let lastError;
    if(key){
      try {
        const v=await finnhub(symbol,{fetchImpl,key,now:ts});
        cache.set(symbol,{savedAt:ts,value:v});
        return v;
      }catch(err){lastError=err;}
    }
    try{
      const value=await yahoo(symbol,{fetchImpl,now:ts});
      cache.set(symbol,{savedAt:ts,value});
      if(cache.size>CACHE_MAX)cache.clear();
      return value;
    }catch(err){
      // Keep diagnostics on the server; avoid sending vendor secrets or
      // internal exception messages to the public browser.
      throw new Error('No verified current quote available ('+
        (key?'both providers failed':'Yahoo unavailable')+')'+
        (lastError?'':''));
    }
  })();
  inFlight.set(symbol,task);
  try{return await task;}finally{inFlight.delete(symbol);}
}

module.exports={getMarketQuote,quoteFinnhub,quoteYahoo,normalizedQuote,symbolValid};
