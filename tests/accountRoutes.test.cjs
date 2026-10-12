'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { installAccountRoutes } = require('../accountRoutes');

function setup(user) {
  const handlers = new Map();
  const app = {};
  for (const method of ['get','post','patch','delete']) {
    app[method] = (route, ...fns) => handlers.set(method.toUpperCase() + ' ' + route, fns.at(-1));
  }
  const deleted = [];
  const User = {
    findById: async id => String(id) === 'owner1' ? user : null,
    findByIdAndUpdate: async (id, patch) => {
      if (id !== 'owner1') return null;
      if (patch.$inc) user.tokenVersion += patch.$inc.tokenVersion;
      else Object.assign(user, patch);
      return user;
    },
    deleteOne: async query => { deleted.push(query); },
    findOne: async () => null
  };
  const Holding = { deleteMany: async query => { deleted.push({ holdings: query }); } };
  installAccountRoutes(app, {
    User, Holding, allowedEmail: 'owner@example.com',
    authMW: (_r, _s, next) => next(), dbRequired: (_r,_s,next) => next()
  });
  function res() {
    return { statusCode: 200, status(v) { this.statusCode = v; return this; },
      set() { return this; }, json(v) { this.body = v; return this; } };
  }
  return { handlers, deleted, res };
}

test('profile edit updates the authenticated MongoDB record', async () => {
  const u = { _id:'owner1', name:'Old', email:'owner@example.com', tokenVersion:0 };
  const { handlers, res } = setup(u);
  const output = res();
  await handlers.get('PATCH /api/user/profile')({ user:{ id:'owner1' }, body:{ name:'New Name' } }, output);
  assert.equal(output.statusCode, 200);
  assert.equal(u.name, 'New Name');
});

test('password update requires correct current password and revokes existing JWT versions', async () => {
  const u = { _id:'owner1', tokenVersion:0,
    password:await bcrypt.hash('GoodPassword123',10), async save(){ return this; } };
  const { handlers, res } = setup(u);
  const handler = handlers.get('POST /api/user/change-password');
  const bad = res();
  await handler({ user:{id:'owner1'}, body:{currentPassword:'wrong',newPassword:'NextPassword123'}},bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(u.tokenVersion, 0);
  const good = res();
  await handler({ user:{id:'owner1'}, body:{currentPassword:'GoodPassword123',newPassword:'NextPassword123'}},good);
  assert.equal(good.statusCode, 200);
  assert.equal(u.tokenVersion, 1);
  assert.equal(await bcrypt.compare('NextPassword123',u.password),true);
});

test('deleting account without the password does not delete any data', async () => {
  const u = { _id:'owner1', password:await bcrypt.hash('Password123',10), tokenVersion:0 };
  const { handlers, deleted, res } = setup(u);
  const output = res();
  await handlers.get('DELETE /api/user/account')({user:{id:'owner1'},body:{password:'wrong'}},output);
  assert.equal(output.statusCode,401);
  assert.equal(deleted.length,0);
});

test('portfolio deletion is scoped to the logged-in account', async () => {
  const u = { _id:'owner1' };
  const {handlers,deleted,res} = setup(u);
  await handlers.get('DELETE /api/user/portfolio')({user:{id:'owner1'}},res());
  assert.deepEqual(deleted, [{holdings:{userId:'owner1'}}]);
});
