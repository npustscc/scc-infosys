// server/src/actions/storage.js — vdrive 讀寫類 action 垂直切片：readJson/updateJson、
// readJsonById/updateContentById、createJson、getMetadata、listFolder、query、startupBatch。
// 對映 dev/Code.gs L1301-1527（Drive Actions）與 L2365-2470（startupBatch_）。
'use strict';

const vdrive = require('../storage/vdrive');
const caseAuthz = require('../authz/caseAuthz');
const sharedIssuesDb = require('../storage/sharedIssuesDb');

// readJson_/readJsonById_ 讀完後的 R1 個案物件級授權 hook（shadow 模式）。
// onShadowStrip：呼叫端（dispatch.js）傳入，用來把「本應剝除幾筆」寫進 audit_log。
function applyCaseAuthzHook(db, parsed, userEmail, ctx, label, mode, onShadowStrip) {
  let users = null;
  try {
    const cfg = vdrive.readJson(db, 'config.json', ctx);
    users = (cfg.data && cfg.data.users) || null;
  } catch (_e) { users = null; }
  let accessLog = [];
  try {
    const log = vdrive.readJson(db, 'case_access_log.json', ctx);
    if (log.data && Array.isArray(log.data.entries)) accessLog = log.data.entries;
  } catch (_e) { accessLog = []; }
  const todayStr = new Date().toISOString().slice(0, 10);
  return caseAuthz.applyCaseAuthz(parsed, userEmail, users, accessLog, todayStr, mode, onShadowStrip, label);
}

function readJson(db, { path: filePath }, ctx, userEmail, caseAuthzMode, onShadowStrip) {
  const { data } = vdrive.readJson(db, filePath, ctx);
  return applyCaseAuthzHook(db, data, userEmail, ctx, filePath, caseAuthzMode, onShadowStrip);
}

function readJsonById(db, { fileId }, ctx, userEmail, caseAuthzMode, onShadowStrip) {
  const data = vdrive.readJsonById(db, fileId);
  return applyCaseAuthzHook(db, data, userEmail, ctx, fileId, caseAuthzMode, onShadowStrip);
}

function updateJson(db, { path: filePath, content }, ctx) {
  return vdrive.updateJson(db, filePath, content, ctx);
}

function updateContentById(db, { fileId, content }) {
  return vdrive.updateContentById(db, fileId, content);
}

function createJson(db, { name, content, parentId }) {
  return vdrive.createJson(db, { name, content, parentId });
}

function getMetadata(db, { fileId }) {
  return vdrive.getMetadata(db, fileId);
}

function listFolder(db, { folderId, pageSize }) {
  return vdrive.listFolder(db, folderId, pageSize);
}

function query(db, { q }) {
  return vdrive.query(db, q);
}

// ── resolveDir/listDir/createFile（v201：移植完整性掃描收尾，見 dispatch.js 該三個 case 註解）──

function resolveDir(db, { path: dirPath }, ctx) {
  return { id: vdrive.resolveDirId(db, dirPath, ctx) };
}

function listDir(db, { path: dirPath, pageSize }, ctx) {
  return vdrive.listDir(db, dirPath, ctx, pageSize);
}

function createFile(db, { name, content, mimeType, parentId }) {
  if (!name || !parentId) throw new Error('createFile: 缺少 name/parentId');
  return vdrive.createFile(db, { name, content, mimeType, parentId });
}

// ── startupBatch：前端開機唯一依賴的複合請求 ──
// 對映 dev/Code.gs startupBatch_（L2365-2470）。GAS 版的 issuesRootId 指向跨環境固定的
// ISSUES_FOLDER_ID（dev/prod 共用 issues.json）；Node 版單一 root 骨架沒有多重資料夾 id 可路由，
// 前端送來的 issuesRootId 參數本就不對應本環境任何實際資料夾，故仍不採用該參數。issues.json
// 的 dev/prod 共用改用獨立機制：v198 起，若設定 SHARED_ISSUES_DB（見 storage/sharedIssuesDb.js），
// 'issues' 這一個 key 改讀共用庫；ISSUES 常數以外的 TOP_LEVEL_FILES 一律維持讀本環境 ctx.root
// （config.json 等機敏資料絕不路由進共用庫，見 sharedIssuesDb.js 檔頭安全邊界說明）。
// 未設定 SHARED_ISSUES_DB 時行為與改動前完全一致（issues 一律從 ctx.root 讀）。
const TOP_LEVEL_FILES = {
  config: 'config.json',
  pending_cases: 'pending_cases.json',
  bookings: 'bookings.json',
  transfer: 'transfer.json',
  unassigned: 'unassigned_records.json',
  issues: 'issues.json',
};
const ISSUES_TOP_LEVEL_KEY = 'issues';

function findChild(db, parentId, name) {
  return db.prepare(
    `SELECT id, content, updated_at FROM files WHERE parent_id = ? AND name = ? AND trashed = 0
     ORDER BY updated_at DESC LIMIT 1`
  ).get(parentId, name);
}

function startupBatch(db, params, ctx, config) {
  const userEmail = params.userEmail || '';
  const envSuffix = params.envSuffix || '';
  const usersFolderIdHint = params.usersFolderIdHint || null;

  // v198：issues.json 若設定 SHARED_ISSUES_DB，改讀共用庫（見檔頭 TOP_LEVEL_FILES 註解）。
  // config 為選填參數（既有呼叫端／測試若不傳，等同未設定 SHARED_ISSUES_DB，行為不變）。
  const sharedDb = config ? sharedIssuesDb.getSharedIssuesDb(config.SHARED_ISSUES_DB) : null;

  const modTimes = {};
  const result = { usersFolderId: null, todoFileId: null, isTodoLegacy: false, modTimes };

  for (const [key, name] of Object.entries(TOP_LEVEL_FILES)) {
    const isIssuesKey = key === ISSUES_TOP_LEVEL_KEY;
    const targetDb = isIssuesKey && sharedDb ? sharedDb : db;
    const targetCtx = isIssuesKey && sharedDb ? sharedIssuesDb.SHARED_CTX : ctx;
    try {
      const fileId = vdrive.resolvePathToId(targetDb, name, targetCtx);
      const row = vdrive.getFileById(targetDb, fileId);
      result[key] = JSON.parse(row.content == null ? 'null' : row.content);
      modTimes[key] = row.updated_at;
    } catch (_e) {
      result[key] = null;
    }
  }

  let usersFolderId = usersFolderIdHint;
  if (!usersFolderId) {
    try { usersFolderId = vdrive.resolvePathToId(db, 'users', ctx); } catch (_e) { usersFolderId = null; }
  }
  result.usersFolderId = usersFolderId;

  let todoFileId = null;
  let isTodoLegacy = false;
  if (usersFolderId) {
    const todoFileName = `todos_${userEmail}_${envSuffix}.json`;
    const legacyTodoName = `todos_${userEmail}.json`;
    const newTodo = findChild(db, usersFolderId, todoFileName);
    if (newTodo) {
      todoFileId = newTodo.id;
      result.todos = JSON.parse(newTodo.content == null ? 'null' : newTodo.content);
      modTimes.todos = newTodo.updated_at;
    } else {
      const legacy = findChild(db, usersFolderId, legacyTodoName);
      if (legacy) {
        todoFileId = legacy.id;
        isTodoLegacy = true;
        result.todos = JSON.parse(legacy.content == null ? 'null' : legacy.content);
        modTimes.todos = legacy.updated_at;
      } else {
        result.todos = null;
      }
    }
  } else {
    result.todos = null;
  }
  result.todoFileId = todoFileId;
  result.isTodoLegacy = isTodoLegacy;

  return result;
}

module.exports = {
  readJson,
  readJsonById,
  updateJson,
  updateContentById,
  createJson,
  getMetadata,
  listFolder,
  resolveDir,
  listDir,
  createFile,
  query,
  startupBatch,
};
