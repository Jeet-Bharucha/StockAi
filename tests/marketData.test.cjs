'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchHistoricalBars, toFinnhubCandleFormat, normalizeBars } = require('../marketData');

const fixture = {
  chart: { result: [{
    timestamp: [1729123200, 1729209600, 1729296000],
    indicators: { quote: [{
      open: [150, null, 152],
      high: [155, null, 156],
      low: [149, null, 151],
      close: [153, null, 154],
      volume: [400, null, 600]
    }] }
  }], error: null }
};

test('converts actual OHLCV bars to chart API format without simulated data', async () => {
  const calls = [];
  const bars = await fetchHistoricalBars('AAPL', {
    from: 1729000000, to: 1729500000, resolution: 'D',
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => fixture };
    }
  });
  assert.equal(bars.length, 2);
  assert.equal(bars[0].close, 153);
  assert.equal(bars[1].volume, 600);
  assert.match(calls[0], /interval=1d/);
  assert.deepEqual(toFinnhubCandleFormat(bars), {
    s: 'ok', t: [1729123200, 1729296000],
    o: [150, 152], h: [155, 156], l: [149, 151],
    c: [153, 154], v: [400, 600]
  });
});

test('rejects invalid symbols and bad ranges before network access', async () => {
  await assert.rejects(
    fetchHistoricalBars('AAPL&token=bad', { from: 1, to: 2, fetchImpl: async () => { throw new Error('Should not reach'); } }),
    /Invalid stock symbol/
  );
  await assert.rejects(
    fetchHistoricalBars('AAPL', { from: 20, to: 10, fetchImpl: async () => { throw new Error('Should not reach'); } }),
    /Invalid historical time range/
  );
});

test('rejects provider HTTP errors instead of constructing fictional OHLCV data', async () => {
  await assert.rejects(
    fetchHistoricalBars('MSFT', {
      from: 1729000000, to: 1729500000,
      fetchImpl: async () => ({ ok: false, status: 429 })
    }),
    /Historical data provider HTTP 429/
  );
});

test('does not convert malformed or absent candles into fabricated prices', () => {
  assert.deepEqual(normalizeBars({ chart: { result: [] } }), []);
  assert.throws(() => normalizeBars({ chart: { error: { description: 'Unavailable' } } }), /Unavailable/);
});
