'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { installAccountRoutes } = require('../accountRoutes');

const key = 'mock-test-key-' + 'x'.repeat(36);
const email = 'owner@example.invalid';
function fixture(existing = true) {
  const handlers = {};
  const app = {};
  for (const method of ['get', 'post', 'patch', 'delete'])
    app[method] = (route, ...fns) => { handlers[method + ' ' + route] = fns.at(-1); };
  const events = [];
  const user = existing ? { _id: 'original-id', name: 'Original', email, watchlist: ['AAPL'], tokenVersion: 0 } : null;
  const User = {
    async findOneAndUpdate(_filter, update) {
      events.push('updated');
      if (!user) return null;
      user.password = update.$set.password;
      user.tokenVersion += update.$inc.tokenVersion;
      return user;
    },
    async create(data) { events.push('created'); return data; }
  };
  installAccountRoutes(app, {
    User, Holding: {}, allowedEmail: email,
    authMW: () => {}, dbRequired: () => {}
  });
  const res = { code: 200, status(n) { this.code=n;return this; },
    set() {return this;},json(v){this.body=v;return this;} };
  return {handler:handlers['post /api/auth/restore-owner'],events,user,res};
}
const request = setup => ({body:{email,name:'Owner',password:'NewPassword123',ownerSetupKey:setup}});

test('existing owner login can be restored without changing identity or watchlist',async()=>{
 const saved=process.env.OWNER_SETUP_KEY;
 process.env.OWNER_SETUP_KEY=key;
 try {
  const f=fixture(true);
  await f.handler(request(key),f.res);
  assert.equal(f.res.code,200);
  assert.equal(f.user._id,'original-id');
  assert.deepEqual(f.user.watchlist,['AAPL']);
  assert.equal(f.user.tokenVersion,1);
  assert.deepEqual(f.events,['updated']);
  assert.equal(await bcrypt.compare('NewPassword123',f.user.password),true);
 } finally { if(saved===undefined)delete process.env.OWNER_SETUP_KEY;else process.env.OWNER_SETUP_KEY=saved; }
});

test('wrong setup key never changes a user record',async()=>{
 const saved=process.env.OWNER_SETUP_KEY;
 process.env.OWNER_SETUP_KEY=key;
 try {
  const f=fixture(true);
  await f.handler(request('wrong'),f.res);
  assert.equal(f.res.code,403);
  assert.deepEqual(f.events,[]);
 } finally { if(saved===undefined)delete process.env.OWNER_SETUP_KEY;else process.env.OWNER_SETUP_KEY=saved; }
});
