'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth.js'), 'utf8');

function memoryStorage() {
  const items = new Map();
  return {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key)
  };
}

function response(status, body, contentType = 'application/json') {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    json: async () => typeof body === 'string' ? JSON.parse(body) : body
  };
}

function setup(fetchImpl) {
  const storage = memoryStorage();
  const ctx = {
    fetch: fetchImpl,
    localStorage: storage,
    sessionStorage: memoryStorage(),
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    console
  };
  vm.createContext(ctx);
  vm.runInContext(source + '\n;globalThis.authUnderTest = Auth;', ctx);
  return { auth: ctx.authUnderTest, storage };
}

test('successful login stores the token and session', async () => {
  const user = { id: '123', name: 'Demo', email: 'demo@example.com' };
  const { auth, storage } = setup(async () => response(200, { token: 'token', user }));
  const result = await auth.login(user.email, 'password');
  assert.equal(result.success, true);
  assert.equal(storage.getItem('stockai_jwt'), 'token');
  assert.equal(auth.getSession().email, user.email);
});

test('invalid credentials show the API error, not a server error', async () => {
  const { auth } = setup(async () => response(401, { error: 'Invalid email or password' }));
  const result = await auth.login('demo@example.com', 'wrong');
  assert.equal(result.success, false);
  assert.match(result.error, /Invalid email or password/);
});

test('disconnected MongoDB returns actionable login feedback', async () => {
  const { auth } = setup(async () => response(503, { error: 'Database not connected' }));
  const result = await auth.login('demo@example.com', 'password');
  assert.match(result.error, /MongoDB is disconnected/);
});

test('HTML from a misconfigured proxy is identified instead of treated as an auth response', async () => {
  const { auth } = setup(async () => response(200, '<html>404 not found</html>', 'text/html'));
  const result = await auth.login('demo@example.com', 'password');
  assert.match(result.error, /api proxy/);
});

test('upstream outage is different from invalid credentials', async () => {
  const { auth } = setup(async () => response(502, '<html>Bad gateway</html>', 'text/html'));
  const result = await auth.login('demo@example.com', 'password');
  assert.match(result.error, /backend is unavailable/);
});

test('health check distinguishes Node up with MongoDB down', async () => {
  const { auth } = setup(async () => response(503, {
    service: 'stockai',
    ok: false,
    database: 'disconnected'
  }));
  const result = await auth.checkServer();
  assert.equal(result.state, 'database');
});

test('health check passes only when the database is connected', async () => {
  const { auth } = setup(async () => response(200, {
    service: 'stockai',
    ok: true,
    database: 'connected'
  }));
  const result = await auth.checkServer();
  assert.equal(result.state, 'online');
});

test('network failures do not leak implementation exceptions to users', async () => {
  const { auth } = setup(async () => { throw new TypeError('Failed to fetch'); });
  const result = await auth.login('demo@example.com', 'password');
  assert.match(result.error, /Cannot reach the StockAI server/);
});
