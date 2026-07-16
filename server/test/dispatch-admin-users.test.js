// server/test/dispatch-admin-users.test.js — 帳號發放與管理（migration 005）：管理者五個 action
// （adminUserAuthGet／adminCreateLocalAccount／adminUpdateLocalAccount／adminResetPassword／
// adminResetTwofa）整合測試（:memory: db，經 dispatch.handleRequest）。比照 test/dispatch-twofa.test.js
// 的寫法直接呼叫 handleRequest。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const totp = require('../src/auth/totp');
const deviceTrust = require('../src/auth/deviceTrust');

const ROOT = 'ROOT_ADMIN_USERS_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-admin-users',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    TRUSTED_DEVICE_DAYS: 30,
  }, overrides || {});
}

async function setupConfigUsers(db, usersMap) {
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: usersMap } });
}

async function login(db, config, email, password, extra) {
  const p = Object.assign({ action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' }, extra || {});
  return handleRequest(db, config, p);
}

async function setupAdminAndStaff(db) {
  await local.upsertUser(db, 'admin@x.com', 'admin-pw-123456');
  await local.upsertUser(db, 'staff@x.com', 'staff-pw-123456'); // 已有本地帳號但非管理者
  await setupConfigUsers(db, {
    'admin@x.com': { role: '主任' },
    'staff@x.com': { role: '專任諮商心理師' },
    'intern1@x.com': {}, // 尚無本地帳號，供 adminCreateLocalAccount 測試用
    'intern2@x.com': {},
  });
  const config = testConfig();
  const adminLogin = await login(db, config, 'admin@x.com', 'admin-pw-123456');
  const staffLogin = await login(db, config, 'staff@x.com', 'staff-pw-123456');
  return { config, adminTok: adminLogin.data.sessionToken, staffTok: staffLogin.data.sessionToken };
}

// ══════════════════════════════════════════════════════════════════════════
// 權限閘：非管理者一律 Forbidden（含未登入）
// ══════════════════════════════════════════════════════════════════════════

test('管理者 action 權限閘：非管理者呼叫任一個 → Forbidden: admin only', async () => {
  const db = openDb(':memory:');
  const { config, staffTok } = await setupAdminAndStaff(db);
  const actions = [
    { action: 'adminUserAuthGet', email: 'intern1@x.com' },
    { action: 'adminCreateLocalAccount', email: 'intern1@x.com', loginName: 'intern01' },
    { action: 'adminUpdateLocalAccount', email: 'staff@x.com', loginName: 'staffer' },
    { action: 'adminResetPassword', email: 'staff@x.com' },
    { action: 'adminResetTwofa', email: 'staff@x.com' },
  ];
  for (const p of actions) {
    const r = await handleRequest(db, config, Object.assign({ sessionToken: staffTok, rootFolderId: ROOT }, p));
    assert.equal(r.data.error, 'Forbidden: admin only', `${p.action} 應拒絕非管理者`);
  }
});

test('管理者 action 權限閘：未登入呼叫 → Session expired（先卡在步驟 1，不會走到 admin 閘）', async () => {
  const db = openDb(':memory:');
  const { config } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, { action: 'adminResetPassword', rootFolderId: ROOT, email: 'staff@x.com' });
  assert.equal(r.data.error, 'Session expired');
});

// ══════════════════════════════════════════════════════════════════════════
// adminUserAuthGet
// ══════════════════════════════════════════════════════════════════════════

test('adminUserAuthGet：尚無本地帳號 → hasLocalAccount:false', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminUserAuthGet', sessionToken: adminTok, rootFolderId: ROOT, email: 'intern1@x.com',
  });
  assert.equal(r.data.hasLocalAccount, false);
});

test('adminUserAuthGet：已有本地帳號 → 回完整狀態', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminUserAuthGet', sessionToken: adminTok, rootFolderId: ROOT, email: 'staff@x.com',
  });
  assert.equal(r.data.hasLocalAccount, true);
  assert.equal(r.data.loginName, 'staff@x.com');
  assert.equal(r.data.totpEnrolled, false);
  assert.equal(r.data.twofaMethod, null);
  assert.deepEqual(r.data.otpEmails, []);
  assert.equal(r.data.mustChangePassword, false);
});

// ══════════════════════════════════════════════════════════════════════════
// adminCreateLocalAccount
// ══════════════════════════════════════════════════════════════════════════

test('adminCreateLocalAccount：email 不在 config.users → email_not_in_config（防替不存在的人建帳）', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminCreateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'ghost@x.com', loginName: 'ghost01',
  });
  assert.equal(r.data.error, 'email_not_in_config');
});

test('adminCreateLocalAccount：成功建立 → 初始密碼 123456789、must_change_password=1，首登被要求改密碼', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminCreateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'intern1@x.com', loginName: 'Intern01',
  });
  assert.equal(r.data.ok, true);
  assert.equal(r.data.loginName, 'intern01', '應正規化為小寫');

  const row = local.getUser(db, 'intern1@x.com');
  assert.equal(row.must_change_password, 1);

  const loginAttempt = await login(db, config, 'intern01', '123456789');
  assert.equal(loginAttempt.data.error, 'password_change_required', '用登入帳號＋初始密碼應可通過密碼驗證，只差改密碼');

  const auditRow = db.prepare(
    "SELECT * FROM audit_log WHERE action = 'adminCreateLocalAccount' AND target = ?"
  ).get('intern1@x.com');
  assert.ok(auditRow);
  assert.equal(auditRow.email, 'admin@x.com', 'audit 的 email 欄應記操作者');
});

test('adminCreateLocalAccount：login_name 已被其他帳號使用 → login_name_taken', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  await handleRequest(db, config, {
    action: 'adminCreateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'intern1@x.com', loginName: 'sharedname',
  });
  const r = await handleRequest(db, config, {
    action: 'adminCreateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'intern2@x.com', loginName: 'SharedName',
  });
  assert.equal(r.data.error, 'login_name_taken', '大小寫不敏感比對');
});

test('adminCreateLocalAccount：目標已有本地帳號 → account_already_exists', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminCreateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'staff@x.com', loginName: 'staffer2',
  });
  assert.equal(r.data.error, 'account_already_exists');
});

test('adminCreateLocalAccount：otpEmails 選填，格式不正確時沿用 normalizeOtpEmails 驗證', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminCreateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'intern1@x.com', loginName: 'intern01', otpEmails: ['not-an-email'],
  });
  assert.equal(r.data.error, 'invalid_otp_email');
  assert.equal(local.getUser(db, 'intern1@x.com'), null, '驗證失敗不應建立帳號');
});

// ══════════════════════════════════════════════════════════════════════════
// adminUpdateLocalAccount
// ══════════════════════════════════════════════════════════════════════════

test('adminUpdateLocalAccount：帳號不存在 → account_not_found', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminUpdateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'intern1@x.com', loginName: 'x',
  });
  assert.equal(r.data.error, 'account_not_found');
});

test('adminUpdateLocalAccount：未附任何欄位 → no_fields_to_update', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminUpdateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT, email: 'staff@x.com',
  });
  assert.equal(r.data.error, 'no_fields_to_update');
});

test('adminUpdateLocalAccount：改 loginName 成功；與他人衝突 → login_name_taken', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r1 = await handleRequest(db, config, {
    action: 'adminUpdateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'staff@x.com', loginName: 'StaffNew',
  });
  assert.equal(r1.data.ok, true);
  assert.equal(local.getUser(db, 'staff@x.com').login_name, 'staffnew');

  // 自己改成自己目前的值不算衝突。
  const r2 = await handleRequest(db, config, {
    action: 'adminUpdateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'staff@x.com', loginName: 'staffnew',
  });
  assert.equal(r2.data.ok, true);

  const r3 = await handleRequest(db, config, {
    action: 'adminUpdateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'admin@x.com', loginName: 'staffnew',
  });
  assert.equal(r3.data.error, 'login_name_taken');
});

test('adminUpdateLocalAccount：twofaMethod=totp 但目標未完成 TOTP 註冊 → totp_not_enrolled（防把人鎖在門外）', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminUpdateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'staff@x.com', twofaMethod: 'totp',
  });
  assert.equal(r.data.error, 'totp_not_enrolled');
});

test('adminUpdateLocalAccount：twofaMethod=email 但（本次未附/既有為空）otp_emails → otp_emails_required', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminUpdateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'staff@x.com', twofaMethod: 'email',
  });
  assert.equal(r.data.error, 'otp_emails_required');
});

test('adminUpdateLocalAccount：同時附 otpEmails 與 twofaMethod=email → 一起生效', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminUpdateLocalAccount', sessionToken: adminTok, rootFolderId: ROOT,
    email: 'staff@x.com', otpEmails: ['staff@x.com', 'backup@x.com'], twofaMethod: 'email',
  });
  assert.equal(r.data.ok, true);
  const row = local.getUser(db, 'staff@x.com');
  assert.equal(row.twofa_method, 'email');
  assert.deepEqual(local.parseOtpEmails(row), ['staff@x.com', 'backup@x.com']);
});

// ══════════════════════════════════════════════════════════════════════════
// adminResetPassword
// ══════════════════════════════════════════════════════════════════════════

test('adminResetPassword：重設為初始密碼、must_change_password=1，並解除既有鎖定', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  // 先製造 staff 帳號鎖定狀態。
  for (let i = 0; i < local.MAX_FAILED_ATTEMPTS; i++) {
    await login(db, config, 'staff@x.com', 'wrong-password');
  }
  assert.ok(local.isLocked(local.getUser(db, 'staff@x.com'), Math.floor(Date.now() / 1000)));

  const r = await handleRequest(db, config, {
    action: 'adminResetPassword', sessionToken: adminTok, rootFolderId: ROOT, email: 'staff@x.com',
  });
  assert.equal(r.data.ok, true);

  const row = local.getUser(db, 'staff@x.com');
  assert.equal(row.must_change_password, 1);
  assert.equal(row.locked_until, null, '應解除鎖定');
  assert.equal(row.failed_attempts, 0);

  const loginAttempt = await login(db, config, 'staff@x.com', '123456789');
  assert.equal(loginAttempt.data.error, 'password_change_required');
});

// ══════════════════════════════════════════════════════════════════════════
// adminResetTwofa
// ══════════════════════════════════════════════════════════════════════════

test('adminResetTwofa：清空 TOTP/Email 驗證碼設定，且撤銷該帳號全部裝置信任憑證', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);

  const secret = totp.generateSecret();
  db.prepare('UPDATE users SET totp_secret = ?, totp_enrolled = 1, totp_enrolled_at = ? WHERE email = ?')
    .run(secret, new Date().toISOString(), 'staff@x.com');
  db.prepare("UPDATE users SET twofa_method = 'totp' WHERE email = ?").run('staff@x.com');

  // staff 登入一次拿裝置信任憑證。
  const staffLogin1 = await login(db, config, 'staff@x.com', 'staff-pw-123456', { otp: totp.totp(secret) });
  const deviceToken = staffLogin1.data.newDeviceToken;
  assert.ok(deviceToken, '首次通過 TOTP 應簽發裝置憑證');

  const r = await handleRequest(db, config, {
    action: 'adminResetTwofa', sessionToken: adminTok, rootFolderId: ROOT, email: 'staff@x.com',
  });
  assert.equal(r.data.ok, true);

  const row = local.getUser(db, 'staff@x.com');
  assert.equal(row.totp_secret, null);
  assert.equal(row.totp_enrolled, 0);
  assert.equal(row.twofa_method, null);
  assert.equal(row.otp_emails, null);

  // 裝置憑證應已全數撤銷：帶著舊 deviceToken 登入應重新要求第二因素（此時尚未選方法，故直接放行——
  // 用另一個判準驗證撤銷本身：verifyDeviceToken 直接回 false）。
  const revokedBefore = require('../src/auth/session').getRevokedBefore(db, 'staff@x.com');
  const stillValid = deviceTrust.verifyDeviceToken(db, deviceToken, 'staff@x.com', revokedBefore, config.TRUSTED_DEVICE_DAYS);
  assert.equal(stillValid, false, '重設 2FA 後，舊裝置憑證應已撤銷，不可再用於免第二因素登入');

  const auditRow = db.prepare(
    "SELECT * FROM audit_log WHERE action = 'adminResetTwofa' AND target = ?"
  ).get('staff@x.com');
  assert.ok(auditRow);
  assert.equal(auditRow.email, 'admin@x.com');
});

test('adminResetTwofa：帳號不存在 → account_not_found', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminResetTwofa', sessionToken: adminTok, rootFolderId: ROOT, email: 'intern1@x.com',
  });
  assert.equal(r.data.error, 'account_not_found');
});
