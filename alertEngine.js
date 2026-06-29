'use strict';
/**
 * alertEngine.js — Automated global market alert system
 *
 * Scans stocks, ETFs, crypto, and IPO calendars on a schedule.
 * Sends email (and optional SMS) alerts for:
 *   • Strong Buy / Sell signals  (≥75% confidence, ≥4 indicators agree)
 *   • Golden Cross / Death Cross (SMA 50 vs 200 crossover)
 *   • Major movers               (price change ≥5% in one day)
 *   • Upcoming IPOs              (within 7 days)
 *
 * Configure via .env — see SETUP GUIDE at the bottom of this file.
 */

const { Resend } = require('resend');
const mongoose   = require('mongoose');

// ── Environment config ────────────────────────────────────────────────────────
const FINNHUB_KEY   = process.env.FINNHUB_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const ALERT_TO      = process.env.ALERT_EMAIL_TO;     // Where to send alerts (comma-separated)
const TWILIO_SID    = process.env.TWILIO_SID;
const TWILIO_TOKEN  = process.env.TWILIO_TOKEN;
const TWILIO_FROM   = process.env.TWILIO_FROM;        // +1XXXXXXXXXX
const ALERT_PHONE   = process.env.ALERT_PHONE;        // +1XXXXXXXXXX

// ── Watchlist — edit this to customise what gets scanned ─────────────────────
const WATCHLIST = {
  stocks: [
    'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'AMD',
    'NFLX', 'JPM', 'V', 'PLTR', 'MSTR', 'ARM', 'AVGO', 'SMCI',
    'ORCL', 'CRM', 'UBER', 'COIN'
  ],
  etfs: [
    'SPY', 'QQQ', 'ARKK', 'GLD', 'IWM', 'VTI', 'SOXL', 'TQQQ', 'SQQQ', 'XLK'
  ],
  crypto: [
    'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT',
    'BINANCE:XRPUSDT', 'BINANCE:BNBUSDT', 'BINANCE:DOGEUSDT',
    'BINANCE:AVAXUSDT', 'BINANCE:LINKUSDT'
  ]
};

// Signal thresholds
const CONFIDENCE_MIN  = 75;   // % confidence required to trigger strong signal
const SIGNAL_MIN      = 4;    // minimum indicators agreeing (out of ~6)
const MOVER_PCT       = 5;    // daily % change to flag as major mover
const ALERT_COOLDOWN  = 24;   // hours before same signal repeats for same symbol

// ── MongoDB deduplication model ───────────────────────────────────────────────
const AlertLogSchema = new mongoose.Schema({
  symbol:     { type: String, required: true },
  signalType: { type: String, required: true },
  direction:  String,
  confidence: Number,
  sentAt:     { type: Date, default: Date.now }
});
AlertLogSchema.index({ symbol: 1, signalType: 1, sentAt: 1 });

let AlertLog;
try   { AlertLog = mongoose.model('AlertLog'); }
catch { AlertLog = mongoose.model('AlertLog', AlertLogSchema); }

// ── Finnhub API helpers ───────────────────────────────────────────────────────
const FH = 'https://finnhub.io/api/v1';

async function fhGet(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${FH}${path}${sep}token=${FINNHUB_KEY}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!resp.ok) throw new Error(`Finnhub HTTP ${resp.status} — ${path}`);
  return resp.json();
}

// CoinGecko IDs for crypto (free API, no key required)
const COINGECKO_IDS = {
  'BINANCE:BTCUSDT':  'bitcoin',
  'BINANCE:ETHUSDT':  'ethereum',
  'BINANCE:SOLUSDT':  'solana',
  'BINANCE:XRPUSDT':  'ripple',
  'BINANCE:BNBUSDT':  'binancecoin',
  'BINANCE:DOGEUSDT': 'dogecoin',
  'BINANCE:AVAXUSDT': 'avalanche-2',
  'BINANCE:LINKUSDT': 'chainlink'
};

async function fetchCandlesCoinGecko(symbol, days = 220) {
  const cgId = COINGECKO_IDS[symbol];
  if (!cgId) throw new Error(`No CoinGecko ID for ${symbol}`);
  const url = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'Accept': 'application/json' } });
  if (!resp.ok) throw new Error(`CoinGecko HTTP ${resp.status} — ${cgId}`);
  const data = await resp.json();
  if (!data.prices?.length) return null;
  const volMap = new Map((data.total_volumes || []).map(([t, v]) => [Math.floor(t / 86400000), v]));
  return data.prices
    .map(([t, close]) => {
      const day = Math.floor(t / 86400000);
      return { close, open: close, high: close, low: close, volume: volMap.get(day) || 0, time: Math.floor(t / 1000) };
    })
    .sort((a, b) => a.time - b.time);
}

async function fetchCandles(symbol, days = 220) {
  if (symbol.includes(':')) return fetchCandlesCoinGecko(symbol, days);
  const to   = Math.floor(Date.now() / 1000);
  const from = to - days * 86400;
  const data = await fhGet(`/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}`);
  if (data.s !== 'ok' || !data.c?.length) return null;
  return data.c.map((close, i) => ({
    close, open: data.o[i], high: data.h[i], low: data.l[i],
    volume: data.v[i], time: data.t[i]
  }));
}

async function fetchIPOCalendar() {
  const from = new Date().toISOString().split('T')[0];
  const to   = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
  return fhGet(`/calendar/ipo?from=${from}&to=${to}`);
}

async function fetchCompanyProfile(symbol) {
  try { return await fhGet(`/stock/profile2?symbol=${symbol}`); }
  catch { return {}; }
}

// ── Technical Analysis (server-side, mirrors aiPredictor.js) ─────────────────
const TA = {
  ema(arr, p) {
    const k = 2 / (p + 1), res = [arr[0]];
    for (let i = 1; i < arr.length; i++) res.push(arr[i] * k + res[i-1] * (1-k));
    return res;
  },
  sma(arr, p) {
    return arr.map((_, i) => {
      if (i < p-1) return null;
      return arr.slice(i-p+1, i+1).reduce((a,b) => a+b, 0) / p;
    });
  },
  rsi(closes, p = 14) {
    const ch = closes.slice(1).map((c,i) => c - closes[i]);
    const g  = ch.map(c => Math.max(c, 0));
    const l  = ch.map(c => Math.abs(Math.min(c, 0)));
    let ag = g.slice(0,p).reduce((a,b)=>a+b,0)/p;
    let al = l.slice(0,p).reduce((a,b)=>a+b,0)/p;
    const vals = [null];
    for (let i = 0; i < ch.length; i++) {
      if (i < p) { vals.push(null); continue; }
      ag = (ag*(p-1) + g[i]) / p;
      al = (al*(p-1) + l[i]) / p;
      vals.push(al === 0 ? 100 : 100 - 100/(1 + ag/al));
    }
    return vals;
  },
  macd(closes) {
    const e12 = this.ema(closes,12), e26 = this.ema(closes,26);
    const line = e12.map((v,i) => v - e26[i]);
    const sig  = this.ema(line, 9);
    return { line, sig, hist: line.map((v,i) => v - sig[i]) };
  },
  bb(closes, p = 20, m = 2) {
    const s = this.sma(closes, p);
    return closes.map((_, i) => {
      if (!s[i]) return null;
      const sl  = closes.slice(i-p+1, i+1);
      const std = Math.sqrt(sl.reduce((a,v) => a+(v-s[i])**2, 0)/p);
      return { upper: s[i]+m*std, lower: s[i]-m*std, mid: s[i] };
    });
  },
  obv(closes, vols) {
    const r = [0];
    for (let i = 1; i < closes.length; i++) {
      r.push(closes[i] > closes[i-1] ? r[i-1]+vols[i]
           : closes[i] < closes[i-1] ? r[i-1]-vols[i] : r[i-1]);
    }
    return r;
  },

  predict(bars) {
    if (bars.length < 60) return null;
    const closes = bars.map(b => b.close);
    const highs  = bars.map(b => b.high);
    const lows   = bars.map(b => b.low);
    const vols   = bars.map(b => b.volume);
    const n = closes.length - 1;
    const signals = [];

    // RSI
    const rsiVals = this.rsi(closes);
    const rsi = rsiVals[n];
    if (rsi != null) {
      const sc = rsi<30?2:rsi<45?1:rsi<55?0:rsi<70?-1:-2;
      const lb = sc===2?'STRONG BUY':sc===1?'BUY':sc===-2?'STRONG SELL':sc===-1?'SELL':'NEUTRAL';
      signals.push({ name:'RSI(14)', value:rsi.toFixed(1), signal:lb, score:sc, weight:1.5 });
    }

    // MACD
    const { line, sig, hist } = this.macd(closes);
    const mv=line[n], mh=hist[n], ph=hist[n-1];
    const ms = mv>sig[n]&&mh>ph?2:mv>sig[n]?1:mv<sig[n]&&mh<ph?-2:mv<sig[n]?-1:0;
    signals.push({ name:'MACD', value:mv.toFixed(3),
      signal:ms===2?'STRONG BUY':ms===1?'BUY':ms===-2?'STRONG SELL':ms===-1?'SELL':'NEUTRAL',
      score:ms, weight:1.8 });

    // Bollinger Bands
    const bbVals = this.bb(closes);
    const bbn = bbVals[n];
    if (bbn) {
      const pos = (closes[n]-bbn.lower)/(bbn.upper-bbn.lower);
      const bs  = pos<0.1?2:pos<0.35?1:pos<0.65?0:pos<0.9?-1:-2;
      signals.push({ name:'Bollinger', value:`${(pos*100).toFixed(0)}%`,
        signal:bs===2?'STRONG BUY':bs===1?'BUY':bs===-2?'STRONG SELL':bs===-1?'SELL':'NEUTRAL',
        score:bs, weight:1.2 });
    }

    // SMA 50/200 Golden/Death Cross
    const sma50  = this.sma(closes, 50);
    const sma200 = this.sma(closes, 200);
    let goldenCross = false, deathCross = false;
    if (sma50[n] && sma200[n]) {
      const cross  = sma50[n]   > sma200[n];
      const pCross = sma50[n-1] > sma200[n-1];
      const cs  = cross&&!pCross?2:!cross&&pCross?-2:cross?1:-1;
      goldenCross = cs === 2;
      deathCross  = cs === -2;
      signals.push({ name:'SMA 50/200',
        value:`${sma50[n].toFixed(0)}/${sma200[n].toFixed(0)}`,
        signal:cs===2?'GOLDEN CROSS ↑':cs===-2?'DEATH CROSS ↓':cs===1?'BUY':'SELL',
        score:cs, weight:2.0 });
    }

    // 10-day momentum
    const mom = ((closes[n]-closes[n-10])/closes[n-10])*100;
    const ms2 = mom>5?2:mom>1?1:mom>-1?0:mom>-5?-1:-2;
    signals.push({ name:'Momentum(10d)', value:`${mom.toFixed(2)}%`,
      signal:ms2===2?'STRONG BUY':ms2===1?'BUY':ms2===-2?'STRONG SELL':ms2===-1?'SELL':'NEUTRAL',
      score:ms2, weight:1.1 });

    // OBV trend
    const obvVals = this.obv(closes, vols);
    const obvSma  = this.sma(obvVals, 20);
    const ot = obvVals[n] > obvSma[n], pot = obvVals[n-1] > obvSma[n-1];
    const os = ot&&!pot?2:!ot&&pot?-2:ot?1:-1;
    signals.push({ name:'OBV', value:ot?'Rising':'Falling',
      signal:os>0?'BUY':'SELL', score:os, weight:1.3 });

    const totalW = signals.reduce((a,s) => a+s.weight, 0);
    const wScore = signals.reduce((a,s) => a+s.score*s.weight, 0) / totalW;
    const direction  = wScore>0.5?'UP':wScore<-0.5?'DOWN':'NEUTRAL';
    const confidence = direction!=='NEUTRAL'
      ? Math.min(95, 50+Math.abs(wScore)*25)
      : Math.max(40, 70-Math.abs(wScore)*30);

    const recent = bars.slice(-30);
    const change1d = n>=1 ? ((closes[n]-closes[n-1])/closes[n-1])*100 : 0;

    return {
      direction,
      confidence:    +confidence.toFixed(1),
      weightedScore: +wScore.toFixed(3),
      signals,
      buyCount:      signals.filter(s=>s.score>0).length,
      sellCount:     signals.filter(s=>s.score<0).length,
      neutralCount:  signals.filter(s=>s.score===0).length,
      support:       +Math.min(...recent.map(b=>b.low)).toFixed(2),
      resistance:    +Math.max(...recent.map(b=>b.high)).toFixed(2),
      currentPrice:  +closes[n].toFixed(4),
      change1d:      +change1d.toFixed(2),
      rsi:           rsi!=null ? +rsi.toFixed(1) : null,
      goldenCross, deathCross
    };
  }
};

// ── Claude AI one-liner insight (optional) ────────────────────────────────────
async function getClaudeInsight(displaySym, pred) {
  if (!ANTHROPIC_KEY) return null;
  try {
    const _m = require('@anthropic-ai/sdk');
    const Anthropic = _m.default || _m;
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 120,
      messages: [{ role:'user', content:
        `${displaySym}: ${pred.direction} signal, ${pred.confidence}% confidence. ` +
        `RSI ${pred.rsi}, MACD ${pred.signals.find(s=>s.name==='MACD')?.signal}, ` +
        `${pred.buyCount} buy/${pred.sellCount} sell indicators. ` +
        `Write one punchy sentence (≤35 words) explaining the key driver. No disclaimers.`
      }]
    });
    return msg.content[0]?.text?.trim() || null;
  } catch { return null; }
}

// ── MongoDB deduplication ─────────────────────────────────────────────────────
async function wasRecentlyAlerted(symbol, signalType) {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    const since = new Date(Date.now() - ALERT_COOLDOWN * 3600000);
    return !!(await AlertLog.findOne({ symbol, signalType, sentAt: { $gte: since } }));
  } catch { return false; }
}

async function logAlert(symbol, signalType, direction, confidence) {
  if (mongoose.connection.readyState !== 1) return;
  try { await AlertLog.create({ symbol, signalType, direction, confidence }); } catch {}
}

// ── Beautiful dark-theme HTML email ──────────────────────────────────────────
function buildEmailHtml(alerts, scanLabel) {
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short'
  });

  const cards = alerts.map(a => {
    const isBuy  = ['STRONG_BUY','GOLDEN_CROSS','MAJOR_MOVER_UP','IPO'].includes(a.signalType);
    const isSell = ['STRONG_SELL','DEATH_CROSS','MAJOR_MOVER_DOWN'].includes(a.signalType);
    const color  = isBuy ? '#00c9a7' : isSell ? '#ff4d6d' : '#f59e0b';
    const emoji  = isBuy ? '🟢' : isSell ? '🔴' : '🟡';
    const badge  = a.signalType.replace(/_/g,' ');
    const priceStr = a.price
      ? '$' + Number(a.price).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits: a.price < 1 ? 6 : 2 })
      : '';

    const signalGrid = (a.signals||[]).slice(0,6).map(s => `
      <td style="background:#0f172a;border-radius:6px;padding:7px 8px;text-align:center;width:16%">
        <div style="font-size:9px;color:#4b5563;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${s.name.split('(')[0]}</div>
        <div style="font-size:10px;font-weight:700;color:${s.score>0?'#00c9a7':s.score<0?'#ff4d6d':'#94a3b8'}">${s.signal.replace('STRONG ','').replace(' CROSS ↑','✓').replace(' CROSS ↓','✗')}</div>
      </td>`).join('');

    return `
    <div style="background:#111827;border:1px solid #1f2937;border-left:4px solid ${color};border-radius:12px;padding:20px 22px;margin-bottom:18px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td>
          <span style="font-size:21px;font-weight:800;color:#f1f5f9">${emoji} ${a.displaySymbol}</span>
          ${a.name ? `<span style="color:#6b7280;font-size:12px;margin-left:8px">${a.name}</span>` : ''}
        </td>
        <td align="right">
          <span style="background:${color}22;color:${color};border:1px solid ${color}55;padding:4px 12px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:1px">${badge}</span>
        </td>
      </tr></table>

      ${priceStr ? `
      <div style="margin-top:14px">
        <span style="font-size:26px;font-weight:700;color:#f1f5f9">${priceStr}</span>
        ${a.change1d != null ? `<span style="font-size:13px;color:${a.change1d>=0?'#00c9a7':'#ff4d6d'};margin-left:10px">${a.change1d>=0?'▲':'▼'} ${Math.abs(a.change1d).toFixed(2)}% today</span>` : ''}
      </div>` : ''}

      ${a.confidence ? `
      <div style="margin:14px 0 0">
        <div style="display:flex;justify-content:space-between;margin-bottom:5px">
          <span style="font-size:10px;color:#4b5563;letter-spacing:1px;text-transform:uppercase">Signal Confidence</span>
          <span style="font-size:11px;color:${color};font-weight:700">${a.confidence}%</span>
        </div>
        <div style="background:#1f2937;border-radius:4px;height:6px">
          <div style="background:linear-gradient(90deg,${color}88,${color});height:6px;border-radius:4px;width:${Math.min(a.confidence,100)}%"></div>
        </div>
      </div>` : ''}

      ${signalGrid ? `
      <table width="100%" cellpadding="3" cellspacing="3" style="margin-top:14px">${signalGrid}</table>` : ''}

      ${a.rsi != null ? `
      <div style="margin-top:12px;font-size:11px;color:#6b7280">
        RSI: <strong style="color:#94a3b8">${a.rsi}</strong>
        &nbsp;·&nbsp; Buy signals: <strong style="color:#00c9a7">${a.buyCount||0}</strong>
        &nbsp;·&nbsp; Sell signals: <strong style="color:#ff4d6d">${a.sellCount||0}</strong>
      </div>` : ''}

      ${a.insight ? `
      <div style="margin-top:14px;background:#0f172a;border-left:3px solid ${color};padding:10px 14px;border-radius:0 8px 8px 0;font-size:13px;color:#cbd5e1;line-height:1.65">
        ✦ Claude AI: ${a.insight}
      </div>` : ''}

      ${a.note ? `<div style="margin-top:14px;font-size:13px;color:#94a3b8;line-height:1.7">${a.note}</div>` : ''}
    </div>`;
  }).join('');

  const buyCount  = alerts.filter(a => ['STRONG_BUY','GOLDEN_CROSS','MAJOR_MOVER_UP'].includes(a.signalType)).length;
  const sellCount = alerts.filter(a => ['STRONG_SELL','DEATH_CROSS','MAJOR_MOVER_DOWN'].includes(a.signalType)).length;
  const ipoCount  = alerts.filter(a => a.signalType === 'IPO').length;

  return `<!DOCTYPE html><html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StockAI Alert</title></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:28px 16px 40px">

  <!-- Header -->
  <div style="text-align:center;margin-bottom:28px;padding-bottom:24px;border-bottom:1px solid #1f2937">
    <div style="font-size:30px;font-weight:900;letter-spacing:-1.5px;margin-bottom:4px">
      <span style="color:#00c9a7">Stock</span><span style="color:#3b82f6">AI</span>
    </div>
    <div style="font-size:11px;color:#374151;letter-spacing:3px;text-transform:uppercase">Automated Market Intelligence</div>
    <div style="font-size:11px;color:#1f2937;margin-top:8px">${now} ET  ·  ${scanLabel}</div>
  </div>

  <!-- Summary bar -->
  <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:16px 20px;margin-bottom:24px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="text-align:center;border-right:1px solid #1f2937;padding-right:16px">
        <div style="font-size:28px;font-weight:800;color:#f1f5f9">${alerts.length}</div>
        <div style="font-size:10px;color:#4b5563;letter-spacing:1px;text-transform:uppercase">Total Alerts</div>
      </td>
      <td style="text-align:center;padding:0 16px;border-right:1px solid #1f2937">
        <div style="font-size:24px;font-weight:700;color:#00c9a7">${buyCount}</div>
        <div style="font-size:10px;color:#4b5563;letter-spacing:1px;text-transform:uppercase">Buy</div>
      </td>
      <td style="text-align:center;padding:0 16px;border-right:1px solid #1f2937">
        <div style="font-size:24px;font-weight:700;color:#ff4d6d">${sellCount}</div>
        <div style="font-size:10px;color:#4b5563;letter-spacing:1px;text-transform:uppercase">Sell</div>
      </td>
      <td style="text-align:center;padding-left:16px">
        <div style="font-size:24px;font-weight:700;color:#f59e0b">${ipoCount}</div>
        <div style="font-size:10px;color:#4b5563;letter-spacing:1px;text-transform:uppercase">IPO</div>
      </td>
    </tr></table>
  </div>

  <!-- Alert cards -->
  ${cards}

  <!-- Footer -->
  <div style="border-top:1px solid #1f2937;margin-top:8px;padding-top:20px;text-align:center">
    <p style="font-size:11px;color:#374151;line-height:1.8;margin:0">
      ⚠️ <strong style="color:#4b5563">Disclaimer:</strong> These alerts are generated by automated technical analysis${ANTHROPIC_KEY ? ' + Claude AI' : ''}
      and are for <strong>informational and educational purposes only</strong>.
      They do <strong>not</strong> constitute financial advice.
      Always do your own research before making any investment decisions.
    </p>
    <p style="font-size:10px;color:#1f2937;margin-top:12px">
      StockAI Alert System  ·  Powered by Finnhub${ANTHROPIC_KEY ? ' + Claude AI (Haiku)' : ''}  ·  Scanning ${WATCHLIST.stocks.length + WATCHLIST.etfs.length + WATCHLIST.crypto.length} instruments
    </p>
  </div>

</div></body></html>`;
}

// ── Send email via Resend (HTTPS API — works on Render free tier) ─────────────
async function sendEmail(alerts, scanLabel) {
  if (!RESEND_KEY || !ALERT_TO) {
    console.log('[AlertEngine] ⚠️  Email not configured (set RESEND_API_KEY and ALERT_EMAIL_TO in .env)');
    return false;
  }
  try {
    const resend = new Resend(RESEND_KEY);

    const buys   = alerts.filter(a => ['STRONG_BUY','GOLDEN_CROSS'].includes(a.signalType));
    const sells  = alerts.filter(a => ['STRONG_SELL','DEATH_CROSS'].includes(a.signalType));
    const ipos   = alerts.filter(a => a.signalType === 'IPO');
    const movers = alerts.filter(a => a.signalType.startsWith('MAJOR_MOVER'));

    let subject;
    if (alerts.length === 1) {
      subject = `🚨 StockAI: ${alerts[0].displaySymbol} — ${alerts[0].signalType.replace(/_/g,' ')}`;
    } else {
      const parts = [];
      if (buys.length)   parts.push(`${buys.length} Strong Buy`);
      if (sells.length)  parts.push(`${sells.length} Strong Sell`);
      if (movers.length) parts.push(`${movers.length} Major Mover`);
      if (ipos.length)   parts.push(`${ipos.length} IPO`);
      subject = `🚨 StockAI: ${alerts.length} alerts — ${parts.join(', ')}`;
    }

    const toAddresses = ALERT_TO.split(',').map(e => e.trim()).filter(Boolean);
    const { error } = await resend.emails.send({
      from:    'StockAI Alerts <onboarding@resend.dev>',
      to:      toAddresses,
      subject,
      html:    buildEmailHtml(alerts, scanLabel)
    });
    if (error) throw new Error(error.message);
    console.log(`[AlertEngine] ✅ Email sent → ${ALERT_TO} | Subject: ${subject}`);
    return true;
  } catch (e) {
    console.error('[AlertEngine] ❌ Email failed:', e.message);
    return false;
  }
}

// ── Send SMS (requires Twilio — optional) ─────────────────────────────────────
async function sendSMS(alerts) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM || !ALERT_PHONE) return false;
  try {
    const twilio = require('twilio');
    const client = twilio(TWILIO_SID, TWILIO_TOKEN);
    const preview = alerts.slice(0,3)
      .map(a => `${a.displaySymbol} ${a.signalType.replace(/_/g,' ')}${a.confidence ? ` (${a.confidence}%)` : ''}`)
      .join(' · ');
    const body = `🚨 StockAI: ${alerts.length} alert${alerts.length>1?'s':''} · ${preview}${alerts.length>3 ? ` +${alerts.length-3} more` : ''}. Check your email.`;
    await client.messages.create({ body, from: TWILIO_FROM, to: ALERT_PHONE });
    console.log('[AlertEngine] ✅ SMS sent');
    return true;
  } catch (e) {
    console.error('[AlertEngine] ❌ SMS failed:', e.message);
    return false;
  }
}

// ── Rate-limited symbol scanner ───────────────────────────────────────────────
async function scanSymbol(symbol, assetType) {
  try {
    const bars = await fetchCandles(symbol, 220);
    if (!bars || bars.length < 60) return null;

    const pred = TA.predict(bars);
    if (!pred) return null;

    const displaySymbol = symbol.includes(':')
      ? symbol.split(':')[1].replace('USDT','') + '/USDT'
      : symbol;

    // Determine what kind of signal this is
    let signalType = null;
    if (pred.goldenCross)                                                       signalType = 'GOLDEN_CROSS';
    else if (pred.deathCross)                                                   signalType = 'DEATH_CROSS';
    else if (pred.direction==='UP' && pred.confidence>=CONFIDENCE_MIN && pred.buyCount>=SIGNAL_MIN)
                                                                                signalType = 'STRONG_BUY';
    else if (pred.direction==='DOWN' && pred.confidence>=CONFIDENCE_MIN && pred.sellCount>=SIGNAL_MIN)
                                                                                signalType = 'STRONG_SELL';
    else if (Math.abs(pred.change1d) >= MOVER_PCT)
      signalType = pred.change1d > 0 ? 'MAJOR_MOVER_UP' : 'MAJOR_MOVER_DOWN';

    if (!signalType) return null;

    // Skip if same signal was sent recently
    if (await wasRecentlyAlerted(symbol, signalType)) {
      console.log(`[AlertEngine] ⏭  ${displaySymbol} ${signalType} — already alerted within ${ALERT_COOLDOWN}h`);
      return null;
    }

    // Get Claude AI one-liner (non-blocking, fails gracefully)
    const insight = await getClaudeInsight(displaySymbol, pred);

    // Fetch company name for stocks
    let name = '';
    if (!symbol.includes(':') && assetType !== 'crypto') {
      const profile = await fetchCompanyProfile(symbol);
      name = profile?.name || '';
    }

    console.log(`[AlertEngine] 🚨 ${displaySymbol} → ${signalType} (${pred.confidence}%)`);
    return {
      symbol, displaySymbol, assetType, signalType, name,
      price:      pred.currentPrice,
      change1d:   pred.change1d,
      confidence: pred.confidence,
      direction:  pred.direction,
      signals:    pred.signals,
      buyCount:   pred.buyCount,
      sellCount:  pred.sellCount,
      rsi:        pred.rsi,
      insight
    };
  } catch (e) {
    console.warn(`[AlertEngine] ⚠️  ${symbol}: ${e.message}`);
    return null;
  }
}

// Rate-limited scan of an array of symbols
async function scanBatch(symbols, assetType, delayMs = 600) {
  const alerts = [];
  for (const sym of symbols) {
    const result = await scanSymbol(sym, assetType);
    if (result) alerts.push(result);
    await new Promise(r => setTimeout(r, delayMs));
  }
  return alerts;
}

// ── IPO calendar scan ─────────────────────────────────────────────────────────
async function scanIPOs() {
  try {
    const data = await fetchIPOCalendar();
    const upcoming = (data?.ipoCalendar || []).filter(ipo => {
      const diffDays = (new Date(ipo.date) - Date.now()) / 86400000;
      return diffDays >= -1 && diffDays <= 7 && ipo.symbol;
    });

    const alerts = [];
    for (const ipo of upcoming.slice(0, 6)) {
      if (await wasRecentlyAlerted(`IPO:${ipo.symbol}`, 'IPO')) continue;
      const daysAway = Math.ceil((new Date(ipo.date) - Date.now()) / 86400000);
      alerts.push({
        symbol:        `IPO:${ipo.symbol}`,
        displaySymbol: ipo.symbol,
        name:          ipo.name || '',
        assetType:     'stock',
        signalType:    'IPO',
        note: [
          `📅 <strong>IPO Date:</strong> ${ipo.date} (${daysAway <= 0 ? 'TODAY' : `in ${daysAway} day${daysAway!==1?'s':''}`})`,
          ipo.price           ? `💰 <strong>Price Range:</strong> $${ipo.price}` : '',
          ipo.numberOfShares  ? `📊 <strong>Shares:</strong> ${Number(ipo.numberOfShares).toLocaleString()}` : '',
          ipo.totalSharesValue? `💵 <strong>Deal Size:</strong> $${(ipo.totalSharesValue/1e6).toFixed(0)}M` : '',
          ipo.exchange        ? `🏛 <strong>Exchange:</strong> ${ipo.exchange}` : '',
          ipo.status          ? `📋 <strong>Status:</strong> ${ipo.status}` : ''
        ].filter(Boolean).join('<br>')
      });
    }
    return alerts;
  } catch (e) {
    console.warn('[AlertEngine] IPO scan error:', e.message);
    return [];
  }
}

// ── Notify and log ────────────────────────────────────────────────────────────
async function notifyAndLog(alerts, scanLabel) {
  if (!alerts.length) return;
  await Promise.all([sendEmail(alerts, scanLabel), sendSMS(alerts)]);
  for (const a of alerts) {
    await logAlert(a.symbol, a.signalType, a.direction, a.confidence);
  }
}

// ── Public scan runners (called by cron) ──────────────────────────────────────

/**
 * runMarketScan — Stocks + ETFs + IPOs
 * Triggered: every 30 min during US market hours (Mon–Fri 9:00–16:30 ET)
 *            + once at 08:00 ET for pre-market IPO check
 */
async function runMarketScan() {
  const label = 'Market Scan — Stocks · ETFs · IPOs';
  console.log(`\n[AlertEngine] 📡 ${label} started at ${new Date().toISOString()}`);
  try {
    const [stockAlerts, etfAlerts, ipoAlerts] = await Promise.all([
      scanBatch(WATCHLIST.stocks, 'stock'),
      scanBatch(WATCHLIST.etfs, 'etf'),
      scanIPOs()
    ]);
    const all = [...stockAlerts, ...etfAlerts, ...ipoAlerts];
    console.log(`[AlertEngine] Market scan complete — ${all.length} alert(s) found`);
    await notifyAndLog(all, label);
  } catch (e) {
    console.error('[AlertEngine] Market scan error:', e.message);
  }
}

/**
 * runCryptoScan — BTC, ETH, SOL, XRP, BNB, DOGE, AVAX, LINK
 * Triggered: every 2 hours, 24/7 (crypto never sleeps)
 */
async function runCryptoScan() {
  const label = 'Crypto Scan — BTC · ETH · SOL · XRP · BNB · DOGE + more';
  console.log(`\n[AlertEngine] 🪙 ${label} started at ${new Date().toISOString()}`);
  try {
    const alerts = await scanBatch(WATCHLIST.crypto, 'crypto');
    console.log(`[AlertEngine] Crypto scan complete — ${alerts.length} alert(s) found`);
    await notifyAndLog(alerts, label);
  } catch (e) {
    console.error('[AlertEngine] Crypto scan error:', e.message);
  }
}

/**
 * runFullScan — everything at once (used for manual triggers + startup test)
 */
async function runFullScan() {
  await runMarketScan();
  await runCryptoScan();
}

module.exports = { runMarketScan, runCryptoScan, runFullScan, WATCHLIST };

/*
 * ════════════════════════════════════════════════════════════════════
 * SETUP GUIDE — add these to your .env file
 * ════════════════════════════════════════════════════════════════════
 *
 * ── Email alerts (Gmail) ──────────────────────────────────────────
 * ALERT_GMAIL_USER=your.gmail@gmail.com
 * ALERT_GMAIL_PASS=xxxx xxxx xxxx xxxx     ← 16-char App Password
 * ALERT_EMAIL_TO=you@example.com           ← where to receive alerts
 *
 * How to get a Gmail App Password:
 *   1. Enable 2-Step Verification on your Google account
 *   2. Go to: myaccount.google.com/apppasswords
 *   3. Create a new app password → copy the 16-char code
 *   4. Paste it (with spaces) as ALERT_GMAIL_PASS
 *
 * ── SMS alerts via Twilio (optional) ─────────────────────────────
 * npm install twilio          ← run this first
 * TWILIO_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 * TWILIO_TOKEN=your_auth_token
 * TWILIO_FROM=+1XXXXXXXXXX    ← your Twilio number
 * ALERT_PHONE=+1XXXXXXXXXX    ← your mobile number
 *
 * Get Twilio credentials: console.twilio.com (free trial = $15 credit)
 * ════════════════════════════════════════════════════════════════════
 */
