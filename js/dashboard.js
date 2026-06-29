// Dashboard — Finnhub-powered with simulation fallback
document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.requireAuth()) return;

  // Load watchlist in background — never block dashboard init.
  // If Render is sleeping the cold-start can take 30+ sec; awaiting it here
  // would freeze ALL tab event listeners until the server wakes up.
  Auth.loadWatchlist()
    .then(() => { updateWatchlistUI(); renderWatchlistMini(); })
    .catch(() => {});

  const session = Auth.getSession();
  document.querySelectorAll('.user-name').forEach(el => el.textContent = session.name);
  document.querySelectorAll('.user-email').forEach(el => el.textContent = session.email);
  const avatarEl = document.querySelector('.user-avatar');
  if (avatarEl) avatarEl.textContent = session.name[0].toUpperCase();

  let currentSymbol = 'AAPL';
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let simInterval = null;
  let marketInterval = null;
  let currentBars = [];
  let newsMode = 'stock';

  // Compare mode state
  let compareSeries = null;
  let compareActive = false;

  // Markets tab groups
  const MARKET_GROUPS = {
    indices:    [{ sym:'SPY',name:'S&P 500 ETF'},{ sym:'QQQ',name:'NASDAQ 100'},{ sym:'DIA',name:'Dow Jones ETF'},{ sym:'IWM',name:'Russell 2000'}],
    sectors:    [{ sym:'XLK',name:'Technology'},{ sym:'XLF',name:'Financials'},{ sym:'XLV',name:'Health Care'},{ sym:'XLE',name:'Energy'},{ sym:'XLI',name:'Industrials'},{ sym:'XLY',name:'Consumer Disc.'},{ sym:'XLRE',name:'Real Estate'},{ sym:'XLB',name:'Materials'}],
    commodities:[{ sym:'GLD',name:'Gold ETF'},{ sym:'USO',name:'Oil ETF'},{ sym:'SLV',name:'Silver ETF'},{ sym:'UNG',name:'Natural Gas'},{ sym:'PDBC',name:'Commodities'}],
  };

  // Simulated earnings calendar (relative to today)
  function getEarningsCalendar() {
    const d = offset => {
      const dt = new Date(); dt.setDate(dt.getDate() + offset);
      return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    };
    return [
      { sym:'JPM',  name:'JPMorgan Chase',  date:d(-45), time:'Before Open', est:4.35, act:4.44, beat:true  },
      { sym:'TSLA', name:'Tesla Inc.',       date:d(-32), time:'After Close', est:0.47, act:0.41, beat:false },
      { sym:'META', name:'Meta Platforms',   date:d(-28), time:'After Close', est:5.28, act:5.38, beat:true  },
      { sym:'MSFT', name:'Microsoft',        date:d(-28), time:'After Close', est:3.22, act:3.46, beat:true  },
      { sym:'GOOGL',name:'Alphabet',         date:d(-27), time:'After Close', est:2.01, act:2.12, beat:true  },
      { sym:'AMZN', name:'Amazon',           date:d(-21), time:'After Close', est:1.36, act:1.59, beat:true  },
      { sym:'AAPL', name:'Apple Inc.',       date:d(-14), time:'After Close', est:1.62, act:1.65, beat:true  },
      { sym:'NVDA', name:'NVIDIA Corp',      date:d(9),   time:'After Close', est:5.89, act:null,  beat:null  },
      { sym:'COIN', name:'Coinbase',         date:d(14),  time:'After Close', est:1.85, act:null,  beat:null  },
      { sym:'AMD',  name:'Adv. Micro Dev.',  date:d(20),  time:'After Close', est:0.97, act:null,  beat:null  },
      { sym:'NFLX', name:'Netflix',          date:d(27),  time:'After Close', est:4.22, act:null,  beat:null  },
      { sym:'V',    name:'Visa Inc.',        date:d(33),  time:'Before Open', est:2.68, act:null,  beat:null  },
    ];
  }

  // ── WebSocket status ──────────────────────────────────────────────────────
  const wsBadge = document.getElementById('ws-badge');
  function setWsStatus(state) {
    if (!wsBadge) return;
    const map = { connected:{text:'⚡ LIVE',cls:'ws-live'}, disconnected:{text:'○ Simulated',cls:'ws-sim'}, error:{text:'⚠ WS Error',cls:'ws-error'}, connecting:{text:'… Connecting',cls:'ws-conn'} };
    const cfg = map[state] || map.disconnected;
    wsBadge.textContent = cfg.text; wsBadge.className = `ws-badge ${cfg.cls}`;
  }
  document.addEventListener('stockai:ws', e => {
    const s = e.detail;
    if (s==='connected') { setWsStatus('connected'); switchToLive(); }
    else if (s==='no-key') setWsStatus('disconnected');
    else if (s==='connecting') setWsStatus('connecting');
    else setWsStatus('disconnected');
  });
  setWsStatus(location.host ? 'connecting' : 'disconnected');

  // ── Chart init ────────────────────────────────────────────────────────────
  function initChart() {
    const container = document.getElementById('price-chart');
    container.innerHTML = '';
    chart = LightweightCharts.createChart(container, {
      width: container.clientWidth, height: 320,
      layout: { background:{type:'solid',color:'transparent'}, textColor:'#94a3b8' },
      grid: { vertLines:{color:'rgba(0,212,255,0.07)'}, horzLines:{color:'rgba(0,212,255,0.07)'} },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor:'rgba(0,212,255,0.2)', scaleMargins:{top:0.08,bottom:0.22} },
      timeScale: { borderColor:'rgba(0,212,255,0.2)', timeVisible:true },
    });
    candleSeries = chart.addCandlestickSeries({ upColor:'#00ff88', downColor:'#ff4466', borderUpColor:'#00ff88', borderDownColor:'#ff4466', wickUpColor:'#00ff88', wickDownColor:'#ff4466' });
    volumeSeries = chart.addHistogramSeries({ priceFormat:{type:'volume'}, priceScaleId:'', scaleMargins:{top:0.82,bottom:0} });
    window._chart = chart; window._candleSeries = candleSeries; window._volSeries = volumeSeries;
    window.addEventListener('resize', () => chart && chart.applyOptions({ width: container.clientWidth }));
  }

  // ── Load stock ────────────────────────────────────────────────────────────
  async function loadStock(symbol) {
    symbol = symbol.toUpperCase().trim();
    if (!symbol) return;
    StockAPI.unsubscribeAll(); clearInterval(simInterval);
    currentSymbol = symbol;

    // Update UI chrome
    document.getElementById('current-symbol').textContent = symbol;
    document.getElementById('stock-search').value = '';
    const badge = document.getElementById('stock-badge-icon');
    if (badge) badge.textContent = symbol.slice(0,2);
    const hint = document.getElementById('watch-sym-hint');
    if (hint) hint.textContent = symbol;
    document.getElementById('stock-price').textContent = '…';
    document.getElementById('stock-change').textContent = '…';

    // Company profile
    const info = await StockAPI.getCompanyProfile(symbol);
    document.getElementById('company-name').textContent   = info.name;
    document.getElementById('company-sector').textContent = info.sector;

    // Subtitles
    const aiSub = document.getElementById('ai-view-subtitle');
    if (aiSub) aiSub.textContent = `Analyzing ${symbol} — ${info.name}`;
    const newsSub = document.getElementById('news-view-subtitle');
    if (newsSub) newsSub.textContent = `News for ${symbol}`;
    const tabStock = document.getElementById('tab-stock');
    if (tabStock) tabStock.textContent = `${symbol} News`;

    // Candles
    showChartLoader(true);
    try { currentBars = await StockAPI.getCandles(symbol,'D',365); }
    catch (_) { currentBars = StockAPI._simCandles(symbol,365); }
    window.fullBars = currentBars;

    if (currentBars.length) {
      candleSeries.setData(currentBars);
      volumeSeries.setData(volData(currentBars));
      chart.timeScale().fitContent();
    }
    showChartLoader(false);
    if (typeof StockChat !== 'undefined') StockChat.setContext(symbol, currentBars);

    // Clear any active compare so the second line doesn't linger
    if (compareSeries) clearCompare();

    await refreshQuote();
    if (currentBars.length >= 50) runAI();
    updateWatchlistUI();
    if (newsMode === 'stock') loadNews(symbol);

    if (location.host && StockAPI._wsStatus === 'connected') {
      StockAPI.subscribeSymbol(symbol, onWSTrade);
    } else {
      simInterval = setInterval(onSimTick, 2000);
    }
  }

  function switchToLive() { clearInterval(simInterval); simInterval = null; StockAPI.subscribeSymbol(currentSymbol, onWSTrade); }

  // ── Real-time handlers ────────────────────────────────────────────────────
  function onWSTrade({ price, volume, time }) {
    const nowSec = Math.floor((time||Date.now())/1000);
    const close  = +price.toFixed(4);
    const dayBucket = Math.floor(nowSec/86400)*86400;
    const last = currentBars[currentBars.length-1];
    let newBar;
    if (last && last.time===dayBucket) {
      newBar = {...last, high:Math.max(last.high,close), low:Math.min(last.low,close), close, volume:(last.volume||0)+(volume||0)};
      currentBars[currentBars.length-1] = newBar;
    } else {
      newBar = {time:dayBucket, open:last?last.close:close, high:close, low:close, close, volume:volume||0};
      currentBars.push(newBar);
    }
    window.fullBars = currentBars;
    candleSeries.update(newBar);
    volumeSeries.update({time:newBar.time, value:newBar.volume, color:newBar.close>=newBar.open?'rgba(0,255,136,0.3)':'rgba(255,68,102,0.3)'});
    updatePriceDisplay(close, last?last.close:close);
    checkAlertsForPrice(currentSymbol, close);
  }

  function onSimTick() {
    const price = StockAPI._simTick(currentSymbol);
    const nowSec = Math.floor(Date.now()/1000);
    const last = currentBars[currentBars.length-1];
    const newBar = { time:nowSec, open:last?last.close:+price.toFixed(2), high:Math.max(last?last.close:price,price), low:Math.min(last?last.close:price,price), close:+price.toFixed(2), volume:StockAPI._seeds[currentSymbol]?.volume||1e6 };
    currentBars.push(newBar); currentBars = currentBars.slice(-600); window.fullBars = currentBars;
    candleSeries.update(newBar);
    volumeSeries.update({time:nowSec, value:newBar.volume, color:newBar.close>=newBar.open?'rgba(0,255,136,0.3)':'rgba(255,68,102,0.3)'});
    updatePriceDisplay(price, last?last.close:price);
    checkAlertsForPrice(currentSymbol, +price.toFixed(2));
  }

  function updatePriceDisplay(price, prevPrice) {
    const change = price - prevPrice, changePct = prevPrice?(change/prevPrice)*100:0, up = change>=0;
    document.getElementById('stock-price').textContent = `$${price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const chgEl = document.getElementById('stock-change');
    chgEl.textContent = `${up?'+':''}${change.toFixed(2)} (${up?'+':''}${changePct.toFixed(2)}%)`;
    chgEl.className = `stock-change ${up?'up':'down'}`;
  }

  async function refreshQuote() {
    const q = await StockAPI.getQuote(currentSymbol); const up = q.changePct>=0;
    document.getElementById('stock-price').textContent = `$${q.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const chgEl = document.getElementById('stock-change');
    chgEl.textContent = `${up?'+':''}${q.change} (${up?'+':''}${q.changePct}%)`; chgEl.className = `stock-change ${up?'up':'down'}`;
    document.getElementById('stat-high').textContent   = `$${q.high}`;
    document.getElementById('stat-low').textContent    = `$${q.low}`;
    document.getElementById('stat-open').textContent   = `$${q.open}`;
    document.getElementById('stat-volume').textContent = q.volume?fmtVol(q.volume):'—';
    document.getElementById('data-source').textContent = q.live?'🟢 Finnhub Live':'🟡 Simulated';
  }

  // ── AI Prediction ─────────────────────────────────────────────────────────
  function runAI() {
    if (currentBars.length < 50) return;
    const prediction = AIPredictor.predict(currentBars);
    renderAI(prediction);
    // Kick off Claude AI analysis in parallel — updates #ai-reasoning when done
    const curPrice = currentBars[currentBars.length - 1].close;
    fetchClaudeAnalysis(currentSymbol, curPrice, prediction);
  }

  async function fetchClaudeAnalysis(symbol, price, prediction) {
    const reasonEl = document.getElementById('ai-reasoning');
    if (!reasonEl) return;

    // Show a subtle loading shimmer while Claude thinks
    reasonEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:.55rem;padding:.25rem 0 .5rem">
        <span style="width:8px;height:8px;border-radius:50%;background:var(--cyan);animation:aiPulse 1.2s ease-in-out infinite"></span>
        <span style="font-size:.75rem;color:var(--muted);font-weight:600;letter-spacing:.06em">CLAUDE AI ANALYZING ${symbol}…</span>
      </div>`;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 18000);
      let resp;
      try {
        resp = await fetch('/api/ai-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, price, prediction }),
          signal: ctrl.signal
        });
      } finally { clearTimeout(timer); }

      // 503 = API key not configured — show fallback badge immediately, no error noise
      if (resp.status === 503) {
        renderFallbackReasoning(prediction);
        return;
      }

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      // ── Render Claude's analysis ──────────────────────────────────────
      const driversHtml = Array.isArray(data.key_drivers) && data.key_drivers.length
        ? `<ul class="claude-drivers">${data.key_drivers.map(d => `<li>${d}</li>`).join('')}</ul>`
        : '';

      const riskHtml = data.risk
        ? `<div class="claude-risk"><span class="claude-label">⚠ RISK</span>${data.risk}</div>`
        : '';

      const watchHtml = data.watch
        ? `<div class="claude-watch"><span class="claude-label">👁 WATCH</span>${data.watch}</div>`
        : '';

      reasonEl.innerHTML = `
        <div class="claude-badge">✦ Claude AI</div>
        <p class="claude-summary">${data.summary}</p>
        ${driversHtml}
        ${riskHtml}
        ${watchHtml}`;

    } catch (err) {
      // Network error / timeout / parse failure — fall back gracefully
      renderFallbackReasoning(prediction);
      console.warn('[Claude AI] Fell back to local analysis:', err.message);
    }
  }

  function renderFallbackReasoning(prediction) {
    const reasonEl = document.getElementById('ai-reasoning');
    if (!reasonEl) return;
    const r = prediction || (currentBars.length >= 50 ? AIPredictor.predict(currentBars) : null);
    if (!r) return;
    reasonEl.innerHTML = `
      <div class="ta-badge">⚙ Technical Analysis</div>
      ${r.reasoning.map(l => `<p>${l}</p>`).join('')}`;
  }

  function renderAI(r) {
    const vc = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };

    // Direction pill
    const dirEl = document.getElementById('ai-direction');
    if (dirEl) {
      const labels = { UP:'▲ STRONG BUY', DOWN:'▼ STRONG SELL', NEUTRAL:'● HOLD' };
      if (r.confidence < 55) labels.UP = '▲ BUY'; if (r.confidence < 55) labels.DOWN = '▼ SELL';
      dirEl.textContent = labels[r.direction] || '● HOLD';
      dirEl.className = `ai-direction ${r.direction.toLowerCase()}`;
    }

    // Big arc gauge (260×160)
    const canvas = document.getElementById('conf-gauge');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const W=260, H=160, cx=130, cy=138, R=108, lw=14;
      ctx.clearRect(0,0,W,H);

      // Background track
      ctx.beginPath(); ctx.arc(cx,cy,R,Math.PI,0,false);
      ctx.lineWidth=lw; ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.stroke();

      // Gradient arc (full sweep)
      const grad = ctx.createLinearGradient(cx-R,0,cx+R,0);
      grad.addColorStop(0,'#ff4466'); grad.addColorStop(0.5,'#ffd700'); grad.addColorStop(1,'#00ff88');
      ctx.beginPath(); ctx.arc(cx,cy,R,Math.PI,0,false);
      ctx.lineWidth=lw; ctx.strokeStyle=grad; ctx.globalAlpha=0.18; ctx.stroke();
      ctx.globalAlpha=1;

      // Filled portion
      const conf = r.confidence/100;
      const startAngle = Math.PI;
      const endAngle = Math.PI + conf * Math.PI;
      const color = r.direction==='UP'?'#00ff88':r.direction==='DOWN'?'#ff4466':'#ffd700';
      ctx.beginPath(); ctx.arc(cx,cy,R,startAngle,endAngle,false);
      ctx.lineWidth=lw; ctx.strokeStyle=color;
      ctx.shadowColor=color; ctx.shadowBlur=18; ctx.stroke(); ctx.shadowBlur=0;

      // Needle dot at tip
      const tipX = cx + R * Math.cos(endAngle);
      const tipY = cy + R * Math.sin(endAngle);
      ctx.beginPath(); ctx.arc(tipX,tipY,7,0,Math.PI*2);
      ctx.fillStyle=color; ctx.shadowColor=color; ctx.shadowBlur=14; ctx.fill(); ctx.shadowBlur=0;

      // Center text
      ctx.fillStyle='#fff'; ctx.font='bold 36px Inter,sans-serif'; ctx.textAlign='center';
      ctx.fillText(`${r.confidence}%`, cx, cy-22);
      ctx.fillStyle='#64748b'; ctx.font='600 11px Inter,sans-serif';
      ctx.fillText('AI CONFIDENCE', cx, cy-4);

      // Zone labels
      ctx.font='500 10px Inter,sans-serif'; ctx.fillStyle='rgba(255,68,102,0.8)';
      ctx.fillText('SELL', cx-R+4, cy+16);
      ctx.fillStyle='rgba(255,215,0,0.8)';
      ctx.fillText('HOLD', cx, cy+20);
      ctx.fillStyle='rgba(0,255,136,0.8)';
      ctx.fillText('BUY', cx+R-18, cy+16);
    }

    vc('ai-buy-count',r.buyCount); vc('ai-sell-count',r.sellCount); vc('ai-neutral-count',r.neutralCount);
    vc('ai-support',`$${r.support}`); vc('ai-resistance',`$${r.resistance}`); vc('ai-atr',`${r.atrPct}%`); vc('ai-rsi',r.rsi??'—');

    // Price targets
    const curPrice = currentBars.length ? currentBars[currentBars.length-1].close : 0;
    if (curPrice) {
      const bullTarget = (curPrice * (1 + 0.08 + r.confidence/1000)).toFixed(2);
      const bearTarget = (curPrice * (1 - 0.05 - (100-r.confidence)/1500)).toFixed(2);
      vc('pt-bear', `$${bearTarget}`);
      vc('pt-bull', `$${bullTarget}`);
      vc('pt-current', `$${curPrice.toFixed(2)}`);
      // Position dot: where current sits between bear and bull
      const range = bullTarget - bearTarget;
      const pos = range > 0 ? Math.min(100, Math.max(0, ((curPrice - bearTarget)/range)*100)) : 50;
      const dotEl = document.getElementById('pt-dot');
      if (dotEl) dotEl.style.left = `${pos}%`;
    }

    // Risk needle
    const riskPct = r.atrPct ? Math.min(100, parseFloat(r.atrPct) / 4 * 100) : 50;
    const riskColor = riskPct < 35 ? '#00ff88' : riskPct < 65 ? '#ffd700' : '#ff4466';
    const needleEl = document.getElementById('risk-needle');
    if (!needleEl) {
      const track = document.querySelector('.risk-track');
      if (track) {
        const n = document.createElement('div');
        n.id = 'risk-needle'; n.className = 'risk-needle';
        n.style.left = `${riskPct}%`; n.style.borderColor = riskColor;
        track.appendChild(n);
      }
    } else {
      needleEl.style.left = `${riskPct}%`; needleEl.style.borderColor = riskColor;
    }

    const tbody = document.getElementById('signals-tbody');
    if (tbody) tbody.innerHTML = r.signals.map(s => {
      const cls=s.score>0?'sig-buy':s.score<0?'sig-sell':'sig-neutral', arrow=s.score>0?'▲':s.score<0?'▼':'●';
      return `<tr><td>${s.name}</td><td class="val">${s.value}</td><td><span class="sig-badge ${cls}">${arrow} ${s.signal}</span></td></tr>`;
    }).join('');

    const reasonEl = document.getElementById('ai-reasoning');
    if (reasonEl) reasonEl.innerHTML = r.reasoning.map(l=>`<p>${l}</p>`).join('');

    // Candlestick patterns
    if (r.patterns && r.patterns.length) {
      const existing = document.getElementById('pattern-row');
      if (existing) existing.remove();
      const pRow = document.createElement('tr'); pRow.id='pattern-row';
      pRow.innerHTML = `<td colspan="3" style="padding:.6rem .5rem"><span style="font-size:.72rem;color:var(--muted);font-weight:600">Patterns: </span>${r.patterns.map(p=>`<span class="sig-badge ${p.bull?'sig-buy':'sig-sell'}" style="margin:.1rem">${p.name}</span>`).join(' ')}</td>`;
      if (tbody) tbody.appendChild(pRow);
    }

    // Quick AI card on dashboard tab
    const qDir = document.getElementById('quick-direction');
    if (qDir) {
      qDir.textContent = r.direction==='UP'?'▲ BULLISH':r.direction==='DOWN'?'▼ BEARISH':'● NEUTRAL';
      qDir.className = `ai-dir-badge ${r.direction==='UP'?'up':r.direction==='DOWN'?'down':'neutral'}`;
    }
    vc('quick-conf-text',`Confidence: ${r.confidence}%`);
    vc('q-buy',r.buyCount); vc('q-sell',r.sellCount); vc('q-neutral',r.neutralCount);
  }

  // ── Market strip ──────────────────────────────────────────────────────────
  async function updateMarket() {
    const data = await StockAPI.getMarketOverview();
    const el = document.getElementById('market-overview');
    if (!el) return;
    el.innerHTML = data.map(m => {
      const up = m.changePct>=0;
      return `<div class="market-card ${up?'up':'down'}" onclick="window.selectSearch('${m.symbol||m.name}')">
        <div class="market-name">${m.name}</div>
        <div class="market-price">${(m.price||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        <div class="market-change">${up?'+':''}${(m.changePct||0).toFixed(2)}%</div>
      </div>`;
    }).join('');
  }

  // ── Markets tab ───────────────────────────────────────────────────────────
  async function renderMarketsTab() {
    // ── Sector Heat Map ───────────────────────────────────────────────────
    const HEAT_SECTORS = [
      { sym:'XLK', name:'Technology', emoji:'💻' },
      { sym:'XLF', name:'Financials',  emoji:'🏦' },
      { sym:'XLV', name:'Health Care', emoji:'🏥' },
      { sym:'XLE', name:'Energy',      emoji:'⚡' },
      { sym:'XLI', name:'Industrials', emoji:'🏭' },
      { sym:'XLY', name:'Consumer',    emoji:'🛍' },
      { sym:'XLRE',name:'Real Estate', emoji:'🏘' },
      { sym:'XLB', name:'Materials',   emoji:'⚗️' },
    ];
    const heatEl = document.getElementById('heat-map');
    if (heatEl) {
      heatEl.innerHTML = HEAT_SECTORS.map(s =>
        `<div class="heat-cell" id="heat-${s.sym}" onclick="window.selectSearch('${s.sym}');switchTab(null,'dashboard')"
          style="background:rgba(100,116,139,0.12)">
          <div class="heat-cell-name">${s.emoji} ${s.name}</div>
          <div class="heat-cell-chg" id="heat-chg-${s.sym}">—</div>
          <div class="heat-cell-sym">${s.sym}</div>
        </div>`).join('');
      await Promise.all(HEAT_SECTORS.map(async s => {
        try {
          const q = await StockAPI.getQuote(s.sym);
          const chg = q.changePct;
          const cell = document.getElementById(`heat-${s.sym}`);
          const chgEl = document.getElementById(`heat-chg-${s.sym}`);
          if (!cell) return;
          const intensity = Math.min(1, Math.abs(chg) / 4);
          if (chg >= 0) {
            cell.style.background = `rgba(0,255,136,${0.07 + intensity * 0.35})`;
            cell.style.color = '#00ff88';
          } else {
            cell.style.background = `rgba(255,68,102,${0.07 + intensity * 0.35})`;
            cell.style.color = '#ff4466';
          }
          if (chgEl) chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
        } catch (_) {}
      }));
    }

    async function fillGrid(id, items) {
      const el = document.getElementById(id); if (!el) return;
      el.innerHTML = items.map(item => `
        <div class="mkt-card" onclick="window.selectSearch('${item.sym}');switchTab(null,'dashboard')">
          <div class="mkt-card-name"><span>${item.name}</span><span class="mkt-card-sym">${item.sym}</span></div>
          <div class="mkt-card-price" id="mkt-px-${item.sym}">$—</div>
          <div class="mkt-card-chg"  id="mkt-chg-${item.sym}">—</div>
          <div class="mkt-card-bar"><div class="mkt-card-fill" id="mkt-bar-${item.sym}" style="width:50%"></div></div>
        </div>`).join('');
      await Promise.all(items.map(async item => {
        try {
          const q = await StockAPI.getQuote(item.sym); const up = q.changePct>=0;
          el.querySelector(`[onclick*="'${item.sym}'"]`)?.classList.add(up?'up':'down');
          const px  = document.getElementById(`mkt-px-${item.sym}`);
          const chg = document.getElementById(`mkt-chg-${item.sym}`);
          const bar = document.getElementById(`mkt-bar-${item.sym}`);
          if (px)  px.textContent  = `$${q.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
          if (chg) chg.textContent = `${up?'+':''}${q.changePct}%`;
          if (bar) bar.style.width = `${Math.min(100,Math.max(5,50+q.changePct*5))}%`;
        } catch (_) {}
      }));
    }
    await Promise.all([fillGrid('mkt-indices',MARKET_GROUPS.indices), fillGrid('mkt-sectors',MARKET_GROUPS.sectors), fillGrid('mkt-commodities',MARKET_GROUPS.commodities)]);
  }

  // ── Watchlist sidebar ─────────────────────────────────────────────────────
  function updateWatchlistUI() {
    const list = Auth.getWatchlist(); const el = document.getElementById('watchlist'); if (!el) return;
    if (!list.length) { el.innerHTML='<div style="color:var(--muted);font-size:.82rem;padding:.5rem;text-align:center">Watchlist empty</div>'; return; }
    el.innerHTML = list.map(sym => {
      const seed = StockAPI._seeds[sym]||{}, price = seed.price?+seed.price.toFixed(2):'—', info = StockAPI.getCompanyInfo(sym);
      return `<div class="wl-item ${sym===currentSymbol?'active':''}" onclick="window.selectSearch('${sym}')">
        <span class="wl-sym">${sym}</span><span class="wl-name">${info.name.split(' ')[0]}</span>
        <span class="wl-price">$${price}</span>
        <button class="wl-remove" onclick="event.stopPropagation();removeFromWL('${sym}')">×</button></div>`;
    }).join('');
  }

  window.removeFromWL = async function(sym) { await Auth.removeFromWatchlist(sym); updateWatchlistUI(); renderWatchlistTab(); renderWatchlistMini(); };

  // ── Watchlist tab ─────────────────────────────────────────────────────────
  async function renderWatchlistTab() {
    const grid = document.getElementById('wl-view-grid'); if (!grid) return;
    const list = Auth.getWatchlist();
    if (Auth.isGuest()) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--muted)"><div style="font-size:2rem;margin-bottom:.8rem">⭐</div><div style="margin-bottom:1.2rem">Create a free account to save your watchlist</div><a href="register.html" style="padding:.6rem 1.6rem;background:linear-gradient(135deg,var(--cyan2),var(--cyan));border-radius:9px;color:#fff;font-weight:700;text-decoration:none;font-size:.88rem">Create Account →</a></div>`;
      return;
    }
    if (!list.length) { grid.innerHTML=`<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--muted)"><div style="font-size:2rem;margin-bottom:.8rem">⭐</div><div>No stocks yet. Use the search box above to add some.</div></div>`; return; }
    grid.innerHTML = list.map(sym => {
      const info = StockAPI.getCompanyInfo(sym);
      return `<div class="wl-full-item" onclick="window.selectSearch('${sym}');switchTab(null,'dashboard')">
        <div class="wlf-badge">${sym.slice(0,2)}</div>
        <div class="wlf-info"><div class="wlf-sym">${sym}</div><div class="wlf-name">${info.name}</div></div>
        <div class="wlf-price"><div class="wlf-px" id="wlf-px-${sym}">$—</div><div class="wlf-chg" id="wlf-chg-${sym}">—</div></div>
        <button onclick="event.stopPropagation();removeFromWL('${sym}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.1rem;opacity:.55;padding:.2rem;flex-shrink:0">×</button>
      </div>`;
    }).join('');
    await Promise.all(list.map(async sym => {
      try {
        const q = await StockAPI.getQuote(sym); const up = q.changePct>=0;
        const px  = document.getElementById(`wlf-px-${sym}`);
        const chg = document.getElementById(`wlf-chg-${sym}`);
        if (px)  px.textContent  = `$${q.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
        if (chg) { chg.textContent=`${up?'+':''}${q.changePct}%`; chg.className=`wlf-chg ${up?'up':'down'}`; }
      } catch (_) {}
    }));
  }

  window.addToWLFromInput = async function() {
    if (Auth.isGuest()) { showGuestModal(); return; }
    const input = document.getElementById('wl-add-input');
    const sym = (input?.value||'').toUpperCase().trim();
    if (!sym) { showToast('Enter a stock symbol'); return; }
    await Auth.addToWatchlist(sym); if (input) input.value='';
    updateWatchlistUI(); renderWatchlistTab(); renderWatchlistMini();
    showToast(`${sym} added to watchlist`);
  };

  // ── Watchlist mini (trending tab) ─────────────────────────────────────────
  async function renderWatchlistMini() {
    const el = document.getElementById('watchlist-mini'); if (!el) return;
    const list = Auth.getWatchlist();
    if (!list.length) { el.innerHTML='<div style="color:var(--muted);font-size:.82rem;text-align:center;padding:.8rem">Watchlist empty</div>'; return; }
    el.innerHTML = list.map(sym => {
      const info = StockAPI.getCompanyInfo(sym);
      return `<div class="wl-item" onclick="window.selectSearch('${sym}');switchTab(null,'dashboard')" style="cursor:pointer">
        <span class="wl-sym">${sym}</span><span class="wl-name">${info.name.split(' ')[0]}</span>
        <span class="wl-price" id="wm-px-${sym}">$—</span>
        <span class="wl-chg"  id="wm-chg-${sym}">—</span></div>`;
    }).join('');
    await Promise.all(list.map(async sym => {
      try {
        const q = await StockAPI.getQuote(sym); const up = q.changePct>=0;
        const px  = document.getElementById(`wm-px-${sym}`);
        const chg = document.getElementById(`wm-chg-${sym}`);
        if (px)  px.textContent  = `$${q.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
        if (chg) { chg.textContent=`${up?'+':''}${q.changePct}%`; chg.className=`wl-chg ${up?'up':'down'}`; }
      } catch (_) {}
    }));
  }

  // ── Trending tab ──────────────────────────────────────────────────────────
  async function renderTrending() {
    const grid = document.getElementById('trend-grid'); if (!grid) return;
    const symbols = StockAPI.popularSymbols || ['AAPL','MSFT','GOOGL','TSLA','AMZN','META','NVDA','NFLX','AMD','JPM','V','COIN','BABA','DIS','PYPL','UBER','SNAP','SPOT'];
    grid.innerHTML = symbols.map(sym => {
      const info = StockAPI.getCompanyInfo(sym);
      return `<div class="trend-card" data-tilt data-tilt-max="9" onclick="window.selectSearch('${sym}');switchTab(null,'dashboard')">
        <div class="trend-sym">${sym}</div><div class="trend-name">${info.name}</div>
        <div class="trend-price" id="tr-px-${sym}">$—</div>
        <div class="trend-chg"  id="tr-chg-${sym}">—</div>
        <div class="trend-bar"><div class="trend-fill" id="tr-bar-${sym}" style="width:50%;background:var(--cyan)"></div></div>
      </div>`;
    }).join('');
    await Promise.all(symbols.map(async sym => {
      try {
        const q = await StockAPI.getQuote(sym); const up = q.changePct>=0;
        const px  = document.getElementById(`tr-px-${sym}`);
        const chg = document.getElementById(`tr-chg-${sym}`);
        const bar = document.getElementById(`tr-bar-${sym}`);
        if (px)  px.textContent  = `$${q.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
        if (chg) { chg.textContent=`${up?'+':''}${q.changePct}%`; chg.className=`trend-chg ${up?'up':'down'}`; }
        if (bar) { bar.style.width=`${Math.min(100,Math.max(5,50+q.changePct*5))}%`; bar.style.background=up?'var(--green)':'var(--red)'; }
      } catch (_) {}
    }));
    if (typeof initTilt==='function') initTilt('[data-tilt]', grid);
    if (typeof animateCardsIn==='function') animateCardsIn('.trend-card', grid);
  }

  // ── Compare mode ──────────────────────────────────────────────────────────
  window.toggleCompare = function() {
    compareActive = !compareActive;
    document.getElementById('compare-panel').classList.toggle('hidden', !compareActive);
    document.getElementById('btn-compare').classList.toggle('active', compareActive);
    if (!compareActive) clearCompare();
  };

  window.loadCompare = async function() {
    const sym = (document.getElementById('compare-input').value||'').toUpperCase().trim();
    if (!sym) { showToast('Enter a symbol to compare'); return; }
    if (sym === currentSymbol) { showToast('Choose a different symbol to compare'); return; }

    // Remove existing compare series
    if (compareSeries && window._chart) { try { window._chart.removeSeries(compareSeries); } catch(_){} compareSeries=null; }

    try {
      const bars2 = await StockAPI.getCandles(sym,'D',365);
      if (!bars2.length) throw new Error('no data');

      // Enable left price scale for the comparison stock
      window._chart.applyOptions({ leftPriceScale:{ visible:true, borderColor:'rgba(245,158,11,0.3)', scaleMargins:{top:0.08,bottom:0.22} } });

      compareSeries = window._chart.addLineSeries({
        color:'#f59e0b', lineWidth:2, priceLineVisible:false,
        lastValueVisible:true, crosshairMarkerVisible:true, title:sym,
        priceScaleId:'left',
      });
      compareSeries.setData(bars2.map(b=>({time:b.time, value:b.close})));

      const leg = document.getElementById('compare-legend');
      if (leg) leg.innerHTML = `<span><span class="cmp-dot" style="background:var(--cyan)"></span>${currentSymbol}</span><span><span class="cmp-dot" style="background:#f59e0b"></span>${sym}</span>`;
      showToast(`Comparing ${currentSymbol} vs ${sym}`);
    } catch(_) {
      showToast(`No data for ${sym}`);
    }
  };

  window.clearCompare = function() {
    if (compareSeries && window._chart) { try { window._chart.removeSeries(compareSeries); } catch(_){} compareSeries=null; }
    window._chart?.applyOptions({ leftPriceScale:{ visible:false } });
    const input = document.getElementById('compare-input'); if (input) input.value='';
    const leg = document.getElementById('compare-legend'); if (leg) leg.innerHTML='';
  };

  // ── Ticker Tape ──────────────────────────────────────────────────────────
  async function renderTickerTape() {
    const inner = document.getElementById('ticker-inner'); if (!inner) return;
    const syms = ['AAPL','MSFT','GOOGL','AMZN','NVDA','TSLA','META','JPM','V','SPY','QQQ','GLD','BTC-USD','NFLX','AMD'];
    const quotes = await Promise.all(syms.map(async s => {
      try { StockAPI._initSeed(s); const q = StockAPI._simQuote(s); return { sym:s, price:q.price, pct:q.changePct }; }
      catch { return null; }
    }));
    const valid = quotes.filter(Boolean);
    const mkItem = q => {
      const up = q.pct >= 0;
      return `<span class="ticker-item"><b>${q.sym}</b> $${q.price.toFixed(2)} <span style="color:${up?'var(--green)':'var(--red)'}">${up?'+':''}${q.pct.toFixed(2)}%</span></span>`;
    };
    const html = valid.map(mkItem).join('');
    inner.innerHTML = html + html; // duplicate for seamless loop
    // Adjust animation duration to content width
    const totalW = inner.scrollWidth / 2;
    inner.style.animation = 'none';
    inner.style.width = (totalW * 2) + 'px';
    inner.offsetHeight; // reflow
    inner.style.animation = `ticker ${Math.max(20, totalW / 60)}s linear infinite`;
  }

  // ── Notification Center ───────────────────────────────────────────────────
  const NotifCenter = window.NotifCenter = (function() {
    const KEY = 'stockai_notifs';
    let _open = false;
    function load() { try { return JSON.parse(localStorage.getItem(KEY)||'[]'); } catch { return []; } }
    function save(list) { localStorage.setItem(KEY, JSON.stringify(list.slice(0,50))); }
    function updateBadge() {
      const n = load().filter(x=>!x.read).length;
      const badge = document.getElementById('notif-badge');
      if (!badge) return;
      badge.textContent = n > 9 ? '9+' : n;
      badge.style.display = n > 0 ? '' : 'none';
    }
    return {
      push(title, body, type='info') {
        const list = load();
        list.unshift({ id:Date.now(), title, body, type, ts:Date.now(), read:false });
        save(list);
        updateBadge();
        if (_open) this.render();
        // Also show a toast
        if (typeof showToast === 'function') showToast(`🔔 ${title}`, false);
      },
      toggle() {
        const panel = document.getElementById('notif-panel');
        if (!panel) return;
        _open = !_open;
        panel.classList.toggle('hidden', !_open);
        if (_open) { this.markAllRead(); this.render(); }
      },
      markAllRead() {
        const list = load().map(x=>({...x, read:true}));
        save(list);
        updateBadge();
      },
      clearAll() {
        save([]);
        updateBadge();
        this.render();
      },
      render() {
        const el = document.getElementById('notif-list'); if (!el) return;
        const list = load();
        if (!list.length) {
          el.innerHTML='<div style="text-align:center;padding:2rem 1rem;color:var(--muted);font-size:.82rem">No notifications yet.<br>Price alerts will appear here.</div>';
          return;
        }
        const icons = { alert:'🚨', info:'ℹ️', up:'📈', down:'📉' };
        el.innerHTML = list.map(n=>`
          <div class="notif-item ${n.read?'':'unread'}">
            <span class="notif-icon">${icons[n.type]||'🔔'}</span>
            <div class="notif-body">
              <div style="font-size:.82rem;font-weight:700;color:var(--text)">${n.title}</div>
              <div>${n.body}</div>
              <div class="notif-time">${_timeAgo(n.ts)}</div>
            </div>
          </div>`).join('');
      },
      init() { updateBadge(); }
    };
    function _timeAgo(ts) {
      const d = Date.now() - ts;
      if (d < 60000) return 'just now';
      if (d < 3600000) return Math.floor(d/60000) + 'm ago';
      if (d < 86400000) return Math.floor(d/3600000) + 'h ago';
      return Math.floor(d/86400000) + 'd ago';
    }
  })();

  // Close notif panel on outside click
  document.addEventListener('click', e => {
    const btn = document.getElementById('notif-btn');
    const panel = document.getElementById('notif-panel');
    if (panel && btn && !panel.classList.contains('hidden') && !panel.contains(e.target) && !btn.contains(e.target)) {
      NotifCenter.toggle(); // closes it
    }
  }, true);

  // ── Daily AI Briefing ─────────────────────────────────────────────────────
  async function renderDailyBriefing() {
    const textEl = document.getElementById('briefing-text');
    const badgeEl = document.getElementById('briefing-badge');
    const moversEl = document.getElementById('briefing-movers');
    if (!textEl) return;

    // Gather quick quotes for major indices
    const moverSyms = ['AAPL','NVDA','MSFT','TSLA','META','AMZN','GOOGL','SPY','QQQ'];
    const qts = await Promise.all(moverSyms.map(s => {
      StockAPI._initSeed(s);
      return Promise.resolve(StockAPI._simQuote(s));
    }));
    const data = moverSyms.map((s,i) => ({ sym:s, ...qts[i] }));
    data.sort((a,b) => Math.abs(b.changePct) - Math.abs(a.changePct));

    const spy = data.find(d=>d.sym==='SPY');
    const qqq = data.find(d=>d.sym==='QQQ');
    const bullish = (spy?.changePct||0) > 0.3;
    const bearish = (spy?.changePct||0) < -0.3;
    const sentiment = bullish ? 'bull' : bearish ? 'bear' : 'neutral';
    const sentLabel = bullish ? 'Bullish' : bearish ? 'Bearish' : 'Neutral';

    if (badgeEl) { badgeEl.className = `briefing-badge ${sentiment}`; badgeEl.textContent = sentLabel; }

    const spyRaw = spy?.changePct||0;
    const qqqRaw = qqq?.changePct||0;
    const spyDir = spyRaw >= 0 ? 'up' : 'down';
    const qqqDir = qqqRaw >= 0 ? 'up' : 'down';
    const fmtPct = v => `${v>=0?'+':''}${v.toFixed(2)}%`;

    const opener = bullish
      ? 'Markets are showing strength today with broad-based gains.'
      : bearish
      ? 'Markets are under pressure today with selling across sectors.'
      : 'Markets are trading mixed today with no clear directional bias.';

    textEl.innerHTML = `${opener} S&P 500 (SPY) <span class="${spyDir}">${fmtPct(spyRaw)}</span>, NASDAQ (QQQ) <span class="${qqqDir}">${fmtPct(qqqRaw)}</span>. AI momentum indicators suggest watching ${data[0]?.sym||'NVDA'} closely today.`;

    if (moversEl) {
      moversEl.innerHTML = data.slice(0,4).map(d => {
        const up = d.changePct >= 0;
        return `<div class="briefing-mover ${up?'up':'down'}">${d.sym} ${up?'+':''}${d.changePct.toFixed(2)}%</div>`;
      }).join('');
    }
  }

  // ── Portfolio Analytics (donut chart) ─────────────────────────────────────
  async function renderPortfolioAnalytics() {
    const canvas = document.getElementById('port-donut'); if (!canvas) return;
    const holdings = Portfolio.get();
    const wrap = document.getElementById('port-analytics-wrap');
    if (!holdings.length) { if (wrap) wrap.style.display='none'; return; }
    if (wrap) wrap.style.display='';

    const quotes = {};
    await Promise.all(holdings.map(async h => {
      StockAPI._initSeed(h.symbol);
      quotes[h.symbol] = StockAPI._simQuote(h.symbol);
    }));

    const rows = holdings.map(h => ({
      sym: h.symbol,
      value: h.shares * (quotes[h.symbol]?.price || h.buyPrice),
    }));
    const total = rows.reduce((a,r) => a+r.value, 0) || 1;
    const colors = ['#00d4ff','#00ff88','#60a5fa','#ffd700','#ff6b6b','#4ecdc4','#45b7d1','#f9ca24'];
    rows.forEach((r,i) => r.color = colors[i % colors.length]);

    // Draw donut
    const ctx = canvas.getContext('2d');
    const cx = 80, cy = 80, R = 68, r = 38;
    ctx.clearRect(0,0,160,160);
    let angle = -Math.PI/2;
    rows.forEach(row => {
      const sweep = (row.value/total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx,cy);
      ctx.arc(cx,cy,R,angle,angle+sweep);
      ctx.closePath(); ctx.fillStyle = row.color; ctx.fill();
      angle += sweep;
    });
    // Hole
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
    ctx.fillStyle = '#060e1c'; ctx.fill();
    // Center text
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 13px Inter,sans-serif'; ctx.textAlign='center';
    ctx.fillText(`$${total>=1000?(total/1000).toFixed(1)+'K':total.toFixed(0)}`, cx, cy+4);

    // Legend
    const legendEl = document.getElementById('port-legend');
    if (legendEl) legendEl.innerHTML = rows.map(r=>`
      <div class="port-legend-row">
        <span style="width:10px;height:10px;border-radius:50%;background:${r.color};flex-shrink:0;display:inline-block"></span>
        <span style="font-size:.76rem;color:var(--text)">${r.sym}</span>
        <span style="font-size:.74rem;color:var(--muted);margin-left:auto">${((r.value/total)*100).toFixed(1)}%</span>
      </div>`).join('');

    // Mini stats grid
    const gridEl = document.getElementById('port-mini-grid');
    if (gridEl) {
      const largest = [...rows].sort((a,b)=>b.value-a.value)[0];
      const mostPL = holdings.map(h=>({
        sym:h.symbol,
        pl:((quotes[h.symbol]?.price||h.buyPrice)-h.buyPrice)*h.shares
      })).sort((a,b)=>b.pl-a.pl)[0];

      gridEl.innerHTML = `
        <div class="port-mini"><div class="port-mini-lbl">Positions</div><div class="port-mini-val">${holdings.length}</div></div>
        <div class="port-mini"><div class="port-mini-lbl">Largest Hold</div><div class="port-mini-val" style="color:var(--cyan)">${largest?.sym||'—'}</div></div>
        <div class="port-mini"><div class="port-mini-lbl">Best Performer</div><div class="port-mini-val up">${mostPL?.pl>=0?mostPL?.sym:'—'}</div></div>
        <div class="port-mini"><div class="port-mini-lbl">Diversification</div><div class="port-mini-val">${holdings.length>=5?'High':holdings.length>=3?'Medium':'Low'}</div></div>`;
    }
  }

  // ── Portfolio sparkline ───────────────────────────────────────────────────
  function renderPortfolioChart() {
    const canvas = document.getElementById('port-sparkline'); if (!canvas) return;
    const holdings = Portfolio.get();
    const W = canvas.parentElement.clientWidth || 600, H = 80;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,W,H);

    if (!holdings.length) {
      ctx.fillStyle='rgba(100,116,139,0.4)'; ctx.font='13px Inter'; ctx.textAlign='center';
      ctx.fillText('Add holdings to see portfolio chart',W/2,H/2+5); return;
    }

    // Simulate 30 daily portfolio values
    const days = 30;
    const values = Array.from({length:days},(_,i) => {
      let total=0;
      holdings.forEach(h => {
        const seed = StockAPI._seeds[h.symbol]||{};
        const base = seed.price||h.buyPrice;
        // Deterministic pseudo-random walk per symbol
        const noise = Math.sin(i*0.4+h.symbol.charCodeAt(0)*0.1)*0.018 + Math.cos(i*0.7+h.symbol.charCodeAt(1)*0.07)*0.012;
        total += h.shares * base * (1+noise);
      });
      return total;
    });

    const min=Math.min(...values), max=Math.max(...values), range=max-min||1;
    const pts = values.map((v,i)=>({ x:(i/(days-1))*W, y:H-4-((v-min)/range)*(H-10) }));
    const isUp = values[days-1]>=values[0];
    const color = isUp?'#00ff88':'#ff4466';

    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0, isUp?'rgba(0,255,136,0.25)':'rgba(255,68,102,0.25)');
    grad.addColorStop(1,'rgba(0,0,0,0)');

    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
    pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
    ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
    ctx.fillStyle=grad; ctx.fill();

    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
    pts.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
    ctx.strokeStyle=color; ctx.lineWidth=2; ctx.shadowColor=color; ctx.shadowBlur=6; ctx.stroke(); ctx.shadowBlur=0;

    // Start/end labels
    const fmt = v=>`$${v.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}`;
    ctx.fillStyle='rgba(100,116,139,0.8)'; ctx.font='10px Inter'; ctx.textAlign='left';
    ctx.fillText(fmt(values[0]),4,H-4);
    ctx.textAlign='right'; ctx.fillStyle=color;
    ctx.fillText(fmt(values[days-1]),W-4,H-4);
  }

  // ── Portfolio v2 — real prices via Yahoo Finance + CoinGecko ─────────────
  const _fmtD = v => Number(v).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });

  function _portIconCls(h) {
    if ((h.assetType || 'stock') === 'crypto') return 'crypto';
    if ((h.assetType || 'stock') === 'etf')    return 'etf';
    const acct = h.accountType || 'taxable';
    if (acct === 'roth_ira') return 'roth';
    if (acct === 'k401')     return 'k401';
    return 'stock';
  }

  function _portIconLabel(h) {
    return (h.assetType || 'stock').toUpperCase().slice(0, 4);
  }

  const _acctLabels = {
    taxable:'Taxable', roth_ira:'Roth IRA', k401:'401(k)',
    crypto_wallet:'Crypto', other:'Other'
  };

  // ── Portfolio hero particle network ───────────────────────────────────────
  let _heroAnimId = null;
  function initPortfolioHero() {
    const canvas = document.getElementById('port-hero-canvas'); if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;
    function resize() { canvas.width = parent.offsetWidth; canvas.height = parent.offsetHeight; }
    resize();
    const pts = Array.from({length:45}, () => ({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      vx: (Math.random()-.5)*.45, vy: (Math.random()-.5)*.45,
    }));
    if (_heroAnimId) cancelAnimationFrame(_heroAnimId);
    function draw() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      pts.forEach(p => {
        p.x+=p.vx; p.y+=p.vy;
        if(p.x<0||p.x>canvas.width)  p.vx*=-1;
        if(p.y<0||p.y>canvas.height) p.vy*=-1;
        ctx.beginPath(); ctx.arc(p.x,p.y,1.8,0,Math.PI*2);
        ctx.fillStyle='rgba(110,90,255,0.55)'; ctx.fill();
      });
      pts.forEach((a,i) => pts.slice(i+1).forEach(b => {
        const d = Math.hypot(a.x-b.x, a.y-b.y);
        if (d<130) {
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
          ctx.strokeStyle=`rgba(100,80,220,${0.18*(1-d/130)})`; ctx.lineWidth=.7; ctx.stroke();
        }
      }));
      _heroAnimId = requestAnimationFrame(draw);
    }
    draw();
  }

  async function renderPortfolio(silent = false) {
    initPortfolioHero();
    await Portfolio.load();               // fetch from API (or guest localStorage)
    const holdings = Portfolio.get();
    const listEl   = document.getElementById('port-list');
    if (!listEl) return;

    if (!holdings.length) {
      listEl.innerHTML = '<div class="port-empty">No holdings yet — add your first position above.</div>';
      ['port-invested','port-value','port-pl','port-pct','port-best','port-count'].forEach(id=>{
        const el=document.getElementById(id); if(el){ el.textContent=id==='port-count'?'0':'—'; el.className='psc-val'; }
      });
      document.getElementById('port-alloc-list').innerHTML='<span style="color:var(--muted);font-size:.8rem">Add holdings to see breakdown</span>';
      renderPortfolioChart();
      renderPortfolioAnalytics();
      return;
    }

    // Fetch live prices (silent = skip loading spinner for background refresh)
    if (!silent) listEl.innerHTML = `<div style="color:var(--muted);font-size:.82rem;padding:1.5rem;text-align:center">⟳ Fetching live prices…</div>`;
    const uniqueSyms = [...new Set(holdings.map(h=>h.symbol))];
    let priceData = {};
    try {
      const r = await fetch(`/api/portfolio-prices?symbols=${uniqueSyms.join(',')}`);
      if (r.ok) priceData = await r.json();
    } catch(e) { console.warn('portfolio-prices fetch failed:', e.message); }

    // Build rows with computed values
    let totalCost=0, totalValue=0;
    const rows = holdings.map(h => {
      const pd      = priceData[h.symbol] || {};
      const hasLive = pd.price != null && pd.price > 0;

      // Price source priority: 1) live API price  2) simulated market price  3) avg cost (last resort)
      let curPrice, priceSource;
      if (hasLive) {
        curPrice    = pd.price;
        priceSource = 'live';
      } else {
        // Use simulated price so gain/loss reflects market movement, NOT avg cost
        try {
          StockAPI._initSeed(h.symbol);
          curPrice    = StockAPI._simQuote(h.symbol).price;
          priceSource = 'sim';
        } catch(e) {
          curPrice    = h.buyPrice;
          priceSource = 'cost';
        }
      }

      const chg24h = hasLive ? (pd.change24h ?? null) : null;
      const cost   = h.shares * h.buyPrice;
      const value  = h.shares * curPrice;
      const pl     = value - cost;
      const plPct  = cost ? (pl / cost) * 100 : 0;
      totalCost  += cost;
      totalValue += value;
      return { ...h, curPrice, chg24h, priceSource, cost, value, pl, plPct,
               name: pd.name || h.name || h.symbol,
               assetType: h.assetType || 'stock',
               accountType: h.accountType || 'taxable' };
    });

    // Stats
    const totalPL    = totalValue - totalCost;
    const totalPLPct = totalCost ? (totalPL / totalCost) * 100 : 0;
    const up    = totalPL >= 0;
    const best  = rows.length ? rows.reduce((a,b) => b.plPct > a.plPct ? b : a) : null;
    const worst = rows.length ? rows.reduce((a,b) => b.plPct < a.plPct ? b : a) : null;

    // ── Big stat cards ────────────────────────────────────────────────────────
    const setText = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    const setHTML = (id, v) => { const el=document.getElementById(id); if(el) el.innerHTML=v; };

    setText('port-invested', '$' + _fmtD(totalCost));
    setText('port-value',    '$' + _fmtD(totalValue));
    setText('port-count-sub', rows.length + ' position' + (rows.length !== 1 ? 's' : ''));

    const plEl = document.getElementById('port-pl');
    if (plEl) { plEl.textContent = (up?'+':'-') + '$' + _fmtD(Math.abs(totalPL)); plEl.className = 'pt-stat-val ' + (up?'up':'down'); }
    setHTML('port-pl-badge', `<span class="pt-stat-badge ${up?'up':'down'}">${up?'▲':'▼'} ${up?'+':''}${_fmtD(totalPLPct)}%</span>`);

    if (best) {
      const bEl = document.getElementById('port-best');
      if (bEl) { bEl.textContent = best.symbol; bEl.className = 'pt-stat-val'; }
      const bUp = best.plPct >= 0;
      setHTML('port-best-sub', `<span style="color:${bUp?'var(--green)':'var(--red)'}">${bUp?'+':''}${_fmtD(best.plPct)}% all-time</span>`);
    }

    // ── Quick Stats ───────────────────────────────────────────────────────────
    setText('qs-positions', rows.length);
    const withChg = rows.filter(r => r.chg24h !== null);
    if (withChg.length) {
      const avg = withChg.reduce((s,r) => s + r.chg24h, 0) / withChg.length;
      const aUp = avg >= 0;
      const aEl = document.getElementById('qs-avgday');
      if (aEl) { aEl.textContent = (aUp?'+':'') + _fmtD(avg) + '%'; aEl.style.color = aUp?'var(--green)':'var(--red)'; }
    }
    if (worst) {
      const wUp = worst.plPct >= 0;
      const wEl = document.getElementById('qs-worst');
      if (wEl) { wEl.textContent = worst.symbol; wEl.style.color = wUp?'var(--green)':'var(--red)'; }
      const wpEl = document.getElementById('qs-worstpl');
      if (wpEl) { wpEl.textContent = (wUp?'+':'') + _fmtD(worst.plPct) + '%'; wpEl.style.color = wUp?'var(--green)':'var(--red)'; }
    }
    const gainEl = document.getElementById('qs-gain');
    if (gainEl) { gainEl.textContent = (up?'+':'-') + '$' + _fmtD(Math.abs(totalPL)); gainEl.style.color = up?'var(--green)':'var(--red)'; }

    // ── Update filter tab counts ──────────────────────────────────────────────
    const filterGroups = { all: rows.length, stock: 0, etf: 0, crypto: 0, roth_ira: 0, k401: 0 };
    rows.forEach(r => {
      const t = r.assetType || 'stock';
      const a = r.accountType || 'taxable';
      if (t === 'stock') filterGroups.stock++;
      else if (t === 'etf') filterGroups.etf++;
      else if (t === 'crypto') filterGroups.crypto++;
      if (a === 'roth_ira') filterGroups.roth_ira++;
      if (a === 'k401') filterGroups.k401++;
    });
    Object.entries(filterGroups).forEach(([k,v]) => {
      const el = document.getElementById(`ftab-count-${k}`);
      if (el) el.textContent = v ? `(${v})` : '';
    });
    // Hide tabs with 0 items (except "all")
    document.querySelectorAll('.port-ftab[data-filter]').forEach(btn => {
      if (btn.dataset.filter === 'all') return;
      const cnt = filterGroups[btn.dataset.filter] || 0;
      btn.style.display = cnt > 0 ? '' : 'none';
    });

    // ── Apply active filter ───────────────────────────────────────────────────
    const filteredRows = _portFilter === 'all' ? rows : rows.filter(r => {
      if (_portFilter === 'stock')   return (r.assetType || 'stock') === 'stock';
      if (_portFilter === 'etf')     return (r.assetType || 'stock') === 'etf';
      if (_portFilter === 'crypto')  return (r.assetType || 'stock') === 'crypto';
      if (_portFilter === 'roth_ira') return (r.accountType || 'taxable') === 'roth_ira';
      if (_portFilter === 'k401')    return (r.accountType || 'taxable') === 'k401';
      return true;
    });

    // ── Render table rows (PortfolioTracker style) ────────────────────────────
    if (!filteredRows.length) {
      listEl.innerHTML = `<div class="port-empty" style="padding:2rem 1rem;text-align:center;color:var(--muted)">No ${_portFilter === 'all' ? 'holdings' : _portFilter.replace('_',' ').replace('k401','401(k)')} found.</div>`;
      renderAllocation(rows);
      renderPortfolioChart();
      renderPortfolioAnalytics();
      return;
    }

    listEl.innerHTML = filteredRows.map(row => {
      const rUp       = row.pl >= 0;
      const iconCls   = _portIconCls(row);
      const acctLabel = _acctLabels[row.accountType] || row.accountType;
      const allocPct  = totalValue > 0 ? ((row.value / totalValue) * 100).toFixed(1) : '0.0';
      const plSign    = rUp ? '+' : '';
      const sharesStr = row.shares % 1 === 0 ? row.shares : parseFloat(row.shares.toFixed(6));

      const srcBadge = row.priceSource === 'live'
        ? `<span style="font-size:.55rem;color:var(--green);font-weight:700;vertical-align:middle;margin-left:.3rem">⚡</span>`
        : row.priceSource === 'sim'
        ? `<span style="font-size:.55rem;color:var(--gold);font-weight:700;vertical-align:middle;margin-left:.3rem" title="Simulated price">~</span>`
        : `<span style="font-size:.55rem;color:var(--red);font-weight:700;vertical-align:middle;margin-left:.3rem" title="Price unavailable">⚠</span>`;

      return `<div class="port-table-row new-cols">
        <div style="display:flex;align-items:center;gap:.65rem;min-width:0">
          <div class="port-icon ${iconCls}">${row.symbol.slice(0,4)}</div>
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
              <button class="port-sym-btn" onclick="window.loadPortfolioStock('${row.symbol}')">${row.symbol}</button>
              <span class="port-acct-badge ${row.accountType}">${acctLabel}</span>
            </div>
            <div style="font-size:.67rem;color:var(--muted);margin-top:.1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px">${row.name}</div>
          </div>
        </div>
        <div>
          <div style="font-weight:600">${sharesStr}</div>
          <div style="font-size:.62rem;color:var(--muted);margin-top:.06rem">${allocPct}% of port.</div>
        </div>
        <div>
          <div>$${_fmtD(row.buyPrice)}</div>
          <div style="font-size:.62rem;color:var(--muted);margin-top:.06rem">avg/share</div>
        </div>
        <div>
          <div style="font-weight:600">$${_fmtD(row.cost)}</div>
          <div style="font-size:.62rem;color:var(--muted);margin-top:.06rem">invested</div>
        </div>
        <div>
          <div style="font-weight:700">$${_fmtD(row.value)}${srcBadge}</div>
          <div style="font-size:.62rem;color:var(--muted);margin-top:.06rem">@ $${_fmtD(row.curPrice)}</div>
        </div>
        <div style="font-weight:700;color:${rUp?'var(--green)':'var(--red)'}">
          ${plSign}$${_fmtD(Math.abs(row.pl))}
        </div>
        <div style="font-weight:700;color:${rUp?'var(--green)':'var(--red)'}">
          ${plSign}${Math.abs(row.plPct).toFixed(2)}%
        </div>
        <div style="display:flex;flex-direction:column;gap:.32rem;align-items:center">
          <button class="port-act-btn edit" onclick="window.openEditHolding('${row.id}')" title="Edit">✎</button>
          <button class="port-act-btn del"  onclick="window.removeHolding('${row.id}')"   title="Remove">🗑</button>
        </div>
      </div>`;
    }).join('');

    renderAllocation(rows);
    renderPortfolioChart();
    renderPortfolioAnalytics();
  }

  function renderAllocation(rows) {
    const allocEl = document.getElementById('port-alloc-list');
    if (!allocEl || !rows.length) return;

    const totalValue = rows.reduce((s,r) => s + r.value, 0);
    if (!totalValue) return;

    // Group by assetType
    const typeMap = { stock:'#3b82f6', etf:'#06b6d4', crypto:'#f59e0b' };
    const typeLabels = { stock:'Stocks', etf:'ETFs', crypto:'Crypto' };
    const byType = {};
    rows.forEach(r => {
      const t = r.assetType || 'stock';
      byType[t] = (byType[t] || 0) + r.value;
    });

    // Group by account
    const acctMap  = { taxable:'#64748b', roth_ira:'#10b981', k401:'#d97706', crypto_wallet:'#f59e0b', other:'#475569' };
    const acctLabels= _acctLabels;
    const byAcct = {};
    rows.forEach(r => {
      const a = r.accountType || 'taxable';
      byAcct[a] = (byAcct[a] || 0) + r.value;
    });

    const renderGroup = (title, map, colorMap, labelMap) => {
      const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]);
      if (!entries.length) return '';
      return `<div style="margin-bottom:.9rem">
        <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:.55rem">${title}</div>
        ${entries.map(([key,val])=>{
          const pct = (val/totalValue*100).toFixed(1);
          const color = colorMap[key] || '#64748b';
          const label = labelMap[key] || key;
          return `<div class="alloc-item">
            <div class="alloc-row"><span class="alloc-name">${label}</span><span class="alloc-val">${pct}% · $${_fmtD(val)}</span></div>
            <div class="alloc-bar-bg"><div class="alloc-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          </div>`;
        }).join('')}
      </div>`;
    };

    allocEl.innerHTML =
      renderGroup('By Asset Type', byType, typeMap, typeLabels) +
      renderGroup('By Account',    byAcct, acctMap, acctLabels);
  }

  window.loadPortfolioStock = function(sym) { loadStock(sym); if(window.switchTab) window.switchTab(null,'dashboard'); };

  // ── Portfolio filter state ────────────────────────────────────────────────
  let _portFilter = 'all';

  window.setPortFilter = function(filter) {
    _portFilter = filter;
    // Update active tab styling
    document.querySelectorAll('.port-ftab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderPortfolio();
  };

  window.refreshPortfolio = function() { renderPortfolio(); showToast('Portfolio refreshed'); };

  window.toggleAddForm = function() {
    const form = document.getElementById('port-add-form');
    if (!form) return;
    form.classList.toggle('open');
    if (form.classList.contains('open')) document.getElementById('port-sym')?.focus();
  };

  window.addHolding = async function() {
    if (Auth.isGuest()) { showGuestModal(); return; }
    const sym     = (document.getElementById('port-sym')?.value || '').toUpperCase().trim();
    const name    = (document.getElementById('port-name')?.value || '').trim();
    const sh      = parseFloat(document.getElementById('port-shares')?.value);
    const price   = parseFloat(document.getElementById('port-price')?.value);
    const type    = document.getElementById('port-type')?.value    || 'stock';
    const account = document.getElementById('port-account')?.value || 'taxable';
    if (!sym || isNaN(sh) || sh <= 0 || isNaN(price) || price <= 0) {
      showToast('Fill in symbol, shares, and buy price'); return;
    }
    // Basic ticker validation — catch obvious typos (APPL vs AAPL, GOGLE vs GOOGL, etc.)
    const knownTickers = Object.keys(StockAPI.companyInfo || {});
    if (knownTickers.length && !knownTickers.includes(sym)) {
      const similar = knownTickers.filter(t => {
        // Levenshtein distance 1 — single char diff
        if (Math.abs(t.length - sym.length) > 1) return false;
        let diffs = 0;
        const s1 = sym.padEnd(5), s2 = t.padEnd(5);
        for (let i = 0; i < 5; i++) if (s1[i] !== s2[i]) diffs++;
        return diffs <= 1;
      }).slice(0, 3);
      const hint = similar.length ? `\n\nDid you mean: ${similar.join(', ')}?` : '\n\nDouble-check the ticker symbol.';
      if (!confirm(`⚠️ "${sym}" not found in known tickers.${hint}\n\nAdd it anyway?`)) return;
    }
    await Portfolio.add(sym, sh, price, account, type, name);
    ['port-sym','port-name','port-shares','port-price'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    document.getElementById('port-add-form')?.classList.remove('open');
    await renderPortfolio();
    showToast(`${sym} added to portfolio`);
  };

  window.removeHolding = async function(id) {
    if (!confirm('Remove this holding?')) return;
    await Portfolio.remove(id);
    await renderPortfolio();
    showToast('Holding removed');
  };

  window.openEditHolding = function(id) {
    const h = Portfolio.get().find(x => String(x.id) === String(id));
    if (!h) return;
    document.getElementById('edit-hold-id').value      = h.id;
    document.getElementById('edit-hold-sym').value     = h.symbol;
    document.getElementById('edit-hold-name').value    = h.name    || h.symbol;
    document.getElementById('edit-hold-shares').value  = h.shares;
    document.getElementById('edit-hold-price').value   = h.buyPrice;
    document.getElementById('edit-hold-type').value    = h.assetType   || 'stock';
    document.getElementById('edit-hold-account').value = h.accountType || 'taxable';
    document.getElementById('edit-hold-modal').classList.remove('hidden');
  };

  window.saveEditHolding = async function() {
    const id      = document.getElementById('edit-hold-id').value; // keep as string (MongoDB ObjectId)
    const name    = document.getElementById('edit-hold-name').value.trim();
    const shares  = parseFloat(document.getElementById('edit-hold-shares').value);
    const price   = parseFloat(document.getElementById('edit-hold-price').value);
    const type    = document.getElementById('edit-hold-type').value;
    const account = document.getElementById('edit-hold-account').value;
    if (isNaN(shares) || shares <= 0 || isNaN(price) || price <= 0) {
      showToast('Invalid shares or price'); return;
    }
    await Portfolio.update(id, { shares, buyPrice: price, assetType: type, accountType: account, name: name || undefined });
    document.getElementById('edit-hold-modal').classList.add('hidden');
    await renderPortfolio();
    showToast('Holding updated');
  };

  // ── Export CSV ────────────────────────────────────────────────────────────
  window.exportPortfolioCSV = async function() {
    const holdings = Portfolio.get();
    if (!holdings.length) { showToast('No holdings to export'); return; }
    const uniqueSyms = [...new Set(holdings.map(h=>h.symbol))];
    let priceData = {};
    try {
      const r = await fetch(`/api/portfolio-prices?symbols=${uniqueSyms.join(',')}`);
      if (r.ok) priceData = await r.json();
    } catch(e) {}
    const header = ['Symbol','Name','Shares','Avg Buy Price','Current Price','Market Value','P&L $','P&L %','Asset Type','Account'];
    const csvRows = [header, ...holdings.map(h => {
      const pd     = priceData[h.symbol] || {};
      const cur    = pd.price ?? h.buyPrice;
      const value  = h.shares * cur;
      const pl     = value - h.shares * h.buyPrice;
      const plPct  = h.buyPrice ? (pl / (h.shares * h.buyPrice)) * 100 : 0;
      return [h.symbol, h.name||h.symbol, h.shares, h.buyPrice.toFixed(2), cur.toFixed(2),
              value.toFixed(2), pl.toFixed(2), plPct.toFixed(2)+'%',
              h.assetType||'stock', h.accountType||'taxable'];
    })];
    const csv = csvRows.map(r=>r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `portfolio_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    showToast('Portfolio exported as CSV');
  };

  // ── Screener ──────────────────────────────────────────────────────────────
  window.setScrSector = function(btn) {
    document.querySelectorAll('.schip').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
  };

  // Expanded symbol pool for screener (50 stocks across sectors)
  const SCREENER_SYMS = [
    'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','NFLX','AMD','INTC',
    'JPM','BAC','GS','MS','WFC','V','MA','PYPL','COIN','AXP',
    'JNJ','PFE','UNH','ABBV','MRK','LLY','BMY','CVS','AMGN','GILD',
    'XOM','CVX','COP','SLB','OXY','NEE','DUK','SO','AEP','PCG',
    'DIS','UBER','LYFT','SPOT','SNAP','TWTR','PINS','RBLX','HOOD','MA',
  ];

  function _scrRSI(sym, period=14) {
    try {
      const bars = StockAPI._simCandles(sym, period + 5);
      if (bars.length < period + 1) return 50;
      let gains=0, losses=0;
      for (let i=bars.length-period; i<bars.length; i++) {
        const d = bars[i].close - bars[i-1].close;
        if (d>0) gains+=d; else losses-=d;
      }
      const avgG=gains/period, avgL=losses/period;
      return avgL===0 ? 100 : Math.round(100 - 100/(1+avgG/avgL));
    } catch { return 50; }
  }

  function _scrMktCap(price, sym) {
    const largeBase = { AAPL:3200, MSFT:3100, NVDA:2200, GOOGL:2100, AMZN:1900, META:1300, TSLA:800, V:550, MA:450, JPM:550 };
    if (largeBase[sym]) return largeBase[sym];
    if (price > 300) return 80 + Math.random()*120;
    if (price > 100) return 15 + Math.random()*70;
    return 2 + Math.random()*12;
  }

  window.runScreener = async function() {
    const grid = document.getElementById('scr-results'); if (!grid) return;
    grid.innerHTML = Array.from({length:10},()=>`
      <div class="scr-card" style="pointer-events:none">
        <div class="scr-card-inner"><div class="scr-card-front">
          <div class="scr-badge" style="background:rgba(255,255,255,0.05)"></div>
          <div class="scr-info">
            <div class="skel" style="width:55px;height:.82em;margin-bottom:.4rem"></div>
            <div class="skel" style="width:130px;height:.7em;margin-bottom:.3rem"></div>
            <div class="skel" style="width:80px;height:.65em"></div>
          </div>
          <div class="scr-metrics">
            <div class="skel" style="width:65px;height:.9em;margin-bottom:.35rem"></div>
            <div class="skel" style="width:50px;height:.75em"></div>
          </div>
        </div></div>
      </div>`).join('');

    const sectorBtn = document.querySelector('.schip.active');
    const sector    = sectorBtn ? sectorBtn.dataset.val : '';
    const perf      = document.getElementById('scr-perf')?.value || '';
    const rsiFilter = document.getElementById('scr-rsi')?.value || '';
    const mktCapF   = document.getElementById('scr-mktcap')?.value || '';
    const minPx     = parseFloat(document.getElementById('scr-min')?.value) || 0;
    const maxPx     = parseFloat(document.getElementById('scr-max')?.value) || Infinity;
    const sortBy    = document.getElementById('scr-sort')?.value || 'chg-desc';

    // Fetch quotes + compute RSI for all symbols in parallel
    const results = (await Promise.all(SCREENER_SYMS.map(async sym => {
      try {
        StockAPI._initSeed(sym);
        const info    = StockAPI.getCompanyInfo(sym);
        const q       = await StockAPI.getQuote(sym);
        const rsi     = _scrRSI(sym);
        const mktCap  = _scrMktCap(q.price, sym);
        const hi52    = +(q.price * (1.08 + Math.random()*0.28)).toFixed(2);
        const lo52    = +(q.price * (0.62 + Math.random()*0.24)).toFixed(2);
        const vol     = +(q.price * (800000 + Math.random()*5e6) / 1e6).toFixed(1);
        return { sym, name:info.name||sym, sector:info.sector||'Unknown', price:q.price, changePct:q.changePct, volume:q.volume||0, rsi, mktCap, hi52, lo52, vol };
      } catch { return null; }
    }))).filter(Boolean);

    let filtered = results;
    if (sector)              filtered = filtered.filter(r => (r.sector||'').toLowerCase().includes(sector.toLowerCase()));
    if (perf==='gainers')    filtered = filtered.filter(r => r.changePct > 0);
    if (perf==='losers')     filtered = filtered.filter(r => r.changePct < 0);
    if (perf==='big')        filtered = filtered.filter(r => Math.abs(r.changePct) >= 2);
    if (rsiFilter==='oversold')    filtered = filtered.filter(r => r.rsi < 30);
    if (rsiFilter==='neutral')     filtered = filtered.filter(r => r.rsi >= 30 && r.rsi <= 70);
    if (rsiFilter==='overbought')  filtered = filtered.filter(r => r.rsi > 70);
    if (mktCapF==='large')   filtered = filtered.filter(r => r.mktCap >= 100);
    if (mktCapF==='mid')     filtered = filtered.filter(r => r.mktCap >= 10 && r.mktCap < 100);
    if (mktCapF==='small')   filtered = filtered.filter(r => r.mktCap < 10);
    filtered = filtered.filter(r => r.price >= minPx && r.price <= maxPx);

    const sorters = {
      'chg-desc':   (a,b)=>b.changePct-a.changePct,
      'chg-asc':    (a,b)=>a.changePct-b.changePct,
      'price-desc': (a,b)=>b.price-a.price,
      'price-asc':  (a,b)=>a.price-b.price,
      'rsi-desc':   (a,b)=>b.rsi-a.rsi,
      'rsi-asc':    (a,b)=>a.rsi-b.rsi,
      'vol-desc':   (a,b)=>b.volume-a.volume,
    };
    filtered.sort(sorters[sortBy] || sorters['chg-desc']);

    const metaEl = document.getElementById('scr-meta');
    if (metaEl) metaEl.textContent = `${filtered.length} of ${results.length} stocks match your filters`;

    if (!filtered.length) { grid.innerHTML='<div class="scr-empty">No stocks match — try broadening your filters.</div>'; return; }

    const rsiCls = v => v < 30 ? 'rsi-low' : v > 70 ? 'rsi-high' : 'rsi-mid';
    const rsiLabel = v => v < 30 ? '😱 Oversold' : v > 70 ? '🔥 Overbought' : '⚖ Neutral';

    grid.innerHTML = filtered.map(r => {
      const up = r.changePct >= 0;
      const capStr = r.mktCap >= 1000 ? `$${(r.mktCap/1000).toFixed(1)}T` : `$${r.mktCap.toFixed(0)}B`;
      return `<div class="scr-card" data-tilt data-tilt-max="8" data-tilt-scale="1.02"
          onclick="window.selectSearch('${r.sym}');switchTab(null,'dashboard')">
        <div class="scr-card-inner">
          <div class="scr-card-front">
            <div class="scr-badge">${r.sym.slice(0,2)}</div>
            <div class="scr-info">
              <div class="scr-sym">${r.sym}</div>
              <div class="scr-name">${r.name}</div>
              <div class="scr-sector">${r.sector}</div>
              <span class="scr-rsi-badge ${rsiCls(r.rsi)}">RSI ${r.rsi} · ${rsiLabel(r.rsi)}</span>
            </div>
            <div class="scr-metrics">
              <div class="scr-price">$${r.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              <div class="scr-chg ${up?'up':'down'}">${up?'+':''}${r.changePct.toFixed(2)}%</div>
            </div>
          </div>
          <div class="scr-card-back">
            <div class="scr-back-row"><span class="scr-back-label">Mkt Cap</span><span class="scr-back-val">${capStr}</span></div>
            <div class="scr-back-row"><span class="scr-back-label">Volume</span><span class="scr-back-val">${r.vol}M</span></div>
            <div class="scr-back-row"><span class="scr-back-label">52W High</span><span class="scr-back-val" style="color:var(--green)">$${r.hi52}</span></div>
            <div class="scr-back-row"><span class="scr-back-label">52W Low</span><span class="scr-back-val" style="color:var(--red)">$${r.lo52}</span></div>
          </div>
        </div>
      </div>`;
    }).join('');
    if (typeof initTilt==='function') initTilt('[data-tilt]', grid);
    if (typeof animateCardsIn==='function') animateCardsIn('.scr-card', grid);
  };

  // ── Earnings Calendar ─────────────────────────────────────────────────────
  function renderEarnings() {
    const tbody = document.getElementById('earnings-tbody'); if (!tbody) return;
    const list = getEarningsCalendar();
    tbody.innerHTML = list.map(e=>{
      const upcoming = e.act===null;
      const rowCls = upcoming?'earn-upcoming':'earn-past';
      const badge  = upcoming?'<span class="earn-badge upcoming">Upcoming</span>':'<span class="earn-badge reported">Reported</span>';
      const actual = upcoming
        ? '<span style="color:var(--muted)">—</span>'
        : `<span class="${e.beat?'earn-beat':'earn-miss'}">${e.beat?'▲':'▼'} $${e.act.toFixed(2)}</span>`;
      const status = upcoming
        ? '<span style="color:var(--muted);font-size:.75rem">TBA</span>'
        : `<span class="${e.beat?'earn-beat':'earn-miss'}">${e.beat?'✓ Beat':'✗ Missed'}</span>`;
      return `<tr class="${rowCls}">
        <td><span class="earn-sym" onclick="window.selectSearch('${e.sym}');switchTab(null,'dashboard')">${e.sym}</span><br><span style="font-size:.7rem;color:var(--muted)">${e.name}</span></td>
        <td class="earn-date ${upcoming?'upcoming':'past'}">${e.date}</td>
        <td style="font-size:.75rem;color:var(--muted)">${e.time}</td>
        <td class="earn-est">$${e.est.toFixed(2)}</td>
        <td>${actual}</td>
        <td>${badge} ${status}</td>
      </tr>`;
    }).join('');
  }

  // ── News ──────────────────────────────────────────────────────────────────
  const NEWS_EMOJIS = ['📈','💹','🏦','📰','💼','🌐','📊','🔔','💡','🚀','⚡','🎯'];

  async function loadNews(sym) {
    const container = document.getElementById('news-list'); if (!container) return;
    container.innerHTML = '<div style="color:var(--muted);font-size:.85rem;padding:2rem;text-align:center;grid-column:1/-1">Loading news…</div>';
    const articles = await NewsAPI.fetch(newsMode==='stock'?sym:null);
    renderNews(articles, sym);
  }

  function renderNews(articles, sym) {
    const container = document.getElementById('news-list'); if (!container) return;
    if (!articles.length) { container.innerHTML='<div style="color:var(--muted);font-size:.85rem;padding:2rem;text-align:center;grid-column:1/-1">No news available</div>'; return; }
    container.innerHTML = articles.map((a,i)=>{
      const emoji = NEWS_EMOJIS[i%NEWS_EMOJIS.length];
      const imgContent = a.image
        ? `<img src="${a.image}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.textContent='${emoji}'">`
        : emoji;
      return `<a class="news-card" href="${a.url}" target="_blank" rel="noopener">
        <div class="news-card-img">${imgContent}</div>
        <div class="news-card-body">
          <div class="news-card-source">${a.source}</div>
          <div class="news-card-headline">${a.headline}</div>
          <div class="news-card-meta">
            <span>${NewsAPI.timeAgo(a.datetime)}</span>
            <span class="news-card-tag">${newsMode==='stock'?(sym||'Stock'):'Markets'}</span>
          </div>
        </div>
      </a>`;
    }).join('');
  }

  window.switchNews = function(btn, mode) {
    newsMode=mode;
    document.querySelectorAll('.news-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); loadNews(currentSymbol);
  };

  // ── Price Alerts ──────────────────────────────────────────────────────────
  PriceAlerts.requestPermission();

  function renderAlerts() {
    const list=PriceAlerts.get(), el=document.getElementById('alert-list'); if (!el) return;
    if (!list.length) { el.innerHTML='<div style="color:var(--muted);font-size:.82rem;padding:.5rem 0">No alerts set yet.</div>'; return; }
    el.innerHTML = list.map(a=>`
      <div class="alert-row">
        <span class="alert-sym">${a.symbol}</span>
        <span class="alert-dir-badge ${a.direction}">${a.direction==='above'?'↑ Above':'↓ Below'}</span>
        <span class="alert-price-val">$${a.targetPrice}</span>
        <span class="alert-status ${a.triggered?'triggered':''}">${a.triggered?'✓ Hit':'●'}</span>
        <button onclick="window.removeAlert(${a.id})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:1rem;line-height:1;margin-left:auto">×</button>
      </div>`).join('');
  }

  window.addAlert = function() {
    if (Auth.isGuest()) { showGuestModal(); return; }
    const sym=(document.getElementById('alert-sym')?.value||currentSymbol).toUpperCase().trim();
    const price=parseFloat(document.getElementById('alert-price')?.value);
    const dir=document.getElementById('alert-dir')?.value||'above';
    if (!sym||isNaN(price)||price<=0) { showToast('Fill in symbol and target price'); return; }
    PriceAlerts.add(sym,price,dir);
    document.getElementById('alert-sym').value=''; document.getElementById('alert-price').value='';
    renderAlerts(); showToast(`Alert set: ${sym} ${dir} $${price}`);
  };

  window.removeAlert = function(id) { PriceAlerts.remove(id); renderAlerts(); };

  function checkAlertsForPrice(symbol, price) {
    const fired=PriceAlerts.check(symbol,price);
    fired.forEach(a=>{
      PriceAlerts.notify(a);
      NotifCenter.push(
        `${symbol} Alert Triggered`,
        `${symbol} crossed $${a.price.toFixed(2)} (${a.direction}). Current: $${price.toFixed(2)}`,
        price >= a.price ? 'up' : 'down'
      );
    });
    if (fired.length) renderAlerts();
  }

  // ── SMA overlays ──────────────────────────────────────────────────────────
  window.toggleSMA = function(btn, period, color) {
    if (!window._chart||!window.fullBars) return;
    const active=ChartOverlays.toggle(window._chart,window.fullBars,period,color);
    btn.classList.toggle(`active-sma${period}`,active);
  };
  const smaButtons = document.querySelectorAll('.ind-btn');
  function clearSMAUI() {
    if (window._chart) ChartOverlays.clear(window._chart);
    smaButtons.forEach(b=>b.classList.remove('active-sma20','active-sma50','active-sma200'));
  }

  // ── Theme toggle ──────────────────────────────────────────────────────────
  window.toggleTheme = function() {
    const light = document.body.classList.toggle('light');
    localStorage.setItem('stockai_theme', light?'light':'dark');
    document.getElementById('theme-toggle').textContent = light?'☀️':'🌙';
  };

  // ── Search ────────────────────────────────────────────────────────────────
  const searchInput=document.getElementById('stock-search'), searchDrop=document.getElementById('search-dropdown');
  searchInput.addEventListener('input',()=>{
    const q=searchInput.value.toUpperCase().trim();
    if (!q) { searchDrop.classList.add('hidden'); return; }
    const matches=StockAPI.popularSymbols.filter(s=>s.includes(q)||StockAPI.getCompanyInfo(s).name.toUpperCase().includes(q)).slice(0,6);
    if (!matches.length) { searchDrop.classList.add('hidden'); return; }
    searchDrop.innerHTML=matches.map(s=>{const info=StockAPI.getCompanyInfo(s);return `<div class="search-item" onclick="window.selectSearch('${s}')"><b>${s}</b><span>${info.name}</span></div>`;}).join('');
    searchDrop.classList.remove('hidden');
  });

  window.selectSearch = function(sym) {
    searchDrop.classList.add('hidden'); clearSMAUI(); loadNews(sym); loadStock(sym);
  };

  document.addEventListener('click',e=>{ if (!searchInput.contains(e.target)&&!searchDrop.contains(e.target)) searchDrop.classList.add('hidden'); });
  searchInput.addEventListener('keydown',e=>{ if (e.key==='Enter'){ const q=searchInput.value.toUpperCase().trim(); if(q){searchDrop.classList.add('hidden');loadStock(q);} } });

  // ── Watchlist add (dashboard tab) ─────────────────────────────────────────
  document.getElementById('btn-add-watch').addEventListener('click', async ()=>{
    if (Auth.isGuest()) { showGuestModal(); return; }
    await Auth.addToWatchlist(currentSymbol); updateWatchlistUI(); showToast(`${currentSymbol} added to watchlist`);
  });

  // ── Logout / Sidebar ─────────────────────────────────────────────────────
  document.getElementById('btn-logout').addEventListener('click',()=>{ StockAPI.unsubscribeAll(); Auth.logout(); });
  document.getElementById('sidebar-toggle').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));

  // ── API Key modal ─────────────────────────────────────────────────────────
  document.getElementById('btn-api').addEventListener('click',e=>{
    e.preventDefault(); document.getElementById('api-modal').classList.remove('hidden');
    fetch('/api/status').then(r=>r.json()).then(s=>{
      const el=document.getElementById('server-status-msg'); if (!el) return;
      el.textContent=s.hasKey?`✅ Server connected — Finnhub key is set${s.wsConnected?', WebSocket live':''}`:'❌ No key — add FINNHUB_KEY to .env and restart';
      el.style.color=s.hasKey?'var(--green)':'var(--red)';
    }).catch(()=>{ const el=document.getElementById('server-status-msg'); if(el){el.textContent='⚠️ Cannot reach server — open via npm start';el.style.color='var(--gold)';} });
  });
  document.getElementById('close-api-modal').addEventListener('click',()=>document.getElementById('api-modal').classList.add('hidden'));

  // ── Toast & Guest modal ───────────────────────────────────────────────────
  window.showToast = function(msg) {
    const t=document.getElementById('toast');
    t.textContent=msg; t.classList.remove('hidden'); t.classList.add('show');
    setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.classList.add('hidden'),400);},2800);
  };
  window.showGuestModal = function() { document.getElementById('guest-modal').classList.remove('hidden'); };
  document.getElementById('guest-modal')?.addEventListener('click',e=>{ if(e.target===e.currentTarget) e.currentTarget.classList.add('hidden'); });

  // ── Tab event listener ────────────────────────────────────────────────────
  let marketsLoaded=false, trendingLoaded=false;
  document.addEventListener('stockai:tab', async e=>{
    const tab=e.detail;
    if (tab==='watchlist')  renderWatchlistTab();
    else if (tab==='portfolio') { renderPortfolio(); }
    else if (tab==='markets')   { marketsLoaded=true; renderMarketsTab(); }
    else if (tab==='news')      loadNews(currentSymbol);
    else if (tab==='trending')  { if(!trendingLoaded){trendingLoaded=true;renderTrending();} renderWatchlistMini(); renderAlerts(); }
    else if (tab==='ai')        { if(currentBars.length>=50) runAI(); renderEarnings(); }
    else if (tab==='screener')  { runScreener(); }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function volData(bars){ return bars.map(b=>({time:b.time,value:b.volume,color:b.close>=b.open?'rgba(0,255,136,0.3)':'rgba(255,68,102,0.3)'})); }
  function fmtVol(v){ if(v>=1e9)return(v/1e9).toFixed(2)+'B'; if(v>=1e6)return(v/1e6).toFixed(2)+'M'; if(v>=1e3)return(v/1e3).toFixed(1)+'K'; return v; }
  function showChartLoader(show) {
    let el=document.getElementById('chart-loader');
    if (!el){ el=document.createElement('div'); el.id='chart-loader'; el.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,11,31,0.7);border-radius:10px;font-size:.85rem;color:#64748b;z-index:10;pointer-events:none'; el.innerHTML='<span>⟳ Loading chart data…</span>'; const cw=document.getElementById('price-chart'); cw.style.position='relative'; cw.appendChild(el); }
    el.style.display=show?'flex':'none';
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  // Restore saved theme
  if (localStorage.getItem('stockai_theme')==='light') {
    document.body.classList.add('light');
    const btn=document.getElementById('theme-toggle'); if(btn) btn.textContent='☀️';
  }

  if (Auth.isAdmin()) document.getElementById('btn-api').style.display='';
  initChart();
  document.getElementById('loading-screen').style.display='none';

  await updateMarket();
  const _prefs = JSON.parse(localStorage.getItem('stockai_prefs') || '{}');
  await loadStock(_prefs.defaultStock || 'AAPL');

  renderPortfolio();
  loadNews(currentSymbol);
  renderAlerts();
  renderEarnings();

  // New features boot
  NotifCenter.init();
  renderTickerTape();
  renderDailyBriefing();

  marketInterval = setInterval(updateMarket, 30000);

  // Auto-refresh portfolio prices every 30 s (silent — no loading spinner)
  setInterval(() => {
    if (document.getElementById('view-portfolio')?.classList.contains('active')) {
      renderPortfolio(true);
    }
  }, 30000);

  // Init tilt on static cards
  if (typeof initTilt === 'function') initTilt('[data-tilt]');

  // Init chat widget
  if (typeof StockChat !== 'undefined') {
    StockChat.init(currentSymbol, currentBars);
    const chatInput = document.getElementById('chat-input');
    if (chatInput) chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') StockChat.send(); });
  }

  // ── 3D Candlestick Chart ──────────────────────────────────────────────────
  window.toggle3DChart = function() {
    const wrap2d = document.getElementById('price-chart');
    const wrap3d = document.getElementById('chart-3d-wrap');
    const btn    = document.getElementById('btn-3d');
    if (!wrap2d || !wrap3d) return;
    const is3d = wrap3d.style.display !== 'none';
    if (is3d) {
      wrap3d.style.display = 'none';
      wrap2d.style.display = '';
      btn.classList.remove('active');
      if (window._3dAnimId) { cancelAnimationFrame(window._3dAnimId); window._3dAnimId = null; }
      if (window._3dRenderer) { window._3dRenderer.dispose(); window._3dRenderer = null; }
    } else {
      wrap2d.style.display = 'none';
      wrap3d.style.display = '';
      btn.classList.add('active');
      init3DChart();
    }
  };

  function init3DChart() {
    if (typeof THREE === 'undefined') { showToast('3D library not loaded', true); return; }
    const bars = (window.fullBars || []).slice(-45);
    if (!bars.length) { showToast('Load a stock first'); return; }

    const canvas = document.getElementById('chart-3d');
    const W = canvas.parentElement.clientWidth || 800, H = 340;
    canvas.width = W * window.devicePixelRatio;
    canvas.height = H * window.devicePixelRatio;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x050b1f, 1);
    window._3dRenderer = renderer;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 500);
    camera.position.set(0, 18, 32);
    camera.lookAt(0, 3, 0);

    // Lighting
    scene.add(new THREE.AmbientLight(0x1a2a6a, 3));
    const sun = new THREE.DirectionalLight(0x00d4ff, 4); sun.position.set(8, 20, 12); scene.add(sun);
    const rim = new THREE.DirectionalLight(0x00ff88, 2); rim.position.set(-8, 4, -8); scene.add(rim);

    // Floor grid
    const grid = new THREE.GridHelper(bars.length * 1.3, bars.length, 0x0d2040, 0x071428);
    grid.position.y = -0.05;
    scene.add(grid);

    // Normalize
    const allP  = bars.flatMap(b => [b.open, b.high, b.low, b.close]);
    const minP  = Math.min(...allP), maxP = Math.max(...allP), range = maxP - minP || 1;
    const norm  = v => ((v - minP) / range) * 11;
    const startX = -(bars.length * 1.2) / 2;

    const allMeshes = [];
    bars.forEach((bar, i) => {
      const x   = startX + i * 1.2;
      const up  = bar.close >= bar.open;
      const col = up ? 0x00ff88 : 0xff4466;

      // Body
      const bH  = Math.max(0.06, Math.abs(norm(bar.close) - norm(bar.open)));
      const bY  = norm(Math.min(bar.open, bar.close)) + bH / 2;
      const bGeo = new THREE.BoxGeometry(0.75, bH, 0.75);
      const bMat = new THREE.MeshPhongMaterial({ color: col, emissive: col, emissiveIntensity: 0.18, shininess: 70 });
      const body = new THREE.Mesh(bGeo, bMat);
      body.position.set(x, bY, 0);
      body.scale.y = 0; // start flat, animate up
      scene.add(body);
      allMeshes.push({ mesh: body, targetY: bH, animated: false });

      // Wick
      const wH  = Math.max(0.04, norm(bar.high) - norm(bar.low));
      const wGeo = new THREE.BoxGeometry(0.08, wH, 0.08);
      const wMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.65 });
      const wick = new THREE.Mesh(wGeo, wMat);
      wick.position.set(x, norm(bar.low) + wH / 2, 0);
      scene.add(wick);
    });

    // Mouse drag orbit
    let isDragging = false, prevX = 0, prevY = 0, rotY = 0, rotX = 0.28;
    canvas.addEventListener('mousedown', e => { isDragging = true; prevX = e.clientX; prevY = e.clientY; });
    window.addEventListener('mouseup',   () => { isDragging = false; });
    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      rotY += (e.clientX - prevX) * 0.008;
      rotX  = Math.max(0.05, Math.min(0.7, rotX + (e.clientY - prevY) * 0.005));
      prevX = e.clientX; prevY = e.clientY;
    });
    canvas.addEventListener('wheel', e => {
      camera.position.z = Math.max(12, Math.min(60, camera.position.z + e.deltaY * 0.06));
    }, { passive: true });

    const R = 32;
    let frame = 0;
    function animate3d() {
      if (!window._3dRenderer) return;
      window._3dAnimId = requestAnimationFrame(animate3d);
      frame++;

      // Grow bars in on first frames
      allMeshes.forEach((m, i) => {
        if (frame > i * 1.2 && m.mesh.scale.y < 1) {
          m.mesh.scale.y = Math.min(1, m.mesh.scale.y + 0.08);
          m.mesh.position.y = m.targetY * m.mesh.scale.y / 2 + norm(0);
        }
      });

      // Slow auto-rotate when not dragging
      if (!isDragging) rotY += 0.004;

      camera.position.x = Math.sin(rotY) * Math.cos(rotX) * R;
      camera.position.z = Math.cos(rotY) * Math.cos(rotX) * R;
      camera.position.y = Math.sin(rotX) * R * 0.6;
      camera.lookAt(0, 4, 0);
      renderer.render(scene, camera);
    }
    animate3d();
  }
});
