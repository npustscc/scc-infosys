// server/src/storage/vdrive.js — 虛擬 Drive 儲存層，取代 dev/Code.gs L1266-1527 對 Google Drive REST
// 的呼叫，行為 bug-for-bug 對齊（含同名多檔取最新、其餘自動 trash 的既有行為）。
// 所有函式吃一個 better-sqlite3 db handle（第一參數），不持有全域單例，方便單元測試用 :memory: db。
'use strict';

const crypto = require('node:crypto');

// Drive fileId 相容字元集：A-Za-z0-9_-（真實 Drive id 長度不定，33 字為常見長度，足夠避免碰撞）。
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
function newFileId() {
  const bytes = crypto.randomBytes(33);
  let out = '';
  for (let i = 0; i < 33; i++) out += ID_CHARS[bytes[i] % ID_CHARS.length];
  return out;
}

// 同 dev/Code.gs _escQ_：先跳脫反斜線再跳脫單引號（順序重要）。本模組的「q 字串」只在內部
// query() 解析用，不會真的送去 Drive，但保留跳脫規則以維持與 GAS 版同構、供 authz/gate.js 的
// query 白名單解析器共用同一套逸出/還原規則。
function escQ(s) {
  return String(s == null ? '' : s).split('\\').join('\\\\').split("'").join("\\'");
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const nowIso = () => new Date().toISOString();

function rowToMeta(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, mimeType: row.mime_type, parents: row.parent_id ? [row.parent_id] : [] };
}

function getFileById(db, id) {
  return db.prepare('SELECT * FROM files WHERE id = ?').get(id) || null;
}

// 資料夾建立（vdrive 內部工具；createFolder_ action 對映，Phase 1 骨架未接入 dispatcher 但供
// import-drive.js／測試建置樹狀結構使用）。
function createFolder(db, { name, parentId }) {
  const id = newFileId();
  db.prepare(
    `INSERT INTO files (id, parent_id, name, mime_type, content, trashed, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`
  ).run(id, parentId || null, name, FOLDER_MIME, nowIso(), nowIso());
  return rowToMeta(getFileById(db, id));
}

// uploadFile_ 對映（v200，見 actions/attachments.js）：附件二進位內容存於 blob 欄位（本檔案頭
// migrations/001_init.sql 原就預留此欄位供「Phase 1.5 才會寫入」使用，見該檔案 blob 欄位註解）；
// content 欄位留 NULL（該欄位專供 JSON 檔文字內容使用，見 createJson/updateContentById），
// mime_type 記實際檔案類型（不套用資料表預設值 'application/json'）。
function uploadFile(db, { parentId, name, mimeType, blob }) {
  const id = newFileId();
  db.prepare(
    `INSERT INTO files (id, parent_id, name, mime_type, content, blob, trashed, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, 0, ?, ?)`
  ).run(id, parentId || null, name, mimeType || 'application/octet-stream', blob, nowIso(), nowIso());
  return rowToMeta(getFileById(db, id));
}

// resolvePathToId_ 對映：path 為 'a/b/c.json' 形式，中段皆視為資料夾、逐層下鑽；末段為檔案，
// 依 name+parent+trashed=false 找，若多筆同名取 modifiedTime（updated_at）最新一筆，其餘標記 trashed
// （bug-for-bug：GAS 版本來就有這個「自動清多餘同名檔」的副作用，沿用以維持行為一致）。
function resolvePathToId(db, filePath, ctx) {
  const parts = filePath.split('/');
  let curId = ctx.root;
  for (let i = 0; i < parts.length - 1; i++) {
    const folder = db.prepare(
      `SELECT id FROM files WHERE name = ? AND parent_id = ? AND mime_type = ? AND trashed = 0
       ORDER BY updated_at DESC LIMIT 1`
    ).get(parts[i], curId, FOLDER_MIME);
    if (!folder) throw new Error('Folder not found: ' + parts[i]);
    curId = folder.id;
  }
  const fileName = parts[parts.length - 1];
  const candidates = db.prepare(
    `SELECT id FROM files WHERE name = ? AND parent_id = ? AND trashed = 0
     ORDER BY updated_at DESC LIMIT 5`
  ).all(fileName, curId);
  if (!candidates.length) throw new Error('File not found: ' + filePath);
  if (candidates.length > 1) {
    const trash = db.prepare('UPDATE files SET trashed = 1, updated_at = ? WHERE id = ?');
    candidates.slice(1).forEach((f) => { try { trash.run(nowIso(), f.id); } catch (_) { /* ignore */ } });
  }
  return candidates[0].id;
}

function resolvePathToParentAndName(db, filePath, ctx) {
  const parts = filePath.split('/');
  const fileName = parts[parts.length - 1];
  let parentId = ctx.root;
  for (let i = 0; i < parts.length - 1; i++) {
    const folder = db.prepare(
      `SELECT id FROM files WHERE name = ? AND parent_id = ? AND mime_type = ? AND trashed = 0
       ORDER BY updated_at DESC LIMIT 1`
    ).get(parts[i], parentId, FOLDER_MIME);
    if (!folder) throw new Error('Folder not found: ' + parts[i]);
    parentId = folder.id;
  }
  return { parentId, fileName };
}

function readJsonById(db, fileId) {
  const row = getFileById(db, fileId);
  if (!row || row.trashed) throw new Error('readJsonById failed: ' + fileId);
  return JSON.parse(row.content == null ? 'null' : row.content);
}

function readJson(db, filePath, ctx) {
  const fileId = resolvePathToId(db, filePath, ctx);
  return { fileId, data: readJsonById(db, fileId) };
}

function updateContentById(db, fileId, content) {
  const row = getFileById(db, fileId);
  if (!row) throw new Error('updateContentById failed: ' + fileId);
  db.prepare('UPDATE files SET content = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(content), nowIso(), fileId);
  return rowToMeta(getFileById(db, fileId));
}

function createJson(db, { name, content, parentId }) {
  const id = newFileId();
  db.prepare(
    `INSERT INTO files (id, parent_id, name, mime_type, content, trashed, created_at, updated_at)
     VALUES (?, ?, ?, 'application/json', ?, 0, ?, ?)`
  ).run(id, parentId || null, name, JSON.stringify(content), nowIso(), nowIso());
  return rowToMeta(getFileById(db, id));
}

// updateJson_ 對映：找不到既有檔則於對應資料夾下新建（與 GAS 版行為一致）。
function updateJson(db, filePath, content, ctx) {
  let fileId;
  try {
    fileId = resolvePathToId(db, filePath, ctx);
  } catch (_notFound) {
    const { parentId, fileName } = resolvePathToParentAndName(db, filePath, ctx);
    return createJson(db, { name: fileName, content, parentId });
  }
  return updateContentById(db, fileId, content);
}

function getMetadata(db, fileId) {
  const row = getFileById(db, fileId);
  if (!row) throw new Error('getMetadata failed: ' + fileId);
  return rowToMeta(row);
}

function listFolder(db, folderId) {
  const rows = db.prepare(
    `SELECT id, name, mime_type FROM files WHERE parent_id = ? AND trashed = 0 ORDER BY name`
  ).all(folderId);
  return { files: rows.map((r) => ({ id: r.id, name: r.name, mimeType: r.mime_type })) };
}

// fileId 是否為 rootId 的子孫（含自身）。files 表只存單一 parent_id（vdrive 簡化，不支援 Drive
// 多重父層——本系統寫入端從未用到多父層），故用遞迴 CTE 沿 parent_id 往上找即可對映
// isUnderRoot_ 的 _ancestorContains_ 邏輯（含 root 本身即合法、找不到路徑即 false）。
function isUnderRoot(db, fileId, rootId) {
  if (!fileId || !rootId) return false;
  if (fileId === rootId) return true;
  // 注意：rootId 本身通常「不是」files 表裡的一列（它是虛擬根目錄，vdrive 不需要為它建
  // 一列才能當 parent_id 使用）——所以不能只檢查 anc.id 是否等於 rootId（那樣永遠找不到，
  // 因為 rootId 只會以 parent_id 的身分出現在鏈中，不會以 id 的身分出現）。要判斷的是「沿
  // parent_id 往上爬的鏈上，是否曾經以 rootId 作為某一列的 parent_id」，即 anc.parent_id
  // 命中 rootId；同時保留 anc.id = rootId 這個分支，涵蓋 rootId 剛好也是一列真實資料夾
  // （例如巢狀 vdrive／測試情境）的情況。
  // depth 上限 25，對映 GAS _ancestorContains_ 的 maxHops 預設值——同時避免 parent_id 若因
  // 資料損毀形成環狀鏈（A→B→A）時 WITH RECURSIVE 無限展開（UNION ALL 不會自動去重判斷環）。
  const row = db.prepare(
    `WITH RECURSIVE anc(id, parent_id, depth) AS (
       SELECT id, parent_id, 0 FROM files WHERE id = ?
       UNION ALL
       SELECT f.id, f.parent_id, anc.depth + 1 FROM files f JOIN anc ON f.id = anc.parent_id WHERE anc.depth < 25
     )
     SELECT 1 FROM anc WHERE id = ? OR parent_id = ? LIMIT 1`
  ).get(fileId, rootId, rootId);
  return !!row;
}

// query() 對映 driveQuery_：只解析前端實際會送的 q 子集（見 authz/gate.js queryParentsAllowed 的
// 白名單邏輯，兩者需搭配使用——authz 先擋非法 q，這裡才動手解析執行）。支援以 ' and ' 串接的：
//   'ID' in parents / trashed=false / trashed=true / name='X' / mimeType='X'
// 不認得的子句 fail-closed（整條 q 視為無效、回空結果），不做「盡量解析」— 寧可回傳空集合，也不要
// 誤解析出超出預期的資料。
function parseQueryClauses(q) {
  const clauses = String(q || '').split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  const out = { parents: [], trashed: null, name: null, mimeType: null, valid: clauses.length > 0 };
  for (const c of clauses) {
    let m;
    if ((m = c.match(/^'([^']*)'\s+in\s+parents$/))) { out.parents.push(m[1]); continue; }
    if ((m = c.match(/^trashed\s*=\s*(true|false)$/))) { out.trashed = m[1] === 'true'; continue; }
    if ((m = c.match(/^name\s*=\s*'((?:[^'\\]|\\.)*)'$/))) {
      out.name = m[1].split("\\'").join("'").split('\\\\').join('\\');
      continue;
    }
    if ((m = c.match(/^mimeType\s*=\s*'((?:[^'\\]|\\.)*)'$/))) { out.mimeType = m[1]; continue; }
    out.valid = false; // 不認得的子句 → fail-closed
  }
  return out;
}

function query(db, q) {
  const parsed = parseQueryClauses(q);
  if (!parsed.valid || !parsed.parents.length) return { files: [] };
  const placeholders = parsed.parents.map(() => '?').join(',');
  let sql = `SELECT id, name, mime_type FROM files WHERE parent_id IN (${placeholders})`;
  const args = [...parsed.parents];
  if (parsed.trashed === null || parsed.trashed === false) {
    sql += ' AND trashed = 0';
  } else {
    sql += ' AND trashed = 1';
  }
  if (parsed.name !== null) { sql += ' AND name = ?'; args.push(parsed.name); }
  if (parsed.mimeType !== null) { sql += ' AND mime_type = ?'; args.push(parsed.mimeType); }
  sql += ' ORDER BY updated_at DESC';
  const rows = db.prepare(sql).all(...args);
  return { files: rows.map((r) => ({ id: r.id, name: r.name, mimeType: r.mime_type })) };
}

module.exports = {
  newFileId,
  escQ,
  FOLDER_MIME,
  getFileById,
  createFolder,
  uploadFile,
  resolvePathToId,
  resolvePathToParentAndName,
  readJson,
  readJsonById,
  updateContentById,
  createJson,
  updateJson,
  getMetadata,
  listFolder,
  isUnderRoot,
  query,
  parseQueryClauses,
};
