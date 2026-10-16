'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { publicSettings, registerPublic, generateVerification, installVerificationRoutes } = require('../publicSignup');
const env={ PUBLIC_SITE_ENABLED:'true', PUBLIC_SIGNUPS_ENABLED:'true', SITE_URL:'https://stockai-main.onrender.com',
  RESEND_API_KEY:'test_key', RESEND_FROM_EMAIL:'verified@example.org' };

test('public signup is opt-in and cannot borrow owner-only settings',()=>{
  assert.equal(publicSettings({env}).registrationOpen,true);
  assert.equal(publicSettings({env,allowedEmail:'owner@example.com'}).registrationOpen,true);
  assert.equal(publicSettings({env,allowedEmail:'owner@example.com'}).mode,'public');
  assert.equal(publicSettings({env:{...env,PUBLIC_SITE_ENABLED:'false'},allowedEmail:'owner@example.com'}).registrationOpen,false);
  assert.equal(publicSettings({env:{...env,PUBLIC_SITE_ENABLED:'false'},allowedEmail:'owner@example.com'}).mode,'private');
  assert.equal(publicSettings({env:{...env,PUBLIC_SIGNUPS_ENABLED:'false'}}).registrationOpen,false);
  assert.equal(publicSettings({env:{...env,RESEND_API_KEY:''}}).registrationOpen,false);
  assert.equal(publicSettings({env:{...env,SITE_URL:'http://localhost:3001'}}).registrationOpen,false);
});

test('verification tokens are random and only a digest is stored',()=>{
  const a=generateVerification(),b=generateVerification();
  assert.match(a.token,/^[0-9a-f]{64}$/);
  assert.notEqual(a.token,b.token);
  assert.notEqual(a.token,a.hash);
  assert.equal(a.hash,crypto.createHash('sha256').update(a.token).digest('hex'));
});

test('public signup does not issue login tokens before proof of email',async()=>{
  let saved,mailToken;
  const User={create:async u=>(saved={_id:'new-user',...u}),deleteOne:async()=>{}};
  const result=await registerPublic({
    User,email:'person@example.com',name:'Person',hashedPassword:'hashed',env,
    deliver:async(_to,token)=>{mailToken=token;}
  });
  assert.equal(result.pendingVerification,true);
  assert.equal(result.token,undefined);
  assert.equal(saved.emailVerified,false);
  assert.equal(saved.emailVerifyHash,crypto.createHash('sha256').update(mailToken).digest('hex'));
  assert.ok(saved.emailVerifyExpires>Date.now());
});

test('failed initial verification delivery removes only new unverified user',async()=>{
  const deletions=[];
  const User={create:async()=>({_id:'new-user'}),deleteOne:async filter=>{deletions.push(filter);}};
  await assert.rejects(registerPublic({
    User,email:'person@example.com',name:'P',hashedPassword:'hash',env,
    deliver:async()=>{throw Error('provider unavailable');}
  }),/provider unavailable/);
  assert.deepEqual(deletions,[{_id:'new-user',emailVerified:false}]);
});

test('valid verification token is single use and enables this user',async()=>{
  const handlers=new Map();
  const app={post:(route,...fns)=>handlers.set(route,fns.at(-1))};
  const record={_id:'id',email:'person@example.com',emailVerified:false};
  const {token,hash}=generateVerification();
  let calls=0;
  const User={
    async findOneAndUpdate(query,update){
      calls++;
      assert.equal(query.emailVerifyHash,hash);
      if(!record.emailVerified) {
        record.emailVerified=update.$set.emailVerified;
        return record;
      }
      return null;
    }
  };
  installVerificationRoutes(app,{User,dbRequired:()=>{},allowedEmail:'',rateLimit:()=>{}});
  const res=()=>({code:200,status(n){this.code=n;return this;},json(x){this.body=x;return this;}});
  const fn=handlers.get('/api/auth/verify-email');
  const first=res();await fn({body:{token}},first);
  assert.equal(first.code,200);assert.equal(record.emailVerified,true);
  const second=res();await fn({body:{token}},second);
  assert.equal(second.code,400);assert.equal(calls,2);
});
