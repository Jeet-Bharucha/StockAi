// AI Prediction Engine — Technical Analysis
const AIPredictor = {

  // ── Indicator calculations ────────────────────────────────────────────────

  sma(closes, period) {
    return closes.map((_, i) => {
      if (i < period - 1) return null;
      const slice = closes.slice(i - period + 1, i + 1);
      return slice.reduce((a, b) => a + b, 0) / period;
    });
  },

  ema(closes, period) {
    const k = 2 / (period + 1);
    const result = [closes[0]];
    for (let i = 1; i < closes.length; i++) {
      result.push(closes[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  },

  rsi(closes, period = 14) {
    const changes = closes.slice(1).map((c, i) => c - closes[i]);
    const gains = changes.map(c => Math.max(c, 0));
    const losses = changes.map(c => Math.abs(Math.min(c, 0)));

    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const rsiVals = [null];

    for (let i = 0; i < changes.length; i++) {
      if (i < period) { rsiVals.push(null); continue; }
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiVals.push(100 - 100 / (1 + rs));
    }
    return rsiVals;
  },

  macd(closes) {
    const ema12 = this.ema(closes, 12);
    const ema26 = this.ema(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signal = this.ema(macdLine, 9);
    const histogram = macdLine.map((v, i) => v - signal[i]);
    return { macdLine, signal, histogram };
  },

  bollingerBands(closes, period = 20, multiplier = 2) {
    const smaVals = this.sma(closes, period);
    return closes.map((_, i) => {
      if (smaVals[i] === null) return { upper: null, middle: null, lower: null };
      const slice = closes.slice(i - period + 1, i + 1);
      const mean = smaVals[i];
      const std = Math.sqrt(slice.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / period);
      return {
        upper:  +(mean + multiplier * std).toFixed(4),
        middle: +mean.toFixed(4),
        lower:  +(mean - multiplier * std).toFixed(4)
      };
    });
  },

  stochastic(highs, lows, closes, k = 14, d = 3) {
    const stochK = closes.map((_, i) => {
      if (i < k - 1) return null;
      const hSlice = highs.slice(i - k + 1, i + 1);
      const lSlice = lows.slice(i - k + 1, i + 1);
      const hh = Math.max(...hSlice);
      const ll = Math.min(...lSlice);
      return ll === hh ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
    });
    const validK = stochK.filter(v => v !== null);
    const stochD = this.sma(validK, d);
    return { k: stochK, d: stochD };
  },

  obv(closes, volumes) {
    const result = [0];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i - 1]) result.push(result[i - 1] + volumes[i]);
      else if (closes[i] < closes[i - 1]) result.push(result[i - 1] - volumes[i]);
      else result.push(result[i - 1]);
    }
    return result;
  },

  atr(highs, lows, closes, period = 14) {
    const tr = closes.map((_, i) => {
      if (i === 0) return highs[0] - lows[0];
      return Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
    });
    return this.sma(tr, period);
  },

  // ── Main prediction engine ────────────────────────────────────────────────

  predict(bars) {
    const closes  = bars.map(b => b.close);
    const highs   = bars.map(b => b.high);
    const lows    = bars.map(b => b.low);
    const volumes = bars.map(b => b.volume);
    const n = closes.length - 1; // latest index

    const signals = [];

    // 1. RSI
    const rsiVals = this.rsi(closes);
    const rsi = rsiVals[n];
    if (rsi !== null) {
      let rsiSignal, rsiLabel;
      if (rsi < 30)      { rsiSignal = 2;  rsiLabel = 'STRONG BUY';  }
      else if (rsi < 45) { rsiSignal = 1;  rsiLabel = 'BUY'; }
      else if (rsi < 55) { rsiSignal = 0;  rsiLabel = 'NEUTRAL'; }
      else if (rsi < 70) { rsiSignal = -1; rsiLabel = 'SELL'; }
      else               { rsiSignal = -2; rsiLabel = 'STRONG SELL'; }
      signals.push({ name: 'RSI (14)', value: rsi.toFixed(1), signal: rsiLabel, score: rsiSignal, weight: 1.5 });
    }

    // 2. MACD
    const { macdLine, signal: macdSig, histogram } = this.macd(closes);
    const macdVal  = macdLine[n];
    const macdSigV = macdSig[n];
    const macdHist = histogram[n];
    const prevHist = histogram[n - 1];
    let macdScore, macdLabel;
    if (macdVal > macdSigV && macdHist > prevHist) { macdScore = 2;  macdLabel = 'STRONG BUY'; }
    else if (macdVal > macdSigV)                    { macdScore = 1;  macdLabel = 'BUY'; }
    else if (macdVal < macdSigV && macdHist < prevHist) { macdScore = -2; macdLabel = 'STRONG SELL'; }
    else if (macdVal < macdSigV)                    { macdScore = -1; macdLabel = 'SELL'; }
    else                                            { macdScore = 0;  macdLabel = 'NEUTRAL'; }
    signals.push({ name: 'MACD (12,26,9)', value: macdVal.toFixed(3), signal: macdLabel, score: macdScore, weight: 1.8 });

    // 3. Bollinger Bands
    const bbands = this.bollingerBands(closes);
    const bb = bbands[n];
    const price = closes[n];
    let bbScore, bbLabel;
    if (bb.upper && bb.lower) {
      const bbPos = (price - bb.lower) / (bb.upper - bb.lower);
      if (bbPos < 0.1)       { bbScore = 2;  bbLabel = 'STRONG BUY'; }
      else if (bbPos < 0.35) { bbScore = 1;  bbLabel = 'BUY'; }
      else if (bbPos < 0.65) { bbScore = 0;  bbLabel = 'NEUTRAL'; }
      else if (bbPos < 0.9)  { bbScore = -1; bbLabel = 'SELL'; }
      else                   { bbScore = -2; bbLabel = 'STRONG SELL'; }
      signals.push({ name: 'Bollinger Bands', value: `${(bbPos*100).toFixed(0)}%`, signal: bbLabel, score: bbScore, weight: 1.2 });
    }

    // 4. SMA 50/200 Golden Cross
    const sma50  = this.sma(closes, 50);
    const sma200 = this.sma(closes, 200);
    const sma50v  = sma50[n];
    const sma200v = sma200[n];
    const prevSma50  = sma50[n - 1];
    const prevSma200 = sma200[n - 1];
    if (sma50v && sma200v) {
      let maScore, maLabel;
      const cross = sma50v > sma200v;
      const prevCross = prevSma50 > prevSma200;
      if (cross && !prevCross)    { maScore = 2;  maLabel = 'GOLDEN CROSS ↑'; }
      else if (!cross && prevCross){ maScore = -2; maLabel = 'DEATH CROSS ↓'; }
      else if (cross)             { maScore = 1;  maLabel = 'BUY'; }
      else                        { maScore = -1; maLabel = 'SELL'; }
      signals.push({ name: 'SMA 50/200', value: `${sma50v.toFixed(2)} / ${sma200v.toFixed(2)}`, signal: maLabel, score: maScore, weight: 2.0 });
    }

    // 5. Stochastic Oscillator
    const { k: stochK } = this.stochastic(highs, lows, closes);
    const stochVal = stochK[n];
    if (stochVal !== null) {
      let stScore, stLabel;
      if (stochVal < 20)      { stScore = 2;  stLabel = 'STRONG BUY'; }
      else if (stochVal < 40) { stScore = 1;  stLabel = 'BUY'; }
      else if (stochVal < 60) { stScore = 0;  stLabel = 'NEUTRAL'; }
      else if (stochVal < 80) { stScore = -1; stLabel = 'SELL'; }
      else                    { stScore = -2; stLabel = 'STRONG SELL'; }
      signals.push({ name: 'Stochastic (14)', value: stochVal.toFixed(1), signal: stLabel, score: stScore, weight: 1.0 });
    }

    // 6. OBV Trend
    const obvVals = this.obv(closes, volumes);
    const obvSma = this.sma(obvVals, 20);
    const obvTrend = obvVals[n] > obvSma[n];
    const prevOBVtrend = obvVals[n - 1] > obvSma[n - 1];
    let obvScore, obvLabel;
    if (obvTrend && !prevOBVtrend)  { obvScore = 2;  obvLabel = 'STRONG BUY'; }
    else if (!obvTrend && prevOBVtrend){ obvScore = -2; obvLabel = 'STRONG SELL'; }
    else if (obvTrend)              { obvScore = 1;  obvLabel = 'BUY'; }
    else                            { obvScore = -1; obvLabel = 'SELL'; }
    signals.push({ name: 'OBV (Volume)', value: obvTrend ? 'Rising' : 'Falling', signal: obvLabel, score: obvScore, weight: 1.3 });

    // 7. Price momentum (10-day)
    const mom10 = ((closes[n] - closes[n - 10]) / closes[n - 10]) * 100;
    let momScore, momLabel;
    if (mom10 > 5)        { momScore = 2;  momLabel = 'STRONG BUY'; }
    else if (mom10 > 1)   { momScore = 1;  momLabel = 'BUY'; }
    else if (mom10 > -1)  { momScore = 0;  momLabel = 'NEUTRAL'; }
    else if (mom10 > -5)  { momScore = -1; momLabel = 'SELL'; }
    else                  { momScore = -2; momLabel = 'STRONG SELL'; }
    signals.push({ name: 'Momentum (10d)', value: `${mom10.toFixed(2)}%`, signal: momLabel, score: momScore, weight: 1.1 });

    // ── Aggregate ────────────────────────────────────────────────────────────
    const totalWeight = signals.reduce((a, s) => a + s.weight, 0);
    const weightedScore = signals.reduce((a, s) => a + s.score * s.weight, 0) / totalWeight;

    const buyCount    = signals.filter(s => s.score > 0).length;
    const sellCount   = signals.filter(s => s.score < 0).length;
    const neutralCount = signals.filter(s => s.score === 0).length;

    let direction, confidence;
    if (weightedScore > 0.5)       { direction = 'UP';      confidence = Math.min(95, 50 + weightedScore * 25); }
    else if (weightedScore < -0.5) { direction = 'DOWN';    confidence = Math.min(95, 50 + Math.abs(weightedScore) * 25); }
    else                           { direction = 'NEUTRAL'; confidence = Math.max(40, 70 - Math.abs(weightedScore) * 30); }

    // Support & Resistance from recent highs/lows
    const recent = bars.slice(-30);
    const support    = +Math.min(...recent.map(b => b.low)).toFixed(2);
    const resistance = +Math.max(...recent.map(b => b.high)).toFixed(2);

    // ATR for volatility
    const atrVals = this.atr(highs, lows, closes);
    const currentATR = atrVals[n];
    const atrPct = currentATR ? +((currentATR / closes[n]) * 100).toFixed(2) : 0;

    const reasoning = this._buildReasoning(direction, signals, weightedScore, atrPct);
    const patterns  = this._detectPatterns(bars.slice(-5));

    return {
      direction,
      confidence: +confidence.toFixed(1),
      weightedScore: +weightedScore.toFixed(3),
      signals,
      patterns,
      buyCount,
      sellCount,
      neutralCount,
      support,
      resistance,
      atrPct,
      reasoning,
      currentPrice: +closes[n].toFixed(2),
      rsi: rsi ? +rsi.toFixed(1) : null
    };
  },

  _detectPatterns(bars) {
    const patterns = [];
    if (bars.length < 3) return patterns;
    const n = bars.length - 1;
    const c = bars[n], p = bars[n-1], pp = bars[n-2];
    const body  = v => Math.abs(v.close - v.open);
    const range = v => v.high - v.low || 0.0001;
    const bull  = v => v.close > v.open;

    // Doji — open ≈ close
    if (body(c) / range(c) < 0.1)
      patterns.push({ name: 'Doji', bull: true });

    // Hammer — lower wick > 2× body, small upper wick, can be either color
    const lowerWick = c.open < c.close ? c.open - c.low : c.close - c.low;
    const upperWick = c.open < c.close ? c.high - c.close : c.high - c.open;
    if (lowerWick > 2 * body(c) && upperWick < body(c) * 0.5 && !bull(p))
      patterns.push({ name: 'Hammer', bull: true });

    // Shooting Star — upper wick > 2× body, small lower wick, after uptrend
    if (upperWick > 2 * body(c) && lowerWick < body(c) * 0.5 && bull(p))
      patterns.push({ name: 'Shooting Star', bull: false });

    // Bullish Engulfing
    if (!bull(p) && bull(c) && c.open < p.close && c.close > p.open)
      patterns.push({ name: 'Bullish Engulfing', bull: true });

    // Bearish Engulfing
    if (bull(p) && !bull(c) && c.open > p.close && c.close < p.open)
      patterns.push({ name: 'Bearish Engulfing', bull: false });

    // Morning Star — bearish, small body, bullish (3-candle reversal)
    if (!bull(pp) && body(p)/range(p) < 0.3 && bull(c) && c.close > (pp.open + pp.close)/2)
      patterns.push({ name: 'Morning Star', bull: true });

    // Evening Star
    if (bull(pp) && body(p)/range(p) < 0.3 && !bull(c) && c.close < (pp.open + pp.close)/2)
      patterns.push({ name: 'Evening Star', bull: false });

    return patterns;
  },

  _buildReasoning(direction, signals, score, atrPct) {
    const strongSignals = signals.filter(s => Math.abs(s.score) === 2);
    const lines = [];
    if (direction === 'UP') {
      lines.push(`AI analysis indicates a BULLISH outlook with a composite score of ${score.toFixed(2)}.`);
      lines.push(`${signals.filter(s=>s.score>0).length} of ${signals.length} indicators are signaling buying pressure.`);
    } else if (direction === 'DOWN') {
      lines.push(`AI analysis indicates a BEARISH outlook with a composite score of ${score.toFixed(2)}.`);
      lines.push(`${signals.filter(s=>s.score<0).length} of ${signals.length} indicators are signaling selling pressure.`);
    } else {
      lines.push(`AI analysis shows NEUTRAL momentum — market is consolidating.`);
      lines.push(`Indicators are evenly split between bullish and bearish signals.`);
    }
    if (strongSignals.length > 0) {
      lines.push(`Strong signals from: ${strongSignals.map(s=>s.name).join(', ')}.`);
    }
    lines.push(`Volatility (ATR): ${atrPct}% — ${atrPct > 3 ? 'HIGH risk environment' : atrPct > 1.5 ? 'MODERATE volatility' : 'LOW volatility'}.`);
    lines.push(`Note: AI predictions are for educational purposes only. Always do your own research.`);
    return lines;
  }
};
