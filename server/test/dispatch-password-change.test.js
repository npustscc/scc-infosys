// server/test/dispatch-password-change.test.js — 帳號發放與管理（migration 005）：首次登入強制
// 改密碼全流程整合測試（:memory: db，經 dispatch.handleRequest）。比照 test/dispatch-twofa.test.js
// 的寫法直接呼叫 handleRequest；covers required→weak（三種 reason）→成功→續走第二因素→旗標清除→
// 再登入不再要求。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const totp = require('../src/auth/totp');

const ROOT = 'ROOT_PWCHANGE_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-pwchange',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    TRUSTED_DEVICE_DAYS: 30,
  }, overrides || {});
}

async function setupForcedUser(db, email, password, userOpts) {
  await local.upsertUser(db, email, password, Object.assign({ mustChangePassword: true }, userOpts || {}));
  vdrive.createJson(db, {
    name: 'config.json', parentId: ROOT,
    content: { users: { [email]: { role: '專任諮商心理師' } } },
  });
}

function loginPayload(email, password, extra) {
  return Object.assign({ action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' }, extra || {});
}

test('首登強制改密碼：未附 newPassword → password_change_required', async () => {
  const db = openDb(':memory:');
  await setupForcedUser(db, 'a@x.com', 'initial-pw-123');
  const r = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'initial-pw-123'));
  assert.equal(r.data.error, 'password_change_required');
});

test('首登強制改密碼：密碼錯誤 → invalid_credentials（不會先暴露 must_change_password 狀態）', async () => {
  const db = openDb(':memory:');
  await setupForcedUser(db, 'a@x.com', 'initial-pw-123');
  const r = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'wrong-pw'));
  assert.equal(r.data.error, 'invalid_credentials');
});

test('首登強制改密碼：weak_new_password 三種 reason', async () => {
  const db = openDb(':memory:');
  await setupForcedUser(db, 'a@x.com', 'initial-pw-123');

  const tooShort = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'initial-pw-123', { newPassword: 'short1' }));
  assert.equal(tooShort.data.error, 'weak_new_password:too_short');

  const sameAsDefault = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'initial-pw-123', { newPassword: '123456789' }));
  assert.equal(sameAsDefault.data.error, 'weak_new_password:same_as_default');

  const sameAsOld = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'initial-pw-123', { newPassword: 'initial-pw-123' }));
  assert.equal(sameAsOld.data.error, 'weak_new_password:same_as_old');

  // 未通過政策檢查不應變動任何欄位：must_change_password 仍為 1，密碼仍是舊密碼。
  const row = local.getUser(db, 'a@x.com');
  assert.equal(row.must_change_password, 1);
  const stillRequired = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'initial-pw-123'));
  assert.equal(stillRequired.data.error, 'password_change_required');
});

test('首登強制改密碼：成功（無 2FA 設定）→ 直接核發 session，旗標清除，audit 記 passwordChanged，再登入不再要求', async () => {
  const db = openDb(':memory:');
  await setupForcedUser(db, 'a@x.com', 'initial-pw-123');

  const r = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'initial-pw-123', { newPassword: 'brand-new-pw-2026' }));
  assert.equal(r.success, true);
  assert.ok(r.data.sessionToken, '改密碼成功且該帳號未設第二因素，應直接核發 session');

  const row = local.getUser(db, 'a@x.com');
  assert.equal(row.must_change_password, 0, '旗標應已清除');

  // 舊密碼不再可用，新密碼可用。
  const withOld = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'initial-pw-123'));
  assert.equal(withOld.data.error, 'invalid_credentials');
  const withNew = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'brand-new-pw-2026'));
  assert.equal(withNew.success, true, '再登入不應再要求改密碼');

  const auditRow = db.prepare(
    "SELECT * FROM audit_log WHERE action = 'passwordChanged' AND email = ?"
  ).get('a@x.com');
  assert.ok(auditRow, '應寫入 passwordChanged 稽核紀錄');
  assert.equal(auditRow.target, 'a@x.com');
  assert.equal(auditRow.outcome, 'ok');
});

test('首登強制改密碼：改完密碼仍要過第二因素（已註冊 TOTP 的帳號）——同一次請求先回 totp_required，附正確 otp 才核發 session', async () => {
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await local.upsertUser(db, 'a@x.com', 'initial-pw-123', { totpSecret: secret, mustChangePassword: true });
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { 'a@x.com': { role: '專任諮商心理師' } } } });

  const changed = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'initial-pw-123', { newPassword: 'brand-new-pw-2026' }));
  assert.equal(changed.data.error, 'totp_required', '密碼已改但尚未附 otp，應續走第二因素而非直接放行');

  const row = local.getUser(db, 'a@x.com');
  assert.equal(row.must_change_password, 0, '即使還沒過第二因素，密碼變更本身已經生效');

  // 用新密碼＋正確 otp 才能完成登入。
  const ok = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'brand-new-pw-2026', { otp: totp.totp(secret) }));
  assert.ok(ok.data.sessionToken);
});

test('首登強制改密碼：帶有效信任裝置也不能跳過改密碼（裝置信任只免第二因素，不免強制改密碼）', async () => {
  const db = openDb(':memory:');
  const secret = totp.generateSecret();
  await local.upsertUser(db, 'a@x.com', 'initial-pw-123', { totpSecret: secret });
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { 'a@x.com': { role: '專任諮商心理師' } } } });

  // 先完成一次正常登入拿到裝置憑證。
  const first = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'initial-pw-123', { otp: totp.totp(secret) }));
  const deviceToken = first.data.newDeviceToken;
  assert.ok(deviceToken);

  // 管理者事後把該帳號標記為需強制改密碼（模擬 adminResetPassword）。
  db.prepare('UPDATE users SET must_change_password = 1 WHERE email = ?').run('a@x.com');

  const r = await handleRequest(db, testConfig(), loginPayload('a@x.com', 'initial-pw-123', { deviceToken }));
  assert.equal(r.data.error, 'password_change_required', '即使裝置受信任仍應先要求改密碼');
});
