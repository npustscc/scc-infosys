// server/test/dispatch-attachments.test.js — createFolder／uploadFile／downloadFileBase64 經
// dispatch.handleRequest 的整合測試（授權閘/F3 ROOT_GUARDED 生效、v200 cutover 回歸修補的
// 「Not implemented on node backend」不再出現）。單元層邏輯見 test/attachments.test.js。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');

const ROOT = 'ROOT_DISPATCH_ATTACH';
const OTHER_ROOT = 'OTHER_ROOT_DISPATCH_ATTACH';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-dispatch-attach',
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

// ── 未登入 → Session expired（比照其他 action 的既有慣例，非本次新增行為）──

test('createFolder/uploadFile/downloadFileBase64 無 token → Session expired', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  for (const action of ['createFolder', 'uploadFile', 'downloadFileBase64']) {
    const r = await handleRequest(db, cfg, { action, rootFolderId: ROOT });
    assert.equal(r.data.error, 'Session expired', action);
  }
});

// ── v200 回歸修補本身：不再落到「Not implemented on node backend」──────────

test('三個 action 不再回「Not implemented on node backend」（cutover 回歸已修補）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;

  const rc = await handleRequest(db, cfg, { action: 'createFolder', sessionToken: tok, rootFolderId: ROOT, name: 'attachments', parentId: ROOT });
  assert.equal(rc.success, true);
  assert.notEqual(rc.data && rc.data.error, 'Not implemented on node backend: createFolder');
  assert.ok(rc.data.id);

  const ru = await handleRequest(db, cfg, {
    action: 'uploadFile', sessionToken: tok, rootFolderId: ROOT,
    parentFolderId: rc.data.id, fileName: 'f.png', mimeType: 'image/png', base64Data: Buffer.from('hi').toString('base64'),
  });
  assert.equal(ru.success, true);
  assert.ok(ru.data.fileId);

  const rd = await handleRequest(db, cfg, { action: 'downloadFileBase64', sessionToken: tok, rootFolderId: ROOT, fileId: ru.data.fileId });
  assert.equal(rd.success, true);
  assert.equal(Buffer.from(rd.data.base64, 'base64').toString('utf8'), 'hi');
});

// ── 授權閘：未授權使用者一律 Unauthorized user（比照既有其他 action）────────

test('三個 action：帳號登入期間被停用（config.json disabled:true）→ Unauthorized user', async () => {
  // sessionStart 本身已內建授權判斷（見 actions/session.js），未授權帳號登入當下就會被擋下、
  // 拿不到 sessionToken（比照 dispatch.test.js「sessionStart 帳密正確但未列在 config.json users」
  // 案例）；因此要驗證「已持有效 token，但授權閘在其他 action 上仍生效」須模擬「登入後才被停權」
  // 的情境（比照既有 dispatch.test.js「停用帳號的 token」測試手法）。
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;
  vdrive.updateJson(db, 'config.json', { users: { 'a@x.com': { role: '專任諮商心理師', disabled: true } } }, { root: ROOT });

  for (const params of [
    { action: 'createFolder', name: 'x', parentId: ROOT },
    { action: 'uploadFile', parentFolderId: ROOT, fileName: 'x', mimeType: 'image/png', base64Data: 'aGk=' },
    { action: 'downloadFileBase64', fileId: 'whatever' },
  ]) {
    const r = await handleRequest(db, cfg, { sessionToken: tok, rootFolderId: ROOT, ...params });
    assert.equal(r.data.error, 'Unauthorized user', params.action);
  }
});

// ── F3 ROOT_GUARDED：createFolder/uploadFile 的 parentId/parentFolderId 須在 ctx.root 子樹 ──

test('createFolder：parentId 在 root 外 → Forbidden: target outside root', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;

  const r = await handleRequest(db, cfg, { action: 'createFolder', sessionToken: tok, rootFolderId: ROOT, name: 'x', parentId: OTHER_ROOT });
  assert.equal(r.data.error, 'Forbidden: target outside root');
});

test('uploadFile：parentFolderId 在 root 外 → Forbidden: target outside root', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;

  const r = await handleRequest(db, cfg, {
    action: 'uploadFile', sessionToken: tok, rootFolderId: ROOT,
    parentFolderId: OTHER_ROOT, fileName: 'x.png', mimeType: 'image/png', base64Data: 'aGk=',
  });
  assert.equal(r.data.error, 'Forbidden: target outside root');
});

test('uploadFile：root 內的 parentFolderId → 正常放行', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;
  const folder = vdrive.createFolder(db, { name: 'attachments', parentId: ROOT });

  const r = await handleRequest(db, cfg, {
    action: 'uploadFile', sessionToken: tok, rootFolderId: ROOT,
    parentFolderId: folder.id, fileName: 'x.png', mimeType: 'image/png', base64Data: 'aGk=',
  });
  assert.equal(r.success, true);
  assert.ok(r.data.fileId);
});

// ── uploadFile：超過 20MB 單檔上限經 dispatch 仍被拒絕（非僅單元層）──────────

test('uploadFile：超過 20MB → 業務錯誤（經 dispatch 整條管線，非單元層繞過）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;
  const big = Buffer.alloc(21 * 1024 * 1024, 1).toString('base64');

  const r = await handleRequest(db, cfg, {
    action: 'uploadFile', sessionToken: tok, rootFolderId: ROOT,
    parentFolderId: ROOT, fileName: 'big.bin', mimeType: 'application/octet-stream', base64Data: big,
  });
  assert.equal(r.success, false, 'uploadFile 例外經 dispatch 外層 catch 轉為 envelope.fail');
  assert.match(r.error, /單檔上限 20MB/);
});

// ── downloadFileBase64：root 外且無白名單設定 → 業務錯誤「找不到附件」（非 Forbidden 字串，
//    但功能上等效拒絕——見 src/actions/attachments.js 檔頭「三層皆查無…一律拋找不到附件」）──

test('downloadFileBase64：root 外的 fileId 且未設定 SHARED_ISSUES_DB/PEER_DB/DRIVE_LEGACY_ROOTS → 找不到附件', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;
  const outside = vdrive.uploadFile(db, { parentId: OTHER_ROOT, name: 'secret.png', mimeType: 'image/png', blob: Buffer.from('x') });

  const r = await handleRequest(db, cfg, { action: 'downloadFileBase64', sessionToken: tok, rootFolderId: ROOT, fileId: outside.id });
  assert.equal(r.success, false);
  assert.match(r.error, /找不到附件/);
});

// ── createFolder → uploadFile → downloadFileBase64 全流程（比照前端 _ensureAttachFolder/
//    _startUpload/viewAttachment 呼叫序列）────────────────────────────────

test('全流程：createFolder → uploadFile → downloadFileBase64 roundtrip（比照前端附件呼叫序列）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;

  const folderRes = await handleRequest(db, cfg, { action: 'createFolder', sessionToken: tok, rootFolderId: ROOT, name: 'attachments', parentId: ROOT });
  const folderId = folderRes.data.id;

  const content = Buffer.from('roundtrip-content');
  const uploadRes = await handleRequest(db, cfg, {
    action: 'uploadFile', sessionToken: tok, rootFolderId: ROOT,
    parentFolderId: folderId, fileName: '1700000000_photo.jpg', mimeType: 'image/jpeg', base64Data: content.toString('base64'),
  });
  assert.equal(uploadRes.success, true);
  const { fileId, fileName } = uploadRes.data;
  assert.equal(fileName, '1700000000_photo.jpg');

  const downloadRes = await handleRequest(db, cfg, { action: 'downloadFileBase64', sessionToken: tok, rootFolderId: ROOT, fileId });
  assert.equal(downloadRes.success, true);
  assert.equal(downloadRes.data.mimeType, 'image/jpeg');
  assert.equal(Buffer.from(downloadRes.data.base64, 'base64').toString('utf8'), 'roundtrip-content');
});

// ── audit_log：三個 action 皆有寫入紀錄（沿用 dispatch.js 通用 finally 區塊，非本檔新增邏輯，
//    此處驗證接線正確）────────────────────────────────────────────────────

test('audit_log：createFolder/uploadFile/downloadFileBase64 皆記錄 outcome=ok', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'a@x.com', 'right-password');
  const tok = (await login(db, cfg, 'a@x.com', 'right-password')).data.sessionToken;

  const folderRes = await handleRequest(db, cfg, { action: 'createFolder', sessionToken: tok, rootFolderId: ROOT, name: 'attachments', parentId: ROOT });
  const uploadRes = await handleRequest(db, cfg, {
    action: 'uploadFile', sessionToken: tok, rootFolderId: ROOT,
    parentFolderId: folderRes.data.id, fileName: 'a.png', mimeType: 'image/png', base64Data: 'aGk=',
  });
  await handleRequest(db, cfg, { action: 'downloadFileBase64', sessionToken: tok, rootFolderId: ROOT, fileId: uploadRes.data.fileId });

  const rows = db.prepare("SELECT action, outcome FROM audit_log WHERE action IN ('createFolder','uploadFile','downloadFileBase64') ORDER BY id").all();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.outcome === 'ok'), JSON.stringify(rows));
});
