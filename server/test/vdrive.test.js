// server/test/vdrive.test.js — 虛擬 Drive 儲存層單元測試（:memory: db）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const vdrive = require('../src/storage/vdrive');

function freshDb() { return openDb(':memory:'); }

test('newFileId：33 字、只含 Drive 相容字元集', () => {
  const id = vdrive.newFileId();
  assert.equal(id.length, 33);
  assert.match(id, /^[A-Za-z0-9_-]{33}$/);
});

test('resolvePathToId：單層路徑（直接在 root 下）', () => {
  const db = freshDb();
  vdrive.createJson(db, { name: 'config.json', content: { users: {} }, parentId: 'ROOT' });
  const id = vdrive.resolvePathToId(db, 'config.json', { root: 'ROOT' });
  assert.ok(id);
  assert.deepEqual(vdrive.readJsonById(db, id), { users: {} });
});

test('resolvePathToId：多層路徑（先找資料夾再找檔案）', () => {
  const db = freshDb();
  const folder = vdrive.createFolder(db, { name: 'cases', parentId: 'ROOT' });
  vdrive.createJson(db, { name: 'manifest.json', content: { chunks: [] }, parentId: folder.id });
  const id = vdrive.resolvePathToId(db, 'cases/manifest.json', { root: 'ROOT' });
  assert.deepEqual(vdrive.readJsonById(db, id), { chunks: [] });
});

test('resolvePathToId：資料夾不存在 → 拋錯', () => {
  const db = freshDb();
  assert.throws(() => vdrive.resolvePathToId(db, 'nosuch/manifest.json', { root: 'ROOT' }), /Folder not found/);
});

test('resolvePathToId：檔案不存在 → 拋錯', () => {
  const db = freshDb();
  assert.throws(() => vdrive.resolvePathToId(db, 'nosuch.json', { root: 'ROOT' }), /File not found/);
});

test('resolvePathToId：同名多檔——bug-for-bug 取最新一筆，其餘自動 trash', () => {
  const db = freshDb();
  const older = vdrive.createJson(db, { name: 'dup.json', content: { v: 1 }, parentId: 'ROOT' });
  // 確保 updated_at 嚴格更新（同毫秒時 SQLite 字串比較可能相同，故手動 backdate 舊筆）。
  db.prepare("UPDATE files SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(older.id);
  const newer = vdrive.createJson(db, { name: 'dup.json', content: { v: 2 }, parentId: 'ROOT' });
  db.prepare("UPDATE files SET updated_at = '2030-01-01T00:00:00.000Z' WHERE id = ?").run(newer.id);

  const id = vdrive.resolvePathToId(db, 'dup.json', { root: 'ROOT' });
  assert.equal(id, newer.id);
  assert.deepEqual(vdrive.readJsonById(db, id), { v: 2 });

  const olderRow = vdrive.getFileById(db, older.id);
  assert.equal(olderRow.trashed, 1, '較舊的同名檔應被自動 trash');
});

test('updateJson：既有檔案 → 更新內容；不存在 → 於對應資料夾新建', () => {
  const db = freshDb();
  vdrive.updateJson(db, 'bookings.json', { items: [1] }, { root: 'ROOT' });
  const id1 = vdrive.resolvePathToId(db, 'bookings.json', { root: 'ROOT' });
  assert.deepEqual(vdrive.readJsonById(db, id1), { items: [1] });

  vdrive.updateJson(db, 'bookings.json', { items: [1, 2] }, { root: 'ROOT' });
  const id2 = vdrive.resolvePathToId(db, 'bookings.json', { root: 'ROOT' });
  assert.equal(id1, id2, '更新既有檔應沿用同一個 fileId');
  assert.deepEqual(vdrive.readJsonById(db, id2), { items: [1, 2] });
});

test('updateContentById：不存在的 fileId → 拋錯', () => {
  const db = freshDb();
  assert.throws(() => vdrive.updateContentById(db, 'nosuch', {}), /updateContentById failed/);
});

// v201 附帶驗證：dev/index.html _syslogFlushToDrive 先呼叫 updateJson({path:'debug_log/xxx.json'})
// ——確認 resolvePathToId/resolvePathToParentAndName 對子資料夾路徑（含中間段資料夾不存在時的
// 「新建」語意）本就支援，不是缺口，只是先前沒有專門測過「子資料夾＋新建」與「子資料夾＋更新既有」
// 兩種情況同時涵蓋。
test('updateJson：子資料夾路徑（debug_log/xxx.json）——資料夾不存在時連同資料夾一併找不到而新建於該路徑', () => {
  const db = freshDb();
  const folder = vdrive.createFolder(db, { name: 'debug_log', parentId: 'ROOT' });
  // 資料夾已存在、檔案不存在 → 應新建在該資料夾下
  vdrive.updateJson(db, 'debug_log/session1.json', { entries: [1] }, { root: 'ROOT' });
  const id1 = vdrive.resolvePathToId(db, 'debug_log/session1.json', { root: 'ROOT' });
  const row1 = vdrive.getFileById(db, id1);
  assert.equal(row1.parent_id, folder.id);
  assert.deepEqual(vdrive.readJsonById(db, id1), { entries: [1] });

  // 再次呼叫（檔案已存在）→ 應更新既有檔案，沿用同一 fileId
  vdrive.updateJson(db, 'debug_log/session1.json', { entries: [1, 2] }, { root: 'ROOT' });
  const id2 = vdrive.resolvePathToId(db, 'debug_log/session1.json', { root: 'ROOT' });
  assert.equal(id1, id2);
  assert.deepEqual(vdrive.readJsonById(db, id2), { entries: [1, 2] });
});

test('readJson：子資料夾路徑（debug_log/xxx.json）roundtrip', () => {
  const db = freshDb();
  vdrive.createFolder(db, { name: 'debug_log', parentId: 'ROOT' });
  vdrive.updateJson(db, 'debug_log/session2.json', { total: 3 }, { root: 'ROOT' });

  const { data } = vdrive.readJson(db, 'debug_log/session2.json', { root: 'ROOT' });
  assert.deepEqual(data, { total: 3 });
});

test('listFolder：只列出該 parentId 下未 trash 的項目，且帶 modifiedTime（v201 補上）', () => {
  const db = freshDb();
  const folder = vdrive.createFolder(db, { name: 'users', parentId: 'ROOT' });
  vdrive.createJson(db, { name: 'a.json', content: {}, parentId: folder.id });
  const trashedFile = vdrive.createJson(db, { name: 'b.json', content: {}, parentId: folder.id });
  db.prepare('UPDATE files SET trashed = 1 WHERE id = ?').run(trashedFile.id);
  vdrive.createJson(db, { name: 'c.json', content: {}, parentId: 'ROOT' }); // 不同 parent，不應出現

  const { files } = vdrive.listFolder(db, folder.id);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'a.json');
  assert.ok(files[0].modifiedTime, 'modifiedTime 應存在（供前端「同名取最新」比對）');
});

test('listFolder：pageSize 裁切筆數（預設 400，可覆寫更小值）', () => {
  const db = freshDb();
  const folder = vdrive.createFolder(db, { name: 'many', parentId: 'ROOT' });
  for (let i = 0; i < 5; i++) vdrive.createJson(db, { name: `f${i}.json`, content: {}, parentId: folder.id });

  const capped = vdrive.listFolder(db, folder.id, 3);
  assert.equal(capped.files.length, 3);

  const uncapped = vdrive.listFolder(db, folder.id);
  assert.equal(uncapped.files.length, 5);
});

// ── resolveDirId（v201）：GAS resolveDir_ 對映——每一段（含最後一段）皆須為資料夾 ──

test('resolveDirId：單層路徑（root 直下的資料夾）', () => {
  const db = freshDb();
  const cases = vdrive.createFolder(db, { name: 'cases', parentId: 'ROOT' });
  const id = vdrive.resolveDirId(db, 'cases', { root: 'ROOT' });
  assert.equal(id, cases.id);
});

test('resolveDirId：多層路徑逐層下鑽', () => {
  const db = freshDb();
  const a = vdrive.createFolder(db, { name: 'a', parentId: 'ROOT' });
  const b = vdrive.createFolder(db, { name: 'b', parentId: a.id });
  const id = vdrive.resolveDirId(db, 'a/b', { root: 'ROOT' });
  assert.equal(id, b.id);
});

test('resolveDirId：查無資料夾 → 拋錯（含最後一段本身找不到的情況，與 resolvePathToId 不同——最後一段也須是資料夾）', () => {
  const db = freshDb();
  assert.throws(() => vdrive.resolveDirId(db, 'nosuch', { root: 'ROOT' }), /Folder not found/);
  // 最後一段是檔案而非資料夾時，resolveDirId 應視為「找不到資料夾」（檔案不滿足 mimeType=folder 條件）
  vdrive.createJson(db, { name: 'notADir.json', content: {}, parentId: 'ROOT' });
  assert.throws(() => vdrive.resolveDirId(db, 'notADir.json', { root: 'ROOT' }), /Folder not found/);
});

// ── listDir（v201）：resolveDirId + listFolder 組合 ──

test('listDir：列出路徑資料夾下子項，含資料夾與檔案、modifiedTime', () => {
  const db = freshDb();
  const cases = vdrive.createFolder(db, { name: 'cases', parentId: 'ROOT' });
  vdrive.createFolder(db, { name: '114', parentId: cases.id });
  vdrive.createJson(db, { name: 'manifest.json', content: { chunks: [] }, parentId: cases.id });

  const { files } = vdrive.listDir(db, 'cases', { root: 'ROOT' }, 400);
  assert.equal(files.length, 2);
  const folderEntry = files.find((f) => f.name === '114');
  const fileEntry = files.find((f) => f.name === 'manifest.json');
  assert.equal(folderEntry.mimeType, vdrive.FOLDER_MIME);
  assert.equal(fileEntry.mimeType, 'application/json');
  assert.ok(fileEntry.modifiedTime);
});

test('listDir：pageSize 裁切筆數', () => {
  const db = freshDb();
  const cases = vdrive.createFolder(db, { name: 'cases', parentId: 'ROOT' });
  for (let i = 0; i < 5; i++) vdrive.createJson(db, { name: `chunk-${i}.json`, content: {}, parentId: cases.id });

  const { files } = vdrive.listDir(db, 'cases', { root: 'ROOT' }, 2);
  assert.equal(files.length, 2);
});

test('listDir：路徑查無 → 拋錯（沿用 resolveDirId 的錯誤）', () => {
  const db = freshDb();
  assert.throws(() => vdrive.listDir(db, 'nosuch', { root: 'ROOT' }), /Folder not found/);
});

// ── createFile（v201）：GAS 版從未存在過的新 action，語意見 vdrive.js createFile 檔頭註解 ──

test('createFile：以純文字（不 JSON.stringify）存 content，roundtrip 讀回字面相同', () => {
  const db = freshDb();
  const folder = vdrive.createFolder(db, { name: 'debug_log', parentId: 'ROOT' });
  const text = JSON.stringify({ session: 'x', entries: [1, 2, 3] }); // 呼叫端已先字串化過
  const meta = vdrive.createFile(db, { name: 'log.json', content: text, mimeType: 'application/json', parentId: folder.id });

  const row = vdrive.getFileById(db, meta.id);
  assert.equal(row.content, text, 'content 應原樣存為文字，不應二次 JSON.stringify');
  assert.equal(row.mime_type, 'application/json');
  assert.equal(row.parent_id, folder.id);
  // readJsonById 對這個檔案做 JSON.parse 應能正確還原（因為沒有被二次字串化）
  assert.deepEqual(vdrive.readJsonById(db, meta.id), { session: 'x', entries: [1, 2, 3] });
});

test('createFile：mimeType 未提供時預設 text/plain', () => {
  const db = freshDb();
  const meta = vdrive.createFile(db, { name: 'plain.txt', content: 'hello', parentId: 'ROOT' });
  const row = vdrive.getFileById(db, meta.id);
  assert.equal(row.mime_type, 'text/plain');
  assert.equal(row.content, 'hello');
});

// ── trashFile（v201）：對映 trashFile_ 軟刪除（trashed=1，資料仍在，非真刪除） ──

test('trashFile：標記 trashed=1，listFolder 不再列出，但資料仍可用 getFileById 讀到', () => {
  const db = freshDb();
  const folder = vdrive.createFolder(db, { name: 'cases', parentId: 'ROOT' });
  const chunk = vdrive.createJson(db, { name: 'active-01.json', content: { cases: [] }, parentId: folder.id });

  const meta = vdrive.trashFile(db, chunk.id);
  assert.equal(meta.id, chunk.id);

  const row = vdrive.getFileById(db, chunk.id);
  assert.equal(row.trashed, 1);
  assert.equal(row.content, JSON.stringify({ cases: [] }), '軟刪除不清空內容');

  const { files } = vdrive.listFolder(db, folder.id);
  assert.equal(files.length, 0, 'trashFile 後 listFolder 不應再列出');
});

test('trashFile：查無 fileId → 拋錯', () => {
  const db = freshDb();
  assert.throws(() => vdrive.trashFile(db, 'nosuch'), /trashFile failed/);
});

test('isUnderRoot：root 本身、直接子項、多層子孫皆為 true；跨樹 false', () => {
  const db = freshDb();
  const cases = vdrive.createFolder(db, { name: 'cases', parentId: 'ROOT' });
  const chunk = vdrive.createJson(db, { name: 'active-01.json', content: {}, parentId: cases.id });
  const other = vdrive.createFolder(db, { name: 'other-root-child', parentId: 'OTHER_ROOT' });

  assert.equal(vdrive.isUnderRoot(db, 'ROOT', 'ROOT'), true);
  assert.equal(vdrive.isUnderRoot(db, cases.id, 'ROOT'), true);
  assert.equal(vdrive.isUnderRoot(db, chunk.id, 'ROOT'), true, '多層子孫應沿 parent_id 鏈找到 root');
  assert.equal(vdrive.isUnderRoot(db, other.id, 'ROOT'), false, '跨樹應拒絕');
  assert.equal(vdrive.isUnderRoot(db, '', 'ROOT'), false);
  assert.equal(vdrive.isUnderRoot(db, 'x', ''), false);
});

test('query：只支援白名單子句，未知子句 fail-closed 回空集合', () => {
  const db = freshDb();
  const folder = vdrive.createFolder(db, { name: 'cases', parentId: 'ROOT' });
  vdrive.createJson(db, { name: 'active-01.json', content: {}, parentId: folder.id });
  vdrive.createJson(db, { name: 'active-02.json', content: {}, parentId: folder.id });

  const r1 = vdrive.query(db, `'${folder.id}' in parents and trashed=false`);
  assert.equal(r1.files.length, 2);

  const r2 = vdrive.query(db, `'${folder.id}' in parents and name='active-01.json'`);
  assert.equal(r2.files.length, 1);
  assert.equal(r2.files[0].name, 'active-01.json');

  const r3 = vdrive.query(db, `'${folder.id}' in parents or trashed=false`);
  assert.deepEqual(r3, { files: [] }, '不認得的運算子（or）fail-closed');

  const r4 = vdrive.query(db, 'trashed=false');
  assert.deepEqual(r4, { files: [] }, '沒有 parents 條件一律拒絕（防枚舉）');
});

// v201 附帶驗證：dev/index.html _debugLogEnsureFolder 組出的 4 子句 query 字串
// （name= + mimeType= + 'ID' in parents + trashed=false）能否被 vdrive.query 正確解析——
// 確認 debug_log 資料夾查找路徑（createFile 的前置步驟）暢通，非新增行為，純驗證既有 parseQueryClauses
// 支援這個組合（先前只各別測過 name/parents/trashed，未測過四子句合併＋mimeType 子句）。
test('query：debug_log 資料夾查找用的 4 子句組合（name+mimeType+parents+trashed）可正確解析', () => {
  const db = freshDb();
  const folder = vdrive.createFolder(db, { name: 'debug_log', parentId: 'ROOT' });
  vdrive.createFolder(db, { name: 'not_debug_log', parentId: 'ROOT' }); // 不應被找到
  const q = `name='debug_log' and mimeType='application/vnd.google-apps.folder' and 'ROOT' in parents and trashed=false`;

  const r = vdrive.query(db, q);
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].id, folder.id);
});

test('escQ：跳脫規則與 GAS 版一致（先反斜線再單引號）', () => {
  assert.equal(vdrive.escQ("a'b"), "a\\'b");
  assert.equal(vdrive.escQ('a\\b'), 'a\\\\b');
  assert.equal(vdrive.escQ(null), '');
});
