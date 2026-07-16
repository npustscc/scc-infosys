// server/src/authz/gate.js — 逐項移植 dev/Code.gs 授權閘純決策函式（L759-832、L963-1145 一帶）。
// 語意須與 GAS 版 1:1（可對照 test/authz-gate.test.js 的案例矩陣），差異只在：
//   - Node 版沒有 BOOTSTRAP_ADMINS 緊急備援名單（GAS 版是為了 Google 帳號生態設計的鎖死保險；
//     Node 版帳號本就由 server 端 create-user.js 直接操作 SQLite，不會被鎖死在「無法登入改設定」
//     的窘境，故省略——config 讀不到就一律 fail-closed 拒絕，更嚴格，符合 CLAUDE.md「預設 deny」）。
//   - Node 版單一 root（ROOT_FOLDER_ID 來自 .env），沒有 ALLOWED_ROOTS 多環境白名單／issues.json
//     跨環境例外（該例外服務 dev/prod 共用 issues.json 的場景，Phase 1 骨架尚未涉及）。
'use strict';

// 給定 users 表（config.json 的 .users）、email，是否放行。users 為 null（config 讀不到）
// ＝ fail-closed 拒絕。對映 authzDecision_。
function authzDecision(users, userEmail) {
  if (!userEmail) return false;
  if (!users) return false;
  const u = users[userEmail];
  return !!u && u.disabled !== true;
}

// 是否為管理者：role==='主任' 或 isAdmin===true 或 extraRole==='管理者'。對映 adminDecision_。
function adminDecision(users, userEmail) {
  if (!userEmail) return false;
  if (!users) return false;
  const u = users[userEmail];
  if (!u || u.disabled === true) return false;
  return u.role === '主任' || u.isAdmin === true || u.extraRole === '管理者';
}

// AUTHZ_EXEMPT：ping（探測）與 submitUserApplication（申請帳號流程本身即為未授權者的入口）
// 在授權閘之前放行。submitUserApplication 在 Phase 1 骨架回 not-implemented 業務錯誤（見
// actions/proxy.js 的開放問題），但閘門語意仍先移植好，供未來實作時直接沿用。
const AUTHZ_EXEMPT = { ping: true, submitUserApplication: true, sessionStart: true };
// 註：sessionStart 額外列入本模組的 AUTHZ_EXEMPT，是因為 Node 版 dispatcher 對 sessionStart 走
// 獨立流程（先本地認證取得 email，再於 actions/session.js 內部自行呼叫 authzDecision 判斷是否放行、
// 分別回應 invalid_credentials／Unauthorized user）——不透過 dispatch.js 通用閘門重複判斷一次。

// deleteFile/moveFile 為純攻擊面（前端從未使用），Phase 1 骨架未實作（回 not-implemented），
// 此表保留供未來實作時直接沿用同一份閘門語意。
const ADMIN_ONLY_ACTIONS = { deleteFile: true, moveFile: true };

// F3：fileId/parentId 類動作限制在本次 ctx.root 子樹——Phase 1 骨架已實作的 action 對映。
const ROOT_GUARDED = {
  readJsonById: 'fileId',
  updateContentById: 'fileId',
  getMetadata: 'fileId',
  createJson: 'parentId',
  listFolder: 'folderId',
  // 以下為 GAS 版亦有、但 Node 版尚未實作的 action，保留映射供未來沿用：
  deleteFile: 'fileId',
  moveFile: 'fileId',
  trashFile: 'fileId',
  createFolder: 'parentId',
  uploadFile: 'parentFolderId',
};

// ── P0-2/v164：config.json 整檔寫入的授權面保護 ──

function isConfigWrite(action, params, cfgFileId) {
  if (!params) return false;
  if (action === 'updateJson') return params.path === 'config.json';
  if (action === 'createJson') return params.name === 'config.json';
  if (action === 'updateContentById') return !!cfgFileId && params.fileId === cfgFileId;
  return false;
}

function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (!a || !b || typeof a !== 'object') return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEq(a[k], b[k])) return false;
  }
  return true;
}

// 非管理者整檔寫 config.json 時，users 物件是否與後端當下最新版完全相同。
function configUsersUnchanged(oldCfg, newCfg) {
  if (!oldCfg || !newCfg || typeof oldCfg !== 'object' || typeof newCfg !== 'object') return false;
  const oldUsers = oldCfg.users, newUsers = newCfg.users;
  if (!oldUsers || typeof oldUsers !== 'object' || Array.isArray(oldUsers)) return false;
  if (!newUsers || typeof newUsers !== 'object' || Array.isArray(newUsers)) return false;
  return deepEq(oldUsers, newUsers);
}

// ── P1：query action 限根（_extractParentsIds_/_qHasForbiddenOp_/queryParentsAllowed_ 對映）──

function extractParentsIds(q) {
  const out = [];
  if (typeof q !== 'string' || !q) return out;
  const marker = 'in parents';
  let searchFrom = 0;
  for (;;) {
    const idx = q.indexOf(marker, searchFrom);
    if (idx === -1) break;
    let j = idx - 1;
    while (j >= 0 && q.charAt(j) === ' ') j--;
    if (j >= 0 && q.charAt(j) === "'") {
      const closeQuote = j;
      let k = closeQuote - 1;
      while (k >= 0 && q.charAt(k) !== "'") k--;
      if (k >= 0) out.push(q.slice(k + 1, closeQuote));
    }
    searchFrom = idx + marker.length;
  }
  return out;
}

function qHasForbiddenOp(q) {
  let word = '';
  let inStr = false;
  for (let i = 0; i <= q.length; i++) {
    const ch = i < q.length ? q.charAt(i) : ' ';
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") { inStr = true; word = ''; continue; }
    const lc = ch.toLowerCase();
    const isWordCh = (lc >= 'a' && lc <= 'z') || (lc >= '0' && lc <= '9') || lc === '_';
    if (isWordCh) { word += lc; continue; }
    if (word === 'or' || word === 'not') return true;
    word = '';
  }
  return false;
}

function queryParentsAllowed(q, checkUnderRoot) {
  const ids = extractParentsIds(q);
  if (!ids.length) return false;
  if (qHasForbiddenOp(q)) return false;
  for (const id of ids) {
    if (!checkUnderRoot(id)) return false;
  }
  return true;
}

// shareCalendarWriters 的非管理者路徑：emails 必須恰為「自己一人」（自助日曆連結，杜絕非管理者
// 把日曆編輯權授予任意 email）。對映 dev/Code.gs shareToSelfOnly_（L1098）。
function shareToSelfOnly(emails, userEmail) {
  return Array.isArray(emails) && emails.length === 1 && !!userEmail && emails[0] === userEmail;
}

// P1：moveFile 目的地檢查（Node 版未實作 moveFile，保留供未來沿用）。
function moveFileDestAllowed(addParents, checkUnderRoot) {
  if (!addParents) return false;
  const ids = String(addParents).split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return false;
  return ids.every((id) => checkUnderRoot(id));
}

module.exports = {
  authzDecision,
  adminDecision,
  AUTHZ_EXEMPT,
  ADMIN_ONLY_ACTIONS,
  ROOT_GUARDED,
  isConfigWrite,
  deepEq,
  configUsersUnchanged,
  extractParentsIds,
  qHasForbiddenOp,
  queryParentsAllowed,
  moveFileDestAllowed,
  shareToSelfOnly,
};
