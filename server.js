require('dotenv').config();
const express  = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const path     = require('path');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

const app    = express();
const server = createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

app.use(express.json());

const FINNHUB_KEY = process.env.FINNHUB_KEY;
const MONGO_URI   = process.env.MONGO_URI;
const JWT_SECRET  = process.env.JWT_SECRET || 'stockai_fallback_secret_change_me';
const PORT        = process.env.PORT || 3001;

// ── MongoDB connection ────────────────────────────────────────────────────
if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(e => console.error('❌ MongoDB error:', e.message));
} else {
  console.warn('⚠️  MONGO_URI not set — auth/portfolio APIs will return 503 (frontend falls back to localStorage)');
}

// ── Models ────────────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true },
  watchlist: { type: [String], default: ['AAPL','GOOGL','MSFT','TSLA','AMZN'] },
  created:   { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const HoldingSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  symbol:      { type: String, required: true, uppercase: true, trim: true },
  name:        { type: String, default: '' },
  shares:      { type: Number, required: true },
  buyPrice:    { type: Number, required: true },
  assetType:   { type: String, enum: ['stock','etf','crypto'], default: 'stock' },
  accountType: { type: String, default: 'taxable' },
  addedAt:     { type: Date, default: Date.now }
});
const Holding = mongoose.model('Holding', HoldingSchema);

// ── Auth middleware ───────────────────────────────────────────────────────
function authMW(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch(e) {
    res.status(401).json({ error: 'Token expired or invalid — please log in again' });
  }
}

function dbRequired(req, res, next) {
  if (mongoose.connection.readyState !== 1)
    return res.status(503).json({ error: 'Database not connected' });
  next();
}

// ── Auth routes ───────────────────────────────────────────────────────────
app.post('/api/auth/register', dbRequired, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email, and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(400).json({ error: 'An account with that email already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({ name: name.trim(), email, password: hashed });
    const token  = jwt.sign({ id: user._id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch(e) {
    console.error('Register:', e.message);
    res.status(500).json({ error: 'Server error — try again' });
  }
});

app.post('/api/auth/login', dbRequired, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ id: user._id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch(e) {
    console.error('Login:', e.message);
    res.status(500).json({ error: 'Server error — try again' });
  }
});

// ── Portfolio routes (protected) ──────────────────────────────────────────
app.get('/api/user/portfolio', authMW, dbRequired, async (req, res) => {
  try {
    const holdings = await Holding.find({ userId: req.user.id }).sort({ addedAt: 1 });
    res.json(holdings.map(h => ({
      id:          h._id,
      symbol:      h.symbol,
      name:        h.name,
      shares:      h.shares,
      buyPrice:    h.buyPrice,
      assetType:   h.assetType,
      accountType: h.accountType,
      addedAt:     h.addedAt
    })));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/user/portfolio', authMW, dbRequired, async (req, res) => {
  try {
    const { symbol, shares, buyPrice, assetType = 'stock', accountType = 'taxable', name = '' } = req.body;
    if (!symbol || shares == null || buyPrice == null)
      return res.status(400).json({ error: 'symbol, shares, and buyPrice are required' });
    const h = await Holding.create({
      userId: req.user.id,
      symbol: symbol.toUpperCase(),
      shares: +shares, buyPrice: +buyPrice,
      assetType, accountType,
      name: name || symbol.toUpperCase()
    });
    res.json({ id: h._id, symbol: h.symbol, name: h.name, shares: h.shares, buyPrice: h.buyPrice, assetType: h.assetType, accountType: h.accountType });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/user/portfolio/:id', authMW, dbRequired, async (req, res) => {
  try {
    const allowed = ['shares','buyPrice','assetType','accountType','name'];
    const update  = {};
    allowed.forEach(k => { if (req.body[k] != null) update[k] = req.body[k]; });
    const h = await Holding.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: update }, { new: true }
    );
    if (!h) return res.status(404).json({ error: 'Holding not found' });
    res.json({ id: h._id, symbol: h.symbol, name: h.name, shares: h.shares, buyPrice: h.buyPrice, assetType: h.assetType, accountType: h.accountType });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/user/portfolio/:id', authMW, dbRequired, async (req, res) => {
  try {
    await Holding.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Watchlist routes (protected) ──────────────────────────────────────────
app.get('/api/user/watchlist', authMW, dbRequired, async (req, res) => {
  try {
    const user = await User.findById(req.user.id, 'watchlist');
    res.json({ watchlist: user?.watchlist || [] });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/user/watchlist', authMW, dbRequired, async (req, res) => {
  try {
    const { watchlist } = req.body;
    if (!Array.isArray(watchlist)) return res.status(400).json({ error: 'watchlist must be an array' });
    await User.findByIdAndUpdate(req.user.id, { watchlist });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Finnhub WebSocket (one shared connection for the whole server) ─────────
let finnhubWS   = null;
let wsConnected = false;
const symbolClients = new Map();

function connectFinnhubWS() {
  if (!FINNHUB_KEY) {
    console.warn('⚠️  FINNHUB_KEY not set — live WebSocket disabled, serving simulated data');
    return;
  }
  console.log('🔌 Connecting to Finnhub WebSocket…');
  finnhubWS = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);

  finnhubWS.on('open', () => {
    wsConnected = true;
    console.log('✅ Finnhub WebSocket connected');
    broadcastToAll({ type: 'status', status: 'connected' });
    for (const symbol of symbolClients.keys()) finnhubSend('subscribe', symbol);
  });

  finnhubWS.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'trade' && msg.data) {
        msg.data.forEach(trade => {
          const clients = symbolClients.get(trade.s);
          if (!clients || clients.size === 0) return;
          const payload = JSON.stringify({ type: 'trade', symbol: trade.s, price: trade.p, volume: trade.v, time: trade.t });
          clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(payload); });
        });
      }
      if (msg.type === 'error') console.error('Finnhub WS error:', msg.msg);
    } catch(_) {}
  });

  finnhubWS.on('close', () => {
    wsConnected = false;
    console.log('🔴 Finnhub WS closed — reconnecting in 5 s…');
    broadcastToAll({ type: 'status', status: 'disconnected' });
    setTimeout(connectFinnhubWS, 5000);
  });

  finnhubWS.on('error', err => console.error('Finnhub WS error:', err.message));
}

function finnhubSend(type, symbol) {
  if (finnhubWS && finnhubWS.readyState === WebSocket.OPEN)
    finnhubWS.send(JSON.stringify({ type, symbol }));
}

function broadcastToAll(obj) {
  const payload = JSON.stringify(obj);
  wss.clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(payload); });
}

// ── Browser WebSocket clients ─────────────────────────────────────────────
wss.on('connection', ws => {
  const mySymbols = new Set();
  ws.send(JSON.stringify({ type: 'status', status: !FINNHUB_KEY ? 'no-key' : wsConnected ? 'connected' : 'connecting' }));

  ws.on('message', raw => {
    try {
      const { type, symbol } = JSON.parse(raw);
      const sym = symbol?.toUpperCase();
      if (!sym) return;
      if (type === 'subscribe') {
        mySymbols.add(sym);
        if (!symbolClients.has(sym)) { symbolClients.set(sym, new Set()); finnhubSend('subscribe', sym); }
        symbolClients.get(sym).add(ws);
      }
      if (type === 'unsubscribe') { mySymbols.delete(sym); removeClientFromSymbol(ws, sym); }
    } catch(_) {}
  });

  ws.on('close', () => { mySymbols.forEach(sym => removeClientFromSymbol(ws, sym)); });
});

function removeClientFromSymbol(ws, symbol) {
  const clients = symbolClients.get(symbol);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) { symbolClients.delete(symbol); finnhubSend('unsubscribe', symbol); }
}

// ── Finnhub REST proxy ────────────────────────────────────────────────────
async function finnhubREST(endpoint, res) {
  if (!FINNHUB_KEY) return res.status(503).json({ error: 'no-key' });
  try {
    const url  = `https://finnhub.io/api/v1${endpoint}&token=${FINNHUB_KEY}`;
    const r    = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch(e) { res.status(502).json({ error: e.message }); }
}

app.get('/api/quote',   (req, res) => finnhubREST(`/quote?symbol=${req.query.symbol}`, res));
app.get('/api/candle',  (req, res) => {
  const { symbol, resolution = 'D', from, to } = req.query;
  finnhubREST(`/stock/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`, res);
});
app.get('/api/profile', (req, res) => finnhubREST(`/stock/profile2?symbol=${req.query.symbol}`, res));
app.get('/api/news', (req, res) => {
  const { symbol } = req.query;
  const to   = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  if (symbol) return finnhubREST(`/company-news?symbol=${symbol}&from=${from}&to=${to}`, res);
  finnhubREST(`/news?category=general`, res);
});
app.get('/api/status', (req, res) => res.json({
  hasKey: !!FINNHUB_KEY, wsConnected,
  dbConnected: mongoose.connection.readyState === 1,
  clients: wss.clients.size,
  symbols: [...symbolClients.keys()]
}));

// ── Portfolio Prices (Finnhub + CoinGecko) ────────────────────────────────
const CRYPTO_MAP_P = {
  BTC:'bitcoin', ETH:'ethereum', SOL:'solana', ADA:'cardano',
  XRP:'ripple', DOGE:'dogecoin', DOT:'polkadot', AVAX:'avalanche-2',
  MATIC:'matic-network', LINK:'chainlink', LTC:'litecoin',
  BNB:'binancecoin', SHIB:'shiba-inu', UNI:'uniswap', ATOM:'cosmos',
};

async function fetchFinnhubPortfolioPrice(symbol) {
  if (!FINNHUB_KEY) return { price: null, change24h: null };
  try {
    const url  = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`;
    const r    = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    if (!data || !data.c || data.c === 0) return { price: null, change24h: null };
    return { price: data.c, change24h: data.dp ?? null, name: symbol };
  } catch { return { price: null, change24h: null }; }
}

async function fetchYahooPortfolioPrice(symbol) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return { price: null, change24h: null };
    const price     = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change24h = prevClose ? ((price - prevClose) / prevClose) * 100 : null;
    return { price, change24h, name: meta.longName || meta.shortName || symbol };
  } catch { return { price: null, change24h: null }; }
}

async function fetchStockPortfolioPrice(symbol) {
  const result = await fetchFinnhubPortfolioPrice(symbol);
  if (result.price) return result;
  console.warn(`Finnhub returned no price for ${symbol}, trying Yahoo Finance...`);
  return fetchYahooPortfolioPrice(symbol);
}

app.get('/api/portfolio-prices', async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });
  const list       = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 50);
  const cryptoSyms = list.filter(s =>  CRYPTO_MAP_P[s]);
  const stockSyms  = list.filter(s => !CRYPTO_MAP_P[s]);
  const prices     = {};

  if (cryptoSyms.length) {
    try {
      const ids = cryptoSyms.map(s => CRYPTO_MAP_P[s]).join(',');
      const r   = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
        { signal: AbortSignal.timeout(8000) }
      );
      const data = await r.json();
      for (const sym of cryptoSyms) {
        const entry = data[CRYPTO_MAP_P[sym]];
        if (entry) prices[sym] = { price: entry.usd, change24h: entry.usd_24h_change ?? null };
      }
    } catch(e) { console.error('CoinGecko error:', e.message); }
  }

  if (stockSyms.length) {
    const results = await Promise.all(stockSyms.map(s => fetchStockPortfolioPrice(s)));
    stockSyms.forEach((sym, i) => { prices[sym] = results[i]; });
  }

  res.json(prices);
});

// ── Serve static frontend files ───────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('  📈  StockAI is running!');
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  🔑  Finnhub key : ${FINNHUB_KEY ? '✅ set' : '❌ not set'}`);
  console.log(`  🍃  MongoDB     : ${MONGO_URI   ? '✅ connecting…' : '❌ not set (add MONGO_URI to .env)'}`);
  console.log(`  🔐  JWT secret  : ${process.env.JWT_SECRET ? '✅ set' : '⚠️  using fallback (set JWT_SECRET in .env)'}`);
  console.log('');
  if (FINNHUB_KEY) connectFinnhubWS();
});
