'use strict';

// Account operations for MongoDB-backed logins and profiles.
// Never trust browser localStorage as evidence of account ownership.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');

function installAccountRoutes(app, { User, Holding, authMW, dbRequired, allowedEmail }) {
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  const fromEmail = process.env.RESEND_FROM_EMAIL || '';
  const mailReady = Boolean(process.env.RESEND_API_KEY && fromEmail && /^https:\/\/[^/]+$/i.test(siteUrl));
  const mailer = mailReady ? new Resend(process.env.RESEND_API_KEY) : null;
  const cooldown = new Map();
  const RESET_WINDOW_MS = 15 * 60 * 1000;
  const safeEmail = value => typeof value === 'string' && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.toLowerCase().trim() : null;

  // Exposes settings, never secrets or the owner email.
  app.get('/api/auth/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ mode: allowedEmail ? 'private' : 'public', passwordResetAvailable: mailReady });
  });

  app.post('/api/auth/forgot-password', dbRequired, async (req, res) => {
    const message = 'If the account exists and email recovery is configured, a reset link will be sent.';
    // Always respond generically so nobody can enumerate user emails.
    if (!mailReady) return res.json({ ok: true, message });
    const email = safeEmail(req.body?.email);
    if (!email || (allowedEmail && allowedEmail !== email)) return res.json({ ok: true, message });
    const key = crypto.createHash('sha256').update(email).digest('hex');
    const now = Date.now();
    if (cooldown.size > 5000) cooldown.clear();
    if ((cooldown.get(key) || 0) + RESET_WINDOW_MS > now) return res.json({ ok: true, message });
    cooldown.set(key, now);
    try {
      const user = await User.findOne({ email });
      if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        user.passwordResetHash = crypto.createHash('sha256').update(token).digest('hex');
        user.passwordResetExpires = new Date(now + 30 * 60 * 1000);
        await user.save();
        const link = siteUrl + '/reset-password.html#token=' + token;
        await mailer.emails.send({
          from: fromEmail,
          to: email,
          subject: 'Reset your StockAI password',
          text: 'You requested a StockAI password reset. Open this link within 30 minutes:\n' +
            link + '\n\nIf you did not request this, ignore the message.'
        });
      }
    } catch (e) {
      console.error('[Password Recovery] Delivery or storage failed:', e.message);
    }
    res.json({ ok: true, message });
  });

  app.post('/api/auth/reset-password', dbRequired, async (req, res) => {
    const { token, password } = req.body || {};
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token) ||
        typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Invalid reset link or password (8–128 characters required).' });
    }
    try {
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const user = await User.findOne({
        passwordResetHash: hash,
        passwordResetExpires: { $gt: new Date() }
      });
      if (!user) return res.status(400).json({ error: 'Reset link expired or already used. Request another.' });
      user.password = await bcrypt.hash(password, 12);
      user.passwordResetHash = undefined;
      user.passwordResetExpires = undefined;
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await user.save();
      return res.json({ ok: true, message: 'Password updated. Sign in with your new password.' });
    } catch (e) {
      console.error('[Password Recovery] Reset failed:', e.message);
      return res.status(500).json({ error: 'Unable to reset password. Please try again.' });
    }
  });

  app.get('/api/user/profile', authMW, dbRequired, async (req, res) => {
    try {
      const user = await User.findById(req.user.id).select('name email created');
      if (!user) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      res.set('Cache-Control', 'no-store');
      res.json({ name: user.name, email: user.email, created: user.created });
    } catch (e) { res.status(500).json({ error: 'Unable to retrieve profile' }); }
  });

  app.patch('/api/user/profile', authMW, dbRequired, async (req, res) => {
    const name = req.body?.name;
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80)
      return res.status(400).json({ error: 'Name must contain 1–80 characters.' });
    try {
      const user = await User.findByIdAndUpdate(req.user.id, { name: name.trim() }, { new: true });
      if (!user) return res.status(401).json({ error: 'Session expired' });
      return res.json({ ok: true, name: user.name });
    } catch (e) { return res.status(500).json({ error: 'Could not update profile' }); }
  });

  app.post('/api/user/change-password', authMW, dbRequired, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' ||
        newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'New password must be 8–128 characters.' });
    }
    try {
      const user = await User.findById(req.user.id);
      if (!user || !(await bcrypt.compare(currentPassword, user.password)))
        return res.status(400).json({ error: 'Current password is incorrect' });
      user.password = await bcrypt.hash(newPassword, 12);
      user.tokenVersion = (user.tokenVersion || 0) + 1;
      await user.save();
      return res.json({ ok: true, message: 'Password updated. Please sign in again.' });
    } catch (e) { return res.status(500).json({ error: 'Could not change password' }); }
  });

  app.post('/api/user/logout-all', authMW, dbRequired, async (req, res) => {
    try {
      await User.findByIdAndUpdate(req.user.id, { $inc: { tokenVersion: 1 } });
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ error: 'Could not sign out all devices' }); }
  });

  app.delete('/api/user/portfolio', authMW, dbRequired, async (req, res) => {
    try {
      await Holding.deleteMany({ userId: req.user.id });
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ error: 'Could not clear portfolio' }); }
  });

  app.delete('/api/user/data', authMW, dbRequired, async (req, res) => {
    try {
      await Holding.deleteMany({ userId: req.user.id });
      await User.findByIdAndUpdate(req.user.id, { watchlist: [] });
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ error: 'Could not clear data' }); }
  });

  app.delete('/api/user/account', authMW, dbRequired, async (req, res) => {
    const password = req.body?.password;
    if (typeof password !== 'string')
      return res.status(400).json({ error: 'Enter your current password to delete your account.' });
    try {
      const user = await User.findById(req.user.id);
      if (!user || !(await bcrypt.compare(password, user.password)))
        return res.status(401).json({ error: 'Current password is incorrect' });
      await Holding.deleteMany({ userId: user._id });
      await User.deleteOne({ _id: user._id });
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ error: 'Account deletion failed.' }); }
  });
}

module.exports = { installAccountRoutes };
