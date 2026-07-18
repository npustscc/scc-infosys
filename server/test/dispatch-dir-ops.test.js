// server/test/dispatch-dir-ops.test.js — resolveDir／listDir／createFile／trashFile 經
// dispatch.handleRequest 的整合測試（v201：移植完整性掃描收尾——四個 action 此前落到
// dispatch.js 的 default 分支回「Not implemented on node backend」，見 dispatch.js 該四個
// case 註解）。單元層邏輯見 test/vdrive.test.js。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');

const ROOT = 'ROOT_DISPATCH_DIROPS';
const OTHER_ROOT = 'OTHER_ROOT_DISPATCH_DIROPS';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-dispatch-dirops',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
  }, overrides || {});
}

async function setupAuthorizedUser(db, email, password) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { [email]: { role: '專任諮商心理師' } } } });
}

async function login(db, config, email, password) {
  return handleRequest(db, config, { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
}

// ── 未登入 → Session expired（比照其他 action 的既有慣例）──────────────────

test('resolveDir/listDir/createFile/trashFile 無 token → Session expired', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  for (const action of ['resolveDir', 'listDir', 'createFile', 'trashFile']) {
    const r = await handleRequest(db, cfg, { action, rootFolderId: ROOT });
    assert.equal(r.data.error, 'Session expired', action);
  }
});

// ── v201 回歸修補本身：不再回「Not implemented on node backend」───────────

test('四個 action 不再回「Not implemented on node backend」（v201 已接線）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;
  const cases = vdrive.createFolder(db, { name: 'cases', parentId: ROOT });

  const rr = await handleRequest(db, cfg, { action: 'resolveDir', sessionToken: tok, rootFolderId: ROOT, path: 'cases' });
  assert.equal(rr.success, true);
  assert.notEqual(rr.data && rr.data.error, 'Not implemented on node backend: resolveDir');
  assert.equal(rr.data.id, cases.id);

  const rl = await handleRequest(db, cfg, { action: 'listDir', sessionToken: tok, rootFolderId: ROOT, path: 'cases', fields: 'id,name,mimeType,modifiedTime', pageSize: 400 });
  assert.equal(rl.success, true);
  assert.deepEqual(rl.data.files, []);

  const rc = await handleRequest(db, cfg, { action: 'createFile', sessionToken: tok, rootFolderId: ROOT, name: 'log.json', content: '{"a":1}', mimeType: 'application/json', parentId: ROOT });
  assert.equal(rc.success, true);
  assert.ok(rc.data.id);

  const rt = await handleRequest(db, cfg, { action: 'trashFile', sessionToken: tok, rootFolderId: ROOT, fileId: rc.data.id });
  assert.equal(rt.success, true);
});

// ── 授權閘：未授權使用者一律 Unauthorized user（比照既有其他 action）────────

test('四個 action：帳號登入期間被停用（config.json disabled:true）→ Unauthorized user', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;
  vdrive.updateJson(db, 'config.json', { users: { 'a@x.com': { role: '專任諮商心理師', disabled: true } } }, { root: ROOT });

  for (const params of [
    { action: 'resolveDir', path: 'cases' },
    { action: 'listDir', path: 'cases' },
    { action: 'createFile', name: 'x.json', content: '{}', parentId: ROOT },
    { action: 'trashFile', fileId: 'whatever' },
  ]) {
    const r = await handleRequest(db, cfg, { sessionToken: tok, rootFolderId: ROOT, ...params });
    assert.equal(r.data.error, 'Unauthorized user', params.action);
  }
});

// ── resolveDir/listDir：路徑一律從 ctx.root 起算，查無資料夾 → 業務錯誤（非 Forbidden，
//    因為兩者不受 ROOT_GUARDED 保護——見 gate.js ROOT_GUARDED 檔頭註解） ───────────

test('resolveDir：路徑查無 → 業務錯誤「Folder not found」', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;

  const r = await handleRequest(db, cfg, { action: 'resolveDir', sessionToken: tok, rootFolderId: ROOT, path: 'nosuch' });
  assert.equal(r.success, false);
  assert.match(r.error, /Folder not found/);
});

test('listDir：內容正確（含子資料夾與檔案、modifiedTime），且 pageSize 生效', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;
  const cases = vdrive.createFolder(db, { name: 'cases', parentId: ROOT });
  vdrive.createFolder(db, { name: '114', parentId: cases.id });
  vdrive.createJson(db, { name: 'manifest.json', content: { chunks: [] }, parentId: cases.id });
  for (let i = 0; i < 4; i++) vdrive.createJson(db, { name: `active-0${i}.json`, content: { cases: [] }, parentId: cases.id });

  const rAll = await handleRequest(db, cfg, { action: 'listDir', sessionToken: tok, rootFolderId: ROOT, path: 'cases', fields: 'id,name,mimeType,modifiedTime' });
  assert.equal(rAll.success, true);
  assert.equal(rAll.data.files.length, 6); // 1 資料夾 + manifest + 4 chunk
  const folderEntry = rAll.data.files.find((f) => f.name === '114');
  assert.equal(folderEntry.mimeType, 'application/vnd.google-apps.folder');
  const manifestEntry = rAll.data.files.find((f) => f.name === 'manifest.json');
  assert.ok(manifestEntry.modifiedTime, 'modifiedTime 應存在（前端 getCasesFolderFileMap 依此判斷同名取最新）');

  const rCapped = await handleRequest(db, cfg, { action: 'listDir', sessionToken: tok, rootFolderId: ROOT, path: 'cases', pageSize: 2 });
  assert.equal(rCapped.data.files.length, 2);
});

// ── createFile：F3 ROOT_GUARDED（parentId 須在 ctx.root 子樹）＋ content 原樣存（不二次序列化） ──

test('createFile：parentId 在 root 外 → Forbidden: target outside root', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;

  const r = await handleRequest(db, cfg, { action: 'createFile', sessionToken: tok, rootFolderId: ROOT, name: 'x.json', content: '{}', mimeType: 'application/json', parentId: OTHER_ROOT });
  assert.equal(r.data.error, 'Forbidden: target outside root');
});

test('createFile：roundtrip——content 為已 JSON.stringify 過的文字，存入後 readJsonById 能正確還原（不被二次序列化）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;
  const folder = vdrive.createFolder(db, { name: 'debug_log', parentId: ROOT });

  const payload = JSON.stringify({ session: 'sess1', entries: [{ t: 1 }, { t: 2 }] });
  const rc = await handleRequest(db, cfg, {
    action: 'createFile', sessionToken: tok, rootFolderId: ROOT,
    name: 'sess1.json', content: payload, mimeType: 'application/json', parentId: folder.id,
  });
  assert.equal(rc.success, true);

  const rr = await handleRequest(db, cfg, { action: 'readJsonById', sessionToken: tok, rootFolderId: ROOT, fileId: rc.data.id });
  assert.equal(rr.success, true);
  assert.deepEqual(rr.data, { session: 'sess1', entries: [{ t: 1 }, { t: 2 }] });
});

// ── trashFile：F3 ROOT_GUARDED（fileId 須在 ctx.root 子樹）＋軟刪除＋稽核落地 ─────────

test('trashFile：fileId 在 root 外 → Forbidden: target outside root', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;
  const outside = vdrive.createJson(db, { name: 'secret.json', content: {}, parentId: OTHER_ROOT });

  const r = await handleRequest(db, cfg, { action: 'trashFile', sessionToken: tok, rootFolderId: ROOT, fileId: outside.id });
  assert.equal(r.data.error, 'Forbidden: target outside root');
  const row = vdrive.getFileById(db, outside.id);
  assert.equal(row.trashed, 0, '被拒絕的請求不應真的軟刪除 root 外的檔案');
});

test('trashFile：全流程——清空個案 chunk 情境（confirmClearAllCases），軟刪除後 listDir 不再列出', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;
  const cases = vdrive.createFolder(db, { name: 'cases', parentId: ROOT });
  const chunk = vdrive.createJson(db, { name: 'active-01.json', content: { cases: [] }, parentId: cases.id });

  const rt = await handleRequest(db, cfg, { action: 'trashFile', sessionToken: tok, rootFolderId: ROOT, fileId: chunk.id });
  assert.equal(rt.success, true);

  const rl = await handleRequest(db, cfg, { action: 'listDir', sessionToken: tok, rootFolderId: ROOT, path: 'cases' });
  assert.equal(rl.data.files.length, 0);
});

test('audit_log：resolveDir/listDir/createFile/trashFile 皆記錄 outcome=ok，trashFile 的 target 為 fileId', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;
  vdrive.createFolder(db, { name: 'cases', parentId: ROOT });
  const chunk = vdrive.createJson(db, { name: 'x.json', content: {}, parentId: ROOT });

  await handleRequest(db, cfg, { action: 'resolveDir', sessionToken: tok, rootFolderId: ROOT, path: 'cases' });
  await handleRequest(db, cfg, { action: 'listDir', sessionToken: tok, rootFolderId: ROOT, path: 'cases' });
  await handleRequest(db, cfg, { action: 'createFile', sessionToken: tok, rootFolderId: ROOT, name: 'y.json', content: '{}', parentId: ROOT });
  await handleRequest(db, cfg, { action: 'trashFile', sessionToken: tok, rootFolderId: ROOT, fileId: chunk.id });

  const rows = db.prepare("SELECT action, outcome, target FROM audit_log WHERE action IN ('resolveDir','listDir','createFile','trashFile') ORDER BY id").all();
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.outcome === 'ok'), JSON.stringify(rows));
  const trashRow = rows.find((r) => r.action === 'trashFile');
  assert.equal(trashRow.target, chunk.id);
});
