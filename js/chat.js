/* ── StockAI — AI Chat Widget ──────────────────────────────────────────── */

const StockChat = {
  _key() {
    const session = typeof Auth !== 'undefined' ? Auth.getSession() : null;
    return 'stockai_chat_history_' + (session?.userId || 'anonymous');
  },
  _open: false,
  _currentSymbol: 'AAPL',
  _bars: [],
  _indicators: null,

  // ── Quick-reply chips ─────────────────────────────────────────────────────
  _chips: {
    default: ["What's the RSI?", 'Buy or sell?', 'Price summary', 'Support & resistance', '52W range', 'Explain MACD'],
    after:   ['Bollinger Bands?', 'Volume trend?', "What's the momentum?", 'OBV trend?', 'Any patterns?'],
  },

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  init(symbol, bars) {
    this._currentSymbol = symbol || 'AAPL';
    this._bars = bars || [];
    this._indicators = null;
    this._updateHeader();
    this._renderMessages();
    this._renderChips(this._chips.default);
  },

  setContext(symbol, bars) {
    const changed = symbol && symbol !== this._currentSymbol;
    this._currentSymbol = symbol || this._currentSymbol;
    this._bars = Array.isArray(bars) ? bars : [];
    this._replyVersion=(this._replyVersion||0)+1;
    this._indicators = null;

    this._updateHeader();

    if (changed && this._bars.length>=20) {
      const ind = this._getIndicators();
      if(!ind.available)return;
      const chg = ind.dayChg;
      const up  = chg >= 0;
      const note = `📊 Now tracking **${symbol}** — **$${ind.price.toFixed(2)}** (${up ? '+' : ''}${chg.toFixed(2)}% last loaded bar). RSI **${ind.rsi}** ${ind.rsiLabel}. Ask me anything about it!`;
      const h = this.getHistory();
      h.push({ role: 'assistant', text: note, ts: Date.now(), auto: true });
      this.saveHistory(h);
      if (this._open) {
        this._renderMessages();
        // Reset to default chips since we're on a new stock
        this._renderChips(this._chips.default);
        this._scrollBottom();
      }
    }
  },

  _updateHeader() {
    const sub = document.querySelector('.chat-header-sub');
    if (sub) sub.textContent = `Tracking: ${this._currentSymbol}`;
  },

  // ── Persistence ───────────────────────────────────────────────────────────
  getHistory() {
    try { const rows=JSON.parse(localStorage.getItem(this._key())||'[]');return Array.isArray(rows)?rows.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string').slice(-60).map(m=>({...m,text:m.text.slice(0,6000)})):[]; } catch { return []; }
  },
  saveHistory(h) {
    localStorage.setItem(this._key(), JSON.stringify(h.slice(-60)));
  },
  clearHistory() {
    localStorage.removeItem(this._key());
    this._indicators = null;
    this._renderMessages();
    this._renderChips(this._chips.default);
  },

  // ── Toggle ────────────────────────────────────────────────────────────────
  toggle() {
    this._open = !this._open;
    const panel = document.getElementById('chat-panel');
    const fab   = document.getElementById('chat-fab');
    if (!panel) return;
    panel.classList.toggle('open', this._open);
    if (fab) fab.classList.toggle('active', this._open);
    if (this._open) {
      this._updateHeader();
      this._renderMessages();
      const h = this.getHistory();
      this._renderChips(h.length ? this._chips.after : this._chips.default);
      this._scrollBottom();
      setTimeout(() => document.getElementById('chat-input')?.focus(), 120);
    }
  },

  // ── Indicator engine ──────────────────────────────────────────────────────
  _getIndicators(bars) {
    // Allow computing for a different set of bars (cross-stock)
    const isDefault = !bars;
    if (isDefault && this._indicators) return this._indicators;
    bars = bars || this._bars;

    if (!Array.isArray(bars)||bars.length<20||bars.some(b=>![b.close,b.high,b.low].every(Number.isFinite)||b.close<=0||b.low<=0||b.high<b.low)) {
      const empty = { available:false, price:null, dayChg:null, rsi:null, rsiLabel:'', macdBull:null, macdMomentum:'', bbPos:null, bbLabel:'', sma20:null, sma50:null, smaTrend:'', support:null, resistance:null, hi52:null, lo52:null, rangePos:null, vol:null, volRatio:null, volLabel:'', mom10:null, obvTrend:'' };
      return isDefault ? (this._indicators = empty) : empty;
    }

    const closes  = bars.map(b => b.close);
    const volumes = bars.map(b => b.volume);
    const n = closes.length - 1;

    const price  = closes[n];
    const prev   = closes[n - 1] || price;
    const dayChg = ((price - prev) / prev) * 100;

    // RSI (14)
    const rs = closes.slice(-16);
    const rc = rs.slice(1).map((c, i) => c - rs[i]);
    const avgG = rc.map(c => Math.max(c, 0)).reduce((a, b) => a + b, 0) / rc.length;
    const avgL = rc.map(c => Math.abs(Math.min(c, 0))).reduce((a, b) => a + b, 0) / rc.length;
    const sharedRSI=typeof AIPredictor!=='undefined'?AIPredictor.rsi(closes).at(-1):null;
    const rsi=Number.isFinite(sharedRSI)?+sharedRSI.toFixed(1):avgG===0&&avgL===0?50:avgL===0?100:+(100-100/(1+avgG/avgL)).toFixed(1);
    const rsiLabel = rsi < 30 ? '(oversold 🟢)' : rsi > 70 ? '(overbought 🔴)' : rsi < 45 ? '(mildly bullish)' : rsi > 55 ? '(mildly bearish)' : '(neutral)';

    // MACD
    const ema = (arr, p) => { const k=2/(p+1),r=[arr[0]]; for(let i=1;i<arr.length;i++) r.push(arr[i]*k+r[i-1]*(1-k)); return r; };
    const macdLine = ema(closes,12).map((v,i)=>v-ema(closes,26)[i]);
    const macdSig  = ema(macdLine,9);
    const macd = macdLine[n], macdSigV = macdSig[n];
    const macdHist = macd - macdSigV, prevHist = macdLine[n-1] - macdSig[n-1];
    const macdBull = macd > macdSigV;
    const macdMomentum = macdBull && macdHist > prevHist ? 'strengthening ↑' : macdBull ? 'bullish' : !macdBull && macdHist < prevHist ? 'weakening ↓' : 'bearish';

    // Bollinger Bands (20)
    const sma20 = closes.slice(-20).reduce((a,b)=>a+b,0) / 20;
    const std20 = Math.sqrt(closes.slice(-20).map(c=>Math.pow(c-sma20,2)).reduce((a,b)=>a+b,0)/20);
    const bbUpper = sma20 + 2*std20, bbLower = sma20 - 2*std20;
    const bbPos   = bbUpper===bbLower?50:+((price - bbLower)/(bbUpper - bbLower)*100).toFixed(1);
    const bbLabel = bbPos < 15 ? 'near lower band (potential bounce)' : bbPos > 85 ? 'near upper band (extended)' : bbPos < 40 ? 'lower half' : bbPos > 60 ? 'upper half' : 'mid-band';

    // SMA 50
    const sma50 = closes.length >= 50 ? +(closes.slice(-50).reduce((a,b)=>a+b,0)/50).toFixed(2) : null;
    const smaTrend = sma50 ? (price > sma50 ? `above SMA50 ($${sma50}) 🟢` : `below SMA50 ($${sma50}) 🔴`) : 'insufficient data';

    // Support / Resistance
    const r30 = bars.slice(-30);
    const support    = +Math.min(...r30.map(b=>b.low)).toFixed(2);
    const resistance = +Math.max(...r30.map(b=>b.high)).toFixed(2);

    // 52W
    const b252 = bars.slice(-252);
    const hi52 = +Math.max(...b252.map(b=>b.high)).toFixed(2);
    const lo52 = +Math.min(...b252.map(b=>b.low)).toFixed(2);
    const rangePos = hi52===lo52?50:+((price - lo52)/(hi52 - lo52)*100).toFixed(1);

    // Volume
    const vol = volumes[n] || 0;
    const avgVol = volumes.slice(-20).reduce((a,b)=>a+b,0)/20;
    const volRatio = avgVol > 0 ? +(vol/avgVol).toFixed(2) : 1;
    const volLabel = volRatio > 1.5 ? 'above average (high conviction)' : volRatio < 0.7 ? 'below average (low conviction)' : 'average';

    // Momentum
    const mom10 = closes.length > 10 ? +((price - closes[n-10])/closes[n-10]*100).toFixed(2) : null;

    // OBV
    let obv = 0;
    const obvArr = closes.map((c,i) => { if(i===0) return 0; obv += c > closes[i-1] ? volumes[i] : c < closes[i-1] ? -volumes[i] : 0; return obv; });
    const obvSma = obvArr.slice(-10).reduce((a,b)=>a+b,0)/10;
    const obvTrend = obvArr[n] > obvSma ? 'rising (accumulation 🟢)' : 'falling (distribution 🔴)';

    const result = { available:true, bars:bars.length, rangeLabel:bars.length>=252?'252-session history':'Loaded '+bars.length+'-bar history', volumeAvailable:volumes.slice(-20).every(v=>Number.isFinite(v)&&v>=0), price, dayChg, rsi, rsiLabel, macd:+macd.toFixed(4), macdSigV:+macdSigV.toFixed(4), macdBull, macdMomentum, bbPos, bbLabel, sma20:+sma20.toFixed(2), bbUpper:+bbUpper.toFixed(2), bbLower:+bbLower.toFixed(2), sma50, smaTrend, support, resistance, hi52, lo52, rangePos, vol, avgVol, volRatio, volLabel, mom10, obvTrend };
    if (isDefault) this._indicators = result;
    return result;
  },

  // ── Cross-stock lookup ────────────────────────────────────────────────────
  _crossStockInfo(ticker) {
    if (typeof StockAPI === 'undefined') return null;
    const cached=StockAPI._cache?.['q_'+ticker];const q=cached?.data;
    if(!q||Date.now()-cached.ts>30000||!Number.isFinite(q.price)||q.price<=0||!Number.isFinite(q.changePct))return null;
    const info=StockAPI.getCompanyInfo?.(ticker)||{};
    return {name:info.name||ticker,price:q.price,changePct:q.changePct,sector:info.sector||'Unknown'};
  },

  // ── Response engine ───────────────────────────────────────────────────────
  _buildResponse(userMsg) {
    const msg = userMsg.toLowerCase().trim();
    const sym = this._currentSymbol;
    const ind = this._getIndicators();
    if(!ind.available)return '**'+sym+' data unavailable.** Load at least 20 valid daily chart bars before asking for prices or indicators. No zero or simulated prices are substituted.';
    if(/volume|obv|on.?balance|liquidity/.test(msg)&&!ind.volumeAvailable)return '**'+sym+' volume unavailable.** The loaded chart does not contain enough verified volume observations.';
    const { price, dayChg, rsi, rsiLabel, macd, macdSigV, macdBull, macdMomentum, bbPos, bbLabel, sma20, bbUpper, bbLower, sma50, smaTrend, support, resistance, hi52, lo52, rangePos, vol, volRatio, volLabel, mom10, obvTrend } = ind;

    const px   = `**$${price.toFixed(2)}**`;
    const chgs = `${dayChg >= 0 ? '+' : ''}${dayChg.toFixed(2)}%`;
    const fmtV = v => v >= 1e9 ? (v/1e9).toFixed(2)+'B' : v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : String(v);

    // ── Cross-stock detection ─────────────────────────────────────────────
    // Find any uppercase ticker in the raw message that isn't the current symbol
    const knownSyms = new Set([
      ...(StockAPI?.popularSymbols || []),
      ...['SPY','QQQ','DIA','IWM','XLK','XLF','XLV','XLE','GLD','USO'],
    ]);
    const tickers = (userMsg.match(/\b([A-Z]{1,5})\b/g) || []).filter(t => t !== sym && knownSyms.has(t));
    const otherSym = tickers[0];

    if (otherSym) {
      const cross = this._crossStockInfo(otherSym);
      if (cross) {
        const up     = cross.changePct >= 0;
        const chgStr = `${up ? '+' : ''}${cross.changePct.toFixed(2)}%`;
        return `**${otherSym}** (${cross.name}) — **$${cross.price.toFixed(2)}** (${chgStr} last loaded bar) | ${cross.sector}\n\nSearch **${otherSym}** to load its own chart indicators. This is a cached provider quote, not a calculated forecast.`;
      }
      return 'Select **'+otherSym+'** in Search to load its verified quote and chart. Its current price is not available in this conversation.';
    }

    // ── Intent matching ───────────────────────────────────────────────────

    if (/^(hi|hey|hello|sup|yo)\b/.test(msg))
      return `Hey! I'm tracking **${sym}** from loaded chart history — ${px} (${chgs} last loaded bar). RSI is **${rsi}** ${rsiLabel}. What would you like to know?`;

    if (/\brsi\b/.test(msg)) {
      const advice = rsi < 30 ? 'Oversold territory — historically a potential reversal zone. This reading alone does not establish that a reversal will happen.' : rsi > 70 ? 'Overbought territory — momentum may be fading. This reading alone does not establish that a reversal will happen.' : 'Neutral range — no extreme reading either way.';
      return `**${sym} RSI (14): ${rsi}** ${rsiLabel}\n\n${advice}\n\nRSI measures momentum on a 0–100 scale. Below 30 = oversold, above 70 = overbought.`;
    }

    if (/\bmacd\b/.test(msg)) {
      const cross = macdBull ? '✅ MACD is **above** the signal line' : '❌ MACD is **below** the signal line';
      return `**${sym} MACD:** ${cross} — momentum is **${macdMomentum}**.\n\nMACD: **${macd}** | Signal: **${macdSigV}** | Histogram: **${(macd - macdSigV).toFixed(4)}**\n\nA bullish crossover (MACD > Signal) signals upward momentum; bearish crossover the opposite.`;
    }

    if (/bollinger|bands?\b|bb\b/.test(msg))
      return `**${sym} Bollinger Bands:** Price is at **${bbPos}%** of the band — ${bbLabel}.\n\nUpper: **$${bbUpper}** | Middle (SMA20): **$${sma20}** | Lower: **$${bbLower}**\n\nPrice near the lower band can indicate oversold conditions; near the upper band suggests the stock is extended.`;

    if (/support|resistance|level/.test(msg)) {
      const pos = (resistance===support?50:(price-support)/(resistance-support)*100).toFixed(0);
      return `**${sym} Key Levels (last up-to-30-bar):**\n\n🟢 Support: **$${support}**\n🔴 Resistance: **$${resistance}**\n\nCurrent price ${px} is **${pos}%** of the way from support to resistance. ${+pos > 65 ? 'Approaching resistance — watch for a rejection or breakout.' : +pos < 35 ? 'Closer to support — potential base-building zone.' : 'Trading in the mid-range.'}`;
    }

    if (/52.?w|52.?week|year.?high|year.?low|annual|range/.test(msg))
      return `**${sym} ${ind.rangeLabel} range:**\n\n📈 High: **$${hi52}** | 📉 Low: **$${lo52}**\n\nAt ${px}, the stock is at **${rangePos}%** of its loaded-history range. ${rangePos > 80 ? 'Near loaded-history highs — strong trend, but watch for mean reversion.' : rangePos < 20 ? 'Near loaded-history lows — possible value zone, verify fundamentals first.' : 'In the middle of its loaded-history range — no extreme positioning.'}`;

    if (/volume|vol\b|liquidity/.test(msg))
      return `**${sym} Volume:** **${fmtV(vol)}** on the last loaded bar — **${volRatio}×** the 20-day average.\n\nVolume conviction: **${volLabel}**\nOBV trend: **${obvTrend}**\n\n${volRatio > 1.5 ? 'Volume is elevated relative to this loaded sample; it does not identify who traded.' : volRatio < 0.7 ? 'Low volume — the move lacks conviction, wait for confirmation.' : 'Volume is in line with recent norms.'}`;

    if (/obv|on.?balance/.test(msg))
      return `**${sym} OBV (On-Balance Volume):** ${obvTrend}\n\nOBV adds volume on up days, subtracts on down days. Rising OBV = accumulation (bullish); Falling OBV = distribution (bearish).`;

    if (/momentum|mom\b/.test(msg) && mom10 !== null)
      return `**${sym} 10-day Momentum: ${mom10 >= 0 ? '+' : ''}${mom10}%**\n\n${sym} has moved **${mom10 >= 0 ? '▲' : '▼'} ${Math.abs(mom10)}%** over the last 10 sessions. ${mom10 > 5 ? 'Strong upward momentum — trend followers would be bullish.' : mom10 < -5 ? 'Strong downward momentum — selling pressure is dominant.' : 'Mild momentum — no strong directional bias.'}`;

    if (/sma|moving.?average|ma\b|trend\b/.test(msg))
      return `**${sym} Moving Averages:**\n\n• SMA 20: **$${sma20}** — price is **${price > sma20 ? 'above ✅' : 'below ❌'}**\n• SMA 50: ${sma50 ? `**$${sma50}** — ${smaTrend}` : 'insufficient data'}\n\nTrading above key moving averages is generally bullish; below is bearish.`;

    if (/buy|sell|should i|worth it|invest|signal/.test(msg)) {
      const signals = [];
      if (rsi < 35) signals.push('🟢 RSI oversold');
      else if (rsi > 65) signals.push('🔴 RSI overbought');
      else signals.push('🟡 RSI neutral');
      signals.push(macdBull ? '🟢 MACD bullish' : '🔴 MACD bearish');
      signals.push(price > sma20 ? '🟢 Above SMA20' : '🔴 Below SMA20');
      if (sma50) signals.push(price > sma50 ? '🟢 Above SMA50' : '🔴 Below SMA50');
      if (mom10 !== null) signals.push(mom10 > 0 ? '🟢 Positive momentum' : '🔴 Negative momentum');
      signals.push(obvTrend.includes('rising') ? '🟢 OBV rising' : '🔴 OBV falling');
      const greenCount = signals.filter(s => s.startsWith('🟢')).length;
      const bias = greenCount >= signals.length * 0.65 ? '🟢 Lean Bullish' : greenCount <= signals.length * 0.35 ? '🔴 Lean Bearish' : '🟡 Mixed Signals';
      return `**${sym} Signal Summary: ${bias}**\n\n${signals.join('\n')}\n\n⚠️ Technical analysis only — not financial advice. Always research before investing.`;
    }

    if (/price|trading|worth|at\b|current/.test(msg))
      return `**${sym}** last loaded close is ${px} (${chgs} last loaded bar).\n\n• Loaded high: **$${resistance}** | Loaded low: **$${support}**\n• SMA20: **$${sma20}** — price is ${price > sma20 ? 'above ✅' : 'below ❌'}\n• ${ind.rangeLabel} position: **${rangePos}%** of loaded-history range`;

    if (/pattern|hammer|doji|engulf|star|candle/.test(msg))
      return `Candlestick patterns for **${sym}** are detected in the **AI Predictions** tab — Hammer, Shooting Star, Bullish/Bearish Engulfing, Morning Star, and Doji based on the last 5 candles.`;

    if (/portfolio|holdings|position/.test(msg))
      return `Track your **${sym}** position in the **Portfolio** tab — enter shares and buy price, and StockAI shows live P&L, total return, and a last up-to-30-bar value chart. Export to CSV anytime.`;

    if (/alert|notify|notification/.test(msg))
      return `Set a price alert for **${sym}** in the **Trending** tab. For example, alert when price breaks above **$${resistance}** (resistance) or falls below **$${support}** (support).`;

    if (/news|headline/.test(msg))
      return `The **News** tab has the latest **${sym}** headlines and broader market news. Toggle between stock-specific and all-markets view.`;

    if (/chart|3d|candle|graph/.test(msg))
      return `The **Dashboard** chart supports 1M–1Y ranges with SMA 20/50/200 overlays. Try **⬡ 3D** for a Three.js candlestick view (drag to rotate, scroll to zoom) or **⚖ Compare** to overlay another stock.`;

    if (/sector|heat.?map|market/.test(msg))
      return `The **Markets** tab has a live sector heat map across Technology, Financials, Healthcare, Energy, and more. Green = up, red = down, intensity scales with the move size.`;

    if (/screener|filter|scan/.test(msg))
      return `The **Screener** filters stocks by sector, price range, and performance (gainers/losers/big movers). Hover any result card to flip it and see market cap, volume, and 52W range.`;

    if (/watchlist|watch/.test(msg))
      return `Add **${sym}** to your watchlist with the **+ Add to Watchlist** button on the Dashboard. Watchlist items show live price updates and sync across sessions.`;

    if (/help|what can|what do|how/.test(msg))
      return `I have **live data** for **${sym}** right now. Ask me:\n\n• **RSI** — overbought/oversold momentum\n• **MACD** — trend crossovers\n• **Bollinger Bands** — volatility & band position\n• **Support & resistance** — key price levels\n• **Volume / OBV** — buying vs selling pressure\n• **52W range** — annual positioning\n• **Buy or sell?** — multi-indicator summary\n\nOr ask about **any other ticker** like "TSLA RSI?" and I'll look it up!`;

    // Default — rich snapshot
    const bias = (rsi < 45 && macdBull && price > sma20) ? '🟢 Lean Bullish' : (rsi > 55 && !macdBull && price < sma20) ? '🔴 Lean Bearish' : '🟡 Mixed';
    return `**${sym} snapshot:** ${px} (${chgs}) | RSI **${rsi}** ${rsiLabel} | MACD **${macdMomentum}** | BB at **${bbPos}%** | ${smaTrend}\n\nBias: **${bias}**. Ask about any indicator or type "buy or sell?" for a full breakdown. You can also ask about other stocks like "TSLA?" or "NVDA RSI?"`;
  },

  // ── Send ──────────────────────────────────────────────────────────────────
  async send(prefill) {
    const input = document.getElementById('chat-input');
    const text  = (prefill || input?.value || '').trim();
    if (!text) return;
    if(text.length>1000)return;
    if (input) input.value = '';

    this._renderChips([]);

    const history = this.getHistory();
    history.push({ role: 'user', text, ts: Date.now() });
    this.saveHistory(history);
    this._renderMessages();
    this._scrollBottom();

    let reply;
    try{reply=this._buildResponse(text);}catch(_){reply='Chart explanation unavailable. Reload the chart and retry; no substitute prices are generated.';}
    this._showTyping(false);
    history.push({ role: 'assistant', text: reply, ts: Date.now() });
    this.saveHistory(history);
    this._renderMessages();
    this._renderChips(this._chips.after);
    this._scrollBottom();
  },

  // ── Chips ─────────────────────────────────────────────────────────────────
  _renderChips(chips) {
    const el = document.getElementById('chat-chips');
    if (!el) return;
    if (!chips?.length) { el.innerHTML = ''; return; }
    el.replaceChildren();for(const text of chips){const button=document.createElement('button');button.type='button';button.className='chat-chip';button.textContent=text;button.addEventListener('click',()=>this.send(text));el.append(button);}
  },

  // ── Typing indicator ──────────────────────────────────────────────────────
  _showTyping(show) {
    const el = document.getElementById('chat-typing');
    if (!el) return;
    el.style.display = show ? 'flex' : 'none';
    if (show) this._scrollBottom();
  },

  // ── Markdown ──────────────────────────────────────────────────────────────
  _md(text) {
    return String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n•/g, '<br>&nbsp;•')
      .replace(/\n/g, '<br>');
  },

  // ── Timestamp ─────────────────────────────────────────────────────────────
  _timeAgo(ts) {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 10)   return 'just now';
    if (d < 60)   return `${d}s ago`;
    if (d < 3600) return `${Math.floor(d/60)}m ago`;
    return `${Math.floor(d/3600)}h ago`;
  },

  // ── Render messages ───────────────────────────────────────────────────────
  _renderMessages() {
    const list = document.getElementById('chat-messages');
    if (!list) return;
    const history = this.getHistory();

    if (!history.length) {
      list.innerHTML = `<div class="chat-welcome">
        <div style="font-size:1.8rem;margin-bottom:.4rem">🤖</div>
        <div style="font-weight:700;margin-bottom:.3rem">StockAI Assistant</div>
        <div style="font-size:.78rem;color:var(--muted);line-height:1.6">Local chart assistant for <strong>${this._md(this._currentSymbol)}</strong>. Prices refer to loaded daily bars. Ask about RSI, MACD, support levels, or any other ticker like "TSLA?" or "NVDA RSI?"</div>
      </div>`;
      return;
    }

    list.innerHTML = history.map(m => `
      <div class="chat-msg ${m.role}${m.auto ? ' chat-auto' : ''}">
        ${m.role === 'assistant' ? '<div class="chat-avatar">🤖</div>' : ''}
        <div style="display:flex;flex-direction:column;gap:2px;${m.role === 'user' ? 'align-items:flex-end' : ''}">
          <div class="chat-bubble">${this._md(m.text)}</div>
          <div class="chat-ts">${this._timeAgo(m.ts)}</div>
        </div>
      </div>`).join('');
  },

  // ── Smooth scroll ─────────────────────────────────────────────────────────
  _scrollBottom() {
    const list = document.getElementById('chat-messages');
    if (!list) return;
    requestAnimationFrame(() => list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }));
  }
};

window.StockChat = StockChat;
