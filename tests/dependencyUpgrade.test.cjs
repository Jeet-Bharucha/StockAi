'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const pkg = require('../package.json');

test('Nodemailer 10 remains compatible with simple StockAI SMTP messages', async () => {
  assert.match(pkg.dependencies.nodemailer, /^\^10\./);
  const transporter = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'unix'
  });
  const sent = await transporter.sendMail({
    from: 'StockAI <alerts@example.com>',
    to: 'tester@example.net',
    subject: 'StockAI notification test',
    text: 'A provider-verified alert can be delivered with this message format.'
  });
  assert.ok(sent.message);
  const raw = sent.message.toString('utf8');
  assert.match(raw, /StockAI notification test/);
  assert.match(raw, /tester@example\.net/);
  assert.match(raw, /provider-verified alert/);
});
