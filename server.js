require('dotenv').config();
const express  = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const path     = require('path');
const mongoose = require('mongoose');
const { fetchHistoricalBars, toFinnhubCandleFormat } = require('./marketData');
const bcrypt   = require('bcryptjs');
const { installAccountRoutes } = require('./accountRoutes');
const { createRateLimiter } = require('./security');
const { publicSettings, registerPublic, installVerificationRoutes } = require('./publicSignup');
const { AIPredictor } = require('./js/aiPredictor');
const { installForwardTrackingRoutes } = require('./forwardTracking');
const jwt      = require('jsonwebtoken');
const cron     = require('node-cron');
const _anthropicMod = require('@anthropic-ai/sdk');
const Anthropic = _anthropicMod.default || _anthropicMod;
const { runMarketScan, runCryptoScan, runDailyDigest } = require('./alertEngine');

const app    = express();
const server = createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

app.set('trust proxy', 1); // Render sits behind one trusted ingress proxy
app.disable('x-powered-by');
app.use(express.json({limit:'32kb'}));

const FINNHUB_KEY      = process.env.FINNHUB_KEY;
const MONGO_URI        = process.env.MONGO_URI;
const ALLOWED_EMAIL    = (process.env.ALLOWED_EMAIL || '').toLowerCase().trim();
const SITE_PASSWORD    = process.env.SITE_PASSWORD || '';
const PUBLIC_SITE_ENABLED = process.env.PUBLIC_SITE_ENABLED === 'true';
// ALLOWED_EMAIL remains the owner's original identity when the site opens.
// No migration of the existing MongoDB user or their portfolio is required.
const OWNER_EMAIL = (process.env.OWNER_EMAIL || ALLOWED_EMAIL || '').toLowerCase().trim();
if (PUBLIC_SITE_ENABLED && !OWNER_EMAIL) {
  throw new Error('Set OWNER_EMAIL (existing owner's email) before opening StockAI publicly.');
}

// ── Private-mode gate — only you can access this site ────────────────────────
// Layer 1: HTTP Basic Auth on all HTML pages (browser shows a password popup)
if (SITE_PASSWORD && !PUBLIC_SITE_ENABLED) {
  app.use((req, res, next) => {
    // Skip basic-auth for API routes, PWA static assets, and uptime monitors
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) return next();
    if (['/manifest.json', '/sw.js', '/favicon.svg', '/ping'].includes(req.path)) return next();
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Basic ')) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString();
      const pass = decoded.split(':').slice(1).join(':'); // handle colons in password
      if (pass === SITE_PASSWORD) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="StockAI"');
    res.status(401).send('Access denied');
  });
}
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured in production.');
}
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.warn('⚠️  JWT_SECRET is short; use a 32+ character random secret at the next maintenance window.');
}
const JWT_SECRET       = process.env.JWT_SECRET || 'stockai_dev_only_secret_change_me';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT             = process.env.PORT || 3001;

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
  created:   { type: Date, default: Date.now },
  tokenVersion: { type: Number, default: 0 },
  passwordResetHash: { type: String, default: undefined, select: false },
  passwordResetExpires: { type: Date, default: undefined, select: false },
  emailVerified: { type: Boolean, default: true }, // historical accounts remain valid
  emailVerifyHash: { type: String, default: undefined, select: false },
  emailVerifyExpires: { type: Date, default: undefined, select: false }
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

const PredictionSchema = new mongoose.Schema({
  userId: {type:mongoose.Schema.Types.ObjectId,ref:'User',required:true,index:true},
  symbol: {type:String,required:true,uppercase:true},
  modelVersion: {type:String,required:true},
  signalTime: {type:Number,required:true},
  horizonSessions: {type:Number,required:true},
  direction: {type:String,enum:['UP','DOWN','NEUTRAL'],required:true},
  indicatorScore: {type:Number,required:true},
  status: {type:String,enum:['pending','resolved'],default:'pending'},
  createdAt: {type:Date,default:Date.now},
  entryTime:Number,exitTime:Number,entryPrice:Number,exitPrice:Number,
  marketReturnPct:Number,correct:Boolean,hypotheticalNetReturnPct:Number,resolvedAt:Date
});
PredictionSchema.index({userId:1,symbol:1,signalTime:1,modelVersion:1,horizonSessions:1},{unique:true});
PredictionSchema.index({userId:1,createdAt:-1});
const Prediction = mongoose.model('Prediction',PredictionSchema);

// ── Auth middleware ───────────────────────────────────────────────────────
async function authMW(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(h.slice(7), JWT_SECRET);
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'Database not connected' });
    }
    // Reject tokens issued before a password reset/change and deleted accounts.
    const user = await User.findById(decoded.id).select('tokenVersion email name');
    if (!user || (decoded.v ?? 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Session expired. Sign in again.' });
    }
    if ((PUBLIC_SITE_ENABLED || !ALLOWED_EMAIL) && user.emailVerified === false)
      return res.status(403).json({error:'Verify your email before using StockAI.'});
    if (!PUBLIC_SITE_ENABLED && ALLOWED_EMAIL && user.email !== ALLOWED_EMAIL) {
      return res.status(403).json({ error: 'This instance is restricted to the owner.' });
    }
    req.user = { id: String(user._id), email: user.email, name: user.name };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token expired or invalid — please log in again' });
  }
}

function signAccessToken(user) {
  return jwt.sign({
    id: String(user._id), email: user.email, name: user.name, v: user.tokenVersion || 0
  }, JWT_SECRET, { expiresIn: '30d' });
}

function dbRequired(req, res, next) {
  if (mongoose.connection.readyState !== 1)
    return res.status(503).json({ error: 'Database not connected' });
  next();
}

function ownerOnly(req, res, next) {
  if (!OWNER_EMAIL || req.user?.email !== OWNER_EMAIL) {
    return res.status(403).json({ error: 'Private owner access required' });
  }
  next();
}

// ── Health check (used by UptimeRobot — no auth required) ────────────────
app.get('/ping', (req, res) => res.send('ok'));

// Separate readiness check for login. /ping verifies that Node is alive;
// this endpoint also verifies that the database required for login is ready.
app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.set('Cache-Control', 'no-store');
  res.status(connected ? 200 : 503).json({
    service: 'stockai',
    ok: connected,
    database: connected ? 'connected' : (MONGO_URI ? 'disconnected' : 'not-configured')
  });
});

// ── Manual alert test (private owner JWT only; no secrets in URLs) ───────
app.post('/api/admin/test-alert', authMW, ownerOnly, async (req, res) => {
  res.json({ ok: true, message: 'Crypto scan started — check your email in ~60 seconds' });
  try {
    const { runCryptoScan } = require('./alertEngine');
    await runCryptoScan();
  } catch (e) {
    console.error('[TestAlert] Error:', e.message);
  }
});

// ── Force a test email via Resend (private owner JWT only) ────────────────
app.post('/api/admin/test-email', authMW, ownerOnly, async (req, res) => {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const ALERT_TO   = process.env.ALERT_EMAIL_TO;
  if (!RESEND_KEY || !ALERT_TO) {
    return res.json({ ok: false, error: 'RESEND_API_KEY or ALERT_EMAIL_TO not set in Render env vars' });
  }
  res.json({ ok: true, message: `Sending test email to ${ALERT_TO} — check inbox in 10s` });
  const { Resend } = require('resend');
  const resend = new Resend(RESEND_KEY);
  resend.emails.send({
    from: 'StockAI Alerts <onboarding@resend.dev>',
    to: ALERT_TO.split(',').map(e => e.trim()).filter(Boolean),
    subject: '✅ StockAI — Email delivery test',
    html: `<div style="font-family:sans-serif;background:#0a0e1a;color:#f1f5f9;padding:32px;border-radius:12px">
      <h2 style="color:#00c9a7">StockAI ✅ Email is working!</h2>
      <p>Your automated alert system is configured correctly.</p>
      <p style="color:#6b7280;font-size:13px">Sent at ${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET</p>
    </div>`
  }).then(r => console.log(`[TestEmail] ✅ Sent to ${ALERT_TO}`, r?.data?.id || ''))
    .catch(e => console.error('[TestEmail] ❌ Failed:', e.message));
});

function normalizeAccountEmail(value) {
  if (typeof value !== 'string' || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Public launch is opt-in; rate limits help but are not distributed across instances.
const limiterSignup = createRateLimiter({windowMs:60*60*1000,max:6,namespace:'register'});
const limiterLogin = createRateLimiter({windowMs:15*60*1000,max:30,namespace:'login'});
const limiterVerify = createRateLimiter({windowMs:60*60*1000,max:15,namespace:'verification'});
const limiterProvider = createRateLimiter({windowMs:15*60*1000,max:240,namespace:'provider'});
const limiterAI = createRateLimiter({windowMs:24*60*60*1000,max:20,namespace:'ai',keyFn:req=>req.user?.id || req.ip});
app.use(['/api/quote','/api/candle','/api/profile','/api/news','/api/portfolio-prices'],limiterProvider);
installVerificationRoutes(app,{User,dbRequired,
  allowedEmail:PUBLIC_SITE_ENABLED ? '' : ALLOWED_EMAIL,rateLimit:limiterVerify});

// ── Auth routes ───────────────────────────────────────────────────────────
app.post('/api/auth/register', limiterSignup, dbRequired, async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    const normalizedEmail = normalizeAccountEmail(email);
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 || !normalizedEmail)
      return res.status(400).json({ error: 'A valid name (up to 80 characters) and email are required' });
    // Layer 2: block registration for any email that isn't the owner's
    if (!PUBLIC_SITE_ENABLED && ALLOWED_EMAIL && normalizedEmail !== ALLOWED_EMAIL)
      return res.status(403).json({ error: 'Registration is restricted to the owner on this private instance.', code: 'PRIVATE_ACCESS_ONLY' });
    // A public /api request must never be able to claim the private owner's
    // email, even if the account does not yet exist in MongoDB.
    if (!PUBLIC_SITE_ENABLED && ALLOWED_EMAIL) {
      const ownerKey = Buffer.from(process.env.OWNER_SETUP_KEY || '');
      const presented = Buffer.from(req.get('X-StockAI-Owner-Setup-Key') || '');
      if (ownerKey.length < 24 || presented.length !== ownerKey.length ||
          !require('node:crypto').timingSafeEqual(presented, ownerKey)) {
        return res.status(403).json({
          error: 'Private account setup requires the owner setup key configured in Render.',
          code: 'OWNER_SETUP_REQUIRED'
        });
      }
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128)
      return res.status(400).json({ error: 'Password must be 8–128 characters' });
    if (await User.findOne({ email: normalizedEmail }))
      return res.status(400).json({ error: 'An account with that email already exists' });
    const hashed = await bcrypt.hash(password, 12);
    if (PUBLIC_SITE_ENABLED || !ALLOWED_EMAIL) {
      // The owner's email is reserved for their existing MongoDB identity:
      // never let a public signup take over that address.
      if (OWNER_EMAIL && normalizedEmail === OWNER_EMAIL)
        return res.status(403).json({error:'This address cannot register as a new public account.'});
      // Public accounts must prove email ownership before a JWT is issued.
      if (!publicSettings().registrationOpen) {
        return res.status(503).json({error:'Public signups are not enabled or verified email delivery is not configured.',code:'PUBLIC_REGISTRATION_CLOSED'});
      }
      const result = await registerPublic({User,email:normalizedEmail,name:name.trim(),hashedPassword:hashed});
      res.set('Cache-Control','no-store');
      return res.status(202).json(result);
    }
    const user   = await User.create({ name: name.trim(), email: normalizedEmail, password: hashed });
    const token  = signAccessToken(user);
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: OWNER_EMAIL && user.email === OWNER_EMAIL ? 'owner' : 'user' } });
  } catch(e) {
    console.error('Register:', e.message);
    res.status(500).json({ error: 'Server error — try again' });
  }
});

app.post('/api/auth/login', limiterLogin, dbRequired, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const normalizedEmail = normalizeAccountEmail(email);
    if (!normalizedEmail || typeof password !== 'string')
      return res.status(400).json({ error: 'Email and password are required' });
    // Layer 3: block login for anyone who isn't the owner
    if (!PUBLIC_SITE_ENABLED && ALLOWED_EMAIL && normalizedEmail !== ALLOWED_EMAIL)
      return res.status(403).json({ error: 'This is the private owner-only instance. Use the public website for other accounts.', code: 'PRIVATE_ACCESS_ONLY' });
    const user = await User.findOne({ email: normalizedEmail });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid email or password' });
    if ((PUBLIC_SITE_ENABLED || !ALLOWED_EMAIL) && user.emailVerified === false)
      return res.status(403).json({error:'Confirm your email address before signing in.',code:'EMAIL_NOT_VERIFIED'});
    const token = signAccessToken(user);
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: OWNER_EMAIL && user.email === OWNER_EMAIL ? 'owner' : 'user' } });
  } catch(e) {
    console.error('Login:', e.message);
    res.status(500).json({ error: 'Server error — try again' });
  }
});

installAccountRoutes(app,{User,Holding,Prediction,authMW,dbRequired,
  allowedEmail:PUBLIC_SITE_ENABLED ? '' : ALLOWED_EMAIL});
const forwardLimiter = createRateLimiter({windowMs:60*60*1000,max:80,namespace:'forward',keyFn:req=>req.user?.id||req.ip});
installForwardTrackingRoutes(app,{Prediction,authMW,dbRequired,fetchHistoricalBars,AIPredictor,rateLimit:forwardLimiter});

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
    const ticker = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    const qty = Number(shares), cost = Number(buyPrice);
    if (!/^[A-Z0-9.\\^:-]{1,24}$/.test(ticker) ||
        shares == null || buyPrice == null ||
        !Number.isFinite(qty) || qty <= 0 || qty > 1e12 ||
        !Number.isFinite(cost) || cost <= 0 || cost > 1e12 ||
        !['stock','etf','crypto'].includes(assetType) ||
        !['taxable','roth_ira','k401','crypto_wallet','other'].includes(accountType) ||
        typeof name !== 'string' || name.length > 120) {
      return res.status(400).json({ error: 'Valid ticker, positive shares and price, and supported asset/account types are required.' });
    }
    const h = await Holding.create({
      userId: req.user.id,
      symbol: ticker,
      shares: qty, buyPrice: cost,
      assetType, accountType,
      name: name.trim() || ticker
    });
    res.json({ id: h._id, symbol: h.symbol, name: h.name, shares: h.shares, buyPrice: h.buyPrice, assetType: h.assetType, accountType: h.accountType });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/user/portfolio/:id', authMW, dbRequired, async (req, res) => {
  try {
    const allowed = ['shares','buyPrice','assetType','accountType','name'];
    const update = {};
    for (const k of allowed) {
      if (req.body?.[k] == null) continue;
      const value=req.body[k];
      if (k==='shares' || k==='buyPrice') {
        const num=Number(value);
        if (!Number.isFinite(num) || num<=0 || num>1e12)
          return res.status(400).json({ error: 'Shares and buy price must be positive finite numbers.' });
        update[k]=num;
      } else if (k==='assetType') {
        if (!['stock','etf','crypto'].includes(value))
          return res.status(400).json({error:'Invalid asset type'});
        update[k]=value;
      } else if (k==='accountType') {
        if (!['taxable','roth_ira','k401','crypto_wallet','other'].includes(value))
          return res.status(400).json({error:'Invalid account type'});
        update[k]=value;
      } else if (k==='name') {
        if (typeof value !== 'string' || value.length>120)
          return res.status(400).json({error:'Name must be 120 characters or fewer'});
        update[k]=value.trim();
      }
    }
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
    if (!Array.isArray(watchlist) || watchlist.length > 100 ||
        watchlist.some(v=>typeof v!=='string' || !/^[A-Z0-9.\\^:-]{1,24}$/.test(v.trim().toUpperCase())))
      return res.status(400).json({ error: 'Watchlist must contain up to 100 valid ticker symbols.' });
    const clean = [...new Set(watchlist.map(v=>v.trim().toUpperCase()))];
    await User.findByIdAndUpdate(req.user.id, { watchlist: clean });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Finnhub WebSocket (one shared connection for the whole server) ─────────
let finnhubWS      = null;
let wsConnected    = false;
let wsRetryDelay   = 10000;   // start at 10 s, backs off to 5 min on 429
const WS_DELAY_MAX = 300000;  // cap at 5 minutes
const symbolClients = new Map();

function connectFinnhubWS() {
  if (!FINNHUB_KEY) {
    console.warn('⚠️  FINNHUB_KEY not set — live WebSocket disabled');
    return;
  }
  console.log(`🔌 Connecting to Finnhub WebSocket… (retry delay ${wsRetryDelay/1000}s)`);
  finnhubWS = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);

  finnhubWS.on('open', () => {
    wsConnected  = true;
    wsRetryDelay = 10000; // reset backoff on successful connect
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
    wsConnected  = false;
    wsRetryDelay = Math.min(wsRetryDelay * 2, WS_DELAY_MAX); // exponential backoff
    console.log(`🔴 Finnhub WS closed — reconnecting in ${wsRetryDelay/1000}s…`);
    broadcastToAll({ type: 'status', status: 'disconnected' });
    setTimeout(connectFinnhubWS, wsRetryDelay);
  });

  // 429 = rate limited — back off hard
  finnhubWS.on('unexpected-response', (req, res) => {
    wsRetryDelay = Math.min(wsRetryDelay * 3, WS_DELAY_MAX);
    console.warn(`⚠️  Finnhub WS rejected (HTTP ${res.statusCode}) — backing off ${wsRetryDelay/1000}s`);
    finnhubWS.terminate();
  });

  finnhubWS.on('error', err => {
    // suppress noisy ECONNRESET logs — close event will handle reconnect
    if (!err.message.includes('ECONNRESET')) console.error('Finnhub WS error:', err.message);
  });
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
app.get('/api/candle', async (req, res) => {
  const { symbol, resolution = 'D', from, to } = req.query;
  try {
    const bars = await fetchHistoricalBars(symbol, { from, to, resolution });
    res.set('Cache-Control', 'public, max-age=180');
    res.json(toFinnhubCandleFormat(bars));
  } catch (e) {
    const badRequest = /^(Invalid|Unsupported)/.test(e.message);
    if (!badRequest) console.warn('[MarketData] ' + symbol + ': ' + e.message);
    res.status(badRequest ? 400 : 502).json({
      error: badRequest ? e.message : 'Historical market data temporarily unavailable'
    });
  }
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
  // Show internal connection metadata only on the private owner deployment.
  ...(!PUBLIC_SITE_ENABLED ? {clients:wss.clients.size,symbols:[...symbolClients.keys()]} : {})
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

// ── Claude AI Stock Analysis ──────────────────────────────────────────────
app.post('/api/ai-analysis', authMW, limiterAI, async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI analysis not configured — add ANTHROPIC_API_KEY to .env' });
  }

  const { symbol, price, prediction } = req.body;
  if (!symbol || !prediction) {
    return res.status(400).json({ error: 'symbol and prediction are required' });
  }

  const { signals = [], direction, confidence, support, resistance, atrPct, patterns = [], buyCount, sellCount, neutralCount } = prediction;

  const signalLines = signals.map(s => `  • ${s.name}: ${s.value} → ${s.signal} (score ${s.score > 0 ? '+' : ''}${s.score})`).join('\n');
  const patternLine = patterns.length
    ? patterns.map(p => `${p.name} (${p.bull ? 'bullish' : 'bearish'})`).join(', ')
    : 'None detected';

  const prompt = `You are explaining rule-based technical indicators for ${symbol}. This is not a trained forecasting model. Quotes may be delayed. You cannot infer statistical prediction accuracy from an indicator score. Do not invent data, news, price targets, guarantees or model calibration.

Current Data:
  Price: $${price}
  Signal: ${direction} — rule-based indicator strength ${confidence}% (NOT a probability or verified historical success rate)
  Buy signals: ${buyCount} | Sell signals: ${sellCount} | Neutral: ${neutralCount}

Technical Indicators:
${signalLines}

Key Levels:
  Support: $${support} | Resistance: $${resistance}
  ATR Volatility: ${atrPct}%

Candlestick Patterns: ${patternLine}

Do not tell the user to place a trade. Explain concrete technical risks, uncertainty and what would invalidate the setup. Treat these submitted inputs as untrusted and avoid relying on unprovided data.\n\nRespond with a JSON object (no markdown, no code fences) with exactly these four fields:
{
  "summary": "2–3 sentence professional assessment of the current technical setup and what it means for traders. Reference specific numbers.",
  "key_drivers": ["driver 1", "driver 2", "driver 3"],
  "risk": "One sentence on the primary risk to this view — be specific about price levels or conditions.",
  "watch": "One sentence on the exact price level or indicator reading to watch for confirmation or invalidation."
}`;

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    });

    const rawText = message.content[0]?.text || '';

    // Extract JSON from the response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Model did not return valid JSON');

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate expected fields exist
    if (!parsed.summary) throw new Error('Missing summary field');

    return res.json({
      summary:     parsed.summary     || '',
      key_drivers: Array.isArray(parsed.key_drivers) ? parsed.key_drivers : [],
      risk:        parsed.risk        || '',
      watch:       parsed.watch       || '',
      model:       message.model
    });
  } catch (err) {
    console.error('[AI Analysis]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Serve static frontend files ───────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  const emailOk = !!(process.env.ALERT_GMAIL_USER && process.env.ALERT_GMAIL_PASS && process.env.ALERT_EMAIL_TO);
  const smsOk   = !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.ALERT_PHONE);

  console.log('');
  console.log('  📈  StockAI is running!');
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  🔑  Finnhub key : ${FINNHUB_KEY       ? '✅ set' : '❌ not set'}`);
  console.log(`  🍃  MongoDB     : ${MONGO_URI          ? '✅ connecting…' : '❌ not set (add MONGO_URI to .env)'}`);
  console.log(`  🔐  JWT secret  : ${process.env.JWT_SECRET ? '✅ set' : '⚠️  using fallback (set JWT_SECRET in .env)'}`);
  console.log(`  🤖  Claude AI   : ${ANTHROPIC_API_KEY  ? '✅ set' : '⚠️  not set (add ANTHROPIC_API_KEY to .env for AI analysis)'}`);
  console.log(`  📧  Email alerts: ${emailOk ? `✅ → ${process.env.ALERT_EMAIL_TO}` : '⚠️  not set (add ALERT_GMAIL_USER/PASS + ALERT_EMAIL_TO)'}`);
  console.log(`  📱  SMS alerts  : ${smsOk   ? '✅ Twilio configured' : '➖  not set (optional — add TWILIO_SID/TOKEN/FROM + ALERT_PHONE)'}`);
  console.log('');

  if (FINNHUB_KEY) connectFinnhubWS();

  // ── Alert Engine — Cron schedules ───────────────────────────────────────
  if (FINNHUB_KEY) {
    // Stocks + ETFs + IPOs: every 30 min during US market hours Mon–Fri (ET)
    cron.schedule('*/30 9-16 * * 1-5', () => {
      console.log('[Cron] ⏰ Market scan triggered');
      runMarketScan().catch(e => console.error('[Cron] Market scan failed:', e.message));
    }, { timezone: 'America/New_York' });

    // Pre-market scan: Mon–Fri 8:00 AM ET (catches IPOs + early movers)
    cron.schedule('0 8 * * 1-5', () => {
      console.log('[Cron] ⏰ Pre-market scan triggered');
      runMarketScan().catch(e => console.error('[Cron] Pre-market scan failed:', e.message));
    }, { timezone: 'America/New_York' });

    // After-hours scan: Mon–Fri 5:00 PM ET
    cron.schedule('0 17 * * 1-5', () => {
      console.log('[Cron] ⏰ After-hours scan triggered');
      runMarketScan().catch(e => console.error('[Cron] After-hours scan failed:', e.message));
    }, { timezone: 'America/New_York' });

    // Crypto: every 2 hours, 24/7 (crypto markets never close)
    cron.schedule('0 */2 * * *', () => {
      console.log('[Cron] ⏰ Crypto scan triggered');
      runCryptoScan().catch(e => console.error('[Cron] Crypto scan failed:', e.message));
    });

    // Daily digest: Mon–Fri 4:00 PM ET — always sends top 5 signals at market close
    cron.schedule('0 16 * * 1-5', () => {
      console.log('[Cron] ⏰ Daily digest triggered');
      runDailyDigest().catch(e => console.error('[Cron] Daily digest failed:', e.message));
    }, { timezone: 'America/New_York' });

    console.log('  ⏰  Alert Engine: ✅ cron jobs scheduled');
    console.log('       • Stocks/ETFs/IPOs: every 30 min (Mon–Fri 8AM–5PM ET)');
    console.log('       • Crypto: every 2 hours, 24/7');
    console.log('       • Daily digest: Mon–Fri 4PM ET (always sends top 5)');
    console.log('');
  } else {
    console.log('  ⏰  Alert Engine: ⚠️  disabled (FINNHUB_KEY not set)');
    console.log('');
  }
});
