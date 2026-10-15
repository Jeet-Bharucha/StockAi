'use strict';

// Single-domain public launch switch. PUBLIC_SITE_ENABLED is deliberately
// separate from sign-up readiness so existing users can still authenticate
// if the email provider becomes temporarily unavailable.
function siteAccess(env = process.env) {
  const allowedEmail = String(env.ALLOWED_EMAIL || '').trim().toLowerCase();
  const ownerEmail = String(env.OWNER_EMAIL || allowedEmail).trim().toLowerCase();
  const publicEnabled = env.PUBLIC_SITE_ENABLED === 'true';
  if (publicEnabled && !ownerEmail) throw new Error('OWNER_EMAIL is required for public single-site mode');
  return {
    publicEnabled, allowedEmail, ownerEmail,
    isLoginAllowed(email) { return publicEnabled || !allowedEmail || email === allowedEmail; },
    isOwner(email) { return Boolean(ownerEmail && email === ownerEmail); },
    canPublicRegister(email) { return publicEnabled && email !== ownerEmail; },
    requireSitePassword() { return Boolean(env.SITE_PASSWORD && !publicEnabled); }
  };
}

module.exports = {siteAccess};