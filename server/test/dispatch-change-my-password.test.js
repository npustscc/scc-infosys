// server/test/dispatch-change-my-password.test.js — 自助改密碼（changeMyPassword，見
// actions/password.js）整合測試（:memory: db，經 dispatch.handleRequest）。比照
// test/dispatch-twofa.test.js 的寫法直接呼叫 handleRequest；covers 錯誤目前密碼→鎖定計數、
// 弱新密碼、成功路徑（含 audit 記錄、舊密碼失效／新密碼可用）、越權防線、account_not_found。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');

const ROOT = 'ROOT_CHANGE_MY_PW_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-change-my-pw',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    TRUSTED_DEVICE_DAYS: 30,
  }, overrides || {});
}

async function setupLoggedInUser(db, email, password) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { [email]: { role: '專任諮商心理師' } } } });
  const login = await handleRequest(db, testConfig(), {
    action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent',
  });
  return login.data.sessionToken;
}

test('changeMyPassword：未登入 → Session expired', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), {
    action: 'changeMyPassword', rootFolderId: ROOT, currentPassword: 'x', newPassword: 'y',
  });
  assert.equal(r.data.error, 'Session expired');
});

test('changeMyPassword：目前密碼錯誤 → invalid_current_password，且計入登入鎖定計數（防爆破側門）', async () => {
  const db = openDb(':memory:');
  const sessionToken = await setupLoggedInUser(db, 'a@x.com', 'right-password-123');

  const r = await handleRequest(db, testConfig(), {
    action: 'changeMyPassword', sessionToken, rootFolderId: ROOT,
    currentPassword: 'wrong-password', newPassword: 'brand-new-pw-2026',
  });
  assert.equal(r.data.error, 'invalid_current_password');

  const row = local.getUser(db, 'a@x.com');
  assert.equal(row.failed_attempts, 1, '應沿用登入鎖定計數，累積失敗次數');
});

test('changeMyPassword：弱新密碼三種 reason（不動任何欄位）', async () => {
  const db = openDb(':memory:');
  const sessionToken = await setupLoggedInUser(db, 'a@x.com', 'right-password-123');

  const tooShort = await handleRequest(db, testConfig(), {
    action: 'changeMyPassword', sessionToken, rootFolderId: ROOT,
    currentPassword: 'right-password-123', newPassword: 'short1',
  });
  assert.equal(tooShort.data.error, 'weak_new_password:too_short');

  const sameAsDefault = await handleRequest(db, testConfig(), {
    action: 'changeMyPassword', sessionToken, rootFolderId: ROOT,
    currentPassword: 'right-password-123', newPassword: local.DEFAULT_INITIAL_PASSWORD,
  });
  assert.equal(sameAsDefault.data.error, 'weak_new_password:same_as_default');

  const sameAsOld = await handleRequest(db, testConfig(), {
    action: 'changeMyPassword', sessionToken, rootFolderId: ROOT,
    currentPassword: 'right-password-123', newPassword: 'right-password-123',
  });
  assert.equal(sameAsOld.data.error, 'weak_new_password:same_as_old');

  const row = local.getUser(db, 'a@x.com');
  assert.equal(row.failed_attempts, 0, '目前密碼皆正確驗證通過，不應計入失敗次數');
});

test('changeMyPassword：成功路徑——更新密碼、清 must_change_password、寫 audit，舊密碼失效新密碼可用', async () => {
  const db = openDb(':memory:');
  const sessionToken = await setupLoggedInUser(db, 'a@x.com', 'right-password-123');

  const r = await handleRequest(db, testConfig(), {
    action: 'changeMyPassword', sessionToken, rootFolderId: ROOT,
    currentPassword: 'right-password-123', newPassword: 'brand-new-pw-2026',
  });
  assert.equal(r.data.ok, true);

  const row = local.getUser(db, 'a@x.com');
  assert.equal(row.must_change_password, 0);

  const withOld = await handleRequest(db, testConfig(), {
    action: 'sessionStart', rootFolderId: ROOT, email: 'a@x.com', password: 'right-password-123', ua: 'test-agent',
  });
  assert.equal(withOld.data.error, 'invalid_credentials', '舊密碼應已失效');

  const withNew = await handleRequest(db, testConfig(), {
    action: 'sessionStart', rootFolderId: ROOT, email: 'a@x.com', password: 'brand-new-pw-2026', ua: 'test-agent',
  });
  assert.equal(withNew.success, true, '新密碼應可登入');

  const auditRow = db.prepare(
    "SELECT * FROM audit_log WHERE action = 'passwordChanged' AND email = ? AND detail = ?"
  ).get('a@x.com', 'self_change_via_prefs');
  assert.ok(auditRow, '應寫入 passwordChanged 稽核紀錄，detail 標明來源為自助改密碼');
  assert.equal(auditRow.target, 'a@x.com');
  assert.equal(auditRow.outcome, 'ok');
});

test('changeMyPassword：帳號在 session 核發後被刪除（極端情境）→ account_not_found', async () => {
  const db = openDb(':memory:');
  const sessionToken = await setupLoggedInUser(db, 'a@x.com', 'right-password-123');
  db.prepare('DELETE FROM users WHERE email = ?').run('a@x.com');

  const r = await handleRequest(db, testConfig(), {
    action: 'changeMyPassword', sessionToken, rootFolderId: ROOT,
    currentPassword: 'right-password-123', newPassword: 'brand-new-pw-2026',
  });
  assert.equal(r.data.error, 'account_not_found');
});

test('changeMyPassword：userEmail 一律來自 session，不吃 params 裡的 email（無法越權改別人密碼）', async () => {
  const db = openDb(':memory:');
  await setupLoggedInUser(db, 'a@x.com', 'right-password-123');
  // b 為另一帳號，併入既有 config.json（同 dispatch-trusted-devices.test.js addAuthorizedUser 手法）。
  await local.upsertUser(db, 'b@x.com', 'b-password-123');
  const { data } = vdrive.readJson(db, 'config.json', { root: ROOT });
  data.users['b@x.com'] = { role: '專任諮商心理師' };
  vdrive.updateJson(db, 'config.json', data, { root: ROOT });

  const loginB = await handleRequest(db, testConfig(), {
    action: 'sessionStart', rootFolderId: ROOT, email: 'b@x.com', password: 'b-password-123', ua: 'test-agent',
  });

  // b 帶自己的 session，即使 params.email 想指名 a，changeMyPassword 也只會查/改自己（b）的密碼。
  const r = await handleRequest(db, testConfig(), {
    action: 'changeMyPassword', sessionToken: loginB.data.sessionToken, rootFolderId: ROOT,
    email: 'a@x.com', currentPassword: 'right-password-123', newPassword: 'brand-new-pw-2026',
  });
  // 用 a 的密碼當「目前密碼」去驗證 b 的帳號，應該不符（b 的密碼是 b-password-123）。
  assert.equal(r.data.error, 'invalid_current_password');

  const verifyStillOld = await handleRequest(db, testConfig(), {
    action: 'sessionStart', rootFolderId: ROOT, email: 'a@x.com', password: 'right-password-123', ua: 'test-agent',
  });
  assert.equal(verifyStillOld.success, true, 'a 的密碼不應被 b 的呼叫變動');
});
