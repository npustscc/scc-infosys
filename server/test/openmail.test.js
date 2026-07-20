// server/test/openmail.test.js — v202 校內 openmail 收發信：credStore／sanitize 單元測試 ＋
// dispatch 整合測試（授權閘生效、未 omConnect 一律 'mail_not_connected'、omConnect 成功/失敗、
// sessionLogout 清憑證、mailPass 完全不落 audit_log）。
//
// 資安要求：本檔不得觸網——omConnect 會真的呼叫 openmail/client.js 的 verifyLogin() 做 IMAP
// LOGIN，測試中一律 monkey-patch 該函式（比照 test/dispatch-mail-integration.test.js 對
// google/gmail.js gmailFetch 的既有 monkey-patch 慣例），不打真實的 mail.npust.edu.tw。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const credStore = require('../src/openmail/credStore');
const client = require('../src/openmail/client');
const sanitize = require('../src/openmail/sanitize');

// ── credStore ────────────────────────────────────────────────────────────

test('credStore.set/get：roundtrip 回傳 mailUser/mailPass', () => {
  credStore.clear('a@x.com');
  credStore.set('a@x.com', 'a', 'secret-pass');
  const c = credStore.get('a@x.com');
  assert.equal(c.mailUser, 'a');
  assert.equal(c.mailPass, 'secret-pass');
  credStore.clear('a@x.com');
});

test('credStore.get：查無帳號 → null（未曾 set）', () => {
  assert.equal(credStore.get('never-set@x.com'), null);
});

test('credStore.nextSundayMidnightSec：回傳的時間點是台北時間的週日 00:00', () => {
  const exp = credStore.nextSundayMidnightSec(Date.now());
  // 位移成台北牆上時間後，用 UTC 讀法檢查為週日 00:00:00
  const d = new Date((exp + 8 * 3600) * 1000);
  assert.equal(d.getUTCDay(), 0);      // 0 = 週日
  assert.equal(d.getUTCHours(), 0);
  assert.equal(d.getUTCMinutes(), 0);
  assert.equal(d.getUTCSeconds(), 0);
});

test('credStore.get：週界（週日 00:00）之前仍可取用、到週界即過期並清除', () => {
  const email = 'weekly-test@x.com';
  credStore.clear(email);
  const now = Date.now();
  credStore.set(email, 'u', 'p', now);
  const expMs = credStore.nextSundayMidnightSec(now) * 1000;
  // 週界前一秒 → 仍存活
  assert.ok(credStore.get(email, expMs - 1000));
  // 到達週界（週日 00:00）→ null 且已被清除
  assert.equal(credStore.get(email, expMs), null);
  assert.equal(credStore.get(email, now), null); // lazy 清除後即使用原 now 也是 null
});

test('credStore.get：固定週界不滑動——平日取用不會把過期時間往後推過週日', () => {
  const email = 'no-slide-test@x.com';
  credStore.clear(email);
  const now = Date.now();
  credStore.set(email, 'u', 'p', now);
  const expMs = credStore.nextSundayMidnightSec(now) * 1000;
  credStore.get(email, now + 1000); // 中途取用一次
  assert.equal(credStore.get(email, expMs), null); // 仍在同一個週日 00:00 過期，未被續期
  credStore.clear(email);
});

test('credStore.clear：立即清除（比照 sessionLogout 呼叫時機）', () => {
  const email = 'clear-test@x.com';
  credStore.set(email, 'u', 'p');
  assert.ok(credStore.get(email));
  credStore.clear(email);
  assert.equal(credStore.get(email), null);
});

test('credStore.sweep：清掉所有已過期項目，保留未過期項目', () => {
  const now = Date.now();
  credStore.clear('sweep-old@x.com');
  credStore.clear('sweep-live@x.com');
  credStore.set('sweep-old@x.com', 'u', 'p', now - 8 * 24 * 3600 * 1000); // 8 天前設定，早已過期
  credStore.set('sweep-live@x.com', 'u', 'p', now); // 現在設定，尚未過期
  credStore.sweep(now);
  assert.equal(credStore.get('sweep-old@x.com', now), null);
  assert.ok(credStore.get('sweep-live@x.com', now));
  credStore.clear('sweep-live@x.com');
});

// ── sanitize ────────────────────────────────────────────────────────────

test('sanitizeHtml：<script> 標籤連內容整段移除', () => {
  const { html } = sanitize.sanitizeHtml('<p>before</p><script>alert(document.cookie)</script><p>after</p>');
  assert.doesNotMatch(html, /script/i);
  assert.match(html, /before/);
  assert.match(html, /after/);
});

test('sanitizeHtml：on* 事件屬性移除（onerror/onclick/onload）', () => {
  const { html } = sanitize.sanitizeHtml('<img src="x.png" onerror="alert(1)"><div onclick="bad()">x</div><body onload="bad()">');
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /onclick/i);
  assert.doesNotMatch(html, /onload/i);
});

test('sanitizeHtml：javascript: URL 從 href/src 移除', () => {
  const r1 = sanitize.sanitizeHtml('<a href="javascript:alert(1)">click</a>');
  assert.doesNotMatch(r1.html, /javascript:/i);
  const r2 = sanitize.sanitizeHtml('<a href="  JavaScript:alert(1)">click</a>'); // 大小寫＋前導空白繞過
  assert.doesNotMatch(r2.html, /javascript:/i);
  const r3 = sanitize.sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>');
  assert.doesNotMatch(r3.html, /text\/html/i);
});

test('sanitizeHtml：遠端圖片 src 改寫為 data-om-src，並回傳 blockedRemoteImages 計數', () => {
  const { html, blockedRemoteImages } = sanitize.sanitizeHtml(
    '<img src="http://evil.example.com/a.png"><img src="https://evil.example.com/b.png">'
  );
  assert.equal(blockedRemoteImages, 2);
  assert.doesNotMatch(html, /<img src="https?:/);
  assert.match(html, /data-om-src="http:\/\/evil\.example\.com\/a\.png"/);
  assert.match(html, /data-om-src="https:\/\/evil\.example\.com\/b\.png"/);
});

test('sanitizeHtml：cid: 圖片 src 原樣保留（供上層換 data URI）', () => {
  const { html, blockedRemoteImages } = sanitize.sanitizeHtml('<img src="cid:image001.png@01D00000">');
  assert.equal(blockedRemoteImages, 0);
  assert.match(html, /src="cid:image001\.png@01D00000"/);
});

test('sanitizeHtml：非字串／空值輸入 → 安全回傳空字串（不丟例外）', () => {
  for (const bad of [null, undefined, 123, {}, []]) {
    const r = sanitize.sanitizeHtml(bad);
    assert.equal(r.html, '');
    assert.equal(r.blockedRemoteImages, 0);
  }
});

test('sanitizeHtml：處理過程拋出例外 → fallback 為跳脫後純文字（仍是字串、不外洩例外）', () => {
  const origToLowerCase = String.prototype.toLowerCase;
  // href 屬性值的危險 URL 判定（isDangerousUrl）會呼叫 .toLowerCase()；讓它拋錯來模擬處理過程中
  // 的非預期例外，驗證 sanitizeHtml 的頂層 try/catch fallback 邏輯（不是靠「非字串」這種入口
  // 型別防呆），escapeToText 本身不呼叫 toLowerCase，因此在 catch 分支內仍能正常完成跳脫。
  String.prototype.toLowerCase = function () { throw new Error('boom (test-injected)'); };
  try {
    const input = '<a href="x">hi & "there" <b></a>';
    const result = sanitize.sanitizeHtml(input);
    assert.equal(typeof result.html, 'string');
    assert.equal(result.blockedRemoteImages, 0);
    const expectedEscaped = input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    assert.equal(result.html, expectedEscaped);
  } finally {
    String.prototype.toLowerCase = origToLowerCase;
  }
});

// ── dispatch 整合測試 ────────────────────────────────────────────────────

const ROOT = 'ROOT_OPENMAIL_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-openmail',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
  }, overrides || {});
}

async function setupAuthorizedUser(db, email, password) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { [email]: { role: '專任諮商心理師' } } } });
}

async function login(db, config, email, password) {
  return handleRequest(db, config, { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
}

const OM_ACTIONS_NEEDING_MAILBOX = [
  { action: 'omListFolders', extra: {} },
  { action: 'omListMessages', extra: { folder: 'INBOX' } },
  { action: 'omGetMessage', extra: { folder: 'INBOX', uid: 1 } },
  { action: 'omDownloadAttachment', extra: { folder: 'INBOX', uid: 1, index: 0 } },
  { action: 'omMarkSeen', extra: { folder: 'INBOX', uids: [1], seen: true } },
  { action: 'omFlag', extra: { folder: 'INBOX', uid: 1, flagged: true } },
  { action: 'omMove', extra: { folder: 'INBOX', uids: [1], toFolder: 'Archive' } },
  { action: 'omDelete', extra: { folder: 'INBOX', uids: [1] } },
  { action: 'omSearch', extra: { folder: 'INBOX', query: 'test' } },
  { action: 'omSend', extra: { to: 'x@npust.edu.tw', subject: 's', text: 't' } },
];

test('om* action：未登入（無 token）→ Session expired', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  for (const { action, extra } of [{ action: 'omStatus', extra: {} }, ...OM_ACTIONS_NEEDING_MAILBOX]) {
    const r = await handleRequest(db, cfg, { action, rootFolderId: ROOT, ...extra });
    assert.equal(r.data.error, 'Session expired', action);
  }
});

test('om* action：已登入已授權但從未 omConnect → 一律 mail_not_connected（不觸網）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'notconnected@x.com', 'right-password');
  const tok = (await login(db, cfg, 'notconnected@x.com', 'right-password')).data.sessionToken;
  credStore.clear('notconnected@x.com');

  for (const { action, extra } of OM_ACTIONS_NEEDING_MAILBOX) {
    const r = await handleRequest(db, cfg, { action, sessionToken: tok, rootFolderId: ROOT, ...extra });
    assert.equal(r.success, true, action);
    assert.equal(r.data.error, 'mail_not_connected', action);
  }
});

test('omStatus：未連線回 connected:false／mailUser:null，不洩漏是否曾經連過', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'status-test@x.com', 'right-password');
  const tok = (await login(db, cfg, 'status-test@x.com', 'right-password')).data.sessionToken;
  credStore.clear('status-test@x.com');

  const r = await handleRequest(db, cfg, { action: 'omStatus', sessionToken: tok, rootFolderId: ROOT });
  assert.deepEqual(r.data, { connected: false, mailUser: null });
});

test('omConnect：帳密驗證失敗（monkey-patch client.verifyLogin，不觸網）→ mail_auth_failed，不寫入 credStore', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'authfail@x.com', 'right-password');
  const tok = (await login(db, cfg, 'authfail@x.com', 'right-password')).data.sessionToken;
  credStore.clear('authfail@x.com');

  const orig = client.verifyLogin;
  client.verifyLogin = async () => ({ ok: false, reason: 'auth' });
  try {
    const r = await handleRequest(db, cfg, {
      action: 'omConnect', sessionToken: tok, rootFolderId: ROOT, mailUser: 'authfail', mailPass: 'super-secret-wrong',
    });
    assert.equal(r.data.error, 'mail_auth_failed');
    assert.equal(credStore.get('authfail@x.com'), null);
  } finally {
    client.verifyLogin = orig;
  }
});

test('omConnect：連不上主機（monkey-patch client.verifyLogin，不觸網）→ mail_server_unreachable', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'unreachable@x.com', 'right-password');
  const tok = (await login(db, cfg, 'unreachable@x.com', 'right-password')).data.sessionToken;
  credStore.clear('unreachable@x.com');

  const orig = client.verifyLogin;
  client.verifyLogin = async () => ({ ok: false, reason: 'unreachable' });
  try {
    const r = await handleRequest(db, cfg, {
      action: 'omConnect', sessionToken: tok, rootFolderId: ROOT, mailUser: 'unreachable', mailPass: 'whatever',
    });
    assert.equal(r.data.error, 'mail_server_unreachable');
  } finally {
    client.verifyLogin = orig;
  }
});

test('omConnect：成功（monkey-patch client.verifyLogin，不觸網）→ credStore 寫入、omStatus 反映 connected:true', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'connectok@x.com', 'right-password');
  const tok = (await login(db, cfg, 'connectok@x.com', 'right-password')).data.sessionToken;
  credStore.clear('connectok@x.com');

  const orig = client.verifyLogin;
  client.verifyLogin = async () => ({ ok: true });
  try {
    const r = await handleRequest(db, cfg, {
      action: 'omConnect', sessionToken: tok, rootFolderId: ROOT, mailUser: 'connectok', mailPass: 'a-real-password-123',
    });
    assert.deepEqual(r.data, { ok: true, mailUser: 'connectok' });
    const cached = credStore.get('connectok@x.com');
    assert.equal(cached.mailUser, 'connectok');
    assert.equal(cached.mailPass, 'a-real-password-123');

    const status = await handleRequest(db, cfg, { action: 'omStatus', sessionToken: tok, rootFolderId: ROOT });
    assert.deepEqual(status.data, { connected: true, mailUser: 'connectok' });
  } finally {
    client.verifyLogin = orig;
    credStore.clear('connectok@x.com');
  }
});

test('sessionLogout：同步清除 openmail credStore（顯式登出不必等到台北午夜過期）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'logout-test@x.com', 'right-password');
  const tok = (await login(db, cfg, 'logout-test@x.com', 'right-password')).data.sessionToken;
  credStore.set('logout-test@x.com', 'u', 'p');
  assert.ok(credStore.get('logout-test@x.com'));

  const r = await handleRequest(db, cfg, { action: 'sessionLogout', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(r.data.ok, true);
  assert.equal(credStore.get('logout-test@x.com'), null);
});

// ── 機密紀律：mailPass 完全不進 audit_log（連長度都不記）───────────────────

test('audit_log：omConnect 的 mailPass 完全不出現在 detail（連長度欄位都不記）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'audit-test@x.com', 'right-password');
  const tok = (await login(db, cfg, 'audit-test@x.com', 'right-password')).data.sessionToken;
  credStore.clear('audit-test@x.com');

  const SECRET_MARKER = 'THE-VERY-SECRET-OPENMAIL-PASSWORD-xyz789';
  const orig = client.verifyLogin;
  client.verifyLogin = async () => ({ ok: true });
  try {
    await handleRequest(db, cfg, {
      action: 'omConnect', sessionToken: tok, rootFolderId: ROOT, mailUser: 'audit-test', mailPass: SECRET_MARKER,
    });
  } finally {
    client.verifyLogin = orig;
    credStore.clear('audit-test@x.com');
  }

  const rows = db.prepare("SELECT detail FROM audit_log WHERE action = 'omConnect' ORDER BY id DESC LIMIT 1").all();
  assert.equal(rows.length, 1);
  const detail = rows[0].detail || '';
  assert.doesNotMatch(detail, /mailPass/); // 連欄位名稱／長度都不該出現
  assert.doesNotMatch(detail, new RegExp(SECRET_MARKER)); // 密碼本身當然也不該出現
  // 全庫掃描：確保這組密碼字串沒有以任何形式（含其他欄位/其他 row）落地到 audit_log。
  const anyLeak = db.prepare('SELECT COUNT(*) AS c FROM audit_log WHERE detail LIKE ?').get('%' + SECRET_MARKER + '%');
  assert.equal(anyLeak.c, 0);
});

test('audit_log：om* action 的 detail 摘要 folder 名／uid（可讀但不含信件內容），比對既有 detail 慣例', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'audit-detail@x.com', 'right-password');
  const tok = (await login(db, cfg, 'audit-detail@x.com', 'right-password')).data.sessionToken;
  credStore.clear('audit-detail@x.com');

  await handleRequest(db, cfg, { action: 'omListMessages', sessionToken: tok, rootFolderId: ROOT, folder: 'INBOX', page: 1 });

  const row = db.prepare("SELECT detail, outcome FROM audit_log WHERE action = 'omListMessages' ORDER BY id DESC LIMIT 1").get();
  assert.match(row.detail, /folder=INBOX/);
});
