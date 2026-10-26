'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function api(fetch) {
  const scope = {fetch, location:{host:''}, AbortController, setTimeout, clearTimeout, console, Map};
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(root,'js/stockApi.js'),'utf8')+'\nthis.api=StockAPI;',scope);
  return scope.api;
}
test('simultaneous panel reads share a request and failed requests can be retried',async()=>{
  let calls=0, release;
  const stock = api(()=>{calls++;return new Promise(resolve=>release=resolve);});
  const first=stock._get('/api/quote?symbol=SPY');
  const second=stock._get('/api/quote?symbol=SPY');
  assert.equal(calls,1);
  release({ok:false,headers:{get:()=> 'application/json'},json:async()=>({error:'Unavailable'})});
  const results=await Promise.allSettled([first,second]);
  assert.ok(results.every(result=>result.status==='rejected'));
  const retry=stock._get('/api/quote?symbol=SPY');
  assert.equal(calls,2);
  release({ok:true,headers:{get:()=> 'application/json'},json:async()=>({c:100})});
  assert.equal((await retry).c,100);
});
test('malformed quote symbols never reach the server',async()=>{
  let calls=0;
  const stock=api(async()=>{calls++;throw Error('must not fetch');});
  await assert.rejects(stock.getQuote('SPY&token=x'),/Invalid market symbol/);
  assert.equal(calls,0);
});
test('quote starts while history and profile are pending, and failed history clears old bars',async()=>{
  const source=fs.readFileSync(path.join(root,'js/dashboard.js'),'utf8');
  const fn=source.slice(source.indexOf('  async function loadStock('),source.indexOf('  function switchToLive()'));
  const elements=new Map();
  const el=id=>{if(!elements.has(id))elements.set(id,{textContent:'old',value:'',style:{}});return elements.get(id);};
  let finishHistory,quoteCalls=0;
  const data=[];
  const context={console,clearInterval,location:{host:''},window:{},
    document:{getElementById:el,dispatchEvent(){}},CustomEvent:function(){},StockAPI:{
      unsubscribeAll(){},getCompanyInfo:()=>({name:'SPY',sector:'ETF'}),
      getCompanyProfile:()=>new Promise(()=>{}),
      getCandles:()=>new Promise(resolve=>finishHistory=resolve)
    },currentSymbol:'AAPL',claudeAnalysisVersion:0,claudeBusy:false,activePrediction:null,
    activePredictionSymbol:null,stockRequestVersion:0,verifiedPrevClose:1,currentBars:[{close:999}],
    simInterval:null,compareSeries:null,newsMode:'market',chart:null,
    candleSeries:{setData:bars=>data.push(bars)},volumeSeries:{setData(){}},
    clearCompare(){},clearSMAUI(){},resetEvidenceUI(){},clearSignalView(){},showChartUnavailable(){},showChartLoader(){},
    refreshQuote:async()=>{quoteCalls++;},updateWatchlistUI(){},runAI(){},volData:()=>[]};
  vm.createContext(context);vm.runInContext(fn+'\nthis.load=loadStock;',context);
  const loading=context.load('SPY');
  assert.equal(quoteCalls,1);
  assert.equal(context.currentBars.length,0);
  assert.equal(el('stat-high').textContent,'—');
  finishHistory([]); await loading;
  assert.equal(context.window.fullBars.length,0);
  assert.ok(data.every(bars=>bars.length===0));
});
test('all data tabs dispatch independently, suppress duplicate loads and offer retry after rejection',async()=>{
  const source=fs.readFileSync(path.join(root,'js/dashboard.js'),'utf8');
  const code=source.slice(source.indexOf('  const tabTasks = new Map();'),source.indexOf("  document.addEventListener('stockai:tab', e => void loadTab"));
  const hosts=new Map();
  function element(){return {hidden:false,children:[],setAttribute(){},append(...x){this.children.push(...x);},prepend(x){this.notice=x;},querySelector(){return this.notice;},addEventListener(type,fn){this.click=fn;}};}
  let calls=[],rejectPortfolio=false,finish;
  const scope={console,Map,Date,document:{getElementById:id=>{if(!hosts.has(id))hosts.set(id,element());return hosts.get(id);},createElement:element},
    marketsLoaded:false,trendingLoaded:false,marketsLastStartedAt:0,moversFetchedAt:0,currentSymbol:'SPY',currentBars:[],
    renderWatchlistTab:()=>{calls.push('watchlist');return new Promise(resolve=>finish=resolve);},
    renderPortfolio:async()=>{calls.push('portfolio');if(rejectPortfolio)throw Error('offline');},
    renderMarketsTab:async()=>calls.push('markets'),loadNews:async()=>calls.push('news'),
    renderTrending:async()=>calls.push('trending'),renderWatchlistMini:async()=>{},refreshSavedAlerts:async()=>{},renderAlerts(){},
    renderEarnings:async()=>calls.push('ai'),runAI(){}};
  vm.createContext(scope);vm.runInContext(code+'\nthis.load=loadTab;',scope);
  const first=scope.load('watchlist');const second=scope.load('watchlist');
  assert.equal(calls.filter(x=>x==='watchlist').length,1);
  await scope.load('markets'); // pending watchlist does not freeze another tab
  finish();await Promise.all([first,second]);
  for(const tab of ['portfolio','news','trending','ai','screener','dashboard'])await scope.load(tab);
  assert.deepEqual(calls,['watchlist','markets','portfolio','news','trending','ai']);
  rejectPortfolio=true;await scope.load('portfolio');
  const notice=hosts.get('view-portfolio').notice;
  assert.equal(notice.hidden,false);
  rejectPortfolio=false;await notice.children[1].click();
  assert.equal(notice.hidden,true);
});

test('quotes preserve provider provenance and observation time for visible freshness labels',async()=>{
  const stock=api(async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({
    c:101,pc:100,d:1,dp:1,t:1792162800,source:'Yahoo latest available'
  })}));
  const quote=await stock.getQuote('SPY');
  assert.equal(quote.source,'Yahoo latest available');
  assert.equal(quote.observedAt,new Date(1792162800000).toISOString());
});
test('chart retry evicts only the selected history and retries current symbol',async()=>{
  const source=fs.readFileSync(path.join(root,'js/dashboard.js'),'utf8');
  const fn=source.slice(source.indexOf('  window.retryStockChart ='),source.indexOf('  function switchToLive()'));
  let calls=[];
  const scope={window:{},chart:{},console,currentSymbol:'SPY',
    StockAPI:{_cache:{c_SPY_D_365:{},c_GLD_D_365:{}}},
    loadStock:async sym=>calls.push(sym)};
  vm.createContext(scope);vm.runInContext(fn,scope);
  await scope.window.retryStockChart();
  assert.equal(scope.StockAPI._cache.c_SPY_D_365,undefined);
  assert.ok(scope.StockAPI._cache.c_GLD_D_365);
  assert.deepEqual(calls,['SPY']);
});
