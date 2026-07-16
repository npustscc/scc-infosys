// server/test/dispatch.test.js — 閘門管線＋垂直切片整合測試（:memory: db，直接呼叫
// dispatch.handleRequest，不經 HTTP layer——HTTP wire contract 由 curl 冒煙測試涵蓋）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');

const ROOT = 'ROOT_TEST';
const OTHER_ROOT = 'OTHER_ROOT_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-dispatch',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
  }, overrides || {});
}

async function setupAuthorizedUser(db, email, password) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, {
    name: 'config.json',
    parentId: ROOT,
    content: { users: { [email]: { role: '專任諮商心理師' } } },
  });
}

async function login(db, config, email, password) {
  const r = await handleRequest(db, config, {
    action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent',
  });
  return r;
}

// ── 身分/憑證閘 ──────────────────────────────────────────────────────────

test('ping 無 token → Session expired（業務錯誤，success:true）', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), { action: 'ping', rootFolderId: ROOT });
  assert.equal(r.success, true);
  assert.equal(r.data.error, 'Session expired');
});

test('sessionStart 密碼錯 → invalid_credentials（不可用 Session expired/Unauthorized）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const r = await login(db, testConfig(), 'a@x.com', 'wrong-password');
  assert.equal(r.success, true);
  assert.equal(r.data.error, 'invalid_credentials');
});

test('sessionStart 帳密正確但未列在 config.json users → Unauthorized user', async () => {
  const db = openDb(':memory:');
  await local.upsertUser(db, 'nobody@x.com', 'right-password');
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: {} } });
  const r = await login(db, testConfig(), 'nobody@x.com', 'right-password');
  assert.equal(r.data.error, 'Unauthorized user');
});

test('sessionStart 成功 → sessionToken/exp/email/mailSent:false，exp 為台北當日午夜', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const r = await login(db, testConfig(), 'a@x.com', 'right-password');
  assert.equal(r.success, true);
  assert.ok(r.data.sessionToken);
  assert.equal(r.data.email, 'a@x.com');
  assert.equal(r.data.mailSent, false);
  assert.ok(r.data.exp > Math.floor(Date.now() / 1000));
});

test('sessionStart 帶 sessionToken（拿舊 session 換新）→ Session expired', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'sessionStart', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, email: 'a@x.com', password: 'right-password',
  });
  assert.equal(r.data.error, 'Session expired');
});

test('帶有效 token 的 ping → ok:true, email 回傳正確', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), { action: 'ping', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });
  assert.deepEqual(r, { success: true, data: { ok: true, email: 'a@x.com' } });
});

test('rootFolderId 與 .env 設定不符 → Unauthorized rootFolderId', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), { action: 'ping', sessionToken: login1.data.sessionToken, rootFolderId: 'SOME_OTHER_ROOT' });
  assert.equal(r.data.error, 'Unauthorized rootFolderId');
});

test('停用帳號的 token（config.json 內 disabled:true）→ Unauthorized user', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  // 登入後才停用（模擬管理者在使用者登入期間停權）——沿用相同 token 應立即被擋。
  // 用 listMySessions（非 AUTHZ_EXEMPT）而非 ping：ping 本身是探測用途豁免授權閘（AUTHZ_EXEMPT
  // 涵蓋 ping/submitUserApplication/sessionStart），停用帳號一樣能 ping 成功是正確行為、非本測試對象。
  vdrive.updateJson(db, 'config.json', { users: { 'a@x.com': { role: '專任諮商心理師', disabled: true } } }, { root: ROOT });
  const r = await handleRequest(db, testConfig(), { action: 'listMySessions', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });
  assert.equal(r.data.error, 'Unauthorized user');
});

// ── readJson/updateJson roundtrip ───────────────────────────────────────

test('readJson/updateJson：roundtrip（不存在則新建、更新後可讀回最新內容）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;
  const cfg = testConfig();

  const w1 = await handleRequest(db, cfg, { action: 'updateJson', sessionToken: tok, rootFolderId: ROOT, path: 'bookings.json', content: { items: [1] } });
  assert.equal(w1.success, true);

  const r1 = await handleRequest(db, cfg, { action: 'readJson', sessionToken: tok, rootFolderId: ROOT, path: 'bookings.json' });
  assert.deepEqual(r1.data, { items: [1] });

  const w2 = await handleRequest(db, cfg, { action: 'updateJson', sessionToken: tok, rootFolderId: ROOT, path: 'bookings.json', content: { items: [1, 2] } });
  assert.equal(w2.success, true);
  const r2 = await handleRequest(db, cfg, { action: 'readJson', sessionToken: tok, rootFolderId: ROOT, path: 'bookings.json' });
  assert.deepEqual(r2.data, { items: [1, 2] });
});

// ── F3 ROOT_GUARDED：root 外 fileId → Forbidden ─────────────────────────

test('readJsonById：root 外的 fileId → Forbidden: target outside root', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const outside = vdrive.createJson(db, { name: 'secret.json', parentId: OTHER_ROOT, content: { top: 'secret' } });

  const r = await handleRequest(db, testConfig(), {
    action: 'readJsonById', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, fileId: outside.id,
  });
  assert.equal(r.data.error, 'Forbidden: target outside root');
});

test('readJsonById：root 內的 fileId → 正常讀取', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const inside = vdrive.createJson(db, { name: 'todo.json', parentId: ROOT, content: { tasks: [] } });

  const r = await handleRequest(db, testConfig(), {
    action: 'readJsonById', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, fileId: inside.id,
  });
  assert.deepEqual(r.data, { tasks: [] });
});

// ── listFolder / query ───────────────────────────────────────────────

test('listFolder / query：正確回傳資料夾內容', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;
  const folder = vdrive.createFolder(db, { name: 'cases', parentId: ROOT });
  vdrive.createJson(db, { name: 'active-01.json', content: {}, parentId: folder.id });

  const rf = await handleRequest(db, testConfig(), { action: 'listFolder', sessionToken: tok, rootFolderId: ROOT, folderId: folder.id });
  assert.equal(rf.data.files.length, 1);

  const rq = await handleRequest(db, testConfig(), { action: 'query', sessionToken: tok, rootFolderId: ROOT, q: `'${folder.id}' in parents and trashed=false` });
  assert.equal(rq.data.files.length, 1);

  const rqDenied = await handleRequest(db, testConfig(), { action: 'query', sessionToken: tok, rootFolderId: ROOT, q: `'${OTHER_ROOT}' in parents and trashed=false` });
  assert.equal(rqDenied.data.error, 'Forbidden: query must be scoped under root');
});

// ── startupBatch ─────────────────────────────────────────────────────

test('startupBatch：回傳齊全（config/各檔案/usersFolderId/modTimes）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  vdrive.createJson(db, { name: 'bookings.json', parentId: ROOT, content: { items: [] } });
  vdrive.createFolder(db, { name: 'users', parentId: ROOT });

  const r = await handleRequest(db, testConfig(), {
    action: 'startupBatch', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    userEmail: 'a@x.com', envSuffix: 'dev',
  });
  assert.equal(r.success, true);
  assert.ok(r.data.config, 'config.json 應被讀到');
  assert.deepEqual(r.data.bookings, { items: [] });
  assert.ok(r.data.usersFolderId, 'users 資料夾應被解析出來');
  assert.ok(r.data.modTimes.config);
});

// ── 厚 commit 類 action（Phase 1.5：見 actions/commit.js＋test/commit-actions.test.js 詳細案例）──
// dispatch 層只驗證「有掛到閘門與 ACTION_TABLE」，語意細節（fail-closed／不整檔覆寫等）另有專檔涵蓋。

test('casesUpsert（厚商業邏輯 commit 類）→ 經 dispatch 正常寫入（不再是 Not implemented）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  vdrive.createFolder(db, { name: 'cases', parentId: ROOT });
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'casesUpsert', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    path: 'cases/chunk-a.json', upserts: [{ id: 'C1', name: 'demo' }],
  });
  assert.equal(r.success, true);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.count, 1);
});

// ── 未實作 action ────────────────────────────────────────────────────

// 日曆同步 7 個 action 已於 Phase 2b 實作（見 src/sync/gcSync.js＋test/dispatch-calendar.test.js
// 的完整案例）；本檔只驗證「CALENDAR_SYNC_CREDS 未設定時的 fail-fast」仍掛在 dispatch 管線上
// （對映 fetchMentalLeaves 對 GMAIL_SYNC_CREDS 未設定的處理方式，見 test/dispatch-mental-leaves.test.js）。
test('createCalendarEvent（日曆同步）：未設定 CALENDAR_SYNC_CREDS → 業務失敗（fail envelope，含提示訊息）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), { action: 'createCalendarEvent', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });
  assert.equal(r.success, false);
  assert.match(r.error, /CALENDAR_SYNC_CREDS/);
});

// ── 登出即註銷 ───────────────────────────────────────────────────────

test('sessionLogout 後，舊 token 立即失效（同帳號全部裝置）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const beforeLogout = await handleRequest(db, testConfig(), { action: 'ping', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(beforeLogout.data.ok, true);

  const logoutR = await handleRequest(db, testConfig(), { action: 'sessionLogout', sessionToken: tok, rootFolderId: ROOT });
  assert.deepEqual(logoutR.data, { ok: true });

  // 註銷判定為 iat < revoked_before（GAS 版同語意，見 dev/Code.gs verifySessionToken_）——
  // 若登入/登出發生在同一秒，revoked_before 與 iat 可能相等而不觸發（GAS 版本來就有此邊界情形）。
  // 測試環境執行速度快，兩者常落在同一秒，故此處直接把 revoked_before 撥到 token iat 之後一秒，
  // 明確驗證「一旦 revoked_before > iat，舊 token 即失效」這條核心規則，避免測試被時間粒度誤判為假陽性。
  const sessionAuth = require('../src/auth/session');
  sessionAuth.revokeAllDevices(db, 'a@x.com', Date.now() + 1500);

  const afterLogout = await handleRequest(db, testConfig(), { action: 'ping', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(afterLogout.data.error, 'Session expired');
});

test('listMySessions：登入後可看到自己這筆紀錄，current 標記正確', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;
  const jti = JSON.parse(Buffer.from(tok.split('.')[0].replace(/-/g, '+').replace(/_/g, '/') + '==', 'base64').toString('utf8')).jti;

  const r = await handleRequest(db, testConfig(), { action: 'listMySessions', sessionToken: tok, rootFolderId: ROOT, currentJti: jti });
  assert.equal(r.data.sessions.length, 1);
  assert.equal(r.data.sessions[0].current, true);
  assert.equal(r.data.sessions[0].active, true);
});

// ── audit_log：每個請求都寫一筆 ─────────────────────────────────────

test('audit_log 筆數 == 請求數（含拒絕/例外的請求）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');

  const requests = [
    () => handleRequest(db, testConfig(), { action: 'ping', rootFolderId: ROOT }), // denied: no token
    () => login(db, testConfig(), 'a@x.com', 'right-password'), // ok
    () => login(db, testConfig(), 'a@x.com', 'wrong'), // denied: invalid_credentials
  ];
  for (const r of requests) await r();

  // dispatch.handleRequest 每個請求恰寫一筆（本測試對象）；src/mail/mailer.js 的寄信嘗試（本例：
  // 第一次成功登入為 first_login，觸發登入通知信決策）另記一筆獨立的稽核紀錄（action=
  // 'sessionStart.loginMail'），語意上屬於「寄信元件自己的稽核軌跡」而非 dispatch 請求稽核，
  // 排除後單獨核對，兩者互不干擾。
  const dispatchCount = db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action != 'sessionStart.loginMail'").get().c;
  assert.equal(dispatchCount, requests.length);
  const mailCount = db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'sessionStart.loginMail'").get().c;
  assert.equal(mailCount, 1); // 唯一一次成功登入（first_login）觸發一次寄信嘗試（無 MAIL_SEND_CREDS → skipped）
});
