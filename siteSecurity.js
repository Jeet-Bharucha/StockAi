'use strict';

// Render serves the frontend from the repository root. Never let the static
// middleware expose backend source, deployment files, lockfiles or test code.
const PAGE_PATHS = new Set([
  '/', '/index.html', '/dashboard.html', '/login.html', '/register.html',
  '/profile.html', '/forgot-password.html', '/reset-password.html',
  '/owner-recovery.html', '/verify-email.html', '/404.html'
]);
const ROOT_ASSETS = new Set([
  '/favicon.svg', '/favicon.ico', '/manifest.json', '/sw.js',
  '/robots.txt', '/apple-touch-icon.png'
]);
const ASSET_RE = /^\/(?:css|js|assets|images|img|icons|fonts)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:css|js|svg|png|webp|jpg|jpeg|gif|ico|woff2?)$/;

function isAllowedPublicPath(urlPath) {
  if (typeof urlPath !== 'string' || urlPath.length > 260) return false;
  let decoded;
  try { decoded = decodeURIComponent(urlPath); }
  catch (_) { return false; }
  if (!decoded.startsWith('/') || decoded.includes('\\') ||
      decoded.includes('//') || decoded.split('/').some(part=>part==='.'||part==='..'||part.startsWith('.'))) {
    return false;
  }
  return PAGE_PATHS.has(decoded) || ROOT_ASSETS.has(decoded) || ASSET_RE.test(decoded);
}

function protectStaticFiles(req,res,next) {
  if (!isAllowedPublicPath(req.path)) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  next();
}

function securityHeaders(req,res,next) {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options','DENY');
  // No script-src yet: legacy StockAI pages contain inline JavaScript.
  // These directives still stop hostile framing, plugins and base URL changes.
  res.setHeader('Content-Security-Policy',"frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if (req.secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
  if (req.path?.startsWith('/api/')) res.setHeader('Cache-Control','no-store');
  next();
}

module.exports={isAllowedPublicPath,protectStaticFiles,securityHeaders};
