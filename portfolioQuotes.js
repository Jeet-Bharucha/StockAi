'use strict';
const CRYPTO={BTC:'bitcoin',ETH:'ethereum',SOL:'solana',ADA:'cardano',XRP:'ripple',DOGE:'dogecoin',DOT:'polkadot',AVAX:'avalanche-2',MATIC:'matic-network',LINK:'chainlink',LTC:'litecoin',BNB:'binancecoin',SHIB:'shiba-inu',UNI:'uniswap',ATOM:'cosmos'};
function parseSymbols(input){if(typeof input!=='string'||input.length>1250)throw Error('Supply 1–50 valid symbols');const list=[...new Set(input.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean))];if(!list.length||list.length>50||list.some(s=>!/^[A-Z0-9^][A-Z0-9.\-^:=]{0,23}$/.test(s)))throw Error('Supply 1–50 valid symbols');return list;}
function validTime(at,now,maxAge){return Number.isFinite(at)&&at>0&&at<=now+60000&&now-at<=maxAge;}
function createPortfolioQuotes({fetchQuote,currency,fetchImpl=fetch,now=()=>Date.now()}){
 const cache=new Map(),pending=new Map();
 async function stock(sym){const cached=cache.get(sym);if(cached&&now()-cached.at<30000)return cached.value;if(pending.has(sym))return pending.get(sym);
  const task=(async()=>{try{const [q,unit]=await Promise.all([fetchQuote(sym),currency(sym)]);if(!Number.isFinite(q.c)||q.c<=0||!validTime(q.t*1000,now(),7*86400000)||unit!=='USD')throw Error('Unconfirmed quote/currency');const value={price:q.c,change24h:Number.isFinite(q.dp)?q.dp:null,name:sym,observedAt:new Date(q.t*1000).toISOString(),source:q.source||'Market provider',currency:'USD'};if(cache.size>200)cache.clear();cache.set(sym,{at:now(),value});return value;}catch(_){return {price:null,change24h:null,name:sym,reason:'Price or USD currency could not be verified'};}})();pending.set(sym,task);try{return await task;}finally{pending.delete(sym);}
 }
 let cryptoCache={at:0,values:{}};let cryptoPending=null;
 async function crypto(symbols){
  if(now()-cryptoCache.at<30000&&symbols.every(s=>cryptoCache.values[s]))return Object.fromEntries(symbols.map(s=>[s,cryptoCache.values[s]]));
  // Coalesce the same symbol batch. Different batches wait then recheck their coverage.
  if(cryptoPending){await cryptoPending;return crypto(symbols);}
  const task=(async()=>{const values={};try{const ids=symbols.map(s=>CRYPTO[s]).join(',');const r=await fetchImpl('https://api.coingecko.com/api/v3/simple/price?ids='+ids+'&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true',{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Unavailable');const data=await r.json();for(const s of symbols){const d=data[CRYPTO[s]];if(!Number.isFinite(d?.usd)||d.usd<=0||!validTime(d.last_updated_at*1000,now(),15*60000))continue;values[s]={price:d.usd,change24h:Number.isFinite(d.usd_24h_change)?d.usd_24h_change:null,observedAt:new Date(d.last_updated_at*1000).toISOString(),source:'CoinGecko',currency:'USD'};}}catch(_){}for(const s of symbols)values[s]||={price:null,change24h:null,reason:'Crypto quote unavailable or stale'};cryptoCache={at:now(),values:{...(now()-cryptoCache.at<30000?cryptoCache.values:{}),...values}};return values;})();cryptoPending=task;try{return await task;}finally{cryptoPending=null;}
 }
 return async input=>{const list=parseSymbols(input),result={},stocks=list.filter(s=>!CRYPTO[s]),coins=list.filter(s=>CRYPTO[s]);let cursor=0;await Promise.all([...(coins.length?[crypto(coins).then(v=>Object.assign(result,v))]:[]),...Array.from({length:4},async()=>{while(cursor<stocks.length){const s=stocks[cursor++];result[s]=await stock(s);}})]);return result;};
}
module.exports={createPortfolioQuotes,parseSymbols};
