'use strict';
const {test,expect}=require('@playwright/test');
const path=require('node:path');
async function setup(page,{outage=false}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{localStorage.setItem('stockai_session',JSON.stringify({userId:'fixture-owner',name:'Browser Test',email:'test@example.invalid',role:'owner',expires:Date.now()+86400000}));localStorage.setItem('stockai_jwt','fixture-token');localStorage.setItem('stockai_tour_done','1');});
 await page.route('https://**/*',async route=>{
  if(route.request().url().includes('lightweight-charts'))return route.fulfill({path:path.resolve('node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'),contentType:'text/javascript'});
  return route.abort();
 });
 let state={version:0,lists:[],screens:[],emailAlerts:false,backgroundEnabled:true,emailConfigured:true},transactions=[];
 const now=Math.floor(Date.now()/1000),bars=Array.from({length:80},(_,i)=>({t:Math.floor((now-90*86400)/86400)*86400+i*86400,o:100+i,h:102+i,l:99+i,c:101+i,v:1000000}));
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url()),p=url.pathname,method=route.request().method();let body={};let status=200;
  if(p==='/api/user/research'){
   if(method==='PUT'){const v=route.request().postDataJSON();state={...state,...v,version:state.version+1};}body=state;
  }else if(p==='/api/user/ledger'){
   if(method==='POST'){transactions.push(route.request().postDataJSON());state.version++;body={ok:true};}
   else body={version:state.version,transactions,book:{cash:transactions.length?1000:0,realized:0,dividends:0},valuation:{equity:transactions.length?1000:0,unrealized:0,missing:[]},snapshots:[],performance:null};
  }else if(p==='/api/user/ledger/snapshot'){body={equity:1000,at:new Date().toISOString()};}
  else if(p.startsWith('/api/research/overview/'))body=outage?{symbol:'AAPL',source:'Finnhub',fetchedAt:new Date().toISOString(),profile:null,metrics:null,earnings:null}:{symbol:'AAPL',source:'Finnhub',fetchedAt:new Date().toISOString(),profile:{name:'Fixture company',exchange:'NASDAQ',industry:'Technology',currency:'USD'},metrics:{pe:25,eps:4,roe:20,low52:80,high52:160,averageVolume10dMillions:2},earnings:[{date:'2030-01-01',epsEstimate:2,revenueEstimate:1e9}]};
  else if(p==='/api/quote'){if(outage){status=502;body={error:'Quote unavailable',code:'QUOTE_UNAVAILABLE'};}else body={c:120,pc:119,d:1,dp:.84,h:121,l:118,o:119,t:now,source:'Fixture feed'};}
  else if(p==='/api/candle')body=outage?{s:'no_data'}:{s:'ok',t:bars.map(b=>b.t),o:bars.map(b=>b.o),h:bars.map(b=>b.h),l:bars.map(b=>b.l),c:bars.map(b=>b.c),v:bars.map(b=>b.v)};
  else if(p==='/api/profile')body={name:'Fixture company',finnhubIndustry:'Technology',marketCapitalization:100000};
  else if(p==='/api/news')body=outage?[]:[{headline:'Fixture market headline',source:'Fixture publisher',url:'https://example.com/news',datetime:now,summary:'Test article'}];
  else if(p==='/api/user/watchlist')body={watchlist:['SPY']};
  else if(p==='/api/user/portfolio')body=[];
  else if(p==='/api/user/alerts/check')body={fired:[]};
  else if(p==='/api/user/alerts')body={alerts:[]};
  else if(p==='/api/user/forward-signals')body={signals:[],performance:{allSaved:0,directionalResolved:0,pending:0,hitRatePct:null}};
  else if(p==='/api/admin/operations')body={database:'connected',uptimeSeconds:30,backgroundEnabled:true,workerStale:false,worker:{lastSuccess:new Date().toISOString()}};
  else body={ok:true};
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/dashboard.html');await expect(page.locator('#loading-screen')).toBeHidden();return {errors,getState:()=>state};
}
async function nav(page,tab){
 const menu=page.locator('#sidebar-toggle');if(await menu.isVisible())await menu.click();
 await page.locator(`.nav-item[onclick*="'${tab}'"]`).click();
 await expect(page.locator('#view-'+tab)).toBeVisible();
}
test('all eight tabs remain visible after Portfolio, with usable Markets, News, Movers and chart',async({page})=>{
 const {errors}=await setup(page);
 for(const tab of ['dashboard','ai','watchlist','portfolio','markets','news','trending','screener']){
  await nav(page,'portfolio');await nav(page,tab);
  await expect(page.locator('.tab-view.active')).toHaveCount(1);
 }
 await nav(page,'markets');await expect(page.locator('#mkt-indices button')).toHaveCount(4);await expect(page.locator('#mkt-indices')).toContainText('$120.00');
 await page.getByRole('button',{name:'Refresh market quotes'}).click();
 await nav(page,'news');await expect(page.locator('#news-list')).toContainText('Fixture market headline');
 await nav(page,'trending');await expect(page.locator('#trend-grid button').first()).toBeVisible();
 await nav(page,'dashboard');await expect(page.locator('#price-chart canvas').first()).toBeVisible();await expect(page.locator('#stock-price')).toHaveText('$120.00');
 if(process.env.STOCKAI_QA_SCREENSHOT_DIR){
  const dir=process.env.STOCKAI_QA_SCREENSHOT_DIR;require('node:fs').mkdirSync(dir,{recursive:true});
  await page.evaluate(()=>{const label=document.createElement('div');label.textContent='LOCAL QA | FIXTURE DATA | NOT LIVE PRICES';label.style.cssText='position:fixed;bottom:0;left:0;right:0;padding:8px;background:#543c00;color:#fff;text-align:center;z-index:99999;font:12px sans-serif';document.body.append(label);});
  await page.screenshot({path:path.join(dir,'stockai-'+(page.viewportSize().width<600?'mobile':'desktop')+'.png')});
 }
 expect(errors).toEqual([]);
});
test('research lists, saved screens, ledger and email preference survive reload',async({page})=>{
 const {errors}=await setup(page);
 await nav(page,'watchlist');await page.getByLabel('New list name',{exact:true}).fill('Long term');await page.getByRole('button',{name:'Create research list',exact:true}).click();
 await page.getByLabel('List symbol',{exact:true}).fill('SPY');await page.getByLabel('Research note',{exact:true}).fill('Review allocation');await page.getByLabel('Target price (optional)',{exact:true}).fill('150');await page.getByRole('button',{name:'Save list item',exact:true}).click();
 await expect(page.locator('#research-lists')).toContainText('Review allocation');
 await nav(page,'screener');await page.locator('#saved-screens > summary').click();await page.getByLabel('Screen name',{exact:true}).fill('Value');await page.getByLabel('Maximum P/E',{exact:true}).fill('30');await page.getByRole('button',{name:'Save current screen',exact:true}).click();
 await page.getByRole('button',{name:'Run fundamentals filter',exact:true}).click();await expect(page.locator('#saved-screens')).toContainText('10/10');
 await nav(page,'portfolio');await page.locator('#transaction-ledger > summary').click();await page.getByRole('button',{name:'Load / refresh ledger',exact:true}).click();await page.getByLabel('Cash amount USD',{exact:true}).fill('1000');await page.getByRole('button',{name:'Record transaction',exact:true}).click();await expect(page.locator('#transaction-ledger')).toContainText('$1,000.00');
 await nav(page,'trending');await page.getByLabel('Email my triggered price alerts',{exact:true}).check();await page.getByRole('button',{name:'Save alert preference',exact:true}).click();await expect(page.locator('#email-alert-settings')).toContainText('saved email preference: on');
 await page.reload();await nav(page,'watchlist');await expect(page.locator('#research-lists')).toContainText('Review allocation');await nav(page,'screener');await page.locator('#saved-screens > summary').click();await expect(page.getByLabel('Saved screen',{exact:true})).toContainText('Value');expect(errors).toEqual([]);
});
test('provider outage never hides panels or invents prices; light/reduced-motion layout stays usable',async({page})=>{
 const {errors}=await setup(page,{outage:true});await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'Switch color mode'}).click();
 await nav(page,'markets');await expect(page.locator('#mkt-indices')).toContainText('Quote unavailable');await expect(page.locator('#mkt-sectors')).not.toContainText('$120');
 await nav(page,'news');await expect(page.locator('#news-list')).toContainText('No recent verified');
 await nav(page,'trending');await expect(page.locator('#trend-grid')).toContainText('unavailable');
 await nav(page,'dashboard');await expect(page.getByRole('button',{name:'Retry chart',exact:true})).toBeVisible();await expect(page.locator('#stock-price')).toHaveText('—');
 await expect(page.locator('#stock-overview')).toContainText('Earnings feed unavailable');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});
