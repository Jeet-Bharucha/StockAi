'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const dash=fs.readFileSync(path.join(root,'js/dashboard.js'),'utf8');
const html=fs.readFileSync(path.join(root,'dashboard.html'),'utf8');
const script=dash.slice(
  dash.indexOf('  // ── Markets tab ───────'),
  dash.indexOf('  // ── Watchlist sidebar ─────')
);

class FakeElement {
 constructor(tag='div') {
  this.tag=tag;this.children=[];this.style={};this.dataset={};
  this._text='';this.className='';
  const labels=new Set();
  this.classList={
    add:(...names)=>names.forEach(n=>labels.add(n)),
    remove:(...names)=>names.forEach(n=>labels.delete(n)),
    contains:name=>labels.has(name)
  };
 }
 set textContent(v){this._text=String(v);this.children=[];}
 get textContent(){return this.children.length?this.children.map(n=>n.textContent).join(''):this._text;}
 append(...els){this.children.push(...els);}
 appendChild(el){this.children.push(el);return el;}
 replaceChildren(...els){this.children=els;}
 setAttribute(){}
 addEventListener(){}
 querySelector(selector) {
   const matching=(node,expr)=>{
     const cls=expr.match(/\.([\w-]+)/)?.[1];
     const tag=expr.match(/^([a-z]+)/)?.[1];
     const data=expr.match(/\[data-symbol="([^"]+)"\]/)?.[1];
     return (!cls||String(node.className).split(' ').includes(cls))&&
       (!data||node.dataset.symbol===data)&&(!tag||node.tag===tag);
   };
   const nodes=this.children.slice();
   while(nodes.length){
     const node=nodes.shift();
     if(matching(node,selector))return node;
     nodes.push(...node.children);
   }
   return null;
 }
}
function createView(getQuote) {
 const ids=['heat-map','mkt-indices','mkt-sectors','mkt-commodities',
   'markets-data-status','mkt-breadth-summary','markets-refresh'];
 const hosts=Object.fromEntries(ids.map(id=>[id,new FakeElement()]));
 const document={
   createElement:tag=>new FakeElement(tag),
   getElementById:id=>hosts[id]||null,
   querySelector:sel=>{
      if(sel.startsWith('#heat-map'))return hosts['heat-map'].querySelector(sel.replace('#heat-map ',''));
      return null;
   }
 };
 const stockApi={_cache:{},getQuote};
 const groups={
   indices:[{sym:'SPY',name:'S&P 500 ETF'},{sym:'QQQ',name:'NASDAQ 100'}],
   sectors:[{sym:'XLK',name:'Technology'},{sym:'XLF',name:'Finance'}],
   commodities:[{sym:'GLD',name:'Gold ETF'},{sym:'USO',name:'Oil ETF'}]
 };
 const context={document,MARKET_GROUPS:groups,StockAPI:stockApi,
   console,Date,window:{},Number,Map,Set,Promise,
   renderResearchMetrics:(id,rows)=>{
     hosts[id].replaceChildren();
     for(const item of rows){
       const el=new FakeElement();
       el.textContent=item.label+': '+item.value;
       hosts[id].appendChild(el);
     }
   }};
 vm.createContext(context);
 vm.runInContext(script+'\n;globalThis.runMarketTest=renderMarketsTab;',context);
 return {run:context.runMarketTest,hosts,api:stockApi,context};
}

test('all three market sections render cards before any asynchronous quote resolves',async()=>{
 let release;
 const pending=new Promise(resolve=>{release=resolve;});
 const view=createView(async()=>pending);
 const complete=view.run();
 assert.equal(view.hosts['mkt-indices'].children.length,2);
 assert.equal(view.hosts['mkt-sectors'].children.length,2);
 assert.equal(view.hosts['mkt-commodities'].children.length,2);
 assert.equal(view.hosts['heat-map'].children.length,8);
 assert.match(view.hosts['mkt-indices'].textContent,/Loading/);
 release({price:100,changePct:1,source:'Fixture',observedAt:new Date().toISOString()});
 await complete;
 assert.match(view.hosts['mkt-indices'].textContent,/\$100\.00/);
 assert.match(view.hosts['mkt-breadth-summary'].textContent,/Verified sector ETFs/);
});

test('failed quote providers show unavailable text in every market section',async()=>{
 const view=createView(async()=>{throw Error('Finnhub 403; Yahoo 429');});
 await view.run();
 for(const name of ['mkt-indices','mkt-sectors','mkt-commodities']){
   assert.ok(view.hosts[name].children.length>0,name);
   assert.match(view.hosts[name].textContent,/Quote unavailable/,name);
 }
 assert.match(view.hosts['markets-data-status'].textContent,/unavailable/);
 assert.match(view.hosts['mkt-breadth-summary'].textContent,/0 \/ 8/);
});

test('manual retry clears stale in-memory quotes, and is independently actionable',async()=>{
 const view=createView(async()=>({price:120,changePct:-2,source:'Fixture'}));
 view.api._cache['q_SPY']={ts:1,data:{price:999,changePct:3}};
 await view.run(true);
 assert.equal(view.api._cache['q_SPY'],undefined);
 assert.equal(view.hosts['markets-refresh'].disabled,false);
 assert.match(view.hosts['mkt-indices'].textContent,/\$120\.00/);
});

test('PWA update and market retry are wired into the dashboard markup',()=>{
 assert.match(html,/id="markets-refresh"/);
 assert.match(html,/id="markets-data-status"/);
 for(const id of ['mkt-indices','mkt-sectors','mkt-commodities'])
   assert.ok(html.includes('id="'+id+'"'));
 assert.match(dash,/createMarketCards\(\); \/\/ Synchronous/);
 const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
 assert.match(sw,/stockai-v26/);
 assert.match(sw,/url\.pathname === '\/js\/dashboard\.js'/);
});
