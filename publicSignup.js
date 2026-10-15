'use strict';
const crypto = require('node:crypto');
const { Resend } = require('resend');

const VERIFY_MS = 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicSettings({ allowedEmail = '', env = process.env } = {}) {
  const url = String(env.SITE_URL || '').replace(/\/$/, '');
  let validUrl = false;
  try { validUrl = new URL(url).protocol === 'https:' && new URL(url).origin === url; }
  catch (_) {}
  const emailReady = Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL && validUrl);
  const configured = !allowedEmail && env.PUBLIC_SIGNUPS_ENABLED === 'true';
  return {
    mode: allowedEmail ? 'private' : 'public',
    registrationOpen: configured && emailReady,
    emailReady,
    siteUrl: url
  };
}
function normalizedEmail(value) {
  const email = typeof value === 'string' && value.length <= 254 ? value.trim().toLowerCase() : '';
  return EMAIL_PATTERN.test(email) ? email : null;
}
function generateVerification() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: crypto.createHash('sha256').update(token).digest('hex') };
}
async function sendVerification(email, token, { env = process.env } = {}) {
  const settings = publicSettings({env});
  if (!settings.emailReady) throw Error('Email provider is not configured');
  const mailer = new Resend(env.RESEND_API_KEY);
  const link = settings.siteUrl + '/verify-email.html#token=' + token;
  const sent = await mailer.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: email,
    subject: 'Verify your StockAI account',
    text: 'Confirm your email before using StockAI. This link expires after 24 hours:\n'+
      link+'\n\nIf you did not create an account, ignore this message.'
  });
  if (sent?.error) throw Error(sent.error.message || 'Email provider rejected verification');
}

async function registerPublic({ User, email, name, hashedPassword, env = process.env, deliver = sendVerification }) {
  if (!publicSettings({env}).registrationOpen) {
    const error = Error('Public registration is not configured yet.');
    error.status = 503;
    throw error;
  }
  const { token, hash } = generateVerification();
  const user = await User.create({
    name, email, password: hashedPassword, emailVerified: false,
    emailVerifyHash: hash, emailVerifyExpires: new Date(Date.now() + VERIFY_MS)
  });
  try {
    await deliver(email, token, { env });
    return { pendingVerification: true, message: 'Check your inbox for the StockAI verification link (valid for 24 hours).' };
  } catch (e) {
    // Never strand an unverified account if the initial provider call failed.
    await User.deleteOne({ _id: user._id, emailVerified: false }).catch(() => {});
    throw e;
  }
}

function installVerificationRoutes(app, { User, dbRequired, allowedEmail, rateLimit }) {
  app.post('/api/auth/verify-email', rateLimit, dbRequired, async (req,res) => {
    if (allowedEmail) return res.status(404).json({error:'Not available'});
    const token = req.body?.token;
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token))
      return res.status(400).json({error:'Invalid verification link.'});
    try {
      const digest = crypto.createHash('sha256').update(token).digest('hex');
      const user = await User.findOneAndUpdate(
        { emailVerified: false, emailVerifyHash: digest, emailVerifyExpires: { $gt: new Date() } },
        { $set: { emailVerified: true }, $unset: { emailVerifyHash: '', emailVerifyExpires: '' } },
        { new: true }
      );
      if (!user) return res.status(400).json({error:'Verification link has expired or was already used.'});
      return res.json({ok:true,message:'Email verified. You can now sign in.'});
    } catch(e) {
      return res.status(500).json({error:'Unable to verify email right now.'});
    }
  });

  const cooldown = new Map();
  app.post('/api/auth/resend-verification', rateLimit, dbRequired, async(req,res) => {
    const generic = 'If an unverified account exists, a new confirmation email will be sent.';
    const settings = publicSettings({ allowedEmail });
    const email = normalizedEmail(req.body?.email);
    if (!settings.registrationOpen || !email) return res.json({ok:true,message:generic});
    const now=Date.now(),key=crypto.createHash('sha256').update(email).digest('hex');
    if(cooldown.size>10000)cooldown.clear();
    if(now<(cooldown.get(key)||0)) return res.json({ok:true,message:generic});
    cooldown.set(key,now+15*60*1000);
    try {
      const user = await User.findOne({email,emailVerified:false});
      if(user){
        const {token,hash}=generateVerification();
        user.emailVerifyHash=hash;
        user.emailVerifyExpires=new Date(now+VERIFY_MS);
        await user.save();
        await sendVerification(email,token);
      }
    }catch(e){ console.warn('[Verification] Delivery failed:',e.message); }
    return res.json({ok:true,message:generic});
  });
}
module.exports={ publicSettings, normalizedEmail, generateVerification, registerPublic, installVerificationRoutes };