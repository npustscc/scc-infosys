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
  // v207：isFreshmenTestContact 是授權欄位（新生心理測驗主責），與 isTransferContact/
  // isMentalLeaveContact 同層，不得經 configSelfPatch 自行開通。
  assert.equal(configActions.selfPatchKeyAllowed('isFreshmenTestContact'), false);
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

  // v207：nomailAdd 不得夾帶 isFreshmenTestContact（同 isTransferContact/isMentalLeaveContact，
  // 授權欄位一律不得經此無 Gmail 帳號的自填通道夾帶）。
  const rFt = await handleRequest(db, config, {
    action: 'configCasesPatch', sessionToken: tok, rootFolderId: ROOT,
    ops: [{ type: 'nomailAdd', email: 'nomail_偷渡主責', entry: { name: 'x', role: '義務輔導老師', isFreshmenTestContact: true } }],
  });
  assert.equal(rFt.success, false);
  assert.ok(!readUsers(db)['nomail_偷渡主責']);

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

// ══════════════ #035 物件級授權（casesPatchOpAuthz，shadow/enforce）══════════════

test('casesPatchOpAuthz：純函式各角色判定', () => {
  const users = {
    'admin@x.com': { role: '主任' },
    'sup@x.com': { role: '專任諮商心理師', extraRole: '實習生專業督導' },
    'tc@x.com': { role: '專任社會工作師', isTransferContact: true },
    'main@x.com': { role: '專任諮商心理師' },
    'mgr@x.com': { role: '兼任諮商心理師', allowedCases: ['A1'] },
    'iv@x.com': { role: '實習諮商心理師' },
    'other@x.com': { role: '專任諮商心理師' },
  };
  const lookup = (id) => (id === 'A1' ? { id: 'A1', counselorEmail: 'main@x.com', interviewerEmails: ['iv@x.com'] } : null);
  const up = { type: 'caseAccessUpsert', email: 'other@x.com', caseId: 'A1' };
  const az = configActions.casesPatchOpAuthz;

  assert.equal(az(users, up, 'admin@x.com', lookup).ok, true);   // 管理者
  assert.equal(az(users, up, 'sup@x.com', lookup).ok, true);     // 督導
  assert.equal(az(users, up, 'tc@x.com', lookup).ok, true);      // 轉銜窗口
  assert.equal(az(users, up, 'main@x.com', lookup).ok, true);    // 現任主責
  assert.equal(az(users, up, 'mgr@x.com', lookup).ok, true);     // 既有個管
  assert.equal(az(users, up, 'iv@x.com', lookup).ok, true);      // 初談員
  assert.equal(az(users, up, 'other@x.com', lookup).ok, false);  // 無關同仁 → 擋

  // 查無案（同批新建/索引時差）放行但記 reason
  const d = az(users, { type: 'caseAccessUpsert', email: 'other@x.com', caseId: 'ZZZ' }, 'other@x.com', lookup);
  assert.equal(d.ok, true);
  assert.equal(d.reason, 'case_not_found');

  // selfRename 恆放行；nomailAdd 非特權一律擋
  assert.equal(az(users, { type: 'selfRename', toEmail: 'x@y.com' }, 'other@x.com', lookup).ok, true);
  assert.equal(az(users, { type: 'nomailAdd', email: 'nomail_a', entry: {} }, 'other@x.com', lookup).ok, false);
  assert.equal(az(users, { type: 'nomailAdd', email: 'nomail_a', entry: {} }, 'tc@x.com', lookup).ok, true);
});

test('configCasesPatch enforce：無關同仁對既有案派任 → 整批拒絕、不套用、稽核 denied', async () => {
  const db = openDb(':memory:');
  const { config, tok } = await setup(db, {
    'staff@x.com': { role: '專任諮商心理師' },
    'main@x.com': { role: '專任諮商心理師' },
  });
  vdrive.createJson(db, {
    name: 'cases-index.json', parentId: ROOT,
    content: { cases: [{ id: 'A114001', counselorEmail: 'main@x.com', interviewerEmails: [] }] },
  });
  const cfgEnforce = Object.assign({}, config, { CASES_PATCH_AUTHZ_MODE: 'enforce' });

  const r = await handleRequest(db, cfgEnforce, {
    action: 'configCasesPatch', sessionToken: tok, rootFolderId: ROOT,
    ops: [{ type: 'caseAccessUpsert', email: 'staff@x.com', caseId: 'A114001' }], // 自授
  });
  assert.equal(r.success, false);
  assert.match(r.error, /派任權限/);
  assert.ok(!readUsers(db)['staff@x.com'].allowedCases); // 未套用
  const row = db.prepare("SELECT outcome,detail FROM audit_log WHERE action='configCasesPatch.authz' ORDER BY id DESC").get();
  assert.equal(row.outcome, 'denied');
  assert.match(row.detail, /caseAccessUpsert/);
});

test('configCasesPatch shadow（預設）：同一情境放行但稽核 would_deny', async () => {
  const db = openDb(':memory:');
  const { config, tok } = await setup(db, {
    'staff@x.com': { role: '專任諮商心理師' },
    'main@x.com': { role: '專任諮商心理師' },
  });
  vdrive.createJson(db, {
    name: 'cases-index.json', parentId: ROOT,
    content: { cases: [{ id: 'A114001', counselorEmail: 'main@x.com', interviewerEmails: [] }] },
  });

  const r = await handleRequest(db, config, {
    action: 'configCasesPatch', sessionToken: tok, rootFolderId: ROOT,
    ops: [{ type: 'caseAccessUpsert', email: 'staff@x.com', caseId: 'A114001' }],
  });
  assert.equal(r.success, true); // shadow 不阻擋
  assert.deepEqual(readUsers(db)['staff@x.com'].allowedCases, ['A114001']);
  const row = db.prepare("SELECT outcome,detail FROM audit_log WHERE action='configCasesPatch.authz' ORDER BY id DESC").get();
  assert.equal(row.outcome, 'would_deny');
  assert.match(row.detail, /^shadow;/);
});

test('configCasesPatch shadow：主責/督導派任不產生 would_deny 稽核', async () => {
  const db = openDb(':memory:');
  const { config, tok } = await setup(db, {
    'staff@x.com': { role: '專任諮商心理師' },
    'mgr@x.com': { role: '兼任諮商心理師' },
  });
  vdrive.createJson(db, {
    name: 'cases-index.json', parentId: ROOT,
    content: { cases: [{ id: 'A114001', counselorEmail: 'staff@x.com', interviewerEmails: [] }] },
  });

  const r = await handleRequest(db, config, {
    action: 'configCasesPatch', sessionToken: tok, rootFolderId: ROOT,
    ops: [{ type: 'caseAccessUpsert', email: 'mgr@x.com', caseId: 'A114001' }], // 主責派個管＝合法
  });
  assert.equal(r.success, true);
  const row = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='configCasesPatch.authz'").get();
  assert.equal(row.n, 0);
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
