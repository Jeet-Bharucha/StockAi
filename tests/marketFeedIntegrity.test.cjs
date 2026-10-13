'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'stockApi.js'), 'utf8');
function setup(fetchImpl) {
  const sandbox = {
    location: { host: '', protocol: 'https:' },
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(source + '\n;globalThis.stockAPIUnderTest = StockAPI;', sandbox);
  return sandbox.stockAPIUnderTest;
}
function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    headers: { get: key => key === 'content-type' ? 'application/json' : null },
    json: async () => data
  };
}

test('valid quote is marked provider-backed and preserves actual price', async () => {
  const api = setup(async () => jsonResponse({
    c: 150.5, d: 1.5, dp: 1.01, h: 151, l: 148, o: 149, pc: 149
  }));
  const q = await api.getQuote('AAPL');
  assert.equal(q.price, 150.5);
  assert.equal(q.live, true);
});

test('provider downtime returns an error instead of inventing a market price', async () => {
  const api = setup(async () => { throw new Error('offline'); });
  await assert.rejects(api.getQuote('AAPL'), /Verified quote unavailable/);
});

test('no or invalid quote cannot become a fake live price', async () => {
  const api = setup(async () => jsonResponse({ c: 0, d: null, dp: null }));
  await assert.rejects(api.getQuote('AAPL'), /No verified quote available/);
});

test('historical data outage cannot generate random candles', async () => {
  const api = setup(async () => { throw new Error('offline'); });
  await assert.rejects(api.getCandles('AAPL'), /Historical candles unavailable/);
});

test('market overview explicitly marks unavailable symbols', async () => {
  const api = setup(async () => { throw new Error('offline'); });
  const overview = await api.getMarketOverview();
  assert.equal(overview.length, 6);
  assert.ok(overview.every(item => item.available === false));
  assert.ok(overview.every(item => item.price === undefined));
});
