'use strict';

// Historical OHLCV data used by charts and scheduled alert scans.
// Finnhub /stock/candle currently returns HTTP 403 for accounts without
// historical-candle entitlement. Read from the already-used Yahoo chart
// endpoint instead, keeping the existing Finnhub quote/WebSocket feed.
const INTERVALS = Object.freeze({
  '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '60m',
  'D': '1d', 'W': '1wk', 'M': '1mo'
});
const CACHE_MS = 15 * 60 * 1000;
const cache = new Map();

function normalizeBars(data) {
  if (data?.chart?.error) {
    throw new Error('Historical data provider: ' + (data.chart.error.description || data.chart.error.code || 'unavailable'));
  }
  const result = data?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const q = result?.indicators?.quote?.[0];
  if (!Array.isArray(timestamps) || !q) return [];
  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    const time = Number(timestamps[i]);
    const open = Number(q.open?.[i]);
    const high = Number(q.high?.[i]);
    const low = Number(q.low?.[i]);
    const close = Number(q.close?.[i]);
    const volume = Number(q.volume?.[i] ?? 0);
    if (![time, open, high, low, close].every(Number.isFinite)) continue;
    if (Math.min(open, high, low, close) <= 0 || high < Math.max(open, close, low)) continue;
    if (low > Math.min(open, close, high)) continue;
    rows.push({ time, open, high, low, close, volume: Number.isFinite(volume) && volume >= 0 ? volume : 0 });
  }
  rows.sort((a, b) => a.time - b.time);
  return rows.filter((row, i) => i === 0 || row.time !== rows[i - 1].time);
}

async function fetchHistoricalBars(symbol, opts = {}) {
  const { from, to, resolution = 'D', fetchImpl = globalThis.fetch } = opts;
  if (!/^[a-zA-Z0-9.\^=-]{1,25}$/.test(symbol || '')) {
    throw new Error('Invalid stock symbol');
  }
  const interval = INTERVALS[resolution];
  if (!interval) throw new Error('Unsupported candle resolution');
  const start = Math.floor(Number(from)), end = Math.floor(Number(to));
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end <= start) {
    throw new Error('Invalid historical time range');
  }
  // Yahoo period2 is exclusive. Include the requested daily closing candle.
  const period2 = end + (['D','W','M'].includes(resolution) ? 86400 : 1);
  const key = [symbol.toUpperCase(), interval, Math.floor(start / 86400), Math.floor(end / 86400)].join('|');
  const cacheEntry = cache.get(key);
  const useCache = fetchImpl === globalThis.fetch;
  if (useCache && cacheEntry && Date.now() - cacheEntry.ts < CACHE_MS) return cacheEntry.bars;

  const url = 'https://query2.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(symbol.toUpperCase()) + '?period1=' + start +
    '&period2=' + period2 + '&interval=' + encodeURIComponent(interval);
  const resp = await fetchImpl(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockAI/1.0)', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(12000)
  });
  if (!resp.ok) throw new Error('Historical data provider HTTP ' + resp.status);
  const bars = normalizeBars(await resp.json());
  if (!bars.length) throw new Error('No usable market candles were returned for ' + symbol);
  if (useCache) {
    if (cache.size >= 100) cache.clear(); // prevent unbounded growth
    cache.set(key, { bars, ts: Date.now() });
  }
  return bars;
}

function toFinnhubCandleFormat(bars) {
  return {
    s: bars.length ? 'ok' : 'no_data',
    t: bars.map(b => b.time),
    o: bars.map(b => b.open),
    h: bars.map(b => b.high),
    l: bars.map(b => b.low),
    c: bars.map(b => b.close),
    v: bars.map(b => b.volume)
  };
}

module.exports = { fetchHistoricalBars, toFinnhubCandleFormat, normalizeBars };
