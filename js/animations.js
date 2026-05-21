/* ── StockAI — 3D Animations & Utilities ──────────────────────────────── */

/* ═══════════════════════════════════════════════════════════════════════
   3D CARD TILT  —  add data-tilt to any element
   Optional attrs: data-tilt-max="10"  data-tilt-scale="1.03"
   ═════════════════════════════════════════════════════════════════════ */
function initTilt(selector, root) {
  var els = (root || document).querySelectorAll(selector || '[data-tilt]');
  els.forEach(function(card) {
    if (card._tiltInit) return;
    card._tiltInit = true;

    var MAX   = +(card.dataset.tiltMax   || 10);
    var SCALE = +(card.dataset.tiltScale || 1.025);

    card.style.willChange    = 'transform';
    card.style.transition    = 'transform 0.08s linear';
    card.style.transformStyle = 'preserve-3d';
    if (!card.style.position || card.style.position === 'static')
      card.style.position = 'relative';
    card.style.overflow = 'hidden';

    // Glare overlay
    var glare = document.createElement('div');
    glare.className = '_tilt-glare';
    glare.style.cssText =
      'position:absolute;inset:0;border-radius:inherit;pointer-events:none;' +
      'opacity:0;transition:opacity .3s;z-index:9';
    card.appendChild(glare);

    card.addEventListener('mousemove', function(e) {
      var r  = card.getBoundingClientRect();
      var nx = (e.clientX - r.left) / r.width  - 0.5;
      var ny = (e.clientY - r.top ) / r.height - 0.5;
      card.style.transform =
        'perspective(900px) rotateX(' + (-ny * MAX * 2) + 'deg) ' +
        'rotateY(' + (nx * MAX * 2) + 'deg) ' +
        'scale3d(' + SCALE + ',' + SCALE + ',' + SCALE + ')';
      var gx = (nx + 0.5) * 100;
      var gy = (ny + 0.5) * 100;
      glare.style.background =
        'radial-gradient(circle at ' + gx + '% ' + gy + '%, ' +
        'rgba(255,255,255,0.13) 0%, transparent 65%)';
      glare.style.opacity = '1';
    });

    card.addEventListener('mouseleave', function() {
      card.style.transition = 'transform 0.5s cubic-bezier(0.03,.98,.52,.99)';
      card.style.transform  = '';
      glare.style.opacity   = '0';
      setTimeout(function() {
        card.style.transition = 'transform 0.08s linear';
      }, 500);
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   ANIMATED NUMBER COUNTER
   animateValue(el, targetNumber, { duration, prefix, suffix, decimals })
   ═════════════════════════════════════════════════════════════════════ */
function animateValue(el, target, opts) {
  if (!el || isNaN(+target)) return;
  opts = opts || {};
  var dur      = opts.duration || 900;
  var prefix   = opts.prefix   || '';
  var suffix   = opts.suffix   || '';
  var decimals = opts.decimals || 0;
  var from     = parseFloat((el.textContent || '').replace(/[^0-9.-]/g, '')) || 0;
  var t0       = performance.now();

  (function tick(now) {
    var p    = Math.min((now - t0) / dur, 1);
    var ease = 1 - Math.pow(1 - p, 3);
    var val  = from + (target - from) * ease;
    el.textContent =
      prefix +
      (decimals ? val.toFixed(decimals) : Math.round(val).toLocaleString()) +
      suffix;
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

/* ═══════════════════════════════════════════════════════════════════════
   STAGGERED CARD ENTRANCE
   animateCardsIn('.selector')  — fades + slides cards in with stagger
   ═════════════════════════════════════════════════════════════════════ */
function animateCardsIn(selector, root) {
  var els = (root || document).querySelectorAll(selector);
  els.forEach(function(el, i) {
    el.style.opacity   = '0';
    el.style.transform = 'translateY(16px) scale(0.97)';
    el.style.transition =
      'opacity .3s ease ' + (i * 0.05) + 's, transform .3s ease ' + (i * 0.05) + 's';
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        el.style.opacity   = '';
        el.style.transform = '';
      });
    });
  });
}
