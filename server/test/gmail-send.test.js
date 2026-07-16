// server/test/gmail-send.test.js — src/google/gmailSend.js 單元測試：RFC822 組信（UTF-8 主旨
// RFC 2047 編碼、raw base64url 正確性）與 sendMail 呼叫 gmail.gmailFetch 的參數。monkey-patch
// src/google/gmail.js 的 gmailFetch（比照 test/gmail-client.test.js／test/dispatch-mental-leaves.test.js
// 慣例），不打真實網路。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const gmail = require('../src/google/gmail');
const gmailSend = require('../src/google/gmailSend');

function decodeRaw(raw) {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

// ── buildRawMessage：純函式，不觸網 ──────────────────────────────────

test('buildRawMessage：無 to → throw', () => {
  assert.throws(() => gmailSend.buildRawMessage({ subject: 's', textBody: 'b' }), /to is required/);
});

test('buildRawMessage：組出 To/Subject(RFC2047)/Content-Type/base64 內文，raw 為合法 base64url', () => {
  const raw = gmailSend.buildRawMessage({ to: 'a@x.com', subject: '測試主旨', textBody: '中文內文\n第二行' });
  assert.doesNotThrow(() => Buffer.from(raw, 'base64url'));
  const decoded = decodeRaw(raw);
  assert.match(decoded, /^To: a@x\.com\r\n/);
  assert.match(decoded, /Subject: =\?UTF-8\?B\?/);
  assert.match(decoded, /Content-Type: text\/plain; charset="UTF-8"/);
  assert.match(decoded, /Content-Transfer-Encoding: base64/);
  assert.match(decoded, /MIME-Version: 1\.0/);

  // 主旨 RFC2047 解碼回原字串
  const subjMatch = decoded.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/);
  assert.ok(subjMatch);
  assert.equal(Buffer.from(subjMatch[1], 'base64').toString('utf8'), '測試主旨');

  // 內文 base64 解碼回原字串（headers 與 body 以空行分隔）
  const bodyB64 = decoded.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(bodyB64, 'base64').toString('utf8'), '中文內文\n第二行');
});

test('buildRawMessage：htmlBody 優先於 textBody，Content-Type 為 text/html', () => {
  const raw = gmailSend.buildRawMessage({ to: 'a@x.com', subject: 's', textBody: 'plain', htmlBody: '<p>hi</p>' });
  const decoded = decodeRaw(raw);
  assert.match(decoded, /Content-Type: text\/html; charset="UTF-8"/);
  const bodyB64 = decoded.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(bodyB64, 'base64').toString('utf8'), '<p>hi</p>');
});

test('buildRawMessage：cc 有值才加 Cc 標頭；未提供則不出現', () => {
  const withCc = decodeRaw(gmailSend.buildRawMessage({ to: 'a@x.com', subject: 's', textBody: 'b', cc: 'b@x.com,c@x.com' }));
  assert.match(withCc, /Cc: b@x\.com,c@x\.com/);
  const noCc = decodeRaw(gmailSend.buildRawMessage({ to: 'a@x.com', subject: 's', textBody: 'b' }));
  assert.doesNotMatch(noCc, /Cc:/);
});

test('buildRawMessage：標頭值消毒——收件人/主旨內的 CR/LF 被移除，防 header injection（不會被拆成獨立新標頭行）', () => {
  const raw = gmailSend.buildRawMessage({ to: 'a@x.com\r\nBcc: evil@x.com', subject: 's\r\nX-Evil: 1', textBody: 'b' });
  const decoded = decodeRaw(raw);
  // CR/LF 被換成空格後，注入內容仍留在同一行的 To:/Subject: 標頭值裡（純資料），
  // 不會出現「另起一行」的獨立 Bcc:/X-Evil: 標頭——用 ^ 錨點確認沒有新的一行是以此開頭。
  assert.doesNotMatch(decoded, /^Bcc: evil@x\.com/m);
  assert.doesNotMatch(decoded, /^X-Evil: 1/m);
  assert.match(decoded, /^To: a@x\.com Bcc: evil@x\.com\r\n/);
});

test('buildRawMessage：長內文每 76 字元換行（RFC 2045）', () => {
  const longBody = 'x'.repeat(200);
  const raw = gmailSend.buildRawMessage({ to: 'a@x.com', subject: 's', textBody: longBody });
  const decoded = decodeRaw(raw);
  const bodyLines = decoded.split('\r\n\r\n')[1].split('\r\n');
  bodyLines.slice(0, -1).forEach((line) => assert.equal(line.length, 76));
});

// ── sendMail：呼叫 gmail.gmailFetch，驗證 path/method/body ──────────────

test('sendMail：POST /messages/send，body 含 raw（合法 base64url，可解回原文）', async () => {
  const origGmailFetch = gmail.gmailFetch;
  let seenPath, seenOpts;
  gmail.gmailFetch = async (accessToken, p, opts) => {
    seenPath = p; seenOpts = opts;
    assert.equal(accessToken, 'TOK');
    return { id: 'msg1' };
  };
  try {
    const r = await gmailSend.sendMail('TOK', { to: 'a@x.com', subject: '通知', textBody: '內容' });
    assert.deepEqual(r, { id: 'msg1' });
    assert.equal(seenPath, '/messages/send');
    assert.equal(seenOpts.method, 'POST');
    assert.ok(seenOpts.body && typeof seenOpts.body.raw === 'string');
    assert.match(decodeRaw(seenOpts.body.raw), /To: a@x\.com/);
  } finally {
    gmail.gmailFetch = origGmailFetch;
  }
});

test('sendMail：gmail.gmailFetch 失敗（非 2xx）→ throw（由呼叫端 mailer.js 決定降級行為）', async () => {
  const origGmailFetch = gmail.gmailFetch;
  gmail.gmailFetch = async () => { throw new Error('Gmail API 呼叫失敗：/messages/send（Insufficient Permission）'); };
  try {
    await assert.rejects(() => gmailSend.sendMail('TOK', { to: 'a@x.com', subject: 's', textBody: 'b' }), /Insufficient Permission/);
  } finally {
    gmail.gmailFetch = origGmailFetch;
  }
});
