// server/test/dispatch-config-patch.test.js — configSelfPatch／configCasesPatch 整合測試
// （:memory: db，經 dispatch.handleRequest）。cutover 後這兩個 action 缺席造成個人偏好與
// 個案存取授權流程靜默失敗（audit_log 全 denied），本檔對移植版驗證：白名單、fail-closed、
// 只動本人條目、六種 cases op 的語意。另附 sessionStart 回傳 twofaMethod/loginName 的驗證
//（login.html 據此決定要不要進 TOTP 設定引導——Email 驗證碼帳號不得每次登入都被再問一次）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const configActions = require('../src/actions/config');

const ROOT = 'ROOT_CONFIG_PATCH_TEST';
const ctx = { root: ROOT };

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-config-patch',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    TRUSTED_DEVICE_DAYS: 30,
  }, overrides || {});
}

async function setup(db, usersMap) {
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: usersMap } });
  await local.upsertUser(db, 'staff@x.com', 'staff-pw-123456');
  const config = testConfig();
  const r = await handleRequest(db, config, {
    action: 'sessionStart', rootFolderId: ROOT, email: 'staff@x.com', password: 'staff-pw-123456', ua: 't',
  });
  return { config, tok: r.data.sessionToken, loginData: r.data };
}

function readUsers(db) {
  return vdrive.readJson(db, 'config.json', ctx).data.users;
}

// ══════════════ configSelfPatch ══════════════

test('configSelfPatch：白名單欄位寫入本人條目並回傳更新後條目；null 刪除欄位', async () => {
  const db = openDb(':memory:');
  const { config, tok } = await setup(db, { 'staff@x.com': { role: '專任諮商心理師', recPageSize: 5 } });

  const r1 = await handleRequest(db, config, {
    action: 'configSelfPatch', sessionToken: tok, rootFolderId: ROOT,
    updates: { counselorFreqMode: true, avatar: 'data:image/jpeg;base64,xxxx', recPageSize: null },
  });
  assert.equal(r1.success, true);
  assert.equal(r1.data.user.counselorFreqMode, true);
  assert.equal(r1.data.user.avatar, 'data:image/jpeg;base64,xxxx');
  assert.ok(!('recPageSize' in r1.data.user));

  const users = readUsers(db);
  assert.equal(users['staff@x.com'].counselorFreqMode, true);
  assert.ok(!('recPageSize' in users['staff@x.com']));
});

test('configSelfPatch：授權欄位（role/isAdmin/allowedCases…）一律拒絕，不部分套用', async () => {
  const db = openDb(':memory:');
  const { config, tok } = await setup(db, { 'staff@x.com': { role: '專任諮商心理師' } });

  const r = await handleRequest(db, config, {
    action: 'configSelfPatch', sessionToken: tok, rootFolderId: ROOT,
    updates: { counselorFreqMode: true, isAdmin: true },
  });
  assert.equal(r.success, false);
  assert.match(r.error, /白名單/);
  assert.ok(!readUsers(db)['staff@x.com'].counselorFreqMode); // 整包拒絕，counselorFreqMode 也不得寫入
});

test('configSelfPatch：呼叫者條目不存在 → 拒絕，不建立新條目', async () => {
  const db = openDb(':memory:');
  // staff 可通過授權閘需要在 users 內——改用另一個帳號模擬：條目在授權閘後被移除的極端情境，
  // 直接呼叫 action 函式驗證第二層防線。
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { 'other@x.com': {} } } });
  assert.throws(
    () => configActions.configSelfPatch(db, { updates: { recPageSize: 10 } }, ctx, 'ghost@x.com'),
    /呼叫者條目不存在/
  );
  assert.ok(!readUsers(db)['ghost@x.com']);
});

test('configSelfPatch：navOrder_ 前綴與 ColWidths 尾碼放行；其他未知欄位拒絕', async () => {
  assert.equal(configActions.selfPatchKeyAllowed('navOrder_todoTabs'), true);
  assert.equal(configActions.selfPatchKeyAllowed('mlColWidths2'), true);
  assert.equal(configActions.selfPatchKeyAllowed('auditColWidths'), true);
  assert.equal(configActions.selfPatchKeyAllowed('avatar'), true);
  assert.equal(configActions.selfPatchKeyAllowed('role'), false);
  assert.equal(configActions.selfPatchKeyAllowed('name'), false);
  assert.equal(configActions.selfPatchKeyAllowed('somethingElse'), false);
});

// ══════════════ configCasesPatch ══════════════

test('configCasesPatch：caseAccessUpsert／Remove／SemsSet 語意（含 extraRole 隨動）', async () => {
  const db = openDb(':memory:');
  const { config, tok } = await setup(db, {
    'staff@x.com': { role: '專任諮商心理師' },
    'mgr@x.com': { role: '兼任諮商心理師' },
  });

  const r1 = await handleRequest(db, config, {
    action: 'configCasesPatch', sessionToken: tok, rootFolderId: ROOT,
    ops: [{ type: 'caseAccessUpsert', email: 'mgr@x.com', caseId: 'A114001', sems: ['114-1'] }],
  });
  assert.equal(r1.success, true);
  let mgr = readUsers(db)['mgr@x.com'];
  assert.deepEqual(mgr.allowedCases, ['A114001']);
  assert.deepEqual(mgr.allowedCasesSems, { A114001: ['114-1'] });
  assert.equal(mgr.extraRole, '個案管理員');

  await handleRequest(db, config, {
    action: 'configCasesPatch', sessionToken: tok, rootFolderId: ROOT,
    ops: [{ type: 'caseAccessSemsSet', email: 'mgr@x.com', caseId: 'A114001', sems: ['114-1', '114-2'] }],
  });
  assert.deepEqual(readUsers(db)['mgr@x.com'].allowedCasesSems.A114001, ['114-1', '114-2']);

  await handleRequest(db, config, {
    action: 'configCasesPatch', sessionToken: tok, rootFolderId: ROOT,
    ops: [{ type: 'caseAccessRemove', email: 'mgr@x.com', caseId: 'A114001' }],
  });
  mgr = readUsers(db)['mgr@x.com'];
  assert.ok(!('allowedCases' in mgr));
  assert.ok(!('extraRole' in mgr));
});

test('configCasesPatch：任一 op 驗證失敗整包拒絕（fail-closed，不部分套用）', async () => {
  const db = openDb(':memory:');
  const { config, tok } = await setup(db, {
    'staff@x.com': { role: '專任諮商心理師' },
    'mgr@x.com': { role: '兼任諮商心理師' },
  });

  const r = await handleRequest(db, config, {
    action: 'configCasesPatch', sessionToken: tok, rootFolderId: ROOT,
    ops: [
      { type: 'caseAccessUpsert', email: 'mgr@x.com', caseId: 'A114001' },
      { type: 'nomailAdd', email: 'nomail_x', entry: { isAdmin: true } }, // 未通過驗證 → 整包拒
    ],
  });
  assert.equal(r.success, false);
  assert.ok(!readUsers(db)['mgr@x.com'].allowedCases);
});

test('configCasesPatch：selfRename 只能搬呼叫者本人；nomailAdd 不得夾帶授權欄位', async () => {
  const db = openDb(':memory:');
  const { config, tok } = await setup(db, { 'staff@x.com': { role: '專任諮商心理師', bkColor: '#abc' } });

  const r1 = await handleRequest(db, config, {
    action: 'configCasesPatch', sessionToken: tok, rootFolderId: ROOT,
    ops: [{ type: 'nomailAdd', email: 'nomail_王小明', entry: { name: '王小明', role: '義務輔導老師' } }],
  });
  assert.equal(r1.success, true);
  assert.equal(readUsers(db)['nomail_王小明'].name, '王小明');

  const r2 = await handleRequest(db, config, {
    action: 'configCasesPatch', sessionToken: tok, rootFolderId: ROOT,
    ops: [{ type: 'selfRename', toEmail: 'staff-new@x.com' }],
  });
  assert.equal(r2.success, true);
  const users = readUsers(db);
  assert.ok(!users['staff@x.com']);
  assert.equal(users['staff-new@x.com'].bkColor, '#abc');
  assert.equal(users['staff-new@x.com'].previousEmails[0].email, 'staff@x.com');
});

// ══════════════ sessionStart：twofaMethod／loginName ══════════════

test('sessionStart：ok 回傳 twofaMethod=null（未設定第二因素）與 loginName', async () => {
  const db = openDb(':memory:');
  const { loginData } = await setup(db, { 'staff@x.com': { role: '專任諮商心理師' } });
  assert.equal(loginData.twofaMethod, null);
  assert.equal(loginData.loginName, 'staff@x.com'); // upsertUser 預設 login_name=lower(email)
});

test('sessionStart：Email 驗證碼帳號通過驗證後 twofaMethod=email（前端據此跳過 TOTP 設定引導）', async () => {
  const db = openDb(':memory:');
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { 'staff@x.com': { role: '專任諮商心理師' } } } });
  await local.upsertUser(db, 'staff@x.com', 'staff-pw-123456');
  db.prepare("UPDATE users SET twofa_method = 'email', otp_emails = '[\"staff@x.com\"]' WHERE email = 'staff@x.com'").run();
  const config = testConfig();

  // 不經 mailer：直接把已知碼的 sha256 雜湊塞進 DB（等同 issueEmailOtp 已寄出），再帶碼登入。
  const crypto = require('node:crypto');
  const codeStr = '123456';
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare(
    `UPDATE users SET email_otp_hash = ?, email_otp_expires_at = ?, email_otp_attempts = 0,
       email_otp_sent_at = ?, updated_at = ? WHERE email = 'staff@x.com'`
  ).run(crypto.createHash('sha256').update(codeStr, 'utf8').digest('hex'), expiresAt, now, now);

  const r = await handleRequest(db, config, {
    action: 'sessionStart', rootFolderId: ROOT, email: 'staff@x.com', password: 'staff-pw-123456',
    emailOtp: codeStr, ua: 't',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.twofaMethod, 'email');
  assert.ok(r.data.sessionToken);
});
