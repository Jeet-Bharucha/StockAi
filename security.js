'use strict';

// Basic single-instance protection for a staged public beta.
// Replace with a shared/edge limiter before multi-instance deployment.
function createRateLimiter({ windowMs, max, namespace = 'route', keyFn } = {}) {
  if (!(windowMs > 0 && max > 0)) throw Error('Invalid limiter configuration');
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const now = Date.now();
    if (buckets.size > 10000) {
      for (const [key,value] of buckets) if (value.reset <= now) buckets.delete(key);
      if (buckets.size > 10000) buckets.clear();
    }
    const identity = String(keyFn ? keyFn(req) : req.ip || req.socket?.remoteAddress || 'unknown');
    const key = namespace + ':' + identity;
    let value = buckets.get(key);
    if (!value || value.reset <= now) value = { count: 0, reset: now + windowMs };
    value.count++;
    buckets.set(key,value);
    if (value.count > max) {
      const retry = Math.max(1, Math.ceil((value.reset-now)/1000));
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    next();
  };
}
module.exports = { createRateLimiter };