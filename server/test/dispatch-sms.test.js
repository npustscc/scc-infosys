// server/test/dispatch-sms.test.js — dispatch.js 對 sms* action 的接線／授權閘 smoke test。
// 比照 test/dispatch-twofa.test.js 寫法：直接呼叫 handleRequest，:memory: db，provider 層
// monkey-patch src/sms/mitake.js／src/sms/every8d.js（同 test/sms-actions.test.js 慣例），
// 不打真實網路。額外驗證 audit_log 沒有把簡訊內容/收件人門號落地（見 dispatch.js finally 區塊
// 與 audit.js summarizeSmsParams 的 v203 改動）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const mitake = require('../src/sms/mitake');

const ROOT = 'ROOT_SMS_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-sms',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    SMS_MITAKE_HOST: 'smsapi.mitake.com.tw',
    SMS_MITAKE_BASE_PATH: '/api/mtk',
    SMS_MITAKE_USERNAME: 'u',
    SMS_MITAKE_PASSWORD: 'p',
    SMS_MITAKE_LONG: false,
    SMS_E8D_HOST: 'api.e8d.tw',
    SMS_E8D_UID: '',
    SMS_E8D_PWD: '',
  }, overrides || {});
}

async function setupAuthorizedUser(db, email, password) {
  await local.upsertUser(db, email, password, {});
  vdrive.createJson(db, {
    name: 'config.json', parentId: ROOT,
    content: { users: { [email]: { role: '專任諮商心理師' } } },
  });
}

async function login(db, config, email, password) {
  return handleRequest(db, config, { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
}

function patch(obj, key, fn, t) {
  const orig = obj[key];
  obj[key] = fn;
  t.after(() => { obj[key] = orig; });
}

test('smsStatus：未帶 sessionToken → Session expired（一般授權閘生效，非 AUTHZ_EXEMPT）', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), { action: 'smsStatus', rootFolderId: ROOT });
  assert.equal(r.data.error, 'Session expired');
});

test('smsStatus：已登入但不在 config.users → Unauthorized user', async () => {
  const db = openDb(':memory:');
  await local.upsertUser(db, 'nobody@x.com', 'right-password', {});
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: {} } });
  const login1 = await login(db, testConfig(), 'nobody@x.com', 'right-password');
  // sessionStart 本身已在 actions/session.js 內部走授權閘，未授權者登入就會被擋（回 Unauthorized user）。
  assert.equal(login1.data.error, 'Unauthorized user');
});

test('smsStatus：已授權使用者 → 回報兩平台 configured 狀態', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), { action: 'smsStatus', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });
  assert.equal(r.success, true);
  assert.equal(r.data.providers.mitake.configured, true);
  assert.equal(r.data.providers.every8d.configured, false); // UID/PWD 留空
});

test('smsSend：成功送出 → 回傳 logId，且 audit_log 不含簡訊內容/門號，只記 logId 與筆數', async (t) => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  patch(mitake, 'sendSingle', async () => ({ ok: true, msgid: 'MID-1', statuscode: '1', accountPoint: 42, duplicate: false }), t);

  const r = await handleRequest(db, testConfig(), {
    action: 'smsSend', sessionToken: tok, rootFolderId: ROOT,
    provider: 'mitake', recipients: [{ phone: '0912345678', name: '王小明', caseId: 'C001' }], message: '這是機密內容不該進稽核',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.ok, true);
  assert.ok(typeof r.data.logId === 'number');

  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'smsSend' ORDER BY id DESC LIMIT 1").get();
  assert.equal(auditRow.outcome, 'ok');
  assert.equal(auditRow.target, `smsLog:${r.data.logId}`);
  assert.doesNotMatch(auditRow.detail, /機密內容/);
  assert.doesNotMatch(auditRow.detail, /王小明/);
  assert.doesNotMatch(auditRow.detail, /0912345678/);
  assert.match(auditRow.detail, /recipients=1/);
  assert.match(auditRow.detail, new RegExp(`resultLogId=${r.data.logId}`));
  assert.match(auditRow.detail, /resultSent=1/);
});

test('smsSend：provider 未設定（every8d 缺 UID/PWD）→ 業務錯誤 sms_not_configured', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'smsSend', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    provider: 'every8d', recipients: [{ phone: '0912345678' }], message: 'hi',
  });
  assert.equal(r.data.error, 'sms_not_configured');
});

test('smsListLog／smsQueryStatus／smsCancel：接線 smoke（呼叫得到、回傳形狀正確）', async (t) => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  patch(mitake, 'sendSingle', async () => ({ ok: true, msgid: 'MID-2', statuscode: '0', accountPoint: 40, duplicate: false }), t);
  const sendRes = await handleRequest(db, testConfig(), {
    action: 'smsSend', sessionToken: tok, rootFolderId: ROOT,
    provider: 'mitake', recipients: [{ phone: '0912345678' }], message: 'hi',
    scheduledAt: (() => {
      const d = new Date(Date.now() + 20 * 60 * 1000 + 8 * 3600 * 1000);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
    })(),
  });
  assert.equal(sendRes.data.ok, true);
  const logId = sendRes.data.logId;

  const listRes = await handleRequest(db, testConfig(), { action: 'smsListLog', sessionToken: tok, rootFolderId: ROOT, limit: 10 });
  assert.equal(listRes.success, true);
  assert.equal(listRes.data.total, 1);
  assert.equal(listRes.data.items[0].id, logId);

  patch(mitake, 'queryStatus', async () => ({ ok: true, items: [{ msgid: 'MID-2', statuscode: '0', statustime: '' }] }), t);
  const queryRes = await handleRequest(db, testConfig(), { action: 'smsQueryStatus', sessionToken: tok, rootFolderId: ROOT, logId });
  assert.equal(queryRes.data.ok, true);
  assert.equal(queryRes.data.batch.id, logId);

  patch(mitake, 'cancel', async () => ({ ok: true, items: [{ msgid: 'MID-2', statuscode: '9', canceled: true }] }), t);
  const cancelRes = await handleRequest(db, testConfig(), { action: 'smsCancel', sessionToken: tok, rootFolderId: ROOT, logId });
  assert.equal(cancelRes.data.ok, true);
  assert.equal(cancelRes.data.canceled, 1);
});

test('smsBalance：接線 smoke（provider 未設定回業務錯誤，不丟例外）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'smsBalance', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, provider: 'every8d',
  });
  assert.equal(r.data.error, 'sms_not_configured');
});
