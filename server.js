require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const path = require('path');

const app    = express();
const server = createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

const FINNHUB_KEY = process.env.FINNHUB_KEY;
const PORT        = process.env.PORT || 3001;

// ── Finnhub WebSocket (one shared connection for the whole server) ─────────
let finnhubWS   = null;
let wsConnected = false;

// symbol → Set of browser WebSocket clients
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

    // Re-subscribe any symbols that were pending
    for (const symbol of symbolClients.keys()) {
      finnhubSend('subscribe', symbol);
    }
  });

  finnhubWS.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'trade' && msg.data) {
        msg.data.forEach(trade => {
          const clients = symbolClients.get(trade.s);
          if (!clients || clients.size === 0) return;
          const payload = JSON.stringify({
            type: 'trade', symbol: trade.s,
            price: trade.p, volume: trade.v, time: trade.t
          });
          clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) ws.send(payload);
          });
        });
      }
      if (msg.type === 'error') {
        console.error('Finnhub WS error msg:', msg.msg);
      }
    } catch (_) {}
  });

  finnhubWS.on('close', () => {
    wsConnected = false;
    console.log('🔴 Finnhub WS closed — reconnecting in 5 s…');
    broadcastToAll({ type: 'status', status: 'disconnected' });
    setTimeout(connectFinnhubWS, 5000);
  });

  finnhubWS.on('error', err => {
    console.error('Finnhub WS error:', err.message);
  });
}

function finnhubSend(type, symbol) {
  if (finnhubWS && finnhubWS.readyState === WebSocket.OPEN) {
    finnhubWS.send(JSON.stringify({ type, symbol }));
  }
}

function broadcastToAll(obj) {
  const payload = JSON.stringify(obj);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}

// ── Browser WebSocket clients ─────────────────────────────────────────────
wss.on('connection', ws => {
  const mySymbols = new Set();

  // Tell the browser the current connection state immediately
  ws.send(JSON.stringify({
    type: 'status',
    status: !FINNHUB_KEY ? 'no-key' : wsConnected ? 'connected' : 'connecting'
  }));

  ws.on('message', raw => {
    try {
      const { type, symbol } = JSON.parse(raw);
      const sym = symbol?.toUpperCase();
      if (!sym) return;

      if (type === 'subscribe') {
        mySymbols.add(sym);
        if (!symbolClients.has(sym)) {
          symbolClients.set(sym, new Set());
          finnhubSend('subscribe', sym);
        }
        symbolClients.get(sym).add(ws);
      }

      if (type === 'unsubscribe') {
        mySymbols.delete(sym);
        removeClientFromSymbol(ws, sym);
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    mySymbols.forEach(sym => removeClientFromSymbol(ws, sym));
  });
});

function removeClientFromSymbol(ws, symbol) {
  const clients = symbolClients.get(symbol);
  if (!clients) return;
  clients.delete(ws);
  // Unsubscribe from Finnhub when no browsers care about this symbol
  if (clients.size === 0) {
    symbolClients.delete(symbol);
    finnhubSend('unsubscribe', symbol);
  }
}

// ── Finnhub REST proxy ────────────────────────────────────────────────────
async function finnhubREST(endpoint, res) {
  if (!FINNHUB_KEY) {
    // Tell the browser to use simulated data
    return res.status(503).json({ error: 'no-key' });
  }
  try {
    const url = `https://finnhub.io/api/v1${endpoint}&token=${FINNHUB_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
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
app.get('/api/status',  (req, res) => res.json({
  hasKey: !!FINNHUB_KEY,
  wsConnected,
  clients: wss.clients.size,
  symbols: [...symbolClients.keys()]
}));

// ── Serve static frontend files ───────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('');
  console.log('  📈  StockAI is running!');
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  🔑  Finnhub key: ${FINNHUB_KEY ? '✅ set' : '❌ not set (add to .env)'}`);
  console.log('');
  if (FINNHUB_KEY) connectFinnhubWS();
});
