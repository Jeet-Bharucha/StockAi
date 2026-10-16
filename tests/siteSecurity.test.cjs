'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAllowedPublicPath,protectStaticFiles,securityHeaders
} = require('../siteSecurity');

test('public frontend pages and their CSS/JS assets remain accessible', () => {
  const valid=[
    '/', '/index.html', '/dashboard.html', '/login.html',
    '/register.html', '/profile.html', '/forgot-password.html',
    '/reset-password.html', '/verify-email.html', '/owner-recovery.html',
    '/favicon.svg', '/favicon.ico', '/manifest.json', '/sw.js',
    '/js/auth.js', '/js/stockApi.js', '/js/signalEvidence.js',
    '/css/pro-terminal.css', '/images/company-logo.webp', '/icons/icon.svg'
  ];
  for(const url of valid) assert.equal(isAllowedPublicPath(url),true,url);
});

test('backend sources, dependencies, credentials and CI files are not public static assets', () => {
  const denied=[
    '/server.js', '/alertEngine.js', '/forwardTracking.js', '/siteAccess.js',
    '/publicSignup.js','/siteSecurity.js','/package.json','/package-lock.json',
    '/.env','/.env.example','/.git/config','/.github/workflows/ci.yml',
    '/node_modules/express/index.js','/tests/auth.test.cjs',
    '/render.yaml','/render-public.yaml','/netlify.toml',
    '/README.md','/docs/public-launch-and-accuracy.md',
    '/js/../server.js','/css/%2e%2e/server.js','/js/%2eenv',
    '/js/%2e%2e%2fserver.js','/js//auth.js','/js/file.exe'
  ];
  for(const url of denied) assert.equal(isAllowedPublicPath(url),false,url);
});

test('frontend guard denies unsafe paths without passing to static handler', () => {
  let nextCalled=false;
  const resp={
    code:200,
    status(n){this.code=n;return this;},
    type(t){this.mime=t;return this;},
    send(data){this.body=data;return this;}
  };
  protectStaticFiles({path:'/server.js'},resp,()=>{nextCalled=true;});
  assert.equal(resp.code,404);
  assert.equal(resp.mime,'text/plain');
  assert.equal(nextCalled,false);
  protectStaticFiles({path:'/js/auth.js'},resp,()=>{nextCalled=true;});
  assert.equal(nextCalled,true);
});

test('browser security headers protect APIs while preserving local HTTP development', () => {
  function head(path,secure) {
    const out={};let next=0;
    securityHeaders({path,secure},{setHeader(k,v){out[k]=v;}},()=>{next++;});
    assert.equal(next,1);
    return out;
  }
  const api=head('/api/user/portfolio',true);
  assert.equal(api['Cache-Control'],'no-store');
  assert.equal(api['X-Content-Type-Options'],'nosniff');
  assert.equal(api['X-Frame-Options'],'DENY');
  assert.match(api['Content-Security-Policy'],/frame-ancestors 'none'/);
  assert.match(api['Strict-Transport-Security'],/max-age=/);
  const local=head('/dashboard.html',false);
  assert.equal(local['Strict-Transport-Security'],undefined);
  assert.equal(local['Cache-Control'],undefined);
});
