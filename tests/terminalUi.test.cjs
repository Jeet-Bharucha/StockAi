'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const pages = [
  'index.html', 'login.html', 'register.html', 'dashboard.html',
  'profile.html', 'forgot-password.html', 'reset-password.html',
  'owner-recovery.html'
];

for (const page of pages) {
  test(page + ': scripts parse, styles load, and local JS assets exist', () => {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(html, /<html[^>]+lang=/i);
    assert.match(html, /<body\b/i);
    assert.match(html, /css\/pro-terminal\.css/);
    const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    for (let i = 0; i < inline.length; i++) {
      const script = inline[i][1];
      if (script.trim())
        assert.doesNotThrow(() => new vm.Script(script, {filename:page + ':' + i}));
    }
    for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
      const src = tag[0].match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!src || !/^(?:js|css)\//.test(src)) continue;
      assert.ok(fs.existsSync(path.join(root, src)), 'Missing '+src+' from '+page);
    }
  });
}

test('terminal uses the muted steel-blue palette instead of bright teal', () => {
  const theme = fs.readFileSync(path.join(root,'css/pro-terminal.css'), 'utf8');
  const dash = fs.readFileSync(path.join(root,'dashboard.html'), 'utf8');
  assert.match(theme, /--cyan:#(?:839fc9|88a5cc)/i);
  assert.doesNotMatch(theme, /#00c9a7/i);
  assert.doesNotMatch(dash, /#00c9a7/i);
  assert.match(dash, /id="sidebar-backdrop"/);
  assert.match(dash, /aria-expanded="false"/);
  assert.match(dash, /id="btn-refresh-market"/);
});

test('dashboard keeps persistent portfolio and starts market panels independently', () => {
  const js = fs.readFileSync(path.join(root,'js/dashboard.js'), 'utf8');
  assert.match(js, /void renderPortfolio\(\)\.catch/);
  assert.match(js, /window\.refreshMarketData = async function/);
  assert.match(js, /ResizeObserver/);
  assert.match(js, /setSidebarOpen\(false\)/);
  assert.doesNotMatch(js, /await updateMarket\(\);\s*const _prefs/);
});
