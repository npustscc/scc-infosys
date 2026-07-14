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

test('listFolder：只列出該 parentId 下未 trash 的項目', () => {
  const db = freshDb();
  const folder = vdrive.createFolder(db, { name: 'users', parentId: 'ROOT' });
  vdrive.createJson(db, { name: 'a.json', content: {}, parentId: folder.id });
  const trashedFile = vdrive.createJson(db, { name: 'b.json', content: {}, parentId: folder.id });
  db.prepare('UPDATE files SET trashed = 1 WHERE id = ?').run(trashedFile.id);
  vdrive.createJson(db, { name: 'c.json', content: {}, parentId: 'ROOT' }); // 不同 parent，不應出現

  const { files } = vdrive.listFolder(db, folder.id);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'a.json');
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

test('escQ：跳脫規則與 GAS 版一致（先反斜線再單引號）', () => {
  assert.equal(vdrive.escQ("a'b"), "a\\'b");
  assert.equal(vdrive.escQ('a\\b'), 'a\\\\b');
  assert.equal(vdrive.escQ(null), '');
});
