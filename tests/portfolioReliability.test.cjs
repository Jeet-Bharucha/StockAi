'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'features.js'), 'utf8');
const mockHolding = {
  id: 'mongo-abc', symbol: 'AAPL', name: 'Apple Inc.',
  shares: 2, buyPrice: 100, assetType: 'stock', accountType: 'taxable'
};

function setup(handler) {
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    return handler(url, options);
  };
  const store = new Map();
  const localStorage = {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, val) { store.set(key, String(val)); },
    removeItem(key) { store.delete(key); }
  };
  const sandbox = {
    fetch, AbortController, setTimeout, clearTimeout,
    console, localStorage,
    window: { showToast() {} },
    Auth: { isGuest: () => false, _authHeader: () => ({ Authorization: 'Bearer mock', 'Content-Type': 'application/json' }), getSession:()=>({userId:'owner'}) }
  };
  vm.createContext(sandbox);
  vm.runInContext(source + '\n;globalThis.testPortfolio = Portfolio;', sandbox);
  return { portfolio: sandbox.testPortfolio, requests };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test('portfolio uses MongoDB response rather than old local storage', async () => {
  const { portfolio, requests } = setup(async () => response(200, [mockHolding]));
  const items = await portfolio.load();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'mongo-abc');
  assert.equal(portfolio.lastError, null);
  assert.equal(requests[0].url, '/api/user/portfolio');
  assert.match(requests[0].options.headers.Authorization, /^Bearer /);
});

test('a failed add never reports a phantom saved holding', async () => {
  const { portfolio } = setup(async (url, opts) =>
    opts.method === 'POST' ? response(503, { error:'Database unavailable' }) : response(200, [mockHolding])
  );
  await portfolio.load();
  await assert.rejects(portfolio.add('NVDA', 1, 200), /Database unavailable/);
  assert.equal(portfolio.get().length, 1);
  assert.equal(portfolio.get()[0].symbol, 'AAPL');
});

test('successful addition updates the view only after server confirms', async () => {
  const { portfolio, requests } = setup(async (url, opts) =>
    opts.method === 'POST' ? response(200, { ...mockHolding, id: 'second-holding', symbol: 'MSFT' }) : response(200, [mockHolding])
  );
  await portfolio.load();
  await portfolio.add('MSFT', 3, 120);
  assert.equal(portfolio.get().length, 2);
  assert.equal(portfolio.get()[1].id, 'second-holding');
  assert.equal(requests[1].options.method, 'POST');
});

test('failed edit preserves prior holding values', async () => {
  const { portfolio } = setup(async (url, opts) =>
    opts.method === 'PUT' ? response(401, { error:'Session expired' }) : response(200, [mockHolding])
  );
  await portfolio.load();
  await assert.rejects(portfolio.update('mongo-abc', { shares:99 }), /Session expired/);
  assert.equal(portfolio.get()[0].shares, 2);
});

test('successful deletion removes only the confirmed holding', async () => {
  const { portfolio, requests } = setup(async (url, opts) =>
    opts.method === 'DELETE' ? response(200, { ok:true }) : response(200, [mockHolding])
  );
  await portfolio.load();
  await portfolio.remove('mongo-abc');
  assert.equal(portfolio.get().length, 0);
  assert.equal(requests[1].url, '/api/user/portfolio/mongo-abc');
  assert.equal(requests[1].options.method, 'DELETE');
});

test('temporary network failure preserves already-loaded portfolio and exposes an error', async () => {
  let available = true;
  const { portfolio } = setup(async () => {
    if (!available) throw new Error('offline');
    return response(200, [mockHolding]);
  });
  await portfolio.load();
  available = false;
  await portfolio.load();
  assert.equal(portfolio.get()[0].symbol, 'AAPL');
  assert.match(portfolio.lastError, /offline/);
});

test('portfolio summary does not present a missing market quote as the buy price or zero profit',async()=>{const {portfolio}=setup(async()=>response(200,[mockHolding]));await portfolio.load();const missing=portfolio.summary({});assert.equal(missing.rows[0].currentPrice,null);assert.equal(missing.totalValue,null);assert.equal(missing.totalPL,null);const valid=portfolio.summary({AAPL:{price:120}});assert.equal(valid.totalValue,240);assert.equal(valid.totalPL,40);});
