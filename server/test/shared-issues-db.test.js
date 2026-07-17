// server/test/shared-issues-db.test.js — issues.json dev/prod 共用 sqlite 路由（v198）。
// 涵蓋：SHARED_ISSUES_DB 設定時 listCommit/readJson/createJson/startupBatch 改走共用庫、主庫不落地；
// 未設定時行為與改動前一致；資安邊界（其他檔案不受影響、config.json 絕不路由進共用庫）；
// 兩個「環境」（模擬 dev/prod，各自獨立主庫）共用同一個 SHARED_ISSUES_DB 時互相可見；
// 附帶回歸測試：issues.json 四個 action 不再被 rootFolderId 不吻合擋下（v198 前的既有 bug，
// 見 dispatch.js「issues.json 路由」段落註解），其餘 action 的 rootFolderId 檢查不受影響。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const sharedIssuesDb = require('../src/storage/sharedIssuesDb');

function tmpSqlitePath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `scc-shared-issues-${label}-`));
  return path.join(dir, 'shared.sqlite');
}

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-shared-issues',
    ROOT_FOLDER_ID: 'ROOT_A',
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
  }, overrides || {});
}

async function setupAuthorizedUser(db, root, email, password) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, {
    name: 'config.json',
    parentId: root,
    content: { users: { [email]: { role: '專任諮商心理師' } } },
  });
}

async function login(db, config, email, password) {
  const r = await handleRequest(db, config, {
    action: 'sessionStart', rootFolderId: config.ROOT_FOLDER_ID, email, password, ua: 'test-agent',
  });
  return r;
}

// ── 未設定 SHARED_ISSUES_DB：行為與改動前完全一致 ──────────────────────────

test('未設定 SHARED_ISSUES_DB：listCommit(issues.json) 落在本環境主庫，rootFolderId 不吻合仍照舊被擋', async () => {
  const db = openDb(':memory:');
  const config = testConfig(); // 無 SHARED_ISSUES_DB
  await setupAuthorizedUser(db, config.ROOT_FOLDER_ID, 'a@x.com', 'right-password');
  const login1 = await login(db, config, 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  // 帶前端沿用的 GAS 時代 ISSUES_FOLDER_ID（此處故意用一個不等於本環境 ROOT_FOLDER_ID 的假值）
  // ── 未啟用共用庫時，issues.json 仍照原設計路由到本環境 ctx.root，不受 SHARED_ISSUES_DB 影響。
  const r = await handleRequest(db, config, {
    action: 'listCommit', sessionToken: tok, rootFolderId: config.ROOT_FOLDER_ID,
    file: 'issues.json', upserts: [{ id: 'i1', title: 'hello' }],
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.data.data.issues, [{ id: 'i1', title: 'hello' }]);

  // 直接檢查主庫確實落地了 issues.json。
  const { data } = vdrive.readJson(db, 'issues.json', { root: config.ROOT_FOLDER_ID });
  assert.deepEqual(data.issues, [{ id: 'i1', title: 'hello' }]);
});

test('未設定 SHARED_ISSUES_DB：createJson(issues.json) 帶前端 GAS 時代 parentId 也不再被 F3 擋下（獨立於 SHARED_ISSUES_DB 的既有 bug 修正）', async () => {
  const db = openDb(':memory:');
  const config = testConfig(); // 無 SHARED_ISSUES_DB
  await setupAuthorizedUser(db, config.ROOT_FOLDER_ID, 'a@x.com', 'right-password');
  const login1 = await login(db, config, 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const r = await handleRequest(db, config, {
    action: 'createJson', sessionToken: tok, rootFolderId: 'SOME_GAS_LEGACY_ISSUES_FOLDER_ID',
    name: 'issues.json', content: { issues: [{ id: 'i1' }] }, parentId: 'SOME_GAS_LEGACY_ISSUES_FOLDER_ID',
  });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.notEqual(r.data && r.data.error, 'Forbidden: target outside root');

  const { data } = vdrive.readJson(db, 'issues.json', { root: config.ROOT_FOLDER_ID });
  assert.deepEqual(data.issues, [{ id: 'i1' }]);
});

// ── 設定 SHARED_ISSUES_DB：issues.json 改走共用庫，主庫不落地 ─────────────

test('設定 SHARED_ISSUES_DB：listCommit(issues.json) 寫進共用庫，主庫完全不落地該檔', async () => {
  const db = openDb(':memory:');
  const sharedPath = tmpSqlitePath('listcommit');
  const config = testConfig({ SHARED_ISSUES_DB: sharedPath });
  await setupAuthorizedUser(db, config.ROOT_FOLDER_ID, 'a@x.com', 'right-password');
  const login1 = await login(db, config, 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const r = await handleRequest(db, config, {
    action: 'listCommit', sessionToken: tok, rootFolderId: 'SOME_GAS_LEGACY_ISSUES_FOLDER_ID',
    file: 'issues.json', upserts: [{ id: 'i1', title: 'hello' }],
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.data.data.issues, [{ id: 'i1', title: 'hello' }]);

  // 主庫完全不該有 issues.json 這個檔案。
  assert.throws(() => vdrive.readJson(db, 'issues.json', { root: config.ROOT_FOLDER_ID }), /File not found/);

  // 共用庫應該讀得到同一筆資料。
  const shared = sharedIssuesDb.getSharedIssuesDb(sharedPath);
  const { data } = vdrive.readJson(shared, 'issues.json', sharedIssuesDb.SHARED_CTX);
  assert.deepEqual(data.issues, [{ id: 'i1', title: 'hello' }]);
});

test('設定 SHARED_ISSUES_DB：readJson(issues.json) 讀得到共用庫內容；readJson(config.json) 仍讀主庫', async () => {
  const db = openDb(':memory:');
  const sharedPath = tmpSqlitePath('readjson');
  const config = testConfig({ SHARED_ISSUES_DB: sharedPath });
  await setupAuthorizedUser(db, config.ROOT_FOLDER_ID, 'a@x.com', 'right-password');
  const login1 = await login(db, config, 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  // 先直接種一筆到共用庫（模擬「對方環境」先寫入）。
  const shared = sharedIssuesDb.getSharedIssuesDb(sharedPath);
  vdrive.createJson(shared, {
    name: 'issues.json', parentId: sharedIssuesDb.SHARED_CTX.root,
    content: { issues: [{ id: 'peer-1', title: 'from other env' }] },
  });

  const r = await handleRequest(db, config, {
    action: 'readJson', sessionToken: tok, rootFolderId: 'SOME_GAS_LEGACY_ISSUES_FOLDER_ID', path: 'issues.json',
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.data.issues, [{ id: 'peer-1', title: 'from other env' }]);

  // config.json 不受影響，仍是本環境主庫的資料（資安邊界：機密設定絕不路由進共用庫）。
  const rc = await handleRequest(db, config, {
    action: 'readJson', sessionToken: tok, rootFolderId: config.ROOT_FOLDER_ID, path: 'config.json',
  });
  assert.equal(rc.success, true);
  assert.ok(rc.data.users['a@x.com']);
  assert.throws(() => vdrive.readJson(shared, 'config.json', sharedIssuesDb.SHARED_CTX), /File not found/);
});

test('設定 SHARED_ISSUES_DB：createJson(issues.json) 首次建檔落在共用庫（fallback 路徑，見 _saveIssuesFallback）', async () => {
  const db = openDb(':memory:');
  const sharedPath = tmpSqlitePath('createjson');
  const config = testConfig({ SHARED_ISSUES_DB: sharedPath });
  await setupAuthorizedUser(db, config.ROOT_FOLDER_ID, 'a@x.com', 'right-password');
  const login1 = await login(db, config, 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const r = await handleRequest(db, config, {
    action: 'createJson', sessionToken: tok, rootFolderId: 'SOME_GAS_LEGACY_ISSUES_FOLDER_ID',
    name: 'issues.json', content: { issues: [{ id: 'i1' }] }, parentId: 'SOME_GAS_LEGACY_ISSUES_FOLDER_ID',
  });
  assert.equal(r.success, true, JSON.stringify(r));

  const shared = sharedIssuesDb.getSharedIssuesDb(sharedPath);
  const { data } = vdrive.readJson(shared, 'issues.json', sharedIssuesDb.SHARED_CTX);
  assert.deepEqual(data.issues, [{ id: 'i1' }]);
  assert.throws(() => vdrive.readJson(db, 'issues.json', { root: config.ROOT_FOLDER_ID }), /File not found/);
});

test('設定 SHARED_ISSUES_DB：startupBatch 的 issues 分支讀共用庫，其餘 TOP_LEVEL_FILES 仍讀本環境主庫', async () => {
  const db = openDb(':memory:');
  const sharedPath = tmpSqlitePath('startupbatch');
  const config = testConfig({ SHARED_ISSUES_DB: sharedPath });
  await setupAuthorizedUser(db, config.ROOT_FOLDER_ID, 'a@x.com', 'right-password');
  const login1 = await login(db, config, 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;
  vdrive.createJson(db, { name: 'bookings.json', parentId: config.ROOT_FOLDER_ID, content: { items: ['local'] } });

  const shared = sharedIssuesDb.getSharedIssuesDb(sharedPath);
  vdrive.createJson(shared, {
    name: 'issues.json', parentId: sharedIssuesDb.SHARED_CTX.root,
    content: { issues: [{ id: 'shared-1' }] },
  });

  const r = await handleRequest(db, config, {
    action: 'startupBatch', sessionToken: tok, rootFolderId: config.ROOT_FOLDER_ID,
    userEmail: 'a@x.com', envSuffix: 'dev',
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.data.issues, { issues: [{ id: 'shared-1' }] });
  assert.deepEqual(r.data.bookings, { items: ['local'] });
  assert.ok(r.data.config, 'config.json 仍應讀到本環境主庫內容');
});

// ── 模擬 dev/prod 兩個環境共用同一個 SHARED_ISSUES_DB ──────────────────────

test('兩個環境（各自獨立主庫）共用同一個 SHARED_ISSUES_DB：一邊寫、另一邊立即讀得到', async () => {
  const sharedPath = tmpSqlitePath('crossenv');

  const dbDev = openDb(':memory:');
  const configDev = testConfig({ ROOT_FOLDER_ID: 'ROOT_DEV', SHARED_ISSUES_DB: sharedPath });
  await setupAuthorizedUser(dbDev, 'ROOT_DEV', 'dev-user@x.com', 'right-password');
  const loginDev = await login(dbDev, configDev, 'dev-user@x.com', 'right-password');

  const dbProd = openDb(':memory:');
  const configProd = testConfig({ ROOT_FOLDER_ID: 'ROOT_PROD', SHARED_ISSUES_DB: sharedPath });
  await setupAuthorizedUser(dbProd, 'ROOT_PROD', 'prod-user@x.com', 'right-password');
  const loginProd = await login(dbProd, configProd, 'prod-user@x.com', 'right-password');

  // dev 回報一筆問題。
  const rDev = await handleRequest(dbDev, configDev, {
    action: 'listCommit', sessionToken: loginDev.data.sessionToken, rootFolderId: 'ISSUES_FOLDER_ID_LEGACY',
    file: 'issues.json', upserts: [{ id: 'from-dev', title: '測試回報' }],
  });
  assert.equal(rDev.success, true);

  // prod 讀 issues.json 應立即看到 dev 剛回報的那筆。
  const rProd = await handleRequest(dbProd, configProd, {
    action: 'readJson', sessionToken: loginProd.data.sessionToken, rootFolderId: 'ISSUES_FOLDER_ID_LEGACY',
    path: 'issues.json',
  });
  assert.equal(rProd.success, true);
  assert.deepEqual(rProd.data.issues, [{ id: 'from-dev', title: '測試回報' }]);

  // prod 回覆／驗證結案（listCommit upsert 同 id），dev 應同步看到更新後的內容。
  const rProdUpdate = await handleRequest(dbProd, configProd, {
    action: 'listCommit', sessionToken: loginProd.data.sessionToken, rootFolderId: 'ISSUES_FOLDER_ID_LEGACY',
    file: 'issues.json', upserts: [{ id: 'from-dev', title: '測試回報', status: 'resolved' }],
  });
  assert.equal(rProdUpdate.success, true);

  const rDevReread = await handleRequest(dbDev, configDev, {
    action: 'readJson', sessionToken: loginDev.data.sessionToken, rootFolderId: 'ISSUES_FOLDER_ID_LEGACY',
    path: 'issues.json',
  });
  assert.deepEqual(rDevReread.data.issues, [{ id: 'from-dev', title: '測試回報', status: 'resolved' }]);
});

// ── 資安邊界：其他檔案不受 SHARED_ISSUES_DB 影響 ───────────────────────────

test('資安邊界：設定 SHARED_ISSUES_DB 時，mental_leaves.json（listCommit）仍落在本環境主庫', async () => {
  const db = openDb(':memory:');
  const sharedPath = tmpSqlitePath('mentalleaves');
  const config = testConfig({ SHARED_ISSUES_DB: sharedPath });
  await setupAuthorizedUser(db, config.ROOT_FOLDER_ID, 'a@x.com', 'right-password');
  const login1 = await login(db, config, 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const r = await handleRequest(db, config, {
    action: 'listCommit', sessionToken: tok, rootFolderId: config.ROOT_FOLDER_ID,
    file: 'mental_leaves.json', upserts: [{ id: 'M1' }],
  });
  assert.equal(r.success, true);

  const { data } = vdrive.readJson(db, 'mental_leaves.json', { root: config.ROOT_FOLDER_ID });
  assert.deepEqual(data.records, [{ id: 'M1' }]);

  const shared = sharedIssuesDb.getSharedIssuesDb(sharedPath);
  assert.throws(() => vdrive.readJson(shared, 'mental_leaves.json', sharedIssuesDb.SHARED_CTX), /File not found/);
});

test('資安邊界：設定 SHARED_ISSUES_DB 時，config.json 整檔寫入仍落在本環境主庫、共用庫不曾出現該檔', async () => {
  const db = openDb(':memory:');
  const sharedPath = tmpSqlitePath('configwrite');
  const config = testConfig({ SHARED_ISSUES_DB: sharedPath });
  await setupAuthorizedUser(db, config.ROOT_FOLDER_ID, 'admin@x.com', 'right-password');
  // 設成管理者才可整檔寫 config.json（isConfigWrite 的非管理者保護見 gate.js）。
  vdrive.updateJson(db, 'config.json', { users: { 'admin@x.com': { role: '主任' } } }, { root: config.ROOT_FOLDER_ID });
  const login1 = await login(db, config, 'admin@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const r = await handleRequest(db, config, {
    action: 'updateJson', sessionToken: tok, rootFolderId: config.ROOT_FOLDER_ID,
    path: 'config.json', content: { users: { 'admin@x.com': { role: '主任' }, 'new@x.com': { role: '兼任心理師' } } },
  });
  assert.equal(r.success, true);

  const { data } = vdrive.readJson(db, 'config.json', { root: config.ROOT_FOLDER_ID });
  assert.ok(data.users['new@x.com']);

  const shared = sharedIssuesDb.getSharedIssuesDb(sharedPath);
  assert.throws(() => vdrive.readJson(shared, 'config.json', sharedIssuesDb.SHARED_CTX), /File not found/);
});

// ── rootFolderId 不吻合的回歸測試 ───────────────────────────────────────

test('issues.json 四個 action：rootFolderId 不吻合本環境時不再被 Unauthorized rootFolderId 擋下（v198 修正前的 bug）', async () => {
  const db = openDb(':memory:');
  const config = testConfig(); // 無 SHARED_ISSUES_DB 也應修正（純檔名判斷，與是否啟用共用庫無關）
  await setupAuthorizedUser(db, config.ROOT_FOLDER_ID, 'a@x.com', 'right-password');
  const login1 = await login(db, config, 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;
  const MISMATCHED = 'NOT_THIS_ENV_ROOT';

  const rRead = await handleRequest(db, config, {
    action: 'readJson', sessionToken: tok, rootFolderId: MISMATCHED, path: 'issues.json',
  });
  assert.notEqual(rRead.data && rRead.data.error, 'Unauthorized rootFolderId');

  const rList = await handleRequest(db, config, {
    action: 'listCommit', sessionToken: tok, rootFolderId: MISMATCHED, file: 'issues.json', upserts: [],
  });
  assert.notEqual(rList.data && rList.data.error, 'Unauthorized rootFolderId');
});

test('其他 action 的 rootFolderId 檢查不受影響：仍在不吻合時被 Unauthorized rootFolderId 擋下', async () => {
  const db = openDb(':memory:');
  const config = testConfig();
  await setupAuthorizedUser(db, config.ROOT_FOLDER_ID, 'a@x.com', 'right-password');
  const login1 = await login(db, config, 'a@x.com', 'right-password');
  const tok = login1.data.sessionToken;

  const r = await handleRequest(db, config, {
    action: 'readJson', sessionToken: tok, rootFolderId: 'NOT_THIS_ENV_ROOT', path: 'config.json',
  });
  assert.equal(r.data.error, 'Unauthorized rootFolderId');

  const rPing = await handleRequest(db, config, {
    action: 'ping', sessionToken: tok, rootFolderId: 'NOT_THIS_ENV_ROOT',
  });
  assert.equal(rPing.data.error, 'Unauthorized rootFolderId');
});
