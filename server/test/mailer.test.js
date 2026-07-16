// server/test/mailer.test.js — src/mail/mailer.js 單元測試：降級行為（無 MAIL_SEND_CREDS）、
// 真實寄送（monkey-patch google/gmail.js 的 gmailFetch＋google/auth.js 的 tokenFromRefresh，
// 比照 test/dispatch-mental-leaves.test.js 慣例）、寄送失敗不拋錯、稽核紀錄只記網域/長度摘要
// （不落地完整信箱/信件內容——CLAUDE.md 機密紀律）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const gmail = require('../src/google/gmail');
const googleAuth = require('../src/google/auth');
const mailer = require('../src/mail/mailer');

function tmpCredsFile() {
  const p = path.join(os.tmpdir(), 'scc-test-mail-creds-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' }));
  return p;
}

function withGmailStubs(handler, fn) {
  const origGmailFetch = gmail.gmailFetch;
  const origTokenFromRefresh = googleAuth.tokenFromRefresh;
  gmail.gmailFetch = handler;
  googleAuth.tokenFromRefresh = async () => ({ accessToken: 'FAKE_ACCESS_TOKEN', expiresIn: 3600 });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      gmail.gmailFetch = origGmailFetch;
      googleAuth.tokenFromRefresh = origTokenFromRefresh;
    });
}

function freshDb() { return openDb(':memory:'); }

// ── 降級行為：無 MAIL_SEND_CREDS ──────────────────────────────────────

test('sendMail：config 無 MAIL_SEND_CREDS → 降級為 audit-only，mailSent:false，不拋錯、不觸網', async () => {
  const db = freshDb();
  const r = await mailer.sendMail({}, db, { to: 'a@x.com', subject: '主旨', textBody: '內文' }, { email: 'a@x.com', action: 'test.mail' });
  assert.deepEqual(r, { mailSent: false, reason: 'no_creds' });
  const rows = db.prepare("SELECT * FROM audit_log WHERE action = 'test.mail'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'skipped');
  assert.equal(rows[0].email, 'a@x.com');
  assert.match(rows[0].detail, /mailSent=false/);
  assert.match(rows[0].detail, /reason=no_creds/);
});

test('sendMail：config 為 undefined/null → 同樣降級，不拋錯', async () => {
  const r1 = await mailer.sendMail(undefined, null, { to: 'a@x.com', subject: 's', textBody: 'b' });
  assert.equal(r1.mailSent, false);
  const r2 = await mailer.sendMail(null, null, { to: 'a@x.com', subject: 's', textBody: 'b' });
  assert.equal(r2.mailSent, false);
});

test('sendMail：db 未提供（純測試呼叫）→ 不 throw，只是不落稽核', async () => {
  const r = await mailer.sendMail({}, null, { to: 'a@x.com', subject: 's', textBody: 'b' });
  assert.equal(r.mailSent, false);
});

// ── 真實寄送（monkey-patch 底層）──────────────────────────────────────

test('sendMail：有 MAIL_SEND_CREDS 且寄送成功 → mailSent:true，audit outcome=sent', async () => {
  const db = freshDb();
  const credsPath = tmpCredsFile();
  let sendCalled = false;
  await withGmailStubs(async (accessToken, p, opts) => {
    if (p === '/messages/send') {
      sendCalled = true;
      assert.equal(accessToken, 'FAKE_ACCESS_TOKEN');
      assert.equal(opts.method, 'POST');
      return { id: 'msg1' };
    }
    throw new Error('unexpected path: ' + p);
  }, async () => {
    const r = await mailer.sendMail({ MAIL_SEND_CREDS: credsPath }, db, { to: 'a@x.com', subject: '登入通知', textBody: '內文' }, {
      email: 'a@x.com', action: 'sessionStart.loginMail',
    });
    assert.deepEqual(r, { mailSent: true });
  });
  assert.equal(sendCalled, true);
  const rows = db.prepare("SELECT * FROM audit_log WHERE action = 'sessionStart.loginMail'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'sent');
  assert.match(rows[0].detail, /mailSent=true/);
  // target 只記網域摘要，不落地完整信箱
  assert.equal(rows[0].target, '@x.com');
});

test('sendMail：Gmail API 呼叫失敗 → 不拋錯，mailSent:false，audit outcome=failed', async () => {
  const db = freshDb();
  const credsPath = tmpCredsFile();
  await withGmailStubs(async () => { throw new Error('Gmail API 呼叫失敗：/messages/send（Insufficient Permission）'); }, async () => {
    const r = await mailer.sendMail({ MAIL_SEND_CREDS: credsPath }, db, { to: 'a@x.com', subject: 's', textBody: 'b' }, {
      email: 'a@x.com', action: 'test.mail.fail',
    });
    assert.deepEqual(r, { mailSent: false, reason: 'send_failed' });
  });
  const rows = db.prepare("SELECT * FROM audit_log WHERE action = 'test.mail.fail'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'failed');
  assert.match(rows[0].detail, /mailSent=false/);
  assert.match(rows[0].detail, /reason=send_failed/);
  // 例外訊息本身不落 audit detail（機密紀律：避免夾帶敏感細節）
  assert.doesNotMatch(rows[0].detail, /Insufficient Permission/);
});

test('sendMail：憑證檔不存在（loadCreds 失敗）→ 不拋錯，降級為 failed', async () => {
  const db = freshDb();
  const r = await mailer.sendMail({ MAIL_SEND_CREDS: '/no/such/creds.json' }, db, { to: 'a@x.com', subject: 's', textBody: 'b' }, {
    email: 'a@x.com', action: 'test.mail.badcreds',
  });
  assert.equal(r.mailSent, false);
  assert.equal(r.reason, 'send_failed');
});

// ── toDomainSummary：多收件人只留網域 ──────────────────────────────────

test('toDomainSummary：多收件人逗號分隔，各自只留網域', () => {
  assert.equal(mailer.toDomainSummary('a@x.com,b@y.com'), '@x.com,@y.com');
  assert.equal(mailer.toDomainSummary('nodomain'), '(no-domain)');
  assert.equal(mailer.toDomainSummary(''), '');
});
