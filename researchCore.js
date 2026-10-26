'use strict';
const SYMBOL=/^[A-Z][A-Z0-9.\-^]{0,15}$/;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const round=n=>Math.round((n+Number.EPSILON)*1e8)/1e8;
function symbol(value){const s=String(value||'').trim().toUpperCase();if(!SYMBOL.test(s))throw Error('Invalid stock/ETF symbol');return s;}
function label(value,max=60){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw Error('Invalid name');return value.trim();}
function number(value,min=0,max=1e12){if(!finite(value)||value<min||value>max)throw Error('Invalid numeric value');return value;}
function validateWorkspace(input){
  if(!input||!Array.isArray(input.lists)||input.lists.length>10||!Array.isArray(input.screens)||input.screens.length>15)throw Error('Maximum 10 lists and 15 saved screens');
  const names=new Set();
  const lists=input.lists.map(list=>{
    const name=label(list.name);if(names.has(name.toLowerCase()))throw Error('List names must be unique');names.add(name.toLowerCase());
    if(!Array.isArray(list.items)||list.items.length>30)throw Error('Maximum 30 symbols per list');
    const symbols=new Set();
    const items=list.items.map(item=>{const sym=symbol(item.symbol);if(symbols.has(sym))throw Error('Duplicate symbol');symbols.add(sym);
      const note=typeof item.note==='string'?item.note.trim():'';if(note.length>300)throw Error('Notes are limited to 300 characters');
      const target=item.target==null?null:number(item.target,0.000001,1e8);
      return {symbol:sym,note,target};});
    if(!['alpha','chg-desc','chg-asc','move-desc'].includes(list.sort))throw Error('Invalid list sort');
    return {name,items,sort:list.sort};
  });
  const screens=input.screens.map(screen=>{
    const filters=screen.filters||{};const out={};
    for(const key of ['sector','rsi','mktcap','perf','sort','min','max','maxPE','minROE','minVolume']){
      if(filters[key]==null)continue;
      const val=String(filters[key]);if(val.length>40||/[<>]/.test(val))throw Error('Invalid screen filter');out[key]=val;
    }
    if(filters.symbols){const values=[...new Set(String(filters.symbols).toUpperCase().split(/[\s,]+/).filter(Boolean).map(symbol))];if(values.length>50)throw Error('Maximum 50 screener symbols');out.symbols=values.join(',');}
    for(const key of ['min','max','maxPE','minROE','minVolume']){
      if(out[key]==null||out[key]==='')continue;
      const n=Number(out[key]);if(!Number.isFinite(n)||n>1e12||n<(key==='minROE'?-10000:0))throw Error('Invalid numeric screen filter');
    }
    if(out.min!==undefined&&out.max!==undefined&&out.min!==''&&out.max!==''&&Number(out.max)<Number(out.min))throw Error('Screen maximum price is below minimum');
    return {name:label(screen.name),filters:out};
  });
  return {lists,screens,emailAlerts:input.emailAlerts===true};
}
function validateTransaction(input,now=Date.now()){
  const type=input?.type;if(!['deposit','withdrawal','buy','sell','dividend','split'].includes(type))throw Error('Invalid transaction type');
  const clientId=String(input.clientId||'');if(!/^[a-zA-Z0-9-]{8,80}$/.test(clientId))throw Error('Transaction identifier required');
  const at=Date.parse(input.at);if(!Number.isFinite(at)||at>now+60000||at<Date.UTC(1970,0,1))throw Error('Invalid transaction time');
  const memo=typeof input.memo==='string'?input.memo.trim():'';if(memo.length>160)throw Error('Memo too long');
  if(type==='split')return {clientId,type,symbol:symbol(input.symbol),numerator:number(input.numerator,1e-6,1e6),denominator:number(input.denominator,1e-6,1e6),at:new Date(at),memo};
  if(type==='buy'||type==='sell')return {clientId,type,symbol:symbol(input.symbol),quantity:number(input.quantity,1e-8,1e9),price:number(input.price,1e-8,1e8),fee:number(input.fee??0),at:new Date(at),memo};
  return {clientId,type,symbol:type==='dividend'?symbol(input.symbol):null,amount:number(input.amount,1e-8),at:new Date(at),memo};
}
function ledger(transactions){
  let cash=0,netContributions=0,dividends=0,realized=0;const holdings=new Map();
  const rows=[...transactions].sort((a,b)=>new Date(a.at)-new Date(b.at));
  for(const t of rows){
    if(t.type==='deposit'){cash+=t.amount;netContributions+=t.amount;}
    else if(t.type==='withdrawal'){cash-=t.amount;netContributions-=t.amount;}
    else if(t.type==='dividend'){cash+=t.amount;dividends+=t.amount;}
    else if(t.type==='split'){const h=holdings.get(t.symbol);if(!h||h.quantity<=0)throw Error('Split requires an existing position');h.quantity*=t.numerator/t.denominator;if(!Number.isFinite(h.quantity)||h.quantity>1e12||h.quantity<1e-8)throw Error('Split quantity is outside supported limits');h.lastSplitAt=t.at;}
    else {
      const h=holdings.get(t.symbol)||{symbol:t.symbol,quantity:0,cost:0};
      if(t.type==='buy'){cash-=t.quantity*t.price+t.fee;h.quantity+=t.quantity;h.cost+=t.quantity*t.price+t.fee;}
      else {if(t.quantity>h.quantity+1e-8)throw Error('Sale exceeds available shares');const cost=h.quantity?h.cost*t.quantity/h.quantity:0;h.quantity-=t.quantity;h.cost-=cost;cash+=t.quantity*t.price-t.fee;realized+=t.quantity*t.price-t.fee-cost;}
      holdings.set(t.symbol,h);
    }
    if(cash < -0.000001)throw Error('Transaction exceeds available cash; record a deposit first');
  }
  return {cash:round(cash),netContributions:round(netContributions),dividends:round(dividends),realized:round(realized),holdings:[...holdings.values()].filter(h=>h.quantity>1e-8).map(h=>({...h,quantity:round(h.quantity),cost:round(h.cost)}))};
}
function verifiedPrice(q,now=Date.now()){
  const at=Date.parse(q?.observedAt);return finite(q?.price)&&q.price>0&&Number.isFinite(at)&&at<=now+60000&&now-at<=4*86400000;
}
function valueLedger(book,quotes,now=Date.now()){
  const missing=[];let invested=0,cost=0;
  for(const h of book.holdings){const q=quotes[h.symbol];if(!verifiedPrice(q,now)||q.currency!=='USD'||(h.lastSplitAt&&Date.parse(q.observedAt)<+new Date(h.lastSplitAt))){missing.push(h.symbol);continue;}invested+=h.quantity*q.price;cost+=h.cost;}
  return {cash:book.cash,equity:missing.length?null:round(book.cash+invested),unrealized:missing.length?null:round(invested-cost),missing};
}
// Modified Dietz is an estimate weighted by each external cash flow's actual time.
function performance(first,last,transactions){
  if(!first||!last||last.at<=first.at||!finite(first.equity)||!finite(last.equity))return null;
  const start=+new Date(first.at),end=+new Date(last.at);if(end<=start)return null;
  const flows=transactions.filter(t=>['deposit','withdrawal'].includes(t.type)&&+new Date(t.at)>start&&+new Date(t.at)<=end);
  let net=0,weighted=0;for(const t of flows){const amount=t.type==='deposit'?t.amount:-t.amount;net+=amount;weighted+=amount*(end-new Date(t.at))/(end-start);}
  const denom=first.equity+weighted;if(denom<=0)return null;
  return {method:'Modified Dietz estimate',returnPct:100*(last.equity-first.equity-net)/denom,
    gain:last.equity-first.equity-net,benchmarkPct:finite(first.spy)&&first.spy>0&&finite(last.spy)?100*(last.spy/first.spy-1):null};
}
module.exports={symbol,validateWorkspace,validateTransaction,ledger,verifiedPrice,valueLedger,performance};
