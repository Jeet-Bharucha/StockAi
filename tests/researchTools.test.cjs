'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const {ResearchTools:R}=require('../js/researchTools');

test('curated research universe is correctly classified, diverse and contains no obsolete Twitter listing',()=>{
 const symbols=R.UNIVERSE.map(([s])=>s);
 assert.equal(new Set(symbols).size,symbols.length);
 assert.ok(symbols.length>=40);
 assert.equal(symbols.includes('TWTR'),false);
 for(const [ticker,sector] of [
   ['NVDA','Technology'],['JPM','Finance'],['V','Finance'],
   ['JNJ','Healthcare'],['XOM','Energy'],['META','Communication'],['TSLA','Consumer']
 ])assert.equal(R.sector(ticker),sector);
});

test('screener applies real sector, performance, price, cap and RSI filters',()=>{
 const rows=[
   {sym:'NVDA',sector:'Technology',price:150,changePct:3.3,rsi:28,cap:3100},
   {sym:'JPM',sector:'Finance',price:290,changePct:-1.1,rsi:65,cap:720},
   {sym:'V',sector:'Finance',price:320,changePct:1.0,rsi:null,cap:null},
   {sym:'XOM',sector:'Energy',price:60,changePct:-3.1,rsi:72,cap:500},
   {sym:'LLY',sector:'Healthcare',price:null,changePct:0,rsi:50,cap:700}
 ];
 assert.deepEqual(R.screen(rows,{sector:'Finance'}).map(x=>x.sym),['V','JPM']);
 assert.deepEqual(R.screen(rows,{perf:'big'}).map(x=>x.sym),['NVDA','XOM']);
 assert.deepEqual(R.screen(rows,{rsiFilter:'oversold'}).map(x=>x.sym),['NVDA']);
 assert.deepEqual(R.screen(rows,{capFilter:'large',sector:'Finance'}).map(x=>x.sym),['JPM']);
 assert.deepEqual(R.screen(rows,{minPrice:100,maxPrice:200}).map(x=>x.sym),['NVDA']);
 assert.deepEqual(R.screen(rows,{sort:'chg-asc'}).map(x=>x.sym),['XOM','JPM','V','NVDA']);
 assert.throws(()=>R.screen(rows,{minPrice:200,maxPrice:100}),/valid/);
});

test('market snapshot counts missing quotes separately from unchanged ETFs',()=>{
 const data=[
  {sym:'XLK',price:100,changePct:3},{sym:'XLV',price:200,changePct:-1},
  {sym:'XLE',price:50,changePct:0},{sym:'XLI',available:false}
 ];
 const b=R.breadth(data);
 assert.deepEqual([b.available,b.missing,b.up,b.down,b.flat],[3,1,1,1,1]);
 assert.equal(b.meanPct,0.67);
 assert.equal(b.leader.sym,'XLK');assert.equal(b.laggard.sym,'XLV');
 assert.equal(R.breadth([{sym:'AAPL'}]).meanPct,null);
});

test('watchlist sorting always places unquoted symbols after verified movers',()=>{
 const quotes={AAPL:{price:170,changePct:-2},MSFT:{price:330,changePct:1.4}};
 const syms=['NVDA','MSFT','AAPL'];
 assert.deepEqual(R.watchlistRows(syms,quotes,'chg-desc').map(r=>r.sym),['MSFT','AAPL','NVDA']);
 assert.deepEqual(R.watchlistRows(syms,quotes,'move-desc').map(r=>r.sym),['AAPL','MSFT','NVDA']);
 assert.equal(R.watchlistRows(syms,quotes)[0].sym,'AAPL');
});

test('portfolio insights combine the same ticker across accounts and flag estimated values',()=>{
 const insight=R.portfolioInsights([
   {symbol:'AAPL',value:600,priceSource:'live'},
   {symbol:'AAPL',value:200,priceSource:'live'},
   {symbol:'NVDA',value:200,priceSource:'cost'}
 ]);
 assert.equal(insight.holdings,3);
 assert.equal(insight.priced,2);
 assert.equal(insight.uniqueSymbols,2);
 assert.equal(insight.topSymbol,'AAPL');
 assert.equal(insight.topWeightPct,80);
 assert.equal(insight.top3WeightPct,100);
 assert.equal(insight.usesCostBasis,true);
 assert.equal(R.portfolioInsights([]).topWeightPct,null);
});

test('news strips duplicate/stale/unsafe headlines instead of implying they are current',()=>{
 const now=1900000000,valid={headline:'Market update',source:'Wire',datetime:now-100,url:'https://news.test/a?utm=one'};
 const articles=[valid,{...valid,url:'https://news.test/a?utm=two'},
  {...valid,headline:'Old',datetime:now-30*86400,url:'https://news.test/old'},
  {...valid,headline:'Unsafe',url:'javascript:alert(1)'},
  {...valid,headline:'Future',datetime:now+86400,url:'https://news.test/future'}
 ];
 const news=R.news(articles,now);
 assert.equal(news.length,1);assert.equal(news[0].headline,'Market update');
});

test('CSV output quotes text and neutralizes spreadsheet formulas',()=>{
 assert.equal(R.csvCell('Acme, Inc.'),'"Acme, Inc."');
 assert.equal(R.csvCell('=1+2'),'"\'=1+2"');
 assert.equal(R.csvCell('  @cmd'),'"\'  @cmd"');
 assert.equal(R.csvCell(23.40),'"23.4"');
});

test('all tab-specific research features are wired to the dashboard and valid JS',()=>{
 const html=fs.readFileSync(path.join(root,'dashboard.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'js/dashboard.js'),'utf8');
 assert.match(html,/src="js\/researchTools\.js"/);
 for(const id of ['mkt-breadth-summary','watchlist-sort','watchlist-coverage',
   'port-risk-insights','trending-sort','trending-meta','scr-export',
   'btn-claude-explain'])
   assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
 assert.doesNotMatch(html,/<option value="vol-desc">/);
 assert.match(js,/window\.exportScreenerCSV/);
 assert.match(js,/window\.explainWithAI/);
 assert.match(js,/ResearchTools\.portfolioInsights/);
 assert.doesNotMatch(js, /fetchClaudeAnalysis\(currentSymbol, curPrice, prediction\)/);
 assert.doesNotThrow(()=>new vm.Script(js));
});
