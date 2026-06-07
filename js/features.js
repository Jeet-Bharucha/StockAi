// ── Portfolio — API-backed with in-memory cache ────────────────────────────
const Portfolio = {
  _cache: null,    // in-memory cache populated by load()
  _GUEST_KEY: 'stockai_portfolio_guest',

  _authHeader() {
    const token = localStorage.getItem('stockai_jwt');
    return { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) };
  },

  _isGuest() {
    return typeof Auth !== 'undefined' ? Auth.isGuest() : false;
  },

  // Sync read from cache (always call load() first in async contexts)
  get() { return this._cache || []; },

  // Fetch from API (or guest localStorage) and populate cache
  async load() {
    if (this._isGuest()) {
      this._cache = JSON.parse(localStorage.getItem(this._GUEST_KEY) || '[]');
      return this._cache;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let r;
      try { r = await fetch('/api/user/portfolio', { headers: this._authHeader(), signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      if (r.ok) { this._cache = await r.json(); return this._cache; }
    } catch(e) { console.warn('Portfolio.load failed:', e.message); }
    // Fallback: return whatever is cached
    if (!this._cache) this._cache = [];
    return this._cache;
  },

  async add(symbol, shares, buyPrice, accountType = 'taxable', assetType = 'stock', name = '') {
    if (this._isGuest()) {
      const list = this.get();
      list.push({ id: Date.now(), symbol: symbol.toUpperCase(), shares:+shares, buyPrice:+buyPrice, accountType, assetType, name: name||symbol.toUpperCase(), addedAt: Date.now() });
      localStorage.setItem(this._GUEST_KEY, JSON.stringify(list));
      this._cache = list;
      return;
    }
    await fetch('/api/user/portfolio', {
      method:  'POST',
      headers: this._authHeader(),
      body:    JSON.stringify({ symbol, shares:+shares, buyPrice:+buyPrice, accountType, assetType, name: name||symbol.toUpperCase() })
    });
    await this.load();
  },

  async update(id, data) {
    if (this._isGuest()) {
      const list = this.get().map(h => String(h.id) === String(id) ? { ...h, ...data } : h);
      localStorage.setItem(this._GUEST_KEY, JSON.stringify(list));
      this._cache = list;
      return;
    }
    await fetch(`/api/user/portfolio/${id}`, {
      method:  'PUT',
      headers: this._authHeader(),
      body:    JSON.stringify(data)
    });
    await this.load();
  },

  async remove(id) {
    if (this._isGuest()) {
      const list = this.get().filter(h => String(h.id) !== String(id));
      localStorage.setItem(this._GUEST_KEY, JSON.stringify(list));
      this._cache = list;
      return;
    }
    await fetch(`/api/user/portfolio/${id}`, { method: 'DELETE', headers: this._authHeader() });
    await this.load();
  },

  summary(quotes) {
    const holdings = this.get();
    let totalCost = 0, totalValue = 0;
    const rows = holdings.map(h => {
      const q      = quotes[h.symbol] || {};
      const px     = q.price || h.buyPrice;
      const cost   = h.shares * h.buyPrice;
      const value  = h.shares * px;
      const pl     = value - cost;
      const plPct  = (pl / cost) * 100;
      totalCost  += cost;
      totalValue += value;
      return { ...h, currentPrice: px, value, pl, plPct };
    });
    return { rows, totalCost, totalValue, totalPL: totalValue - totalCost, totalPLPct: totalCost ? ((totalValue - totalCost) / totalCost) * 100 : 0 };
  }
};

// ── Price Alerts ──────────────────────────────────────────────────────────
const PriceAlerts = {
  _key: 'stockai_alerts',

  get() { return JSON.parse(localStorage.getItem(this._key) || '[]'); },
  save(data) { localStorage.setItem(this._key, JSON.stringify(data)); },

  add(symbol, targetPrice, direction) {
    const list = this.get();
    list.push({ id: Date.now(), symbol: symbol.toUpperCase(), targetPrice: +targetPrice, direction, triggered: false });
    this.save(list);
  },

  remove(id) { this.save(this.get().filter(a => a.id !== id)); },

  check(symbol, price) {
    const list  = this.get();
    let changed = false;
    const fired = [];
    list.forEach(a => {
      if (a.symbol !== symbol || a.triggered) return;
      const hit = (a.direction === 'above' && price >= a.targetPrice) ||
                  (a.direction === 'below' && price <= a.targetPrice);
      if (hit) { a.triggered = true; fired.push(a); changed = true; }
    });
    if (changed) this.save(list);
    return fired;
  },

  requestPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  },

  notify(alert) {
    const title = `📈 StockAI Alert — ${alert.symbol}`;
    const body  = `Price ${alert.direction === 'above' ? 'rose above' : 'dropped below'} $${alert.targetPrice}`;
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
    window.showToast?.(`🔔 ${alert.symbol} ${body}`);
  }
};

// ── News ──────────────────────────────────────────────────────────────────
const NewsAPI = {
  _cache: {},

  async fetch(symbol) {
    const key = `news_${symbol || 'market'}`;
    const cached = this._cache[key];
    if (cached && Date.now() - cached.ts < 300000) return cached.data; // 5 min cache

    try {
      const url = symbol ? `/api/news?symbol=${symbol}` : '/api/news';
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      let res, data;
      try {
        res  = await fetch(url, { signal: ctrl.signal });
        data = await res.json();
      } finally { clearTimeout(timer); }
      if (!Array.isArray(data) || data.error) throw new Error('no data');
      const sorted = data.sort((a, b) => b.datetime - a.datetime).slice(0, 12);
      this._cache[key] = { ts: Date.now(), data: sorted };
      return sorted;
    } catch (_) {
      return this._mockNews(symbol);
    }
  },

  _mockNews(symbol) {
    const sym = symbol || 'Market';
    return [
      { headline: `${sym} shares climb as investors weigh Fed policy outlook`, source: 'Reuters', datetime: Date.now()/1000 - 1800,  url: '#', image: '' },
      { headline: `Analysts upgrade ${sym} citing strong earnings momentum`,   source: 'Bloomberg', datetime: Date.now()/1000 - 5400, url: '#', image: '' },
      { headline: 'Wall Street edges higher as tech rally continues',           source: 'CNBC',     datetime: Date.now()/1000 - 9000, url: '#', image: '' },
      { headline: `${sym} options activity spikes ahead of quarterly report`,  source: 'Barron\'s', datetime: Date.now()/1000 - 14400,url: '#', image: '' },
      { headline: 'Fed minutes signal data-dependent rate path for 2025',      source: 'WSJ',      datetime: Date.now()/1000 - 21600,url: '#', image: '' },
      { headline: `Institutional investors increase ${sym} position by 12%`,   source: 'MarketWatch',datetime:Date.now()/1000-36000,  url: '#', image: '' },
    ];
  },

  timeAgo(ts) {
    const diff = Math.floor(Date.now()/1000 - ts);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400)return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
  }
};

// ── Chart Overlays (SMA lines) ────────────────────────────────────────────
const ChartOverlays = {
  _series: {},
  _active: new Set(),

  _sma(closes, period) {
    return closes.map((_, i) => {
      if (i < period - 1) return null;
      const slice = closes.slice(i - period + 1, i + 1);
      return slice.reduce((a, b) => a + b, 0) / period;
    });
  },

  add(chart, bars, period, color) {
    const key = `sma${period}`;
    this.remove(chart, period);

    const closes = bars.map(b => b.close);
    const smaVals = this._sma(closes, period);

    const series = chart.addLineSeries({
      color, lineWidth: 1.5, priceLineVisible: false,
      lastValueVisible: true, crosshairMarkerVisible: false,
    });

    const data = bars
      .map((b, i) => smaVals[i] !== null ? { time: b.time, value: +smaVals[i].toFixed(4) } : null)
      .filter(Boolean);

    series.setData(data);
    this._series[key] = series;
    this._active.add(period);
    return series;
  },

  remove(chart, period) {
    const key = `sma${period}`;
    if (this._series[key]) {
      try { chart.removeSeries(this._series[key]); } catch (_) {}
      delete this._series[key];
    }
    this._active.delete(period);
  },

  toggle(chart, bars, period, color) {
    if (this._active.has(period)) this.remove(chart, period);
    else this.add(chart, bars, period, color);
    return this._active.has(period);
  },

  updateAll(chart, bars) {
    const active = [...this._active];
    const colors = { 20: '#a855f7', 50: '#ffd700', 200: '#ff8c00' };
    active.forEach(p => this.add(chart, bars, p, colors[p]));
  },

  clear(chart) {
    Object.keys(this._series).forEach(key => {
      try { chart.removeSeries(this._series[key]); } catch (_) {}
    });
    this._series = {};
    this._active.clear();
  }
};
