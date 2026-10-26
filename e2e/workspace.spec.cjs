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
 let state={version:0,lists:[],screens:[],emailAlerts:false,backgroundEnabled:true,emailConfigured:true},transactions=[],holdings=[],alerts=[];let watchlist=['SPY'];
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
  else if(p.startsWith('/api/research/currency/'))body={currency:'USD'};
  else if(p.startsWith('/api/research/company-details/'))body={source:'Finnhub',fetchedAt:new Date().toISOString(),from:'2024-01-01',to:'2027-01-01',reports:null,dividends:null,splits:[{date:'2026-01-01',toFactor:4,fromFactor:1}]};
  else if(p==='/api/admin/email-readiness')body={state:'missing-settings',missing:['RESEND_FROM_EMAIL'],note:'Sender settings are incomplete.'};
  else if(p==='/api/admin/email-self-test')body={state:'provider-accepted',message:'Provider accepted test. Check inbox; not proof of delivery.'};
  else if(p==='/api/quote'){if(outage){status=502;body={error:'Quote unavailable',code:'QUOTE_UNAVAILABLE'};}else body={c:120,pc:119,d:1,dp:.84,h:121,l:118,o:119,t:now,source:'Fixture feed'};}
  else if(p==='/api/candle')body=outage?{s:'no_data'}:{s:'ok',t:bars.map(b=>b.t),o:bars.map(b=>b.o),h:bars.map(b=>b.h),l:bars.map(b=>b.l),c:bars.map(b=>b.c),v:bars.map(b=>b.v)};
  else if(p==='/api/profile')body={name:'Fixture company',finnhubIndustry:'Technology',marketCapitalization:100000};
  else if(p==='/api/news')body=outage?[]:[{headline:'Fixture market headline',source:'Fixture publisher',url:'https://example.com/news',datetime:now,summary:'Test article'}];
  else if(p==='/api/health')body={service:'stockai',ok:true,database:'connected'};
  else if(p==='/api/version')body={commit:'fixture-revision'};
  else if(p==='/api/capabilities')body={aiCommentary:'not-configured',localChartAssistant:'available',email:{settingsPresent:false,senderMode:'missing',backgroundWorkerEnabled:false,deliveryVerified:false},passwordRecoverySettingsPresent:false,accessMode:'private'};
  else if(p==='/api/user/watchlist'){if(method==='PUT')watchlist=route.request().postDataJSON().watchlist;body={watchlist};}
  else if(p==='/api/user/portfolio'){if(method==='POST'){const data=route.request().postDataJSON();body={...data,id:'holding-'+holdings.length};holdings.push(body);}else body=holdings;}
  else if(p.startsWith('/api/user/portfolio/')){const id=p.split('/').at(-1);if(method==='PUT'){const h=holdings.find(h=>h.id===id);Object.assign(h,route.request().postDataJSON());body=h;}else if(method==='DELETE'){holdings=holdings.filter(h=>h.id!==id);body={ok:true};}}
  else if(p==='/api/portfolio-prices')body=Object.fromEntries((url.searchParams.get('symbols')||'').split(',').filter(Boolean).map(sym=>[sym,outage?{price:null,change24h:null}:{price:120,change24h:.84,source:'Fixture feed',currency:'USD',observedAt:new Date().toISOString()}]));
  else if(p==='/api/user/alerts/check')body={fired:[]};
  else if(p==='/api/user/alerts'){if(method==='POST'){const alert={...route.request().postDataJSON(),id:'alert-'+alerts.length,triggered:false};alerts.push(alert);body={alert};}else body={alerts};}
  else if(p.startsWith('/api/user/alerts/')&&method==='DELETE'){alerts=alerts.filter(a=>a.id!==p.split('/').at(-1));body={ok:true};}
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


test('keyboard search, recent symbols, custom screen, company actions and email readiness are usable',async({page})=>{
 const {errors}=await setup(page);const search=page.locator('#stock-search');await search.fill('SP');await search.press('ArrowDown');await expect(search).toHaveAttribute('aria-expanded','true');await expect(search).toHaveAttribute('aria-activedescendant','stock-option-0');const selected=await page.locator('#stock-option-0 b').textContent();await search.press('Enter');await expect(page.locator('#current-symbol')).toHaveText(selected);await search.fill('');await expect(page.locator('#search-dropdown')).toContainText(selected);await search.press('Escape');await expect(search).toHaveAttribute('aria-expanded','false');
 await page.getByRole('button',{name:'Load statements, dividends & splits',exact:true}).click();await expect(page.locator('#stock-overview')).toContainText('Financial statements unavailable');await expect(page.locator('#stock-overview')).toContainText('2026-01-01');
 await page.locator('#operations-status > summary').click();await page.getByRole('button',{name:'Check email sender readiness',exact:true}).click();await expect(page.locator('#operations-status')).toContainText('missing-settings');
 await nav(page,'screener');await page.locator('#saved-screens > summary').click();await page.getByLabel('Custom screener symbols (up to 50, comma separated)',{exact:true}).fill('SPY,GLD');await page.locator('#scr-run').click();await expect(page.locator('#scr-meta')).toContainText('custom list of 2 symbols');
 expect(errors).toEqual([]);
});


test('comparison, feature status and chart assistant stay useful without optional AI',async({page})=>{
 const {errors}=await setup(page);await page.locator('#service-readiness > summary').click();await expect(page.locator('#service-readiness')).toContainText('Sender setup incomplete');await nav(page,'ai');await expect(page.locator('#btn-claude-explain')).toBeDisabled();await nav(page,'dashboard');
 await page.locator('#company-comparison > summary').click();await page.getByLabel('Symbols to compare (up to 4)',{exact:true}).fill('AAPL,MSFT');await page.getByRole('button',{name:'Compare companies',exact:true}).click();await expect(page.locator('#company-comparison')).toContainText('2/2 symbols');const [comparisonFile]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export company comparison CSV',exact:true}).click()]);const comparisonCSV=require('node:fs').readFileSync(await comparisonFile.path(),'utf8');expect(comparisonCSV).toContain('Quote observed at');expect(comparisonCSV).toContain('AAPL');const [connectionFile]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download connection report',exact:true}).click()]);const connectionJSON=require('node:fs').readFileSync(await connectionFile.path(),'utf8');expect(connectionJSON).not.toContain('test@example.invalid');expect(connectionJSON).not.toContain('fixture-token');if(process.env.STOCKAI_QA_SCREENSHOT_DIR){await page.evaluate(()=>{const label=document.createElement('div');label.textContent='LOCAL QA • FIXTURE DATA • NOT LIVE PRICES';label.style.cssText='position:fixed;bottom:0;left:0;right:0;padding:8px;background:#543c00;color:white;z-index:99999;text-align:center';document.body.append(label);});await page.locator('#company-comparison').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.STOCKAI_QA_SCREENSHOT_DIR,'stockai-comparison-'+(page.viewportSize().width<600?'mobile':'desktop')+'.png')});}await page.getByLabel('Symbols to compare (up to 4)',{exact:true}).fill('AAPL,MSFT,SPY,GLD,XLK');await page.getByRole('button',{name:'Compare companies',exact:true}).click();await expect(page.locator('#company-comparison')).toContainText('Enter 1–4 valid symbols');
 await page.locator('#chat-fab').click();await page.locator('#chat-chips button').first().click();await expect(page.locator('#chat-messages')).toContainText('RSI');await page.getByLabel('Ask the chart assistant').fill('<img src=x onerror=alert(1)>');await page.locator('.btn-chat-send').click();await expect(page.locator('#chat-messages img')).toHaveCount(0);await expect(page.locator('#chat-messages')).toContainText('<img');await page.locator('#chat-panel button[title="Close"]').click();
 await page.locator('#btn-3d').click();await expect(page.locator('#price-chart')).toBeVisible();await expect(page.locator('#chart-3d-wrap')).toBeHidden();expect(errors).toEqual([]);
});

test('holding add edit delete and saved alert controls persist confirmed fixture changes',async({page})=>{
 const {errors}=await setup(page);page.on('dialog',dialog=>dialog.accept());await nav(page,'portfolio');await page.getByRole('button',{name:'+ Add Holding',exact:true}).click();await page.locator('#port-sym').fill('AAPL');await page.locator('#port-shares').fill('2');await page.locator('#port-price').fill('100');await page.locator('#port-add-form button').click();await expect(page.locator('#port-list')).toContainText('AAPL');await expect(page.locator('#port-value')).toHaveText('$240.00');const [portfolioFile]=await Promise.all([page.waitForEvent('download'),page.locator('button[onclick="exportPortfolioCSV()"]').click()]);const portfolioCSV=require('node:fs').readFileSync(await portfolioFile.path(),'utf8');expect(portfolioCSV).toContain('Observed At');expect(portfolioCSV).toContain('Fixture feed');expect(portfolioCSV).toContain('USD');
 await page.locator('#port-list button[onclick*="openEditHolding"]').click();await page.locator('#edit-hold-shares').fill('3');await page.getByRole('button',{name:'Save Changes',exact:true}).click();await expect(page.locator('#port-value')).toHaveText('$360.00');await page.reload();await nav(page,'portfolio');await expect(page.locator('#port-value')).toHaveText('$360.00');await page.locator('#port-list button[onclick*="removeHolding"]').click();await expect(page.locator('#port-list')).toContainText('No holdings yet');
 await nav(page,'trending');await page.locator('#alert-sym').fill('SPY');await page.locator('#alert-price').fill('100');await page.getByRole('button',{name:'Set Alert',exact:true}).click();await expect(page.locator('#alert-list')).toContainText('SPY');await page.reload();await nav(page,'trending');await expect(page.locator('#alert-list')).toContainText('SPY');await page.getByRole('button',{name:'Remove SPY alert',exact:true}).click();await expect(page.locator('#alert-list')).toContainText('No price alerts set');expect(errors).toEqual([]);
});

test('switching to missing history clears old signals and assistant prices',async({page})=>{
 const {errors}=await setup(page);await expect(page.locator('#ai-rsi')).not.toHaveText('—');await page.route('**/api/candle?**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({s:'no_data'})}));await page.locator('#stock-search').fill('GLD');await page.locator('#stock-search').press('Enter');await nav(page,'ai');await expect(page.locator('#ai-direction')).toHaveText('No verified signal data');await expect(page.locator('#ai-rsi')).toHaveText('—');await expect(page.locator('#signals-tbody tr')).toHaveCount(0);await page.locator('#chat-fab').click();await page.getByLabel('Ask the chart assistant').fill('price');await page.locator('.btn-chat-send').click();await expect(page.locator('#chat-messages')).toContainText('data unavailable');await expect(page.locator('#chat-messages')).not.toContainText('$0.00');expect(errors).toEqual([]);
});

test('expired account access cannot create phantom research lists and offline status can recover',async({page,context})=>{
 const {errors}=await setup(page);await page.route('**/api/user/research',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Session expired. Sign in again.'})}));await page.reload();await nav(page,'watchlist');await page.getByLabel('New list name',{exact:true}).fill('Cannot save');await page.getByRole('button',{name:'Create research list',exact:true}).click();await expect(page.locator('#view-watchlist')).toContainText('Sign in and sync account settings first');await expect(page.getByLabel('Research list',{exact:true})).not.toContainText('Cannot save');await nav(page,'dashboard');await page.locator('#service-readiness > summary').click();await context.setOffline(true);for(const endpoint of ['health','version','capabilities'])await page.route('**/api/'+endpoint,route=>route.abort('internetdisconnected'));await page.getByRole('button',{name:'Check connections',exact:true}).click();await expect(page.locator('#service-readiness')).toContainText('Unable to check');await context.setOffline(false);for(const endpoint of ['health','version','capabilities'])await page.unroute('**/api/'+endpoint);await page.getByRole('button',{name:'Check connections',exact:true}).click();await expect(page.locator('#service-readiness')).toContainText('connected');expect(errors).toEqual([]);
});

test('cleared and superseded chart comparisons cannot reappear after a slow response',async({page})=>{
 const {errors}=await setup(page);await expect(page.locator('#stock-price')).toHaveText('$120.00');
 let release,arrived;const ready=new Promise(resolve=>arrived=resolve);
 await page.route('**/api/candle?**',async route=>{if(new URL(route.request().url()).searchParams.get('symbol')!=='GLD')return route.fallback();arrived();await new Promise(resolve=>release=resolve);const now=Math.floor(Date.now()/1000);await route.fulfill({contentType:'application/json',body:JSON.stringify({s:'ok',t:[now-86400,now],o:[100,101],h:[102,103],l:[99,100],c:[101,102],v:[100,100]})});});
 await page.locator('#btn-compare').click();await page.getByLabel('Chart comparison symbol').fill('GLD');await page.getByLabel('Chart comparison symbol').press('Enter');await ready;await expect(page.locator('#compare-legend')).toContainText('Loading GLD');await page.locator('.btn-cmp-clear').click();const response=page.waitForResponse(r=>r.url().includes('/api/candle?')&&r.url().includes('GLD'));release();await (await response).finished();await expect(page.locator('#compare-legend')).toBeEmpty();
 let releaseSecond,arrivedSecond;const secondReady=new Promise(resolve=>arrivedSecond=resolve);
 await page.route('**/api/candle?**',async route=>{if(new URL(route.request().url()).searchParams.get('symbol')!=='MSFT')return route.fallback();arrivedSecond();await new Promise(resolve=>releaseSecond=resolve);await route.fulfill({contentType:'application/json',body:JSON.stringify({s:'no_data'})});});
 await page.getByLabel('Chart comparison symbol').fill('MSFT');await page.locator('.btn-cmp-go').click();await secondReady;await page.locator('#stock-search').fill('XLK');await page.locator('#stock-search').press('Enter');await expect(page.locator('#current-symbol')).toHaveText('XLK');const secondResponse=page.waitForResponse(r=>r.url().includes('/api/candle?')&&r.url().includes('MSFT'));releaseSecond();await (await secondResponse).finished();await expect(page.locator('#compare-legend')).toBeEmpty();await expect(page.getByLabel('Chart comparison symbol')).toHaveValue('');await page.locator('#btn-compare').click();await expect(page.locator('#compare-panel')).toBeHidden();expect(errors).toEqual([]);
});

test('dialogs trap focus, close from inputs and restore the trigger on a short screen',async({page})=>{
 const {errors}=await setup(page);await page.setViewportSize({width:page.viewportSize().width,height:520});await page.keyboard.press('?');const shortcuts=page.getByRole('dialog',{name:'Keyboard shortcuts',exact:true});await expect(shortcuts).toBeVisible();await expect(page.getByRole('button',{name:'Close keyboard shortcuts'})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Close keyboard shortcuts'})).toBeFocused();await page.keyboard.press('Escape');await expect(shortcuts).toBeHidden();
 await nav(page,'portfolio');await page.getByRole('button',{name:'+ Add Holding',exact:true}).click();await page.locator('#port-sym').fill('AAPL');await page.locator('#port-shares').fill('2');await page.locator('#port-price').fill('100');await page.locator('#port-add-form button').click();await expect(page.locator('#port-list')).toContainText('AAPL');const edit=page.locator('#port-list button[onclick*="openEditHolding"]');await edit.click();const dialog=page.getByRole('dialog',{name:'Edit holding',exact:true});await expect(dialog).toBeVisible();await expect(page.locator('.app')).toHaveAttribute('inert','');await page.getByRole('button',{name:'Save Changes',exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Close edit holding'})).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Save Changes',exact:true})).toBeFocused();await page.getByRole('textbox',{name:'Name',exact:true}).fill('Keyboard test');await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(edit).toBeFocused();await expect(page.locator('.app')).not.toHaveAttribute('inert','');expect(errors).toEqual([]);
});

test('quick research actions and comparison distinguish expired access from missing market data',async({page})=>{
 const {errors}=await setup(page);const actions=page.getByRole('region',{name:'Research shortcuts'});await actions.getByRole('button',{name:'Explore markets'}).click();await expect(page.locator('#view-markets')).toBeVisible();await expect(page.locator('#view-markets .view-title')).toBeFocused();await nav(page,'dashboard');await actions.getByRole('button',{name:'Open company comparison'}).click();await expect(page.locator('#company-comparison')).toHaveAttribute('open','');await expect(page.locator('#company-comparison summary')).toBeFocused();await expect(page.getByRole('button',{name:'Export company comparison CSV'})).toBeDisabled();
 await page.route('**/api/research/overview/**',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'expired'})}));await page.route('**/api/quote?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'unavailable'})}));await page.getByLabel('Symbols to compare (up to 4)').fill('ZZZZ');await page.getByRole('button',{name:'Compare companies',exact:true}).click();await expect(page.locator('#company-comparison')).toContainText('Sign in again to continue');await expect(page.locator('#company-comparison')).toContainText('Quote unavailable');await expect(page.locator('#company-comparison')).not.toContainText('$0');await expect(page.locator('#company-comparison')).not.toContainText('Unavailable%');expect(errors).toEqual([]);
});

test('comparison rejects stale and future quotes while keeping genuine fundamentals readable',async({page})=>{
 const {errors}=await setup(page);await page.getByRole('region',{name:'Research shortcuts'}).getByRole('button',{name:'Open company comparison'}).click();
 await page.route('**/api/quote?**',route=>{const sym=new URL(route.request().url()).searchParams.get('symbol');return route.fulfill({contentType:'application/json',body:JSON.stringify({c:99999,pc:99998,d:1,dp:.01,t:Math.floor(Date.now()/1000)+(sym==='OLD'?-14*86400:3600),source:'Untrusted time fixture'})});});
 await page.getByLabel('Symbols to compare (up to 4)').fill('OLD,FUTURE');await page.getByRole('button',{name:'Compare companies',exact:true}).click();await expect(page.locator('#company-comparison')).toContainText('0/2 symbols');await expect(page.locator('#company-comparison')).not.toContainText('99,999');await expect(page.locator('#company-comparison')).toContainText('Quote unavailable');await expect(page.locator('#company-comparison table')).toContainText('25');expect(errors).toEqual([]);
});
