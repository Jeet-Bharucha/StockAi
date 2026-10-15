'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {siteAccess} = require('../siteAccess');
const {publicSettings} = require('../publicSignup');

const env = {
  ALLOWED_EMAIL:'existing-owner@example.com',SITE_PASSWORD:'do-not-publish-secret',
  JWT_SECRET:'a-previously-used-owner-token-secret',
  PUBLIC_SIGNUPS_ENABLED:'true',PUBLIC_SITE_ENABLED:'false',
  RESEND_API_KEY:'test',RESEND_FROM_EMAIL:'verified@example.com',
  SITE_URL:'https://stockai-main.onrender.com'
};

test('default private deployment remains completely owner only', () => {
  const a=siteAccess(env);
  assert.equal(a.publicEnabled,false);
  assert.equal(a.requireSitePassword(),true);
  assert.equal(a.isOwner('existing-owner@example.com'),true);
  assert.equal(a.isLoginAllowed('existing-owner@example.com'),true);
  assert.equal(a.isLoginAllowed('friend@example.com'),false);
  assert.equal(a.canPublicRegister('friend@example.com'),false);
  assert.equal(publicSettings({allowedEmail:a.allowedEmail,env}).registrationOpen,false);
});

test('single-site public flag admits normal users without revoking owner or opening owner APIs', () => {
  const switched={...env,PUBLIC_SITE_ENABLED:'true'};
  const a=siteAccess(switched);
  assert.equal(a.publicEnabled,true);
  assert.equal(a.requireSitePassword(),false);
  assert.equal(a.isLoginAllowed('friend@example.com'),true);
  assert.equal(a.canPublicRegister('friend@example.com'),true);
  assert.equal(a.canPublicRegister('existing-owner@example.com'),false);
  assert.equal(a.isOwner('existing-owner@example.com'),true);
  assert.equal(a.isOwner('friend@example.com'),false);
  assert.equal(publicSettings({allowedEmail:a.allowedEmail,env:switched}).registrationOpen,true);
});

test('no email delivery means no new public registrations even though existing users can login', () => {
  const switched={...env,PUBLIC_SITE_ENABLED:'true',RESEND_API_KEY:''};
  const a=siteAccess(switched);
  assert.equal(a.isLoginAllowed('already-verified@example.com'),true);
  assert.equal(publicSettings({allowedEmail:a.allowedEmail,env:switched}).registrationOpen,false);
});

test('explicit OWNER_EMAIL overrides historic allowlist without importing or deleting users', () => {
  const a=siteAccess({...env,OWNER_EMAIL:'Owner-Changed@Example.Com',PUBLIC_SITE_ENABLED:'true'});
  assert.equal(a.ownerEmail,'owner-changed@example.com');
  assert.equal(a.isOwner('owner-changed@example.com'),true);
  assert.equal(a.isOwner('existing-owner@example.com'),false);
});

test('opening an installation without identifying its owner fails closed', () => {
  assert.throws(()=>siteAccess({PUBLIC_SITE_ENABLED:'true'}),/OWNER_EMAIL/);
});
