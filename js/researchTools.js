/* StockAI ResearchTools v1
 * Pure, testable view helpers. Nothing here produces predictive probabilities
 * or substitutes fabricated prices for unavailable market data.
 */
const ResearchTools = {
  UNIVERSE: Object.freeze([
    ['AAPL','Technology'],['MSFT','Technology'],['NVDA','Technology'],
    ['AMD','Technology'],['INTC','Technology'],['AMZN','Consumer'],
    ['TSLA','Consumer'],['DIS','Consumer'],['UBER','Consumer'],
    ['LYFT','Consumer'],['RBLX','Consumer'],
    ['GOOGL','Communication'],['META','Communication'],['NFLX','Communication'],
    ['SPOT','Communication'],['SNAP','Communication'],['PINS','Communication'],
    ['JPM','Finance'],['BAC','Finance'],['GS','Finance'],['MS','Finance'],
    ['WFC','Finance'],['V','Finance'],['MA','Finance'],
    ['PYPL','Finance'],['COIN','Finance'],['AXP','Finance'],['HOOD','Finance'],
    ['JNJ','Healthcare'],['PFE','Healthcare'],['UNH','Healthcare'],
    ['ABBV','Healthcare'],['MRK','Healthcare'],['LLY','Healthcare'],
    ['BMY','Healthcare'],['CVS','Healthcare'],['AMGN','Healthcare'],
    ['GILD','Healthcare'],
    ['XOM','Energy'],['CVX','Energy'],['COP','Energy'],
    ['SLB','Energy'],['OXY','Energy'],
    ['NEE','Utilities'],['DUK','Utilities'],['SO','Utilities'],
    ['AEP','Utilities'],['PCG','Utilities']
  ]),

  sampleUniverse(limit=30, sector='') {
    const maximum=Math.max(0,Math.min(100,Math.floor(Number(limit)||0)));
    const eligible=this.UNIVERSE.filter(row=>!sector||row[1]===sector);
    if(sector)return eligible.slice(0,maximum);
    // Round-robin by sector, avoiding a tech/finance-only sample when rate
    // limits cap the all-sectors scan to 30 symbols.
    const groups=new Map();
    for(const row of eligible){
      if(!groups.has(row[1]))groups.set(row[1],[]);
      groups.get(row[1]).push(row);
    }
    const selected=[];
    while(selected.length<maximum){
      let progress=false;
      for(const rows of groups.values()){
        if(!rows.length)continue;
        selected.push(rows.shift());
        progress=true;
        if(selected.length===maximum)break;
      }
      if(!progress)break;
    }
    return selected;
  },

  sector(symbol) {
    return this.UNIVERSE.find(row=>row[0]===symbol)?.[1] || 'Other';
  },

  validQuote(q) {
    return q && Number.isFinite(q.price) && q.price>0 &&
      Number.isFinite(q.changePct);
  },

  sortQuoteRows(rows, sort='chg-desc') {
    const funcs={
      'chg-desc':(a,b)=>b.changePct-a.changePct,
      'chg-asc':(a,b)=>a.changePct-b.changePct,
      'move-desc':(a,b)=>Math.abs(b.changePct)-Math.abs(a.changePct),
      'price-desc':(a,b)=>b.price-a.price,
      'price-asc':(a,b)=>a.price-b.price,
      'alpha':(a,b)=>a.sym.localeCompare(b.sym),
      'rsi-desc':(a,b)=>(b.rsi??-1)-(a.rsi??-1),
      'rsi-asc':(a,b)=>(a.rsi??101)-(b.rsi??101),
      'cap-desc':(a,b)=>(b.cap??-1)-(a.cap??-1)
    };
    return [...rows].sort((a,b)=>(funcs[sort]||funcs['chg-desc'])(a,b) ||
      a.sym.localeCompare(b.sym));
  },

  screen(rows, options={}) {
    const min=options.minPrice==null ? 0:Number(options.minPrice);
    const max=options.maxPrice==null ? Infinity:Number(options.maxPrice);
    if (!Number.isFinite(min) || min<0 ||
        (!Number.isFinite(max) && max!==Infinity) || max<min)
      throw new Error('Choose a valid minimum and maximum price.');
    let valid=rows.filter(r=>this.validQuote(r) && r.price>=min && r.price<=max);
    if(options.sector)valid=valid.filter(r=>r.sector===options.sector);
    if(options.perf==='gainers')valid=valid.filter(r=>r.changePct>0);
    if(options.perf==='losers')valid=valid.filter(r=>r.changePct<0);
    if(options.perf==='big')valid=valid.filter(r=>Math.abs(r.changePct)>=2);
    const f=options.rsiFilter;
    if(f)valid=valid.filter(r=>Number.isFinite(r.rsi)&&
      (f==='oversold'?r.rsi<30:f==='overbought'?r.rsi>70:r.rsi>=30&&r.rsi<=70));
    const cap=options.capFilter;
    if(cap)valid=valid.filter(r=>Number.isFinite(r.cap)&&
      (cap==='large'?r.cap>=100:cap==='mid'?r.cap>=10&&r.cap<100:r.cap<10));
    return this.sortQuoteRows(valid,options.sort);
  },

  breadth(rows) {
    const valid=rows.filter(row=>this.validQuote(row));
    const up=valid.filter(row=>row.changePct>0).length;
    const down=valid.filter(row=>row.changePct<0).length;
    const flat=valid.length-up-down;
    const avg=valid.length ? valid.reduce((s,r)=>s+r.changePct,0)/valid.length : null;
    return {
      available:valid.length,missing:rows.length-valid.length,up,down,flat,
      meanPct:avg===null?null:Math.round(avg*100)/100,
      leader:valid.length?this.sortQuoteRows(valid)[0]:null,
      laggard:valid.length?this.sortQuoteRows(valid,'chg-asc')[0]:null
    };
  },

  watchlistRows(symbols,quotes,sort='alpha') {
    const rows=symbols.map(sym=>{
      const quote=quotes[sym];
      return {sym, price:this.validQuote(quote)?quote.price:null,
        changePct:this.validQuote(quote)?quote.changePct:null};
    });
    if(sort==='alpha')return rows.sort((a,b)=>a.sym.localeCompare(b.sym));
    // Unavailable quotes always last; never treat missing as 0% change.
    const available=rows.filter(r=>r.price!==null);
    const missing=rows.filter(r=>r.price===null);
    return [...this.sortQuoteRows(available,sort),...missing.sort((a,b)=>a.sym.localeCompare(b.sym))];
  },

  portfolioInsights(rows) {
    const valid=rows.filter(r=>Number.isFinite(r.value)&&r.value>=0);
    const value=valid.reduce((s,r)=>s+r.value,0);
    const priced=valid.filter(r=>r.priceSource==='live');
    const holdings=valid.length;
    const groups=new Map();
    for (const h of valid) {
      const entry=groups.get(h.symbol)||{sym:h.symbol,value:0,holdings:0};
      entry.value+=h.value;entry.holdings++;groups.set(h.symbol,entry);
    }
    const sorted=[...groups.values()].sort((a,b)=>b.value-a.value);
    const top=sorted[0] || null;
    return {
      holdings,priced:priced.length,missing:holdings-priced.length,
      uniqueSymbols:sorted.length,
      topSymbol:top?.sym||null,topValue:top?.value||0,
      topWeightPct:value&&top?Math.round(top.value/value*1000)/10:null,
      top3WeightPct:value?Math.round(sorted.slice(0,3).reduce((s,r)=>s+r.value,0)/value*1000)/10:null,
      approximateValue:value,usesCostBasis:priced.length!==holdings
    };
  },

  news(articles, nowSeconds=Date.now()/1000) {
    if(!Array.isArray(articles))return [];
    const seen=new Set();
    return articles.filter(a=>{
      const timestamp=Number(a.datetime);
      if(!Number.isFinite(timestamp) || timestamp<=0 ||
         timestamp>nowSeconds+3600 || timestamp<nowSeconds-14*86400) return false;
      if(typeof a.headline!=='string'||!a.headline.trim()||
         typeof a.url!=='string') return false;
      let u;
      try {u=new URL(a.url);if(u.protocol!=='https:' && u.protocol!=='http:')return false}
      catch(_){return false}
      const key=u.origin+u.pathname;
      if(seen.has(key))return false;
      seen.add(key);return true;
    }).sort((a,b)=>b.datetime-a.datetime).slice(0,12);
  },

  csvCell(value) {
    // Escape spreadsheet formulas before CSV export (RFC 4180 quoting).
    let s=String(value??'');
    if (/^[\s]*[=+@-]/.test(s) && !/^-?\d+(?:\.\d+)?$/.test(s.trim())) s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  }
};

if(typeof module!=='undefined' && module.exports)module.exports={ResearchTools};
