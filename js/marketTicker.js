// Shared by the home page and dashboard. Quotes are USD snapshots; trades
// carry the provider's millisecond timestamp. Never advance a price locally.
(() => {
  const track = document.querySelector('#ticker-track, #ticker-inner');
  if (!track) return;
  // Leave one of the server's twelve subscriptions available for the selected chart.
  const streamed = ['AAPL','MSFT','GOOGL','AMZN','NVDA','TSLA','META','JPM','V','SPY','QQQ'];
  const symbols = [...streamed,'GLD','NFLX','AMD','DIS','COIN','^GSPC','BTC','ETH'];
  const sessionDate = new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York' });
  const dollars = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' });
  const rows = new Map();
  for (const symbol of symbols) {
    rows.set(symbol, { nodes:[], price:null, at:0, source:'', quote:null, trade:false });
  }

  // Both copies scroll continuously. Only change their text, not the track or its animation.
  for (let copy = 0; copy < 2; copy++) {
    for (const [symbol, row] of rows) {
      const item = document.createElement('span');
      item.className = 'ticker-item';
      if (copy) item.setAttribute('aria-hidden','true');
      const name = document.createElement('b');
      name.textContent = symbol === '^GSPC' ? 'S&P 500' : symbol;
      const price = document.createElement('span');
      const change = document.createElement('span');
      const status = document.createElement('small');
      price.textContent = '—';
      status.textContent = 'Loading';
      item.append(name, price, change, status);
      track.append(item);
      row.nodes.push({item, price, change, status});
    }
  }

  let loading = true;
  let busy = false;
  function paint() {
    if (document.hidden) return;
    const now = Date.now();
    for (const row of rows.values()) {
      const age = now - row.at;
      const live = row.trade && StockAPI._wsStatus === 'connected' && age < 60000;
      const status = !row.at ? (loading ? 'Loading' : 'Unavailable') :
        live ? 'Live trade' : age < 60000 ? 'Last quote' :
        age < 3600000 ? Math.floor(age / 60000) + 'm ago' :
        new Date(row.at).toLocaleDateString(undefined, {month:'short',day:'numeric'}) + ' ' +
          new Date(row.at).toLocaleTimeString(undefined, {hour:'2-digit',minute:'2-digit'});
      const quote = row.quote;
      let pct = quote && quote.pct;
      if (row.trade) {
        pct = quote && quote.base > 0 && sessionDate.format(quote.at) === sessionDate.format(row.at)
          ? (row.price / quote.base - 1) * 100 : null;
      }
      const price = row.at ? dollars.format(row.price) : '—';
      const change = Number.isFinite(pct) ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '';
      const title = row.at ? row.source + ' · ' + new Date(row.at).toLocaleString() : status;
      if (row.lastPrice === price && row.lastChange === change && row.lastStatus === status && row.lastTitle === title) continue;
      Object.assign(row,{lastPrice:price,lastChange:change,lastStatus:status,lastTitle:title});
      for (const node of row.nodes) {
        node.price.textContent = price;
        node.change.textContent = change;
        node.change.className = 'ticker-chg chg ' + (pct >= 0 ? 'up' : 'down');
        node.status.textContent = status;
        node.item.title = title;
      }
    }
  }

  for (const symbol of streamed) {
    const row = rows.get(symbol);
    StockAPI.subscribeSymbol(symbol, ({price,time}) => {
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(time) ||
          time <= 0 || time < row.at || time > Date.now() + 60000) return;
      Object.assign(row, { price, at:time, trade:true, source:'Finnhub trade' });
    });
  }

  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const data = await StockAPI._get('/api/portfolio-prices?symbols=' + encodeURIComponent(symbols.join(',')));
      for (const [symbol,row] of rows) {
        const q = data[symbol];
        const at = Date.parse(q?.observedAt);
        if (!q || !Number.isFinite(q.price) || q.price <= 0 || !Number.isFinite(at) ||
            at <= 0 || at > Date.now() + 60000) continue;
        const pct = Number.isFinite(q.change24h) ? q.change24h : null;
        row.quote = { at, pct, base: pct !== null && pct > -100 ? q.price / (1+pct/100) : null };
        if (at > row.at || (at === row.at && !row.trade)) {
          Object.assign(row,{ price:q.price, at, trade:false, source:q.source || 'Provider quote' });
        }
      }
    } catch (_) {
      // Retain the last verified observation and its age while retrying.
    } finally {
      busy = false;
      loading = false;
      paint();
    }
  }
  void refresh();
  setInterval(refresh, 30000);
  setInterval(paint, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window.addEventListener('online', refresh);
})();
