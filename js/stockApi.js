// StockAPI — talks to our own Node.js backend proxy.
// The browser never needs a Finnhub key; the server holds it.
const StockAPI = {
  _cache: {},
  _CACHE_QUOTE:  30000,  // 30 s
  _CACHE_CANDLE: 300000, // 5 min
  _ws: null,
  _wsSubs: {},    // symbol → callback
  _wsStatus: 'disconnected',

  // ── WebSocket (connect to our own server) ─────────────────────────────────
  connectWS() {
    // Can't use WS when opened as a local file — server not running
    if (!location.host) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url   = `${proto}//${location.host}/ws`;

    this._ws = new WebSocket(url);

    this._ws.onopen = () => {
      // Re-subscribe any pending symbols
      Object.keys(this._wsSubs).forEach(s => this._wsSend('subscribe', s));
    };

    this._ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);

        if (msg.type === 'status') {
          this._wsStatus = msg.status;
          document.dispatchEvent(new CustomEvent('stockai:ws', { detail: msg.status }));
        }

        if (msg.type === 'trade') {
          const cb = this._wsSubs[msg.symbol];
          if (cb) cb({ price: msg.price, volume: msg.volume, time: msg.time });
        }
      } catch (_) {}
    };

    this._ws.onclose = () => {
      this._wsStatus = 'disconnected';
      document.dispatchEvent(new CustomEvent('stockai:ws', { detail: 'disconnected' }));
      // Reconnect after 5 s
      setTimeout(() => this.connectWS(), 5000);
    };

    this._ws.onerror = () => {
      document.dispatchEvent(new CustomEvent('stockai:ws', { detail: 'error' }));
    };
  },

  _wsSend(type, symbol) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type, symbol }));
    }
  },

  subscribeSymbol(symbol, callback) {
    if (this._wsSubs[symbol]) this._wsSend('unsubscribe', symbol);
    this._wsSubs[symbol] = callback;
    this._wsSend('subscribe', symbol);
  },

  unsubscribeSymbol(symbol) {
    this._wsSend('unsubscribe', symbol);
    delete this._wsSubs[symbol];
  },

  unsubscribeAll() {
    Object.keys(this._wsSubs).forEach(s => this._wsSend('unsubscribe', s));
    this._wsSubs = {};
  },

  // ── REST (hits our /api/* proxy) ──────────────────────────────────────────
  async _get(path) {
    const res  = await fetch(path);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  // ── Quote ─────────────────────────────────────────────────────────────────
  async getQuote(symbol) {
    const key    = `q_${symbol}`;
    const cached = this._cache[key];
    if (cached && Date.now() - cached.ts < this._CACHE_QUOTE) return cached.data;

    try {
      const d = await this._get(`/api/quote?symbol=${symbol}`);
      if (!d.c) throw new Error('no data');
      const result = {
        symbol, live: true,
        price:     d.c,
        change:    +d.d.toFixed(2),
        changePct: +d.dp.toFixed(2),
        high: d.h, low: d.l, open: d.o, prevClose: d.pc,
        volume: null
      };
      this._cache[key] = { ts: Date.now(), data: result };
      return result;
    } catch (_) {
      return this._simQuote(symbol);
    }
  },

  // ── Candles ───────────────────────────────────────────────────────────────
  async getCandles(symbol, resolution = 'D', days = 365) {
    const key    = `c_${symbol}_${resolution}_${days}`;
    const cached = this._cache[key];
    if (cached && Date.now() - cached.ts < this._CACHE_CANDLE) return cached.data;

    const to   = Math.floor(Date.now() / 1000);
    const from = to - days * 86400;

    try {
      const d = await this._get(`/api/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`);
      if (d.s !== 'ok' || !d.t?.length) throw new Error('no data');
      const bars = d.t.map((t, i) => ({
        time: t, open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i], volume: d.v[i]
      }));
      this._cache[key] = { ts: Date.now(), data: bars };
      return bars;
    } catch (_) {
      return this._simCandles(symbol, days);
    }
  },

  // ── Company profile ───────────────────────────────────────────────────────
  async getCompanyProfile(symbol) {
    const key = `p_${symbol}`;
    if (this._cache[key]) return this._cache[key].data;

    try {
      const d = await this._get(`/api/profile?symbol=${symbol}`);
      if (!d.name) throw new Error('no data');
      const result = {
        name: d.name, sector: d.finnhubIndustry || 'Unknown',
        country: d.country || 'US', exchange: d.exchange,
        logo: d.logo, marketCap: d.marketCapitalization,
        ipo: d.ipo, weburl: d.weburl, live: true
      };
      this._cache[key] = { data: result };
      return result;
    } catch (_) {
      return this.getCompanyInfo(symbol);
    }
  },

  // ── Market overview ───────────────────────────────────────────────────────
  async getMarketOverview() {
    const etfs = [
      { name: 'S&P 500',   symbol: 'SPY' },
      { name: 'NASDAQ',    symbol: 'QQQ' },
      { name: 'Dow Jones', symbol: 'DIA' },
      { name: 'Russell',   symbol: 'IWM' },
      { name: 'Gold',      symbol: 'GLD' },
      { name: 'Oil (USO)', symbol: 'USO' },
    ];
    const results = await Promise.all(etfs.map(async e => {
      const q = await this.getQuote(e.symbol);
      return { name: e.name, symbol: e.symbol, price: q.price, change: q.change, changePct: q.changePct };
    }));
    return results;
  },

  // ── Simulation fallback ───────────────────────────────────────────────────
  _seeds: {},
  _initSeed(symbol) {
    if (this._seeds[symbol]) return;
    const base = {
      AAPL:185, GOOGL:175, MSFT:420, TSLA:245, AMZN:195, META:510,
      NVDA:875, NFLX:650, AMD:165, INTC:42, JPM:205, BAC:38,
      V:275, MA:480, DIS:95, UBER:78, COIN:205, PYPL:68,
      SPY:521, QQQ:446, DIA:389, IWM:208, GLD:218, USO:74,
    };
    this._seeds[symbol] = {
      price:  base[symbol] || (80 + Math.random() * 400),
      vol:    0.001 + Math.random() * 0.002,
      drift:  (Math.random() - 0.48) * 0.0002,
      volume: Math.floor(5e6 + Math.random() * 50e6),
    };
  },

  _simTick(symbol) {
    this._initSeed(symbol);
    const s = this._seeds[symbol];
    s.price = Math.max(1, s.price * (1 + s.drift + s.vol * (Math.random() - 0.5) * 2));
    return s.price;
  },

  _simQuote(symbol) {
    this._initSeed(symbol);
    const s      = this._seeds[symbol];
    const price  = +s.price.toFixed(2);
    const prev   = price * (1 - s.drift * 5 - s.vol * (Math.random() - 0.5));
    const change = +(price - prev).toFixed(2);
    return {
      symbol, price, change, live: false,
      changePct:  +(change / prev * 100).toFixed(2),
      high:       +(price * 1.015).toFixed(2),
      low:        +(price * 0.985).toFixed(2),
      open:       +(price * 0.999).toFixed(2),
      prevClose:  +prev.toFixed(2),
      volume:     s.volume,
    };
  },

  _simCandles(symbol, days = 365) {
    this._initSeed(symbol);
    const s     = { ...this._seeds[symbol] };
    let price   = s.price * (0.7 + Math.random() * 0.3);
    const bars  = [];
    const now   = Date.now();
    for (let i = days; i >= 0; i--) {
      const ts   = Math.floor((now - i * 86400000) / 1000);
      const dv   = s.vol * (1 + Math.random());
      const open = price;
      price = Math.max(1, price * (1 + s.drift + s.vol * (Math.random() - 0.5) * 2));
      bars.push({
        time: ts,
        open:   +open.toFixed(2),
        high:   +(Math.max(open, price) * (1 + Math.random() * dv)).toFixed(2),
        low:    +(Math.min(open, price) * (1 - Math.random() * dv)).toFixed(2),
        close:  +price.toFixed(2),
        volume: Math.floor(s.volume * (0.5 + Math.random())),
      });
    }
    return bars;
  },

  // ── Static company info ───────────────────────────────────────────────────
  companyInfo: {
    AAPL:{name:'Apple Inc.',sector:'Technology'},
    GOOGL:{name:'Alphabet Inc.',sector:'Technology'},
    MSFT:{name:'Microsoft Corp.',sector:'Technology'},
    TSLA:{name:'Tesla Inc.',sector:'Automotive'},
    AMZN:{name:'Amazon.com Inc.',sector:'E-Commerce'},
    META:{name:'Meta Platforms',sector:'Social Media'},
    NVDA:{name:'NVIDIA Corp.',sector:'Semiconductors'},
    NFLX:{name:'Netflix Inc.',sector:'Streaming'},
    AMD:{name:'Advanced Micro Devices',sector:'Semiconductors'},
    INTC:{name:'Intel Corp.',sector:'Semiconductors'},
    JPM:{name:'JPMorgan Chase',sector:'Banking'},
    BAC:{name:'Bank of America',sector:'Banking'},
    V:{name:'Visa Inc.',sector:'Payments'},
    MA:{name:'Mastercard Inc.',sector:'Payments'},
    DIS:{name:'Walt Disney Co.',sector:'Entertainment'},
    UBER:{name:'Uber Technologies',sector:'Transportation'},
    COIN:{name:'Coinbase Global',sector:'Crypto'},
    PYPL:{name:'PayPal Holdings',sector:'Finance'},
    // Finance
    GS:{name:'Goldman Sachs',sector:'Finance'},
    MS:{name:'Morgan Stanley',sector:'Finance'},
    WFC:{name:'Wells Fargo',sector:'Finance'},
    AXP:{name:'American Express',sector:'Finance'},
    // Healthcare
    JNJ:{name:'Johnson & Johnson',sector:'Healthcare'},
    PFE:{name:'Pfizer Inc.',sector:'Healthcare'},
    UNH:{name:'UnitedHealth Group',sector:'Healthcare'},
    ABBV:{name:'AbbVie Inc.',sector:'Healthcare'},
    MRK:{name:'Merck & Co.',sector:'Healthcare'},
    LLY:{name:'Eli Lilly & Co.',sector:'Healthcare'},
    BMY:{name:'Bristol-Myers Squibb',sector:'Healthcare'},
    CVS:{name:'CVS Health Corp.',sector:'Healthcare'},
    AMGN:{name:'Amgen Inc.',sector:'Healthcare'},
    GILD:{name:'Gilead Sciences',sector:'Healthcare'},
    // Energy
    XOM:{name:'ExxonMobil Corp.',sector:'Energy'},
    CVX:{name:'Chevron Corp.',sector:'Energy'},
    COP:{name:'ConocoPhillips',sector:'Energy'},
    SLB:{name:'SLB (Schlumberger)',sector:'Energy'},
    OXY:{name:'Occidental Petroleum',sector:'Energy'},
    NEE:{name:'NextEra Energy',sector:'Energy'},
    DUK:{name:'Duke Energy',sector:'Energy'},
    SO:{name:'Southern Company',sector:'Energy'},
    AEP:{name:'American Elec. Power',sector:'Energy'},
    PCG:{name:'PG&E Corp.',sector:'Energy'},
    // Communication / Consumer
    LYFT:{name:'Lyft Inc.',sector:'Transportation'},
    SPOT:{name:'Spotify Technology',sector:'Streaming'},
    SNAP:{name:'Snap Inc.',sector:'Communication'},
    TWTR:{name:'X Corp. (Twitter)',sector:'Communication'},
    PINS:{name:'Pinterest Inc.',sector:'Communication'},
    RBLX:{name:'Roblox Corp.',sector:'Consumer'},
    HOOD:{name:'Robinhood Markets',sector:'Finance'},
    SPY:{name:'SPDR S&P 500 ETF',sector:'ETF'},
    QQQ:{name:'Invesco QQQ (NASDAQ)',sector:'ETF'},
    DIA:{name:'SPDR Dow Jones ETF',sector:'ETF'},
    IWM:{name:'iShares Russell 2000',sector:'ETF'},
    GLD:{name:'SPDR Gold Shares',sector:'Commodity'},
    USO:{name:'US Oil Fund',sector:'Commodity'},
  },

  getCompanyInfo(symbol) {
    return this.companyInfo[symbol] || { name: symbol, sector: 'Unknown' };
  },

  popularSymbols: [
    'AAPL','GOOGL','MSFT','TSLA','AMZN','META',
    'NVDA','NFLX','AMD','INTC','JPM','BAC','V','MA','DIS','UBER','COIN','PYPL',
  ],
};

// Auto-connect WebSocket when served from a real server
if (location.host) StockAPI.connectWS();
