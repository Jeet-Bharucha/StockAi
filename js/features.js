// ── Portfolio — API-backed with in-memory cache ────────────────────────────
const Portfolio = {
  _cache: null,    // in-memory cache populated by load()
  lastError: null,
  _GUEST_KEY: 'stockai_portfolio_guest',

  _authHeader() {
    return Auth._authHeader();
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
      const timer = setTimeout(() => ctrl.abort(), 55000);
      let r;
      try { r = await fetch('/api/user/portfolio', { headers: this._authHeader(), signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      if (!r.ok) throw new Error('Portfolio API HTTP ' + r.status);
      const holdings = await r.json();
      if (!Array.isArray(holdings)) throw new Error('Invalid portfolio response');
      this._cache = holdings;
      this.lastError = null;
      return this._cache;
    } catch(e) {
      this.lastError = e.message;
      console.warn('Portfolio.load failed:', e.message);
    }
    // Do not erase already-loaded holdings during brief network outages.
    // The UI shows an error instead of falsely claiming an empty portfolio.
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
    const r = await fetch('/api/user/portfolio', {
      method: 'POST', headers: this._authHeader(),
      body: JSON.stringify({ symbol, shares:+shares, buyPrice:+buyPrice, accountType, assetType, name: name||symbol.toUpperCase() })
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not save holding (HTTP ' + r.status + ')');
    const holding = await r.json();
    if (!this._cache) this._cache = [];
    this._cache.push({ ...holding, id: holding.id, addedAt: new Date().toISOString() });
    this.lastError = null;
  },

  async update(id, data) {
    if (this._isGuest()) {
      const list = this.get().map(h => String(h.id) === String(id) ? { ...h, ...data } : h);
      localStorage.setItem(this._GUEST_KEY, JSON.stringify(list));
      this._cache = list;
      return;
    }
    const r = await fetch(`/api/user/portfolio/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: this._authHeader(), body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not update holding (HTTP ' + r.status + ')');
    const updated = await r.json();
    this._cache = this.get().map(h => String(h.id) === String(id) ? { ...h, ...updated } : h);
    this.lastError = null;
  },

  async remove(id) {
    if (this._isGuest()) {
      const list = this.get().filter(h => String(h.id) !== String(id));
      localStorage.setItem(this._GUEST_KEY, JSON.stringify(list));
      this._cache = list;
      return;
    }
    const r = await fetch(`/api/user/portfolio/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this._authHeader() });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not delete holding (HTTP ' + r.status + ')');
    this._cache = this.get().filter(h => String(h.id) !== String(id));
    this.lastError = null;
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
  _cache:null,
  lastError:null,
  _key() {
    const session=typeof Auth!=='undefined'?Auth.getSession():null;
    return 'stockai_alerts_' + (session?.userId||'anonymous');
  },
  _guest() {return typeof Auth!=='undefined'&&Auth.isGuest();},
  _legacy() {
    try {return JSON.parse(localStorage.getItem(this._key())||'[]');}
    catch(_){return [];}
  },
  get() {return this._cache||this._legacy();},
  save(data) {localStorage.setItem(this._key(),JSON.stringify(data));},

  async _request(url,opts={}) {
    const response=await fetch(url,{
      ...opts,headers:{...Auth._authHeader(),...(opts.headers||{})}
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw Error(data.error||'Alert service error ('+response.status+')');
    return data;
  },

  async load() {
    if(this._guest()) {this._cache=null;return this._legacy();}
    try {
      const result=await this._request('/api/user/alerts');
      this._cache=result.alerts;
      this.lastError=null;
      // Import locally saved alerts only after confirmed server save.
      // Deleting the browser copy on failure would lose someone's alerts.
      const legacy=this._legacy().filter(a=>!a.triggered);
      if(legacy.length) {
        let migrated=true;
        for(const item of legacy.slice(0,35)) {
          try {
            if(!['above','below'].includes(item.direction)||!Number.isFinite(Number(item.targetPrice))||
               Number(item.targetPrice)<=0)continue;
            await this._request('/api/user/alerts',{
              method:'POST',body:JSON.stringify({
                symbol:String(item.symbol||'').trim().toUpperCase(),
                direction:item.direction,targetPrice:Number(item.targetPrice)
              })
            });
          }catch(e) { migrated=false;console.warn('Legacy alert not imported:',e.message); }
        }
        if(migrated&&legacy.length<=35) {
          localStorage.removeItem(this._key());
          const latest=await this._request('/api/user/alerts');
          this._cache=latest.alerts;
        }
      }
    }catch(e) {
      this.lastError=e.message;
      console.warn('PriceAlerts.load failed:',e.message);
    }
    return this.get();
  },

  async add(symbol,targetPrice,direction) {
    if(this._guest()) throw Error('Sign in to save alerts across devices.');
    const result=await this._request('/api/user/alerts',{
      method:'POST',body:JSON.stringify({
        symbol:String(symbol||'').toUpperCase().trim(),
        targetPrice:Number(targetPrice),direction
      })
    });
    await this.load();
    return result.alert;
  },

  async remove(id) {
    if(this._guest()) {
      this.save(this._legacy().filter(a=>String(a.id)!==String(id)));return;
    }
    await this._request('/api/user/alerts/'+encodeURIComponent(id),{method:'DELETE'});
    if(this._cache) this._cache=this._cache.filter(a=>String(a.id)!==String(id));
    this.lastError=null;
  },

  async clearAll() {
    if(this._guest()) {this.save([]);return;}
    await this._request('/api/user/alerts',{method:'DELETE'});
    localStorage.removeItem(this._key());
    this._cache=[];
    this.lastError=null;
  },

  // Local-only legacy fallback. Server alerts trigger atomically using
  // provider-verified quotes rather than client-submitted prices.
  check(symbol,price) {
    // Signed-in users must never "confirm" an alert with browser-supplied
    // prices. Only the backend is allowed to verify a hit.
    if(!this._guest()) return [];
    const list=this._legacy(), fired=[];
    for(const a of list) {
      if(a.symbol!==symbol||a.triggered)continue;
      if((a.direction==='above'&&price>=a.targetPrice)||
         (a.direction==='below'&&price<=a.targetPrice)) {
        a.triggered=true;fired.push(a);
      }
    }
    if(fired.length)this.save(list);
    return fired;
  },

  async checkServer() {
    if(this._guest())return {fired:[],throttled:true};
    const result=await this._request('/api/user/alerts/check',{method:'POST'});
    if(result.fired?.length){
      await this.load();
      for(const alert of result.fired) this.notify(alert);
    }
    return result;
  },

  requestPermission() {
    if('Notification' in window&&Notification.permission==='default')
      Notification.requestPermission();
  },

  notify(alert) {
    const body=alert.symbol+' '+(alert.direction==='above'?'reached or exceeded':'fell to or below')+
      ' $'+Number(alert.targetPrice).toFixed(2);
    if('Notification' in window&&Notification.permission==='granted')
      new Notification('StockAI Price Alert',{body,icon:'/favicon.svg'});
    window.showToast?.('🔔 '+body);
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
    } catch (error) {
      console.warn('Verified news unavailable:', error.message);
      return []; // Never invent news headlines or attribute them to real publishers.
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
    const colors = { 20: '#f59e0b', 50: '#ffd700', 200: '#ff8c00' };
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
