// server/test/dispatch-totp.test.js — Phase 3a TOTP 雙因素登入整合測試（:memory: db）：
//   1) sessionStart 三態：未註冊 TOTP 放行／已註冊缺 otp 要求／已註冊 otp 錯拒絕
//   2) totpSetupStart／totpSetupConfirm／totpStatus 三個 action（含輪替、未登入拒絕）
// 比照 test/dispatch.test.js／test/dispatch-clock-bridge.test.js 寫法，直接呼叫 handleRequest。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const totp = require('../src/auth/totp');

const ROOT = 'ROOT_TOTP_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-totp',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
  }, overrides || {});
}

async function setupAuthorizedUser(db, email, password, userOpts) {
  await local.upsertUser(db, email, password, userOpts || {});
  vdrive.createJson(db, {
    name: 'config.json',
    parentId: ROOT,
    content: { users: { [email]: { role: '專任諮商心理師' } } },
  });
}

function loginPayload(email, password, otp) {
  const p = { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' };
  if (otp !== undefined) p.otp = otp;
  return p;
}

// ── sessionStart 三態 ────────────────────────────────────────────────────

test('sessionStart：未註冊 TOTP → 帳密正確即放行（totpEnrolled:false）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password'));
  assert.equal(r.success, true);
  assert.ok(r.data.sessionToken);
  assert.equal(r.data.totpEnrolled, false);
});

test('sessionStart：已註冊 TOTP、缺 otp → totp_required（不發 session）', async () => {
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password', { totpSecret: secret });
  const r = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password'));
  assert.equal(r.success, true);
  assert.equal(r.data.error, 'totp_required');
  assert.equal(r.data.sessionToken, undefined);
});

test('sessionStart：已註冊 TOTP、otp 錯誤 → invalid_totp（不發 session）', async () => {
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password', { totpSecret: secret });
  const r = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', '000000'));
  assert.equal(r.success, true);
  assert.equal(r.data.error, 'invalid_totp');
  assert.equal(r.data.sessionToken, undefined);
});

test('sessionStart：已註冊 TOTP、otp 正確 → 放行（totpEnrolled:true）', async () => {
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password', { totpSecret: secret });
  const code = totp.totp(secret);
  const r = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'right-password', code));
  assert.equal(r.success, true);
  assert.ok(r.data.sessionToken);
  assert.equal(r.data.totpEnrolled, true);
});

test('sessionStart：密碼錯誤時，即使帳號已註冊 TOTP，仍回 invalid_credentials（不洩漏 TOTP 狀態）', async () => {
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password', { totpSecret: secret });
  const r = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'wrong-password'));
  assert.equal(r.data.error, 'invalid_credentials');
});

// ── totpSetupStart／totpSetupConfirm／totpStatus ────────────────────────

async function login(db, config, email, password, otp) {
  return handleRequest(db, config, loginPayload(email, password, otp));
}

test('totpStatus：尚未註冊 → enrolled:false', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), { action: 'totpStatus', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });
  assert.equal(r.success, true);
  assert.equal(r.data.enrolled, false);
});

test('totpSetupStart → totpSetupConfirm（正確碼）：完整註冊流程，完成後 totpStatus:true 且可用新碼登入', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const start = await handleRequest(db, testConfig(), { action: 'totpSetupStart', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(start.success, true);
  assert.match(start.data.otpauthUri, /^otpauth:\/\/totp\//);
  assert.ok(start.data.manualKey);
  const secretNoSpaces = start.data.manualKey.replace(/\s+/g, '');

  const code = totp.totp(secretNoSpaces);
  const confirm = await handleRequest(db, testConfig(), { action: 'totpSetupConfirm', sessionToken: tok, rootFolderId: ROOT, code });
  assert.equal(confirm.success, true);
  assert.equal(confirm.data.ok, true);

  const status = await handleRequest(db, testConfig(), { action: 'totpStatus', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(status.data.enrolled, true);

  // 下次登入應要求 TOTP，且新碼可正確通過。
  const noOtp = await login(db, testConfig(), 'a@x.com', 'right-password');
  assert.equal(noOtp.data.error, 'totp_required');
  const withOtp = await login(db, testConfig(), 'a@x.com', 'right-password', totp.totp(secretNoSpaces));
  assert.ok(withOtp.data.sessionToken);
});

test('totpSetupConfirm：碼錯誤 → invalid_totp，不生效（totpStatus 仍 false）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  await handleRequest(db, testConfig(), { action: 'totpSetupStart', sessionToken: tok, rootFolderId: ROOT });
  const confirm = await handleRequest(db, testConfig(), { action: 'totpSetupConfirm', sessionToken: tok, rootFolderId: ROOT, code: '000000' });
  assert.equal(confirm.data.error, 'invalid_totp');

  const status = await handleRequest(db, testConfig(), { action: 'totpStatus', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(status.data.enrolled, false);
});

test('totpSetupConfirm：無暫存 secret（未先呼叫 start）→ no_pending_totp_setup', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), { action: 'totpSetupConfirm', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, code: '123456' });
  assert.equal(r.data.error, 'no_pending_totp_setup');
});

test('輪替：已註冊使用者重跑 totpSetupStart，confirm 前舊碼仍可登入，confirm 後才切換為新碼', async () => {
  const db = openDb(':memory:');
  const oldSecret = totp.generateSecret();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password', { totpSecret: oldSecret });
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password', totp.totp(oldSecret));
  const tok = login1.data.sessionToken;

  const start = await handleRequest(db, testConfig(), { action: 'totpSetupStart', sessionToken: tok, rootFolderId: ROOT });
  const newSecret = start.data.manualKey.replace(/\s+/g, '');
  assert.notEqual(newSecret, oldSecret);

  // confirm 前：舊密鑰仍可正常登入（輪替中途放棄不影響既有登入能力）。
  const stillOldWorks = await login(db, testConfig(), 'a@x.com', 'right-password', totp.totp(oldSecret));
  assert.ok(stillOldWorks.data.sessionToken, '確認前舊密鑰應仍有效');

  const confirm = await handleRequest(db, testConfig(), { action: 'totpSetupConfirm', sessionToken: tok, rootFolderId: ROOT, code: totp.totp(newSecret) });
  assert.equal(confirm.data.ok, true);

  // confirm 後：舊密鑰失效，新密鑰生效。
  const oldNowFails = await login(db, testConfig(), 'a@x.com', 'right-password', totp.totp(oldSecret));
  assert.equal(oldNowFails.data.error, 'invalid_totp', '確認後舊密鑰應已失效');
  const newWorks = await login(db, testConfig(), 'a@x.com', 'right-password', totp.totp(newSecret));
  assert.ok(newWorks.data.sessionToken, '確認後新密鑰應生效');
});

test('totpSetupStart／totpSetupConfirm／totpStatus：未登入 → Session expired', async () => {
  const db = openDb(':memory:');
  const r1 = await handleRequest(db, testConfig(), { action: 'totpSetupStart', rootFolderId: ROOT });
  assert.equal(r1.data.error, 'Session expired');
  const r2 = await handleRequest(db, testConfig(), { action: 'totpSetupConfirm', rootFolderId: ROOT, code: '123456' });
  assert.equal(r2.data.error, 'Session expired');
  const r3 = await handleRequest(db, testConfig(), { action: 'totpStatus', rootFolderId: ROOT });
  assert.equal(r3.data.error, 'Session expired');
});
