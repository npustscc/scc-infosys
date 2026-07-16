// server/test/dispatch-mail-integration.test.js — 寄信點經 dispatch.handleRequest 的整合測試：
// 登入通知信（sessionStart，v166 異常偵測各分支）／打卡彙整信（attendanceCommit）。
// monkey-patch src/google/gmail.js 的 gmailFetch＋src/google/auth.js 的 tokenFromRefresh
// （比照 test/dispatch-mental-leaves.test.js／test/mailer.test.js 慣例），不打真實網路；
// 驗證觸發條件（v166 決策各分支）與收件人/主旨正確，而非重覆測試 RFC822 組信細節
// （已在 test/gmail-send.test.js／test/mail-parity.test.js 覆蓋）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const gmail = require('../src/google/gmail');
const googleAuth = require('../src/google/auth');
const commit = require('../src/actions/commit');

const ROOT = 'ROOT_MAIL_INTEGRATION_TEST';

function tmpCredsFile() {
  const p = path.join(os.tmpdir(), 'scc-test-mailint-creds-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' }));
  return p;
}

function decodeRaw(raw) {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

function extractSubject(rawDecoded) {
  const m = rawDecoded.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : null;
}

function extractTo(rawDecoded) {
  const m = rawDecoded.match(/^To: (.+)\r\n/);
  return m ? m[1] : null;
}

// 內文為 base64 編碼（見 gmailSend.buildRawMessage），headers/body 以空行分隔——解回原始純文字，
// 供測試比對彙整信的中文內容（RFC822 組信本身的正確性已在 test/gmail-send.test.js 覆蓋，
// 此處只需驗證「業務內容」正確）。
function extractBodyText(rawDecoded) {
  const bodyB64 = rawDecoded.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  return Buffer.from(bodyB64, 'base64').toString('utf8');
}

// 攔截所有 /messages/send 呼叫，記錄每次的 to/subject/body（解碼後）；其餘 gmailFetch 呼叫回傳空殼。
function withSendCapture(fn) {
  const sent = [];
  const origGmailFetch = gmail.gmailFetch;
  const origTokenFromRefresh = googleAuth.tokenFromRefresh;
  gmail.gmailFetch = async (_accessToken, p, opts) => {
    if (p === '/messages/send') {
      const decoded = decodeRaw(opts.body.raw);
      sent.push({ to: extractTo(decoded), subject: extractSubject(decoded), raw: decoded, body: extractBodyText(decoded) });
      return { id: 'msg_' + sent.length };
    }
    throw new Error('unexpected gmailFetch path in test: ' + p);
  };
  googleAuth.tokenFromRefresh = async () => ({ accessToken: 'FAKE_ACCESS_TOKEN', expiresIn: 3600 });
  return Promise.resolve()
    .then(() => fn(sent))
    .finally(() => {
      gmail.gmailFetch = origGmailFetch;
      googleAuth.tokenFromRefresh = origTokenFromRefresh;
    });
}

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-mail-int',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    GC_CALENDAR_NAME: '[DEV] SCC 空間預約',
    MAIL_SEND_CREDS: tmpCredsFile(),
  }, overrides || {});
}

async function setupAuthorizedUser(db, email, password) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, {
    name: 'config.json', parentId: ROOT,
    content: { users: { [email]: { role: '專任諮商心理師' } } },
  });
}

async function login(db, config, email, password, extra) {
  return handleRequest(db, config, Object.assign({
    action: 'sessionStart', rootFolderId: ROOT, email, password,
  }, extra || {}));
}

// ══════════════════════════════════════════════════════════════════════════
// 登入通知信（v166 異常偵測）
// ══════════════════════════════════════════════════════════════════════════

test('sessionStart：first_login → 寄出通知信給登入者本人，mailSent:true，主旨含【測試版】前綴', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const config = testConfig();
  await withSendCapture(async (sent) => {
    const r = await login(db, config, 'a@x.com', 'right-password', { ua: 'UA-1' });
    assert.equal(r.data.mailSent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'a@x.com');
    assert.match(sent[0].subject, /^【測試版】【屏科大學諮資訊系統】登入通知$/);
    assert.match(sent[0].body, /有人以此帳號登入屏科大學諮資訊系統/);
  });
});

test('sessionStart：同一 ua/geo 再次登入（熟識裝置，7 天內已寄過）→ 不重複寄信', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const config = testConfig();
  await withSendCapture(async (sent) => {
    await login(db, config, 'a@x.com', 'right-password', { ua: 'UA-1' }); // first_login → 寄
    const r2 = await login(db, config, 'a@x.com', 'right-password', { ua: 'UA-1' }); // 熟識 → 不寄
    assert.equal(r2.data.mailSent, false);
    assert.equal(sent.length, 1); // 仍只有第一次那封
  });
});

test('sessionStart：新裝置（不同 ua）→ 寄出「新裝置或新位置登入」警示信', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const config = testConfig();
  await withSendCapture(async (sent) => {
    await login(db, config, 'a@x.com', 'right-password', { ua: 'UA-1' });
    const r2 = await login(db, config, 'a@x.com', 'right-password', { ua: 'UA-2' });
    assert.equal(r2.data.mailSent, true);
    assert.equal(sent.length, 2);
    assert.match(sent[1].subject, /⚠ 新裝置或新位置登入/);
    assert.match(sent[1].body, /不熟識的裝置或位置/);
  });
});

test('sessionStart：正式版環境（GC_CALENDAR_NAME 不以 [DEV] 開頭）→ 主旨不含【測試版】前綴', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const config = testConfig({ GC_CALENDAR_NAME: 'SCC 空間預約' });
  await withSendCapture(async (sent) => {
    await login(db, config, 'a@x.com', 'right-password', { ua: 'UA-1' });
    assert.equal(sent[0].subject, '【屏科大學諮資訊系統】登入通知');
  });
});

test('sessionStart：Gmail API 寄送失敗 → 不阻斷登入，mailSent:false，仍正常核發 sessionToken', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const config = testConfig();
  const origGmailFetch = gmail.gmailFetch;
  const origTokenFromRefresh = googleAuth.tokenFromRefresh;
  gmail.gmailFetch = async () => { throw new Error('Gmail API 呼叫失敗：/messages/send（quota exceeded）'); };
  googleAuth.tokenFromRefresh = async () => ({ accessToken: 'FAKE', expiresIn: 3600 });
  try {
    const r = await login(db, config, 'a@x.com', 'right-password', { ua: 'UA-1' });
    assert.equal(r.success, true);
    assert.ok(r.data.sessionToken);
    assert.equal(r.data.mailSent, false);
  } finally {
    gmail.gmailFetch = origGmailFetch;
    googleAuth.tokenFromRefresh = origTokenFromRefresh;
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 打卡彙整信（attendanceCommit）
// ══════════════════════════════════════════════════════════════════════════

const CTX = { root: ROOT };
function freshDb() { return openDb(':memory:'); }

test('attendanceCommit：新增打卡且 MAIL_SEND_CREDS 已設定 → 寄出彙整信給打卡當事人', async () => {
  const db = freshDb();
  const config = testConfig();
  await withSendCapture(async (sent) => {
    const r = await commit.attendanceCommit(db, {
      upserts: [{ id: 'P1', type: 'punch', email: 'a@x.com', name: '小美', date: '2026-07-15', timestamp: '2026-07-15T01:00:00.000Z' }],
    }, CTX, config);
    assert.equal(r.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'a@x.com');
    assert.match(sent[0].subject, /打卡通知（2026-07-15）/);
    assert.match(sent[0].body, /小美（a@x\.com）您好/);

    const rows = db.prepare("SELECT * FROM audit_log WHERE action = 'attendanceCommit.punchMail'").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'sent');
  });
});

test('attendanceCommit：同一人同日兩筆打卡（第二筆為新增而非改寫）→ 第二封信彙整含兩筆紀錄與工時', async () => {
  const db = freshDb();
  const config = testConfig();
  await withSendCapture(async (sent) => {
    await commit.attendanceCommit(db, {
      upserts: [{ id: 'P1', type: 'punch', email: 'a@x.com', name: '小美', date: '2026-07-15', timestamp: '2026-07-15T01:00:00.000Z' }],
    }, CTX, config);
    await commit.attendanceCommit(db, {
      upserts: [{ id: 'P2', type: 'punch', email: 'a@x.com', name: '小美', date: '2026-07-15', timestamp: '2026-07-15T09:00:00.000Z' }],
    }, CTX, config);
    assert.equal(sent.length, 2);
    // 01:00Z/09:00Z 換算 Asia/Taipei（UTC+8）為 09:00:00/17:00:00。
    assert.match(sent[1].body, /最早打卡：09:00:00/);
    assert.match(sent[1].body, /最晚打卡：17:00:00/);
    assert.match(sent[1].body, /涵蓋工時（最晚−最早，午休不另扣）：8 小時 0 分/);
  });
});
