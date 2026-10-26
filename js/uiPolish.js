'use strict';
// Keyboard and small-screen navigation; no network calls or account writes.
document.addEventListener('DOMContentLoaded', () => {
  if (!Auth.getSession()) return;
  const focusables = root => [...root.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]
    .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && !el.closest('[inert]'));
  const dialogs = [...document.querySelectorAll('#shortcuts-modal,#edit-hold-modal,#api-modal,#guest-modal')];
  let active = null, returnFocus = null, priorOverflow = '', background = [];
  function syncDialog() {
    const next = dialogs.find(el => !el.classList.contains('hidden')) || null;
    if (next === active) return;
    if (active) {
      for (const [el, inert] of background) el.inert = inert;
      background = [];
      document.body.style.overflow = priorOverflow;
    }
    const previous = active;
    active = next;
    if (next) {
      if (!previous) returnFocus = document.activeElement;
      priorOverflow = document.body.style.overflow;
      background = [...document.body.children].filter(el => el !== next && !el.contains(next) && !['SCRIPT','STYLE'].includes(el.tagName)).map(el => [el, el.inert]);
      for (const [el] of background) el.inert = true;
      document.body.style.overflow = 'hidden';
      (focusables(next)[0] || next).focus();
    } else if (returnFocus?.isConnected && returnFocus.getClientRects().length && !returnFocus.closest('[inert]')) {
      returnFocus.focus();
      returnFocus = null;
    }
  }
  for (const dialog of dialogs) {
    dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    dialog.tabIndex = -1;
    dialog.setAttribute('aria-label', {'shortcuts-modal':'Keyboard shortcuts','edit-hold-modal':'Edit holding','api-modal':'Market data setup','guest-modal':'Account required'}[dialog.id]);
    new MutationObserver(syncDialog).observe(dialog,{attributes:true,attributeFilter:['class']});
  }
  document.addEventListener('keydown', e => {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      active.classList.add('hidden'); syncDialog(); return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables(active), first = items[0], last = items.at(-1);
    if (!items.length) { e.preventDefault(); active.focus(); }
    else if (e.shiftKey && (document.activeElement === first || !active.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !active.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }, true);
  document.addEventListener('focusin', e => {
    if (active && !active.contains(e.target)) (focusables(active)[0] || active).focus();
  });
  syncDialog();

  const main = document.querySelector('.main');
  main.id = 'main-content'; main.tabIndex = -1; main.setAttribute('role','main');
  const skip = document.createElement('a'); skip.href = '#main-content'; skip.textContent = 'Skip to main content'; skip.className = 'skip-content';
  skip.addEventListener('click', () => main.focus()); document.body.prepend(skip);
  document.addEventListener('stockai:tab', e => {
    if (active) return;
    const target = document.getElementById('view-'+e.detail);
    const heading = target?.querySelector('.view-title') || target;
    if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); }
  });
  const quick = document.createElement('section'); quick.className = 'workspace-quick-actions'; quick.setAttribute('aria-label','Research shortcuts');
  const intro = document.createElement('div'), title = document.createElement('strong'), caption = document.createElement('span');
  title.textContent = 'Your research starts here'; caption.textContent = 'Explore verified data, compare companies and check service availability.';
  intro.append(title,caption); quick.append(intro);
  const actions = [
    ['Explore markets', () => window.switchTab(null,'markets')],
    ['Open company comparison', () => reveal('company-comparison')],
    ['View service status', () => reveal('service-readiness')]
  ];
  function reveal(id) {
    const panel = document.getElementById(id); if (!panel) return;
    panel.open = true; panel.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    panel.querySelector('summary')?.focus({preventScroll:true});
  }
  for (const [text, action] of actions) { const b = document.createElement('button'); b.type='button'; b.className='research-btn'; b.textContent=text; b.addEventListener('click',action); quick.append(b); }
  document.getElementById('view-dashboard').prepend(quick);
  document.getElementById('compare-input')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();window.loadCompare();}});
});
