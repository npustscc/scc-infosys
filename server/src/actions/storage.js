// server/src/actions/storage.js — vdrive 讀寫類 action 垂直切片：readJson/updateJson、
// readJsonById/updateContentById、createJson、getMetadata、listFolder、query、startupBatch。
// 對映 dev/Code.gs L1301-1527（Drive Actions）與 L2365-2470（startupBatch_）。
'use strict';

const vdrive = require('../storage/vdrive');
const caseAuthz = require('../authz/caseAuthz');

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

function listFolder(db, { folderId }) {
  return vdrive.listFolder(db, folderId);
}

function query(db, { q }) {
  return vdrive.query(db, q);
}

// ── startupBatch：前端開機唯一依賴的複合請求 ──
// 對映 dev/Code.gs startupBatch_（L2365-2470）。單一 root 簡化：GAS 版的 issuesRootId 可能指向
// 跨環境的固定 ISSUES_FOLDER_ID（dev/prod 共用 issues.json）；Node 版骨架單一 root，故 issuesRootId
// 參數被忽略、issues.json 一律從 ctx.root 讀（見交付報告「與計畫的偏差」）。
const TOP_LEVEL_FILES = {
  config: 'config.json',
  pending_cases: 'pending_cases.json',
  bookings: 'bookings.json',
  transfer: 'transfer.json',
  unassigned: 'unassigned_records.json',
  issues: 'issues.json',
};

function findChild(db, parentId, name) {
  return db.prepare(
    `SELECT id, content, updated_at FROM files WHERE parent_id = ? AND name = ? AND trashed = 0
     ORDER BY updated_at DESC LIMIT 1`
  ).get(parentId, name);
}

function startupBatch(db, params, ctx) {
  const userEmail = params.userEmail || '';
  const envSuffix = params.envSuffix || '';
  const usersFolderIdHint = params.usersFolderIdHint || null;

  const modTimes = {};
  const result = { usersFolderId: null, todoFileId: null, isTodoLegacy: false, modTimes };

  for (const [key, name] of Object.entries(TOP_LEVEL_FILES)) {
    try {
      const fileId = vdrive.resolvePathToId(db, name, ctx);
      const row = vdrive.getFileById(db, fileId);
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
  query,
  startupBatch,
};
