// Dashboard — verified prices; no fabricated chart or ticker values
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

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
  function renderResearchMetrics(id, items) {
    const host=document.getElementById(id);
    if(!host)return;
    host.replaceChildren();
    for(const item of items){
      const box=document.createElement('div');
      box.className='research-metric';
      const label=document.createElement('small');
      label.textContent=item.label;
      const value=document.createElement('strong');
      value.textContent=item.value;
      box.append(label,value);host.appendChild(box);
    }
  }

  const safeExternalLink = value => {
    try {
      const url = new URL(value, location.origin);
      return ['https:','http:'].includes(url.protocol) ? escapeHTML(url.href) : '#';
    } catch (_) { return '#'; }
  };

  let currentSymbol = 'AAPL';
  let stockRequestVersion = 0;
  let verifiedPrevClose = null;
  let chart = null;
  let candleSeries = null;
  let volumeSeries = null;
  let simInterval = null;
  let marketInterval = null;
  let currentBars = [];
  let newsMode = 'stock';
  let newsRequestVersion = 0;
  let claudeAnalysisVersion = 0;
  let claudeBusy = false;
  let activePrediction = null;
  let activePredictionSymbol = null;

  // Compare mode state
  let compareSeries = null;
  let compareActive = false;

  // Markets tab groups
  const MARKET_GROUPS = {
    indices:    [{ sym:'SPY',name:'S&P 500 ETF'},{ sym:'QQQ',name:'NASDAQ 100'},{ sym:'DIA',name:'Dow Jones ETF'},{ sym:'IWM',name:'Russell 2000'}],
    sectors:    [{ sym:'XLK',name:'Technology'},{ sym:'XLF',name:'Financials'},{ sym:'XLV',name:'Health Care'},{ sym:'XLE',name:'Energy'},{ sym:'XLI',name:'Industrials'},{ sym:'XLY',name:'Consumer Disc.'},{ sym:'XLRE',name:'Real Estate'},{ sym:'XLB',name:'Materials'}],
    commodities:[{ sym:'GLD',name:'Gold ETF'},{ sym:'USO',name:'Oil ETF'},{ sym:'SLV',name:'Silver ETF'},{ sym:'UNG',name:'Natural Gas'},{ sym:'PDBC',name:'Commodities'}],
  };

  // ── WebSocket status ──────────────────────────────────────────────────────
  const wsBadge = document.getElementById('ws-badge');
  function setWsStatus(state) {
    if (!wsBadge) return;
    const map = { connected:{text:'● STREAM LIVE',cls:'ws-live'}, disconnected:{text:'○ STREAM OFFLINE',cls:'ws-sim'}, error:{text:'⚠ STREAM ERROR',cls:'ws-error'}, connecting:{text:'… CONNECTING',cls:'ws-conn'} };
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
      grid: { vertLines:{color:'rgba(132,157,193,0.07)'}, horzLines:{color:'rgba(132,157,193,0.07)'} },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor:'rgba(132,157,193,0.2)', scaleMargins:{top:0.08,bottom:0.22} },
      timeScale: { borderColor:'rgba(132,157,193,0.2)', timeVisible:true },
    });
    candleSeries = chart.addCandlestickSeries({ upColor:'#4bbf8d', downColor:'#e27889', borderUpColor:'#4bbf8d', borderDownColor:'#e27889', wickUpColor:'#4bbf8d', wickDownColor:'#e27889' });
    volumeSeries = chart.addHistogramSeries({ priceFormat:{type:'volume'}, priceScaleId:'', scaleMargins:{top:0.82,bottom:0} });
    window._chart = chart; window._candleSeries = candleSeries; window._volSeries = volumeSeries;
    window.addEventListener('resize', resizeChart);
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        if (container.clientWidth >= 90 && container.offsetParent !== null) resizeChart();
      });
      observer.observe(container.parentElement || container);
    }
    applyChartTheme();
  }


  // Keep the chart legible when its tab changes visibility, the sidebar
  // opens/closes, a phone rotates or the user changes color mode.
  function resizeChart() {
    const host = document.getElementById('price-chart');
    if (!chart || !host || host.clientWidth < 90 || host.offsetParent === null) return;
    chart.applyOptions({ width: host.clientWidth, height: host.clientHeight || 320 });
  }

  function applyChartTheme() {
    if (!chart) return;
    const light = document.body.classList.contains('light');
    chart.applyOptions({
      layout: { background:{type:'solid',color:light?'#f6fafb':'#0d1823'}, textColor:light?'#526b7e':'#9eb0bd' },
      grid: {
        vertLines:{color:light?'rgba(56,91,110,0.08)':'rgba(111,152,168,0.10)'},
        horzLines:{color:light?'rgba(56,91,110,0.08)':'rgba(111,152,168,0.10)'}
      },
      rightPriceScale:{borderColor:light?'#cedee4':'#284251'},
      timeScale:{borderColor:light?'#cedee4':'#284251'}
    });
    candleSeries?.applyOptions({
      upColor:light?'#158568':'#4bbf8d',downColor:light?'#c13d51':'#ff7784',
      borderUpColor:light?'#158568':'#4bbf8d',borderDownColor:light?'#c13d51':'#ff7784',
      wickUpColor:light?'#158568':'#4bbf8d',wickDownColor:light?'#c13d51':'#ff7784'
    });
    resizeChart();
  }

  // ── Load stock ────────────────────────────────────────────────────────────
  async function loadStock(symbol) {
    symbol = symbol.toUpperCase().trim();
    if (!symbol) return;
    StockAPI.unsubscribeAll(); clearInterval(simInterval);
    currentSymbol = symbol;
    claudeAnalysisVersion++;
    claudeBusy = false;
    activePrediction = null;
    activePredictionSymbol = null;
    const claudeButton = document.getElementById('btn-claude-explain');
    if (claudeButton) { claudeButton.disabled = false; claudeButton.textContent='✦ Explain with AI'; }
    resetEvidenceUI();
    const requestVersion = ++stockRequestVersion;
    verifiedPrevClose = null;

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
    if (requestVersion !== stockRequestVersion) return;
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
    let loadedBars = [];
    try { loadedBars = await StockAPI.getCandles(symbol,'D',365); }
    catch (e) { console.warn('Chart unavailable:', e.message); }
    // A slow older response must not overwrite the newer ticker selection.
    if (requestVersion !== stockRequestVersion) return;
    currentBars = loadedBars;
    window.fullBars = currentBars;

    candleSeries.setData(currentBars);
    volumeSeries.setData(currentBars.length ? volData(currentBars) : []);
    if (currentBars.length) chart.timeScale().fitContent();
    showChartLoader(false);
    showChartUnavailable(!currentBars.length);
    if (typeof StockChat !== 'undefined') StockChat.setContext(symbol, currentBars);

    // Clear any active compare so the second line doesn't linger
    if (compareSeries) clearCompare();

    await refreshQuote();
    if (requestVersion !== stockRequestVersion) return;
    if (currentBars.length >= 50) runAI();
    else {
      const q=document.getElementById('quick-direction');
      if(q){q.textContent='○ NO SIGNAL DATA';q.className='ai-dir-badge neutral';}
      const c=document.getElementById('quick-conf-text');
      if(c)c.textContent='Indicator score: —';
      ['q-buy','q-sell','q-neutral'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='—';});
    }
    updateWatchlistUI();
    if (newsMode === 'stock') loadNews(symbol);

    if (location.host && StockAPI._wsStatus === 'connected') {
      StockAPI.subscribeSymbol(symbol, onWSTrade);
    } else {
      // Streaming unavailable: keep the last verified quote, never simulate trades.
      simInterval = null;
    }
  }

  function switchToLive() { clearInterval(simInterval); simInterval = null; StockAPI.subscribeSymbol(currentSymbol, onWSTrade); }

  // ── Real-time handlers ────────────────────────────────────────────────────
  function onWSTrade({ price, volume, time }) {
    if (!Number.isFinite(price) || price <= 0) return;
    const nowSec = Math.floor((time||Date.now())/1000);
    const close  = +price.toFixed(4);
    const dayBucket = Math.floor(nowSec/86400)*86400;
    const last = currentBars[currentBars.length-1];
    if (last && dayBucket < last.time) return;
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

  function updatePriceDisplay(price) {
    if(!Number.isFinite(price)||price<=0)return;
    document.getElementById('stock-price').textContent='$'+price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    const el=document.getElementById('stock-change');
    if(!Number.isFinite(verifiedPrevClose)||verifiedPrevClose<=0){
      el.textContent='Previous close unavailable';
      return;
    }
    const change=price-verifiedPrevClose,percent=(change/verifiedPrevClose)*100;
    const up=change>=0;
    el.textContent=(up?'+':'')+change.toFixed(2)+' ('+(up?'+':'')+percent.toFixed(2)+'%)';
    el.className='stock-change '+(up?'up':'down');
  }

  async function refreshQuote() {
    const symbol = currentSymbol;
    const fmt = n => Number.isFinite(n) && n > 0 ? '$' + n.toFixed(2) : '—';
    try {
      const q = await StockAPI.getQuote(symbol);
      if (currentSymbol !== symbol) return;
      const up = q.changePct >= 0;
      verifiedPrevClose = q.prevClose > 0 ? q.prevClose : null;
      document.getElementById('stock-price').textContent = fmt(q.price);
      const change = document.getElementById('stock-change');
      change.textContent = (up?'+':'') + q.change.toFixed(2) + ' (' + (up?'+':'') + q.changePct.toFixed(2) + '%)';
      change.className = 'stock-change ' + (up?'up':'down');
      document.getElementById('stat-high').textContent = fmt(q.high);
      document.getElementById('stat-low').textContent = fmt(q.low);
      document.getElementById('stat-open').textContent = fmt(q.open);
      document.getElementById('stat-volume').textContent = q.volume ? fmtVol(q.volume) : '—';
      document.getElementById('data-source').textContent = '● Verified provider quote · latest available';
      const badge = document.getElementById('market-data-status');
      if (badge) { badge.textContent='● QUOTES AVAILABLE'; badge.className='ready'; }
    } catch (error) {
      if (currentSymbol !== symbol) return;
      document.getElementById('stock-price').textContent = '—';
      document.getElementById('stock-change').textContent = 'Quote unavailable';
      for (const id of ['stat-high','stat-low','stat-open','stat-volume'])
        document.getElementById(id).textContent = '—';
      document.getElementById('data-source').textContent = '⚠ Provider quote unavailable. Please retry.';
      const badge = document.getElementById('market-data-status');
      if (badge) { badge.textContent='⚠ QUOTE OFFLINE'; badge.className='offline'; }
      console.warn(error.message);
    }
  }

  // ── AI Prediction ─────────────────────────────────────────────────────────
  function runAI() {
    if (currentBars.length < 50) return;
    const prediction = AIPredictor.predict(currentBars);
    activePrediction = prediction;
    activePredictionSymbol = currentSymbol;
    renderAI(prediction);
    // No automatic billable LLM call on every page load or tab visit:
    // local indicator explanations are always available at no extra cost.
    renderFallbackReasoning(prediction);
  }

  window.explainWithAI = async function () {
    if(!activePrediction || activePredictionSymbol !== currentSymbol){
      showToast('Load a verified stock chart before requesting commentary.');
      return;
    }
    if(Auth.isGuest()){
      showToast('Sign in to request optional AI commentary.');
      return;
    }
    if(claudeBusy)return;
    claudeBusy=true;
    const button=document.getElementById('btn-claude-explain');
    if(button){button.disabled=true;button.textContent='Analyzing indicators…';}
    const version=++claudeAnalysisVersion;
    try{
      const price=currentBars[currentBars.length-1]?.close;
      await fetchClaudeAnalysis(currentSymbol,price,activePrediction,version);
    }finally{
      if(version===claudeAnalysisVersion){
        claudeBusy=false;
        if(button){button.disabled=false;button.textContent='✦ Explain with AI';}
      }
    }
  };

  async function fetchClaudeAnalysis(symbol, price, prediction, version) {
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
          headers: Auth._authHeader(),
          body: JSON.stringify({ symbol, price, prediction }),
          signal: ctrl.signal
        });
      } finally { clearTimeout(timer); }

      // 503 = API key not configured — show fallback badge immediately, no error noise
      if (resp.status === 503) {
        if(version===claudeAnalysisVersion && symbol===currentSymbol){
          renderFallbackReasoning(prediction);
          showToast('Optional AI commentary is not configured.');
        }
        return;
      }

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      if(version!==claudeAnalysisVersion || symbol!==currentSymbol)return;
      // ── Render Claude's analysis ──────────────────────────────────────
      const driversHtml = Array.isArray(data.key_drivers) && data.key_drivers.length
        ? `<ul class="claude-drivers">${data.key_drivers.slice(0,5).map(d => `<li>${escapeHTML(d)}</li>`).join('')}</ul>`
        : '';

      const riskHtml = data.risk
        ? `<div class="claude-risk"><span class="claude-label">⚠ RISK</span>${escapeHTML(data.risk)}</div>`
        : '';

      const watchHtml = data.watch
        ? `<div class="claude-watch"><span class="claude-label">👁 WATCH</span>${escapeHTML(data.watch)}</div>`
        : '';

      reasonEl.innerHTML = `
        <div class="claude-badge">✦ Claude AI</div>
        <p class="claude-summary">${escapeHTML(data.summary)}</p>
        ${driversHtml}
        ${riskHtml}
        ${watchHtml}`;

    } catch (err) {
      // Network error / timeout / parse failure — fall back gracefully
      if(version===claudeAnalysisVersion && symbol===currentSymbol){
        renderFallbackReasoning(prediction);
        showToast('AI commentary unavailable; local technical explanation is shown.');
      }
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
      ${r.reasoning.map(l => `<p>${escapeHTML(l)}</p>`).join('')}`;
  }

  function renderAI(r) {
    const vc = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };

    // Direction pill
    const dirEl = document.getElementById('ai-direction');
    if (dirEl) {
      const labels = { UP:'▲ BULLISH SETUP', DOWN:'▼ BEARISH SETUP', NEUTRAL:'● MIXED SETUP' };
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
      grad.addColorStop(0,'#e27889'); grad.addColorStop(0.5,'#d9b676'); grad.addColorStop(1,'#4bbf8d');
      ctx.beginPath(); ctx.arc(cx,cy,R,Math.PI,0,false);
      ctx.lineWidth=lw; ctx.strokeStyle=grad; ctx.globalAlpha=0.18; ctx.stroke();
      ctx.globalAlpha=1;

      // Filled portion
      const conf = r.confidence/100;
      const startAngle = Math.PI;
      const endAngle = Math.PI + conf * Math.PI;
      const color = r.direction==='UP'?'#4bbf8d':r.direction==='DOWN'?'#e27889':'#d9b676';
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
      ctx.fillText('INDICATOR SCORE', cx, cy-4);

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

    // ATR scenarios are risk bands, NOT modeled price forecasts.
    const curPrice = currentBars.length ? currentBars[currentBars.length-1].close : 0;
    if (curPrice) {
      const atr = curPrice * (r.atrPct || 0) / 100;
      const bear = atr > 0 ? Math.max(0,curPrice-2*atr) : null;
      const bull = atr > 0 ? curPrice+2*atr : null;
      vc('pt-bear',bear===null?'—':'$'+bear.toFixed(2));
      vc('pt-bull',bull===null?'—':'$'+bull.toFixed(2));
      vc('pt-current','$'+curPrice.toFixed(2));
      const dotEl = document.getElementById('pt-dot');
      if (dotEl) dotEl.style.left='50%';
    }

    // Risk needle
    const riskPct = r.atrPct ? Math.min(100, parseFloat(r.atrPct) / 4 * 100) : 50;
    const riskColor = riskPct < 35 ? '#4bbf8d' : riskPct < 65 ? '#d9b676' : '#e27889';
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
      return `<tr><td>${escapeHTML(s.name)}</td><td class="val">${escapeHTML(s.value)}</td><td><span class="sig-badge ${cls}">${arrow} ${escapeHTML(s.signal)}</span></td></tr>`;
    }).join('');

    const reasonEl = document.getElementById('ai-reasoning');
    if (reasonEl) reasonEl.innerHTML = r.reasoning.map(l=>`<p>${escapeHTML(l)}</p>`).join('');

    // Candlestick patterns
    if (r.patterns && r.patterns.length) {
      const existing = document.getElementById('pattern-row');
      if (existing) existing.remove();
      const pRow = document.createElement('tr'); pRow.id='pattern-row';
      pRow.innerHTML = `<td colspan="3" style="padding:.6rem .5rem"><span style="font-size:.72rem;color:var(--muted);font-weight:600">Patterns: </span>${r.patterns.map(p=>`<span class="sig-badge ${p.bull?'sig-buy':'sig-sell'}" style="margin:.1rem">${escapeHTML(p.name)}</span>`).join(' ')}</td>`;
      if (tbody) tbody.appendChild(pRow);
    }

    // Quick AI card on dashboard tab
    const qDir = document.getElementById('quick-direction');
    if (qDir) {
      qDir.textContent = r.direction==='UP'?'▲ BULLISH':r.direction==='DOWN'?'▼ BEARISH':'● NEUTRAL';
      qDir.className = `ai-dir-badge ${r.direction==='UP'?'up':r.direction==='DOWN'?'down':'neutral'}`;
    }
    vc('quick-conf-text',`Indicator score: ${r.confidence}% (not probability)`);
    vc('q-buy',r.buyCount); vc('q-sell',r.sellCount); vc('q-neutral',r.neutralCount);
  }

  // ── On-demand walk-forward evidence (historical, never marketed as certainty)
  let evidenceRequest = 0;
  function resetEvidenceUI() {
    evidenceRequest++;
    const results = document.getElementById('evidence-results');
    const status = document.getElementById('evidence-status');
    if (results) results.hidden = true;
    if (status) {
      status.className = 'evidence-status';
      status.textContent = 'Select Run Historical Check to inspect ' + currentSymbol + ' using earlier market data.';
    }
    const button = document.getElementById('btn-backtest');
    if (button) { button.disabled = false; button.textContent = 'Run Historical Check →'; }
  }

  window.runHistoricalCheck = async function () {
    if (!currentSymbol || typeof SignalEvidence === 'undefined') return;
    const symbol = currentSymbol, request = ++evidenceRequest;
    const status = document.getElementById('evidence-status');
    const results = document.getElementById('evidence-results');
    const button = document.getElementById('btn-backtest');
    const format = value => value == null ? '—' : (value >= 0 ? '+' : '') + value.toFixed(2) + '%';
    if (results) results.hidden = true;
    if (button) { button.disabled = true; button.textContent = 'Checking history…'; }
    if (status) { status.className = 'evidence-status'; status.textContent = 'Fetching up to three years of verified daily candles for ' + symbol + '…'; }
    try {
      const history = await StockAPI.getCandles(symbol,'D',1095);
      if (request !== evidenceRequest || symbol !== currentSymbol) return;
      const report = await SignalEvidence.evaluateAsync(history, (done,total) => {
        if (status && request === evidenceRequest) status.textContent =
          'Replaying historical signals: ' + done + ' of ' + total + ' windows…';
      });
      if (request !== evidenceRequest || symbol !== currentSymbol) return;
      if (!report.evaluations || report.directionalSignals < 1) {
        if (status) {
          status.className = 'evidence-status warning';
          status.textContent = 'Not enough complete price history or non-neutral signals to evaluate. No historical accuracy is claimed.';
        }
        return;
      }
      const set=(id,value)=>{
        const el=document.getElementById(id);if(el)el.textContent=value;
      };
      // Avoid marketing tiny-sample noise as a meaningful accuracy figure.
      const enough = report.evidenceLevel !== 'insufficient';
      set('evidence-hit', enough ? report.hitRatePct.toFixed(1) + '%' : 'Not enough');
      set('evidence-hit-ci', enough
        ? '95% Wilson interval: ' + report.hitRate95Pct.join('–') + '%'
        : 'At least 10 directional samples required');
      set('evidence-n', String(report.directionalSignals));
      set('evidence-window', report.evaluations + ' sampled windows · ' + report.neutralSignals + ' neutral');
      set('evidence-strategy',enough ? format(report.avgDirectionalReturnPct) : '—');
      set('evidence-benchmark',enough ? format(report.avgBaselineLongReturnPct) : '—');
      set('evidence-disclaimer',report.note);
      const table = document.getElementById('evidence-rows');
      if (table) {
        table.replaceChildren();
        for (const row of report.rows) {
          const tr=document.createElement('tr');
          const date=new Date(row.signalTime*1000).toLocaleDateString('en-US',
            {month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
          for (const value of [date,
            row.direction==='UP'?'Bullish':row.direction==='DOWN'?'Bearish':'Neutral',
            format(row.marketReturnPct),row.correct===null?'—':row.correct?'Yes':'No']) {
            const td=document.createElement('td'); td.textContent=value;
            tr.appendChild(td);
          }
          table.appendChild(tr);
        }
      }
      if (results) results.hidden=false;
      if (status) {
        status.className = 'evidence-status '+(report.evidenceLevel==='insufficient'?'warning':'success');
        status.textContent = symbol + ': ' + report.directionalSignals + ' historical directional samples (' +
          report.evidenceLevel + ' evidence). ' +
          (report.evidenceLevel==='insufficient'
            ? 'Too few outcomes for a reliable hit-rate estimate. '
            : 'Historical results are exploratory, not expected future accuracy. ') +
          (report.errors.length ? report.errors.length + ' samples could not be computed.' : '');
      }
    } catch(err) {
      if (request===evidenceRequest && status) {
        status.className = 'evidence-status warning';
        status.textContent = 'Historical check unavailable: '+err.message+'. No made-up success rate is shown.';
      }
    } finally {
      if (request===evidenceRequest && button) {
        button.disabled=false; button.textContent='Run Historical Check →';
      }
    }
  };

  // Forward evidence: only future matured outcomes count toward the displayed
  // hit rate. Saving recomputes rules on the server, not from browser inputs.
  let loadingForward = false;
  async function loadForwardSignals() {
    if (loadingForward) return;
    const state = document.getElementById('forward-status');
    const tbody = document.getElementById('forward-rows');
    if (!state || !tbody) return;
    if (Auth.isGuest()) {
      state.textContent = 'Sign in to keep a private, timestamped record of your signals.';
      return;
    }
    loadingForward = true;
    state.textContent = 'Loading verified signal history and checking matured outcomes…';
    try {
      const resp = await fetch('/api/user/forward-signals',{
        headers:Auth._authHeader(),cache:'no-store'
      });
      const data = await resp.json();
      if(!resp.ok) throw Error(data.error||'Unable to read forward signals.');
      const p=data.performance;
      const set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
      set('forward-total',String(p.allSaved));
      set('forward-resolved',String(p.directionalResolved));
      set('forward-pending',String(p.pending));
      set('forward-hit',p.hitRatePct===null?'Not enough data':p.hitRatePct.toFixed(1)+'%');
      set('forward-interval',p.hitRate95Pct
        ? '95% Wilson interval '+p.hitRate95Pct.join('–')+'%'
        : 'Need 30 matured directional outcomes');
      tbody.replaceChildren();
      for(const item of data.signals){
        const date=new Date(item.signalTime*1000).toLocaleDateString('en-US',{
          month:'short',day:'numeric',year:'numeric',timeZone:'UTC'
        });
        const move=item.marketReturnPct==null?'—':
          (item.marketReturnPct>0?'+':'')+item.marketReturnPct.toFixed(2)+'%';
        const columns=[
          item.symbol,date,item.direction,
          item.status==='resolved'?'Measured':'Pending',
          move,item.correct===null?'—':item.correct?'Yes':'No'
        ];
        const tr=document.createElement('tr');
        for(const col of columns){const td=document.createElement('td');td.textContent=col;tr.appendChild(td);}
        tbody.appendChild(tr);
      }
      if(!data.signals.length){
        const tr=document.createElement('tr');
        const td=document.createElement('td');td.colSpan=6;
        td.textContent='No signals saved yet. Select a stock and save today’s technical signal.';
        tr.appendChild(td);tbody.appendChild(tr);
      }
      state.textContent='Evidence is based on '+p.resolved+' actually matured outcomes from your account. '+
        (p.hitRatePct===null?'No performance percentage is claimed yet.':
        'Measured hit rate is descriptive, not a future accuracy guarantee.');
    }catch(e){
      state.textContent='Could not load forward evidence: '+e.message;
    }finally{loadingForward=false;}
  }

  window.saveForwardSignal = async function(){
    if (Auth.isGuest()) { showGuestModal(); return; }
    const button=document.getElementById('btn-save-forward');
    const status=document.getElementById('forward-status');
    if(button){button.disabled=true;button.textContent='Saving verified signal…';}
    try{
      const symbol=currentSymbol;
      const resp=await fetch('/api/user/forward-signals',{
        method:'POST',headers:Auth._authHeader(),body:JSON.stringify({symbol})
      });
      const data=await resp.json();
      if(!resp.ok)throw Error(data.error||'Unable to save a verified signal.');
      if(status)status.textContent=symbol+': '+data.note;
      await loadForwardSignals();
    }catch(e){if(status)status.textContent=e.message;}
    finally{if(button){button.disabled=false;button.textContent='Save Current Signal';}}
  };
  document.addEventListener('stockai:tab',event=>{
    if(event.detail==='ai') void loadForwardSignals();
  });

  // ── Market strip ──────────────────────────────────────────────────────────
  async function updateMarket() {
    const el = document.getElementById('market-overview');
    if (!el) return;
    let data;
    try { data = await StockAPI.getMarketOverview(); }
    catch (e) { el.textContent='Market overview is currently unavailable.';return; }
    el.innerHTML = data.map(m => {
      const valid = m.available && Number.isFinite(m.price);
      const up = valid && m.changePct>=0;
      const price = valid ? '$' + m.price.toFixed(2) : '—';
      const pct = valid ? (up?'+':'') + m.changePct.toFixed(2) + '%' : 'Quote unavailable';
      return `<div class="market-card ${valid ? (up?'up':'down') : ''}" onclick="window.selectSearch('${m.symbol}')">
        <div class="market-name">${m.name}</div><div class="market-price">${price}</div>
        <div class="market-change">${pct}</div></div>`;
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
      const sectorQuotes = await Promise.all(HEAT_SECTORS.map(async s => {
        try {
          const q = await StockAPI.getQuote(s.sym);
          const chg = q.changePct;
          const cell = document.getElementById(`heat-${s.sym}`);
          const chgEl = document.getElementById(`heat-chg-${s.sym}`);
          if (!cell) return;
          const intensity = Math.min(1, Math.abs(chg) / 4);
          if (chg >= 0) {
            cell.style.background = `rgba(0,255,136,${0.07 + intensity * 0.35})`;
            cell.style.color = '#4bbf8d';
          } else {
            cell.style.background = `rgba(255,68,102,${0.07 + intensity * 0.35})`;
            cell.style.color = '#e27889';
          }
          if (chgEl) chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
          return {sym:s.sym,price:q.price,changePct:chg};
        } catch (_) { return {sym:s.sym,available:false}; }
      }));
      const breadth=ResearchTools.breadth(sectorQuotes);
      const pct=v=>v===null?'Unavailable':(v>=0?'+':'')+v.toFixed(2)+'%';
      renderResearchMetrics('mkt-breadth-summary',[
        {label:'Verified ETF quotes',value:breadth.available+' / '+sectorQuotes.length},
        {label:'Up / down / unchanged',value:breadth.up+' / '+breadth.down+' / '+breadth.flat},
        {label:'Unweighted avg session move',value:pct(breadth.meanPct)},
        {label:'Leader · laggard',value:breadth.leader&&breadth.laggard?
          breadth.leader.sym+' · '+breadth.laggard.sym:'Unavailable'}
      ]);
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
      const quote=StockAPI._cache['q_'+sym]?.data;
      const price=Number.isFinite(quote?.price) ? quote.price.toFixed(2) : '—';
      const info=StockAPI.getCompanyInfo(sym);
      return `<div class="wl-item ${sym===currentSymbol?'active':''}" onclick="window.selectSearch('${sym}')">
        <span class="wl-sym">${sym}</span><span class="wl-name">${info.name.split(' ')[0]}</span>
        <span class="wl-price">$${price}</span>
        <button class="wl-remove" onclick="event.stopPropagation();removeFromWL('${sym}')">×</button></div>`;
    }).join('');
  }

  window.removeFromWL = async function(sym) {
    try{
      await Auth.removeFromWatchlist(sym);
      delete watchlistQuotes[sym];
      updateWatchlistUI();
      void renderWatchlistTab();
      void renderWatchlistMini();
      showToast(sym+' removed from saved watchlist.');
    }catch(e){showToast('Could not update watchlist: '+e.message);}
  };

  // ── Watchlist tab: sortable, account-persisted, provider-backed ─────────
  const watchlistQuotes=Object.create(null);
  let watchlistVersion=0;
  function paintWatchlistRows() {
    const grid=document.getElementById('wl-view-grid');
    if(!grid)return;
    const symbols=Auth.getWatchlist();
    grid.replaceChildren();
    if(Auth.isGuest()){
      grid.textContent='Create an account to save and organize your watchlist.';
      return;
    }
    if(!symbols.length){
      grid.textContent='Your watchlist is empty. Add a ticker above to get started.';
      const status=document.getElementById('watchlist-coverage');
      if(status)status.textContent='0 saved tickers';
      return;
    }
    const sorted=ResearchTools.watchlistRows(symbols,watchlistQuotes,
      document.getElementById('watchlist-sort')?.value||'alpha');
    const verified=sorted.filter(row=>row.price!==null).length;
    const status=document.getElementById('watchlist-coverage');
    if(status)status.textContent=symbols.length+' saved · '+verified+' verified quote'+
      (verified===1?'':'s')+' · unavailable prices shown as —'+
      (symbols.length>30?' · first 30 fetched per visit':'');
    for(const item of sorted){
      const sym=item.sym;
      const info=StockAPI.getCompanyInfo(sym);
      const row=document.createElement('div');
      row.className='wl-full-item'+(item.price===null?' unavailable':'');
      row.tabIndex=0;row.setAttribute('role','button');
      row.setAttribute('aria-label','Open '+sym+' stock chart');
      const badge=document.createElement('div');badge.className='wlf-badge';badge.textContent=sym.slice(0,2);
      const infoBox=document.createElement('div');infoBox.className='wlf-info';
      const name=document.createElement('div');name.className='wlf-name';name.textContent=info.name||sym;
      const ticker=document.createElement('div');ticker.className='wlf-sym';ticker.textContent=sym;
      infoBox.append(ticker,name);
      const priced=document.createElement('div');priced.className='wlf-price';
      const px=document.createElement('div');px.className='wlf-px';
      px.textContent=item.price===null?'—':'$'+item.price.toLocaleString('en-US',
        {minimumFractionDigits:2,maximumFractionDigits:2});
      const ch=document.createElement('div');
      ch.className='wlf-chg '+(item.changePct===null?'':item.changePct>=0?'up':'down');
      ch.textContent=item.changePct===null?'Quote unavailable':
        (item.changePct>=0?'+':'')+item.changePct.toFixed(2)+'%';
      priced.append(px,ch);
      const remove=document.createElement('button');remove.type='button';
      remove.className='research-btn';remove.textContent='×';
      remove.setAttribute('aria-label','Remove '+sym+' from watchlist');
      remove.addEventListener('click',event=>{event.stopPropagation();void window.removeFromWL(sym);});
      const open=()=>window.selectSearch(sym);
      row.addEventListener('click',open);
      row.addEventListener('keydown',event=>{
        if(event.target===row && (event.key==='Enter'||event.key===' ')){
          event.preventDefault();open();
        }
      });
      row.append(badge,infoBox,priced,remove);grid.appendChild(row);
    }
  }

  window.renderSortedWatchlist=paintWatchlistRows;
  async function renderWatchlistTab() {
    const version=++watchlistVersion;
    paintWatchlistRows();
    if(Auth.isGuest())return;
    const list=Auth.getWatchlist().slice(0,30);
    let cursor=0;
    await Promise.all(Array.from({length:5},async()=>{
      while(cursor<list.length){
        const symbol=list[cursor++];
        try{
          const q=await StockAPI.getQuote(symbol);
          if(version===watchlistVersion)watchlistQuotes[symbol]=q;
        }catch(_){
          if(version===watchlistVersion)delete watchlistQuotes[symbol];
        }
      }
    }));
    if(version===watchlistVersion)paintWatchlistRows();
  }

  window.addToWLFromInput = async function() {
    if (Auth.isGuest()) { showGuestModal();return; }
    const input=document.getElementById('wl-add-input');
    const symbol=(input?.value||'').trim().toUpperCase();
    if(!symbol) {showToast('Enter a ticker to add.');return;}
    try{
      await Auth.addToWatchlist(symbol);
      if(input)input.value='';
      updateWatchlistUI();
      void renderWatchlistTab();
      void renderWatchlistMini();
      showToast(symbol+' saved to your watchlist.');
    }catch(e){showToast('Watchlist not saved: '+e.message);}
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

  // ── Stock Movers: a curated universe, ranked by provider sessions ─────
  let moverData=[];
  let moverVersion=0;
  function paintMovers() {
    const grid=document.getElementById('trend-grid');
    if(!grid)return;
    grid.replaceChildren();
    const status=document.getElementById('trending-meta');
    const available=moverData.filter(ResearchTools.validQuote);
    const rows=ResearchTools.sortQuoteRows(available,
      document.getElementById('trending-sort')?.value||'move-desc');
    if(status)status.textContent=available.length+' verified quotes / '+
      StockAPI.popularSymbols.length+' tracked symbols · latest available session';
    if(!rows.length){
      grid.textContent='Verified mover data is unavailable. Try again after the market-data provider responds.';
      return;
    }
    for(const item of rows){
      const up=item.changePct>=0;
      const card=document.createElement('button');
      card.type='button';card.className='trend-card';
      card.style.cssText='text-align:left;cursor:pointer;color:var(--text);font-family:inherit';
      card.addEventListener('click',()=>window.selectSearch(item.sym));
      const sym=document.createElement('div');sym.className='trend-sym';sym.textContent=item.sym;
      const name=document.createElement('div');name.className='trend-name';
      name.textContent=StockAPI.getCompanyInfo(item.sym).name;
      const px=document.createElement('div');px.className='trend-price';
      px.textContent='$'+item.price.toLocaleString('en-US',
        {minimumFractionDigits:2,maximumFractionDigits:2});
      const change=document.createElement('div');change.className='trend-chg '+(up?'up':'down');
      change.textContent=(up?'+':'')+item.changePct.toFixed(2)+'%';
      const bar=document.createElement('div');bar.className='trend-bar';
      const fill=document.createElement('div');fill.className='trend-fill';
      fill.style.width=Math.min(100,Math.max(5,50+item.changePct*5))+'%';
      fill.style.background=up?'var(--green)':'var(--red)';
      bar.appendChild(fill);
      card.append(sym,name,px,change,bar);grid.appendChild(card);
    }
  }
  window.renderSortedMovers=paintMovers;

  async function renderTrending() {
    const version=++moverVersion;
    const status=document.getElementById('trending-meta');
    if(status)status.textContent='Fetching verified session moves…';
    const symbols=StockAPI.popularSymbols;
    const rows=await Promise.all(symbols.map(async sym=>{
      try{
        const q=await StockAPI.getQuote(sym);
        return ResearchTools.validQuote(q)
          ? {sym,price:q.price,changePct:q.changePct} : null;
      }catch(_){return null;}
    }));
    if(version!==moverVersion)return;
    moverData=rows.filter(Boolean);
    paintMovers();
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
    const syms = ['AAPL','MSFT','GOOGL','AMZN','NVDA','TSLA','META','JPM','V','SPY','QQQ','GLD'];
    const quotes = (await Promise.all(syms.map(async sym => {
      try { const q=await StockAPI.getQuote(sym);return {sym,price:q.price,pct:q.changePct}; }
      catch (_) { return null; }
    }))).filter(Boolean);
    if (!quotes.length) { inner.textContent='Verified market ticker unavailable · check back shortly.'; inner.style.animation='none'; return; }
    const html=quotes.map(q=> {
      const up=q.pct>=0;
      return `<span class="ticker-item"><b>${q.sym}</b> $${q.price.toFixed(2)}
        <span style="color:${up?'var(--green)':'var(--red)'}">${up?'+':''}${q.pct.toFixed(2)}%</span></span>`;
    }).join('');
    inner.innerHTML=html+html;
    const totalW=inner.scrollWidth/2;
    inner.style.animation='none';
    inner.style.width=(totalW*2)+'px';
    void inner.offsetHeight;
    inner.style.animation=`ticker ${Math.max(30,totalW/45)}s linear infinite`;
  }

  // ── Notification Center ───────────────────────────────────────────────────
  const NotifCenter = window.NotifCenter = (function() {
    const KEY = () => 'stockai_notifs_' + (Auth.getSession()?.userId || 'anonymous');
    let _open = false;
    function load() { try { return JSON.parse(localStorage.getItem(KEY())||'[]'); } catch { return []; } }
    function save(list) { localStorage.setItem(KEY(), JSON.stringify(list.slice(0,50))); }
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
    const textEl=document.getElementById('briefing-text');
    const badgeEl=document.getElementById('briefing-badge');
    const moversEl=document.getElementById('briefing-movers');
    if(!textEl)return;
    const syms=['AAPL','NVDA','MSFT','TSLA','META','AMZN','GOOGL','SPY','QQQ'];
    const available=(await Promise.all(syms.map(async sym=>{
      try {const q=await StockAPI.getQuote(sym);return {sym,pct:q.changePct};}
      catch(_){return null;}
    }))).filter(Boolean);
    const spy=available.find(q=>q.sym==='SPY'),qqq=available.find(q=>q.sym==='QQQ');
    if(!spy||!qqq){
      if(badgeEl){badgeEl.className='briefing-badge neutral';badgeEl.textContent='Data pending';}
      textEl.textContent='Verified market summary is not available yet. No simulated changes are shown.';
      if(moversEl)moversEl.textContent='Awaiting live quotes';
      return;
    }
    const sentiment=spy.pct>.3?'bull':spy.pct<-.3?'bear':'neutral';
    if(badgeEl){
      badgeEl.className='briefing-badge '+sentiment;
      badgeEl.textContent=sentiment==='bull'?'Positive session':sentiment==='bear'?'Negative session':'Mixed session';
    }
    const pct=v=>(v>=0?'+':'')+v.toFixed(2)+'%';
    textEl.textContent='Latest available ETF moves: SPY '+pct(spy.pct)+' · QQQ '+pct(qqq.pct)+'. Past performance does not predict future returns.';
    if(moversEl){
      available.sort((a,b)=>Math.abs(b.pct)-Math.abs(a.pct));
      moversEl.innerHTML=available.slice(0,4).map(d=>
        `<div class="briefing-mover ${d.pct>=0?'up':'down'}">${d.sym} ${pct(d.pct)}</div>`).join('');
    }
  }

  // ── Portfolio Analytics (donut chart) ─────────────────────────────────────
  function renderPortfolioAnalytics(rows) {
    const canvas = document.getElementById('port-donut'); if (!canvas) return;
    const wrap = document.getElementById('port-analytics-wrap');
    if (!rows || !rows.length) { if (wrap) wrap.style.display='none'; return; }
    if (wrap) wrap.style.display='';

    const total = rows.reduce((a,r) => a + r.value, 0) || 1;
    const colors = ['#91a9cf','#4bbf8d','#60a5fa','#d9b676','#ff6b6b','#4ecdc4','#45b7d1','#f9ca24','#a78bfa','#fb923c'];
    const colored = rows.map((r,i) => ({ ...r, color: colors[i % colors.length] }));

    // Draw donut using actual portfolio values (canvas is 140×140)
    const ctx = canvas.getContext('2d');
    const CW = 140, CH = 140, cx = 70, cy = 70, R = 62, r2 = 34;
    canvas.width = CW; canvas.height = CH;
    ctx.clearRect(0,0,CW,CH);
    let angle = -Math.PI/2;
    colored.forEach(row => {
      const sweep = (row.value/total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx,cy);
      ctx.arc(cx,cy,R,angle,angle+sweep);
      ctx.closePath(); ctx.fillStyle = row.color; ctx.fill();
      angle += sweep;
    });
    ctx.beginPath(); ctx.arc(cx,cy,r2,0,Math.PI*2);
    ctx.fillStyle = '#060e1c'; ctx.fill();
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 12px Inter,sans-serif'; ctx.textAlign='center';
    ctx.fillText(`$${total>=1000?(total/1000).toFixed(1)+'K':total.toFixed(0)}`, cx, cy+4);

    const legendEl = document.getElementById('port-legend');
    if (legendEl) legendEl.innerHTML = colored.map(r=>`
      <div class="port-legend-row">
        <span class="port-legend-dot" style="background:${r.color}"></span>
        <span class="port-legend-name">${r.symbol}</span>
        <span class="port-legend-pct" style="color:${r.color}">${((r.value/total)*100).toFixed(1)}%</span>
      </div>`).join('');

    const gridEl = document.getElementById('port-mini-grid');
    if (gridEl) {
      const largest = [...rows].sort((a,b)=>b.value-a.value)[0];
      const mostPL  = [...rows].sort((a,b)=>b.pl-a.pl)[0];
      gridEl.innerHTML = `
        <div class="port-mini"><div class="port-mini-lbl">Positions</div><div class="port-mini-val">${rows.length}</div></div>
        <div class="port-mini"><div class="port-mini-lbl">Largest Hold</div><div class="port-mini-val" style="color:var(--cyan)">${largest?.symbol||'—'}</div></div>
        <div class="port-mini"><div class="port-mini-lbl">Best Performer</div><div class="port-mini-val up">${mostPL?.pl>=0?mostPL?.symbol:'—'}</div></div>
        <div class="port-mini"><div class="port-mini-lbl">Diversification</div><div class="port-mini-val">${rows.length>=5?'High':rows.length>=3?'Medium':'Low'}</div></div>`;
    }
  }

  // ── Portfolio sparkline ───────────────────────────────────────────────────
  function renderPortfolioChart(rows) {
    const canvas=document.getElementById('port-sparkline');
    if(!canvas)return;
    const width=canvas.parentElement.clientWidth || 600;
    canvas.width=width;canvas.height=80;
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,width,80);
    ctx.fillStyle='#96adbe';
    ctx.font='12px Inter,sans-serif';
    ctx.textAlign='center';
    ctx.fillText(rows?.length
      ? 'Historical portfolio values are not stored yet · no synthetic chart.'
      : 'Add holdings to begin tracking.',width/2,42,Math.max(140,width-18));
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
      listEl.innerHTML = Portfolio.lastError
        ? '<div class="port-empty" style="color:var(--gold)">Your saved holdings could not be loaded. They have NOT been deleted. Please retry after the API responds.</div>'
        : '<div class="port-empty">No holdings yet — add your first position above.</div>';
      ['port-invested','port-value','port-pl','port-pct','port-best','port-count'].forEach(id=>{
        const el=document.getElementById(id); if(el){ el.textContent=id==='port-count'?'0':'—'; el.className='psc-val'; }
      });
      document.getElementById('port-alloc-list').innerHTML='<span style="color:var(--muted);font-size:.8rem">Add holdings to see breakdown</span>';
      renderPortfolioChart([]);
      renderPortfolioAnalytics([]);
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

      // No fabricated quotes: temporary cost-basis estimate when price is missing.
      const curPrice=hasLive ? pd.price : h.buyPrice;
      const priceSource=hasLive ? 'live' : 'cost';

      const chg24h = hasLive ? (pd.change24h ?? null) : null;
      const cost   = h.shares * h.buyPrice;
      const value  = h.shares * curPrice;
      const pl     = hasLive ? value - cost : null;
      const plPct  = hasLive && cost ? (pl / cost) * 100 : null;
      totalCost  += cost;
      totalValue += value;
      return { ...h, curPrice, chg24h, priceSource, cost, value, pl, plPct,
               name: pd.name || h.name || h.symbol,
               assetType: h.assetType || 'stock',
               accountType: h.accountType || 'taxable' };
    });

    const partialQuotes=rows.some(r=>r.priceSource!=='live');
    let pricingNotice=document.getElementById('port-pricing-notice');
    if(!pricingNotice){
      pricingNotice=document.createElement('div');
      pricingNotice.id='port-pricing-notice';
      pricingNotice.className='data-warning';
      listEl.parentElement.insertBefore(pricingNotice,listEl);
    }
    pricingNotice.style.display=partialQuotes?'block':'none';
    if(partialQuotes)pricingNotice.textContent='Some prices cannot be verified. Cost basis is shown temporarily for those holdings; total value is an estimate and portfolio P/L is withheld.';
    // Stats
    const totalPL    = totalValue - totalCost;
    const totalPLPct = totalCost ? (totalPL / totalCost) * 100 : 0;
    const up    = totalPL >= 0;
    const pricedRows=rows.filter(r=>r.plPct!==null);
    const best=pricedRows.length?pricedRows.reduce((a,b)=>b.plPct>a.plPct?b:a):null;
    const worst=pricedRows.length?pricedRows.reduce((a,b)=>b.plPct<a.plPct?b:a):null;

    // ── Big stat cards ────────────────────────────────────────────────────────
    const setText = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    const setHTML = (id, v) => { const el=document.getElementById(id); if(el) el.innerHTML=v; };

    setText('port-invested', '$' + _fmtD(totalCost));
    setText('port-value',    '$' + _fmtD(totalValue));
    setText('port-count-sub', rows.length + ' position' + (rows.length !== 1 ? 's' : ''));

    const plEl = document.getElementById('port-pl');
    if(plEl){plEl.textContent=partialQuotes?'—':(up?'+':'-')+'$'+_fmtD(Math.abs(totalPL));plEl.className='pt-stat-val '+(partialQuotes?'':(up?'up':'down'));}
    setHTML('port-pl-badge',partialQuotes?'<span class="pt-stat-badge">Waiting for all quotes</span>':
      `<span class="pt-stat-badge ${up?'up':'down'}">${up?'▲':'▼'} ${up?'+':''}${_fmtD(totalPLPct)}%</span>`);

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
    if(gainEl){gainEl.textContent=partialQuotes?'—':(up?'+':'-')+'$'+_fmtD(Math.abs(totalPL));gainEl.style.color=partialQuotes?'var(--muted)':(up?'var(--green)':'var(--red)');}

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
      renderPortfolioChart(rows);
      renderPortfolioAnalytics(rows);
      return;
    }

    listEl.innerHTML = filteredRows.map(row => {
      const rUp       = (row.pl ?? 0) >= 0;
      const iconCls   = _portIconCls(row);
      const acctLabel = _acctLabels[row.accountType] || row.accountType;
      const allocPct  = totalValue > 0 ? ((row.value / totalValue) * 100).toFixed(1) : '0.0';
      const plSign    = rUp ? '+' : '-';
      const sharesStr = row.shares % 1 === 0 ? row.shares : parseFloat(row.shares.toFixed(6));

      const srcBadge=row.priceSource==='live'
        ? '<span style="color:var(--green);margin-left:.3rem" title="Provider quote">●</span>'
        : '<span style="color:var(--gold);margin-left:.3rem" title="Cost basis; no live price">⚠ cost</span>';
      const rowPL=row.pl===null?'—':plSign+'$'+_fmtD(Math.abs(row.pl));
      const rowReturn=row.plPct===null?'—':plSign+Math.abs(row.plPct).toFixed(2)+'%';

      return `<div class="port-table-row new-cols">
        <div style="display:flex;align-items:center;gap:.65rem;min-width:0">
          <div class="port-icon ${iconCls}">${row.symbol.slice(0,4)}</div>
          <div style="min-width:0">
            <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">
              <button class="port-sym-btn" onclick="window.loadPortfolioStock('${row.symbol}')">${row.symbol}</button>
              <span class="port-acct-badge ${row.accountType}">${acctLabel}</span>
            </div>
            <div style="font-size:.67rem;color:var(--muted);margin-top:.1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px">${escapeHTML(row.name)}</div>
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
          <div style="font-size:.62rem;color:var(--muted);margin-top:.06rem">${row.priceSource==='live'?'@ $'+_fmtD(row.curPrice):'unpriced · cost basis'}</div>
        </div>
        <div style="font-weight:700;color:${rUp?'var(--green)':'var(--red)'}">
          ${rowPL}
        </div>
        <div style="font-weight:700;color:${rUp?'var(--green)':'var(--red)'}">
          ${rowReturn}
        </div>
        <div style="display:flex;gap:.3rem;align-items:center;justify-content:flex-end">
          <button class="port-act-btn edit" onclick="window.openEditHolding('${row.id}')" title="Edit">✏</button>
          <button class="port-act-btn del"  onclick="window.removeHolding('${row.id}')"   title="Delete">✕</button>
        </div>
      </div>`;
    }).join('');

    renderAllocation(rows);
    renderPortfolioChart(rows);
    renderPortfolioAnalytics(rows);
  }

  function renderAllocation(rows) {
    const allocEl = document.getElementById('port-alloc-list');
    if (!allocEl || !rows.length) return;

    const totalValue = rows.reduce((s,r) => s + r.value, 0);
    if (!totalValue) return;

    // Group by assetType
    const typeMap = { stock:'#3b82f6', etf:'#7e99c4', crypto:'#f59e0b' };
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
    try { await Portfolio.add(sym, sh, price, account, type, name); }
    catch(error) { showToast('Not saved: '+error.message); return; }
    ['port-sym','port-name','port-shares','port-price'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    document.getElementById('port-add-form')?.classList.remove('open');
    await renderPortfolio();
    showToast(`${sym} added to portfolio`);
  };

  window.removeHolding = async function(id) {
    if (!confirm('Remove this holding?')) return;
    try {
      await Portfolio.remove(id);
      await renderPortfolio();
      showToast('Holding removed');
    } catch(error) { showToast('Delete failed: '+error.message); }
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
    try {
      await Portfolio.update(id, { shares, buyPrice: price, assetType: type, accountType: account, name: name || undefined });
      document.getElementById('edit-hold-modal').classList.add('hidden');
      await renderPortfolio();
      showToast('Holding updated');
    } catch(error) { showToast('Update failed: '+error.message); }
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
    const header=['Symbol','Name','Shares','Avg Buy Price','Current Price','Market Value','P&L $','P&L %','Asset Type','Account','Price Source'];
    const csvRows=[header,...holdings.map(h=>{
      const pd=priceData[h.symbol]||{};
      const verified=Number.isFinite(pd.price)&&pd.price>0;
      const current=verified?pd.price:null;
      const value=verified?h.shares*current:null;
      const cost=h.shares*h.buyPrice;
      const pl=verified?value-cost:null;
      const percent=verified&&cost?pl/cost*100:null;
      return [h.symbol,h.name||h.symbol,h.shares,h.buyPrice.toFixed(2),
        current===null?'':current.toFixed(2),
        value===null?'':value.toFixed(2),
        pl===null?'':pl.toFixed(2),
        percent===null?'':percent.toFixed(2)+'%',
        h.assetType||'stock',h.accountType||'taxable',
        verified?'Provider quote':'Unavailable'];
    })];
    // Escape CSV syntax, commas/newlines and spreadsheet-formula prefixes.
    const escapeCsv=value=>{
      let v=String(value??'');
      if (/^[=+@-]/.test(v.trimStart()))v="'"+v;
      return '"'+v.replace(/"/g,'""')+'"';
    };
    const csv=csvRows.map(row=>row.map(escapeCsv).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `portfolio_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    showToast('Portfolio exported as CSV');
  };

  // ── Curated screener: all metrics trace to provider data ───────────────
  let lastScreenerRows=[];
  let screenerBusy=false;

  window.setScrSector = function(button){
    document.querySelectorAll('.schip').forEach(b=>b.classList.remove('active'));
    button.classList.add('active');
  };
  function verifiedRSI(bars){
    if(!Array.isArray(bars)||bars.length<30)return null;
    const values=AIPredictor.rsi(bars.map(b=>b.close));
    const last=values[values.length-1];
    return Number.isFinite(last)?Math.round(last):null;
  }

  window.runScreener = async function(){
    if(screenerBusy)return;
    screenerBusy=true;
    const grid=document.getElementById('scr-results');
    const meta=document.getElementById('scr-meta');
    const runBtn=document.getElementById('scr-run');
    const csvBtn=document.getElementById('scr-export');
    if(runBtn)runBtn.disabled=true;
    if(csvBtn)csvBtn.disabled=true;
    lastScreenerRows=[];
    const sector=document.querySelector('.schip.active')?.dataset.val||'';
    const sort=document.getElementById('scr-sort')?.value||'chg-desc';
    const rsiFilter=document.getElementById('scr-rsi')?.value||'';
    const capFilter=document.getElementById('scr-mktcap')?.value||'';
    const perf=document.getElementById('scr-perf')?.value||'';
    const minInput=document.getElementById('scr-min')?.value?.trim()||'';
    const maxInput=document.getElementById('scr-max')?.value?.trim()||'';
    const minPrice=minInput===''?0:Number(minInput);
    const maxPrice=maxInput===''?Infinity:Number(maxInput);
    const needsRSI=Boolean(rsiFilter)||sort.startsWith('rsi');
    const needsCap=Boolean(capFilter)||sort==='cap-desc';
    if(grid)grid.textContent='Fetching verified provider quotes. Additional historical filters may take longer…';

    try{
      if(!Number.isFinite(minPrice)||minPrice<0||
        (!Number.isFinite(maxPrice)&&maxPrice!==Infinity)||maxPrice<minPrice)
        throw Error('Maximum price must be greater than or equal to minimum price.');
      // Market-data quotas are finite. Scan a sector-balanced, named universe
      // and show scope/coverage; never call this "all market stocks".
      const universe=ResearchTools.UNIVERSE.filter(([sym,group])=>!sector||group===sector)
        .slice(0,30);
      const results=[];
      let cursor=0,unavailable=0;
      await Promise.all(Array.from({length:5},async()=>{
        while(cursor<universe.length){
          const [sym,group]=universe[cursor++];
          try{
            const q=await StockAPI.getQuote(sym);
            if(!ResearchTools.validQuote(q)){unavailable++;continue;}
            let rsi=null,cap=null;
            if(needsRSI){
              try{rsi=verifiedRSI(await StockAPI.getCandles(sym,'D',365));}
              catch(_){}
            }
            if(needsCap){
              try{
                const p=await StockAPI.getCompanyProfile(sym);
                if(Number.isFinite(p.marketCap)&&p.marketCap>0)cap=p.marketCap/1000;
              }catch(_){}
            }
            results.push({sym,sector:group,name:StockAPI.getCompanyInfo(sym).name,
              price:q.price,changePct:q.changePct,rsi,cap});
          }catch(_){unavailable++;}
        }
      }));
      const filtered=ResearchTools.screen(results,{
        sector,sort,rsiFilter,capFilter,perf,minPrice,maxPrice
      });
      lastScreenerRows=filtered;
      if(meta){
        meta.textContent=filtered.length+' matches · '+results.length+'/'+universe.length+
          ' verified quotes · '+unavailable+' unavailable · curated universe of '+
          ResearchTools.UNIVERSE.length+' stocks; only '+universe.length+' sampled for this run'+
          (needsRSI?' · RSI calculated from verified daily candles':'')+
          (needsCap?' · cap unavailable where provider profile is missing':'');
      }
      if(grid)grid.replaceChildren();
      if(csvBtn)csvBtn.disabled=filtered.length===0;
      if(!filtered.length){
        if(grid)grid.textContent=results.length===0
          ? 'Quote provider unavailable. No invented matches are shown.'
          : 'No verified rows match these filters. Broaden the criteria and run again.';
        return;
      }
      for(const row of filtered){
        const up=row.changePct>=0;
        const card=document.createElement('button');card.type='button';
        card.className='pro-screener-result';
        card.addEventListener('click',()=>window.selectSearch(row.sym));
        const cell=(name,value,sub)=>{
          const span=document.createElement('span');span.className=name;span.textContent=value;
          const small=document.createElement('small');small.textContent=sub;span.appendChild(small);
          return span;
        };
        const cap=row.cap===null?'N/A':row.cap>=1000?'$'+(row.cap/1000).toFixed(1)+'T':
          '$'+row.cap.toFixed(1)+'B';
        const symbolCell=cell('pro-scr-symbol',row.sym,row.name);
        const priceCell=cell('pro-scr-price','$'+row.price.toFixed(2),row.sector);
        const changeCell=cell('pro-scr-change '+(up?'up':'down'),
          (up?'+':'')+row.changePct.toFixed(2)+'%','Session change');
        const metricCell=cell('pro-scr-metrics','RSI '+(row.rsi??'—'),'Cap '+cap);
        card.append(symbolCell,priceCell,changeCell,metricCell);
        grid.appendChild(card);
      }
    }catch(error){
      if(grid)grid.textContent='Screener could not complete: '+error.message;
      if(meta)meta.textContent='No results exported.';
    }finally{
      screenerBusy=false;
      if(runBtn)runBtn.disabled=false;
    }
  };

  window.exportScreenerCSV = function(){
    if(!lastScreenerRows.length)return;
    const fields=['Ticker','Company','Sector','Price USD','Session change %','RSI 14','Market cap USD billions'];
    const lines=[fields,...lastScreenerRows.map(r=>[
      r.sym,r.name,r.sector,r.price,r.changePct,r.rsi??'',r.cap??''
    ])].map(row=>row.map(value=>ResearchTools.csvCell(value)).join(','));
    const blob=new Blob([lines.join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;
    anchor.download='stockai-verified-screener-'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    showToast('Exported '+lastScreenerRows.length+' verified screener matches.');
  };

  // ── Earnings Calendar ─────────────────────────────────────────────────────
  function renderEarnings() {
    const tbody=document.getElementById('earnings-tbody');
    if(!tbody)return;
    // No licensed earnings feed is connected. Never present invented EPS or dates.
    tbody.innerHTML='<tr><td colspan="6" style="padding:1.3rem;color:var(--muted);text-align:center">Verified earnings data not connected. Forecast EPS and dates are not shown.</td></tr>';
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
      const imgContent = a.image && safeExternalLink(a.image) !== '#'
        ? `<img src="${safeExternalLink(a.image)}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.textContent='${emoji}'">`
        : emoji;
      return `<a class="news-card" href="${safeExternalLink(a.url)}" target="_blank" rel="noopener noreferrer">
        <div class="news-card-img">${imgContent}</div>
        <div class="news-card-body">
          <div class="news-card-source">${escapeHTML(a.source)}</div>
          <div class="news-card-headline">${escapeHTML(a.headline)}</div>
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
  // Ask notification permission only after the user chooses to set an alert.

  function renderAlerts() {
    const list=PriceAlerts.get(),el=document.getElementById('alert-list');
    const status=document.getElementById('alert-service-status');
    if(!el)return;
    if(status)status.textContent=PriceAlerts.lastError
      ? '⚠ Alert sync unavailable: '+PriceAlerts.lastError+'. Old browser alerts have been preserved.'
      : 'Saved to your account · checked while this page is open · not 24/7 monitoring.';
    el.replaceChildren();
    if(!list.length){
      const empty=document.createElement('div');
      empty.style.cssText='color:var(--muted);font-size:.82rem;padding:.5rem 0';
      empty.textContent=PriceAlerts.lastError
        ? 'Unable to load saved alerts right now. Please retry.'
        : 'No price alerts set. Add one above.';
      el.appendChild(empty);return;
    }
    for(const a of list){
      const row=document.createElement('div');row.className='alert-row';
      const sym=document.createElement('span');sym.className='alert-sym';sym.textContent=a.symbol;
      const dir=document.createElement('span');
      dir.className='alert-dir-badge '+(a.direction==='above'?'above':'below');
      dir.textContent=a.direction==='above'?'↑ Above':'↓ Below';
      const price=document.createElement('span');price.className='alert-price-val';
      price.textContent='$'+Number(a.targetPrice).toFixed(2);
      const trigger=document.createElement('span');
      trigger.className='alert-status '+(a.triggered?'triggered':'');
      trigger.textContent=a.triggered?'✓ Hit':'●';
      if(a.triggeredAt)trigger.title='Triggered '+new Date(a.triggeredAt).toLocaleString();
      const remove=document.createElement('button');remove.type='button';
      remove.setAttribute('aria-label','Remove '+a.symbol+' alert');
      remove.textContent='×';
      remove.style.cssText='background:none;border:none;color:var(--red);cursor:pointer;font-size:1rem;line-height:1;margin-left:auto';
      remove.addEventListener('click',()=>window.removeAlert(a.id));
      row.append(sym,dir,price,trigger,remove);el.appendChild(row);
    }
  }

  window.addAlert = async function() {
    if(Auth.isGuest()){showGuestModal();return;}
    const sym=(document.getElementById('alert-sym')?.value||currentSymbol).toUpperCase().trim();
    const price=Number(document.getElementById('alert-price')?.value);
    const dir=document.getElementById('alert-dir')?.value||'above';
    if(!/^[A-Z0-9.\-^]{1,16}$/.test(sym)||!Number.isFinite(price)||price<=0){
      showToast('Enter a valid symbol and target price');return;
    }
    const btn=document.querySelector('.btn-set-alert');
    if(btn)btn.disabled=true;
    try{
      await PriceAlerts.add(sym,price,dir);
      PriceAlerts.requestPermission();
      document.getElementById('alert-sym').value='';
      document.getElementById('alert-price').value='';
      renderAlerts();
      showToast('Saved '+sym+' '+dir+' $'+price.toFixed(2)+' to your account');
    }catch(e){showToast('Could not save price alert: '+e.message);}
    finally{if(btn)btn.disabled=false;}
  };

  window.removeAlert = async function(id) {
    try{await PriceAlerts.remove(id);renderAlerts();showToast('Alert deleted');}
    catch(e){showToast('Could not remove alert: '+e.message);}
  };

  async function refreshSavedAlerts() {
    if(Auth.isGuest())return;
    await PriceAlerts.load();
    renderAlerts();
    if(document.hidden||navigator.onLine===false)return;
    try{await PriceAlerts.checkServer();renderAlerts();}
    catch(e){
      const status=document.getElementById('alert-service-status');
      if(status)status.textContent='⚠ Verification unavailable: '+e.message+
        '. Your saved alerts are not being checked right now.';
    }
  }

  function checkAlertsForPrice(symbol, price) {
    const fired=PriceAlerts.check(symbol,price);
    fired.forEach(a=>{
      PriceAlerts.notify(a);
      NotifCenter.push(
        `${symbol} Alert Triggered`,
        `${symbol} crossed ${a.targetPrice.toFixed(2)} (${a.direction}). Current: ${price.toFixed(2)}`,
        a.direction === 'above' ? 'up' : 'down'
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
    applyChartTheme();
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
    const normalized = String(sym || '').toUpperCase().trim();
    if (!/^[A-Z0-9.^:-]{1,16}$/.test(normalized)) {
      showToast('Enter a valid market symbol');
      return;
    }
    searchDrop.classList.add('hidden');
    clearSMAUI();
    loadStock(normalized).catch(error => showToast('Chart could not load: ' + error.message));
    if (!document.getElementById('view-dashboard')?.classList.contains('active')) {
      window.switchTab?.(null, 'dashboard');
    }
  };

  document.addEventListener('click',e=>{ if (!searchInput.contains(e.target)&&!searchDrop.contains(e.target)) searchDrop.classList.add('hidden'); });
  searchInput.addEventListener('keydown',e=>{
    if(e.key==='Enter') { e.preventDefault(); window.selectSearch(searchInput.value); searchInput.blur(); }
    if(e.key==='Escape') searchDrop.classList.add('hidden');
  });

  // ── Watchlist add (dashboard tab) ─────────────────────────────────────────
  document.getElementById('btn-add-watch').addEventListener('click', async ()=>{
    if (Auth.isGuest()) { showGuestModal(); return; }
    try{
      await Auth.addToWatchlist(currentSymbol);
      updateWatchlistUI();
      void renderWatchlistTab();
      showToast(currentSymbol+' saved to your watchlist.');
    }catch(e){showToast('Watchlist not saved: '+e.message);}
  });

  // ── Logout / Sidebar ─────────────────────────────────────────────────────
  document.getElementById('btn-logout').addEventListener('click',()=>{ StockAPI.unsubscribeAll(); Auth.logout(); });
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  function setSidebarOpen(open) {
    const show = Boolean(open && window.innerWidth < 900);
    sidebar.classList.toggle('open', show);
    sidebarBackdrop?.classList.toggle('hidden', !show);
    sidebarToggle?.setAttribute('aria-expanded', String(show));
    sidebarToggle?.setAttribute('aria-label', show ? 'Close navigation' : 'Open navigation');
    if (show) sidebar.querySelector('.nav-item')?.focus();
  }
  sidebarToggle?.addEventListener('click', () => setSidebarOpen(!sidebar.classList.contains('open')));
  sidebarBackdrop?.addEventListener('click', () => { setSidebarOpen(false); sidebarToggle?.focus(); });
  document.addEventListener('stockai:tab', event => {
    if (event.detail === 'dashboard') requestAnimationFrame(resizeChart);
    setSidebarOpen(false);
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 900) setSidebarOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && sidebar.classList.contains('open')) {
      setSidebarOpen(false);
      sidebarToggle?.focus();
    }
  });

  // ── API Key modal ─────────────────────────────────────────────────────────
  // Request a fresh quote without losing local saved holdings or candle cache.
  let manualRefreshBusy = false;
  window.refreshMarketData = async function () {
    if (manualRefreshBusy) return;
    manualRefreshBusy = true;
    const button = document.getElementById('btn-refresh-market');
    if (button) { button.disabled = true; button.textContent = '…'; }
    try {
      for (const key of Object.keys(StockAPI._cache)) {
        if (key.startsWith('q_')) delete StockAPI._cache[key];
      }
      await Promise.allSettled([refreshQuote(), updateMarket()]);
      showToast('Market quote refresh completed. Check data status above.');
    } finally {
      manualRefreshBusy = false;
      if (button) { button.disabled = false; button.textContent = '↻'; }
    }
  };

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
    else if (tab==='trending')  {
      if(!trendingLoaded){trendingLoaded=true;renderTrending();}
      renderWatchlistMini(); renderAlerts(); void refreshSavedAlerts();
    }
    else if (tab==='ai')        { if(currentBars.length>=50) runAI(); renderEarnings(); }
    else if (tab==='screener')  {
      // Runs only when user requests; conserves quota on public data providers.
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function volData(bars){ return bars.map(b=>({time:b.time,value:b.volume,color:b.close>=b.open?'rgba(0,255,136,0.3)':'rgba(255,68,102,0.3)'})); }
  function fmtVol(v){ if(v>=1e9)return(v/1e9).toFixed(2)+'B'; if(v>=1e6)return(v/1e6).toFixed(2)+'M'; if(v>=1e3)return(v/1e3).toFixed(1)+'K'; return v; }
  function showChartLoader(show) {
    let el=document.getElementById('chart-loader');
    if (!el){ el=document.createElement('div'); el.id='chart-loader'; el.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,11,31,0.7);border-radius:10px;font-size:.85rem;color:#64748b;z-index:10;pointer-events:none'; el.innerHTML='<span>⟳ Loading chart data…</span>'; const cw=document.getElementById('price-chart'); cw.style.position='relative'; cw.appendChild(el); }
    el.style.display=show?'flex':'none';
  }

  function showChartUnavailable(show) {
    const host=document.getElementById('price-chart');
    let el=document.getElementById('chart-unavailable');
    if(!el){
      el=document.createElement('div');
      el.id='chart-unavailable';
      el.className='chart-unavailable';
      el.setAttribute('role','status');
      el.textContent='Verified candle history is unavailable. No simulated prices are shown.';
      host.appendChild(el);
    }
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

  // A sleeping market-data provider must not block navigation or holdings.
  let _prefs = {};
  try { _prefs = JSON.parse(localStorage.getItem('stockai_prefs') || '{}'); }
  catch (_) { _prefs = {}; }
  renderAlerts();
  void refreshSavedAlerts();
  // Check latest provider quotes every 2 minutes while the browser is open.
  // This is NOT guaranteed background monitoring when Render sleeps.
  setInterval(()=>{
    if(!document.hidden&&!Auth.isGuest())void refreshSavedAlerts();
  },120000);
  renderEarnings();
  NotifCenter.init();
  void loadStock(_prefs.defaultStock || 'AAPL').catch(err => {
    console.error('Initial chart failed:', err);
    showToast('Unable to load the opening stock. Try Refresh.');
  });
  void updateMarket().catch(err => console.warn('Market overview failed:', err.message));
  void renderPortfolio().catch(err => console.warn('Portfolio could not load:', err.message));
  void renderTickerTape().catch(err => console.warn('Ticker could not load:', err.message));
  void renderDailyBriefing().catch(err => console.warn('Market briefing could not load:', err.message));

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
      requestAnimationFrame(resizeChart);
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
