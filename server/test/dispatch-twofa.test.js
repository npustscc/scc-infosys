// server/test/dispatch-twofa.test.js — 第二因素方法選擇（actions/twofa.js）：twofaSetMethod／
// twofaStatus 整合測試（:memory: db）。比照 test/dispatch-totp.test.js 寫法，直接呼叫 handleRequest。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const totp = require('../src/auth/totp');

const ROOT = 'ROOT_TWOFA_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-twofa',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
  }, overrides || {});
}

async function setupAuthorizedUser(db, email, password, userOpts) {
  await local.upsertUser(db, email, password, userOpts || {});
  vdrive.createJson(db, {
    name: 'config.json', parentId: ROOT,
    content: { users: { [email]: { role: '專任諮商心理師' } } },
  });
}

async function login(db, config, email, password, otp) {
  const p = { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' };
  if (otp !== undefined) p.otp = otp;
  return handleRequest(db, config, p);
}

test('twofaStatus：預設 → method:null，totpEnrolled:false', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), { action: 'twofaStatus', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });
  assert.equal(r.success, true);
  assert.equal(r.data.method, null);
  assert.equal(r.data.totpEnrolled, false);
});

test('twofaSetMethod：選 totp 但尚未完成 TOTP 註冊 → totp_not_enrolled，不生效', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const r = await handleRequest(db, testConfig(), { action: 'twofaSetMethod', sessionToken: tok, rootFolderId: ROOT, method: 'totp' });
  assert.equal(r.data.error, 'totp_not_enrolled');

  const status = await handleRequest(db, testConfig(), { action: 'twofaStatus', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(status.data.method, null);
});

test('twofaSetMethod：選 email＋合法 emails → 立即生效（不要求 TOTP 前置條件），twofaStatus 回 otpEmails', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const r = await handleRequest(db, testConfig(), {
    action: 'twofaSetMethod', sessionToken: tok, rootFolderId: ROOT, method: 'email', emails: ['a@x.com', 'backup@x.com'],
  });
  assert.equal(r.data.ok, true);
  assert.equal(r.data.method, 'email');
  assert.deepEqual(r.data.otpEmails, ['a@x.com', 'backup@x.com']);

  const status = await handleRequest(db, testConfig(), { action: 'twofaStatus', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(status.data.method, 'email');
  assert.deepEqual(status.data.otpEmails, ['a@x.com', 'backup@x.com']);
});

test('twofaSetMethod：選 email 但未附 emails（0 個）→ otp_emails_required，不生效', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const r = await handleRequest(db, testConfig(), { action: 'twofaSetMethod', sessionToken: tok, rootFolderId: ROOT, method: 'email', emails: [] });
  assert.equal(r.data.error, 'otp_emails_required');

  const status = await handleRequest(db, testConfig(), { action: 'twofaStatus', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(status.data.method, null, '驗證失敗不應變更 twofa_method');
  assert.deepEqual(status.data.otpEmails, []);
});

test('twofaSetMethod：emails 超過 3 個（去重後仍超過）→ too_many_otp_emails', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const r = await handleRequest(db, testConfig(), {
    action: 'twofaSetMethod', sessionToken: tok, rootFolderId: ROOT, method: 'email',
    emails: ['a1@x.com', 'a2@x.com', 'a3@x.com', 'a4@x.com'],
  });
  assert.equal(r.data.error, 'too_many_otp_emails');
});

test('twofaSetMethod：emails 含格式不正確項目（缺 @ 或缺網域）→ invalid_otp_email', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const noAt = await handleRequest(db, testConfig(), {
    action: 'twofaSetMethod', sessionToken: tok, rootFolderId: ROOT, method: 'email', emails: ['not-an-email'],
  });
  assert.equal(noAt.data.error, 'invalid_otp_email');

  const noDot = await handleRequest(db, testConfig(), {
    action: 'twofaSetMethod', sessionToken: tok, rootFolderId: ROOT, method: 'email', emails: ['a@localhost'],
  });
  assert.equal(noDot.data.error, 'invalid_otp_email');
});

test('twofaSetMethod：emails 去重＋小寫正規化（同一位址大小寫視為重複，只存一份且轉小寫）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const r = await handleRequest(db, testConfig(), {
    action: 'twofaSetMethod', sessionToken: tok, rootFolderId: ROOT, method: 'email',
    emails: ['Backup@X.com', 'backup@x.com', '  BACKUP@x.COM  '],
  });
  assert.equal(r.data.ok, true);
  assert.deepEqual(r.data.otpEmails, ['backup@x.com'], '三個等價地址去重後應只剩一份，且為小寫');
});

test('twofaSetMethod：完成 TOTP 註冊後才可選 totp，選定後 twofaStatus 反映', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const start = await handleRequest(db, testConfig(), { action: 'totpSetupStart', sessionToken: tok, rootFolderId: ROOT });
  const secret = start.data.manualKey.replace(/\s+/g, '');
  await handleRequest(db, testConfig(), { action: 'totpSetupConfirm', sessionToken: tok, rootFolderId: ROOT, code: totp.totp(secret) });

  const r = await handleRequest(db, testConfig(), { action: 'twofaSetMethod', sessionToken: tok, rootFolderId: ROOT, method: 'totp' });
  assert.equal(r.data.ok, true);

  const status = await handleRequest(db, testConfig(), { action: 'twofaStatus', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(status.data.method, 'totp');
  assert.equal(status.data.totpEnrolled, true);
});

test('twofaSetMethod：不合法的 method 值 → invalid_method', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'twofaSetMethod', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, method: 'sms',
  });
  assert.equal(r.data.error, 'invalid_method');
});

test('twofaSetMethod／twofaStatus：未登入 → Session expired', async () => {
  const db = openDb(':memory:');
  const r1 = await handleRequest(db, testConfig(), { action: 'twofaSetMethod', rootFolderId: ROOT, method: 'email' });
  assert.equal(r1.data.error, 'Session expired');
  const r2 = await handleRequest(db, testConfig(), { action: 'twofaStatus', rootFolderId: ROOT });
  assert.equal(r2.data.error, 'Session expired');
});

test('twofaSetMethod：無法越權改別人的 twofa_method（userEmail 一律來自 session，不吃 params）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  await local.upsertUser(db, 'b@x.com', 'right-password');
  const { data } = vdrive.readJson(db, 'config.json', { root: ROOT });
  data.users['b@x.com'] = { role: '專任諮商心理師' };
  vdrive.updateJson(db, 'config.json', data, { root: ROOT });

  const loginA = await login(db, testConfig(), 'a@x.com', 'right-password');
  // params 帶 email:'b@x.com' 也不影響——twofaSetMethod 只吃 dispatch 解出的 session userEmail。
  await handleRequest(db, testConfig(), {
    action: 'twofaSetMethod', sessionToken: loginA.data.sessionToken, rootFolderId: ROOT, method: 'email',
    email: 'b@x.com', emails: ['a@x.com'],
  });
  const rowA = local.getUser(db, 'a@x.com');
  const rowB = local.getUser(db, 'b@x.com');
  assert.equal(rowA.twofa_method, 'email', 'A 自己的設定應生效');
  assert.equal(rowB.twofa_method, null, 'B 的設定不應被 A 竄改');
});

// ══════════════════════════════════════════════════════════════════════════
// twofaSetEmails（帳號發放與管理，migration 005）：只更新 otp_emails，不切換 twofa_method
// ══════════════════════════════════════════════════════════════════════════

test('twofaSetEmails：更新 otp_emails 成功，且不切換 twofa_method（即使目前是 totp）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const start = await handleRequest(db, testConfig(), { action: 'totpSetupStart', sessionToken: tok, rootFolderId: ROOT });
  const secret = start.data.manualKey.replace(/\s+/g, '');
  await handleRequest(db, testConfig(), { action: 'totpSetupConfirm', sessionToken: tok, rootFolderId: ROOT, code: totp.totp(secret) });
  await handleRequest(db, testConfig(), { action: 'twofaSetMethod', sessionToken: tok, rootFolderId: ROOT, method: 'totp' });

  const r = await handleRequest(db, testConfig(), {
    action: 'twofaSetEmails', sessionToken: tok, rootFolderId: ROOT, emails: ['backup@x.com'],
  });
  assert.equal(r.data.ok, true);
  assert.deepEqual(r.data.otpEmails, ['backup@x.com']);

  const status = await handleRequest(db, testConfig(), { action: 'twofaStatus', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(status.data.method, 'totp', 'twofaSetEmails 不應切換 twofa_method');
  assert.deepEqual(status.data.otpEmails, ['backup@x.com']);
});

test('twofaSetEmails：驗證規則同 normalizeOtpEmails（0 個 → otp_emails_required）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'twofaSetEmails', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, emails: [],
  });
  assert.equal(r.data.error, 'otp_emails_required');
});

test('twofaSetEmails：未登入 → Session expired', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), { action: 'twofaSetEmails', rootFolderId: ROOT, emails: ['a@x.com'] });
  assert.equal(r.data.error, 'Session expired');
});

test('twofaStatus：回傳 method/otpEmails/totpEnrolled 三個欄位（缺一律補預設值，不回 undefined）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), { action: 'twofaStatus', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });
  assert.equal(r.data.method, null);
  assert.equal(r.data.totpEnrolled, false);
  assert.deepEqual(r.data.otpEmails, []);
});
