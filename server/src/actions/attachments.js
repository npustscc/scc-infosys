// server/src/actions/attachments.js — createFolder／uploadFile／downloadFileBase64 垂直切片。
// 對映 dev/Code.gs createFolder_/uploadFile_/downloadFileBase64_（L1762-1967）。
//
// v200 cutover 回歸修補：這三個 action 在 GAS→Node 移植時被遺漏，dispatch.js 落到 default 一律回
// 「Not implemented on node backend」，導致全系統附件（晤談紀錄/初談/精神科/結案評估/請假佐證/
// 問題回報）上傳與開啟自 2026-07-17 切換後全面故障。授權閘沿用既有 gate.ROOT_GUARDED 對映
// （createFolder→parentId／uploadFile→parentFolderId，dispatch.js 步驟 4c 已通用套用，見該檔）；
// downloadFileBase64 比照 GAS 版做法，不走 ROOT_GUARDED 簡單黑白名單，而是本檔內部三層查找
// （見 downloadFileBase64 函式頭註解）。
'use strict';

const vdrive = require('../storage/vdrive');
const { openDb } = require('../db');
const sharedIssuesDb = require('../storage/sharedIssuesDb');
const googleAuth = require('../google/auth');
const driveClientDefault = require('../google/drive');

// 單檔大小上限（decode 後位元組數）。body 總限 25MB 已存在於 index.js readBody；base64 膨脹
// 係數約 4/3，20MB 原始內容 base64 後約 27MB 字元——單一 uploadFile 呼叫的 payload 本就不可能
// 超過 body 總限太多，此處另設單檔上限主要是防止一次請求夾帶異常巨大附件拖垮 sqlite 檔案大小。
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

// Drive 舊附件 fallback 的 parents 上溯深度上限（見 tryDriveLegacyFallback）。對映 GAS
// _ancestorContains_ 的 maxHops 概念，但舊附件多半只有 1-2 層（root 直下的 attachments 資料夾），
// 5 已留有餘裕。
const LEGACY_ROOT_MAX_DEPTH = 5;

// ── createFolder ──────────────────────────────────────────────────────────
// 對映 createFolder_：GAS 版本來就不做「同名已存在則回傳既有」的 idempotent 檢查——每次呼叫必定
// 新建一筆（前端呼叫端自己會先用 query 檢查是否已存在，見 dev/index.html _ensureAttachFolder／
// getUsersFolderId／getOrCreateYearFolder 等呼叫點）。此處刻意 bug-for-bug 對齊、不額外加判斷，
// 理由：(a) 與既有前端呼叫慣例一致，加了反而是本檔案自創的新語意；(b) 若要做到真正安全的
// idempotent（避免併發下仍建出重複資料夾），需要唯一索引/交易鎖等額外機制，非本次 P1 回歸修補
// 範疇——之後若要收斂為 idempotent 應另案處理。
function createFolder(db, { name, parentId }) {
  if (!name || !parentId) throw new Error('createFolder: 缺少 name/parentId');
  return vdrive.createFolder(db, { name, parentId });
}

// ── uploadFile ───────────────────────────────────────────────────────────
// 對映 uploadFile_：回傳形狀 { fileId, fileName } 與 GAS 版一致（見 dev/index.html _startUpload
// 對 r.fileId 的取用）。
function uploadFile(db, { parentFolderId, fileName, mimeType, base64Data }) {
  if (!parentFolderId || !fileName || !base64Data) {
    throw new Error('uploadFile: 缺少 parentFolderId/fileName/base64Data');
  }
  let bytes;
  try {
    bytes = Buffer.from(base64Data, 'base64');
  } catch (_e) {
    throw new Error('uploadFile: base64Data 格式錯誤');
  }
  if (!bytes.length) throw new Error('uploadFile: base64Data 格式錯誤');
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`uploadFile: 檔案過大（約 ${(bytes.length / 1024 / 1024).toFixed(1)}MB），單檔上限 20MB`);
  }
  const meta = vdrive.uploadFile(db, {
    parentId: parentFolderId,
    name: fileName,
    mimeType: mimeType || 'application/octet-stream',
    blob: bytes,
  });
  return { fileId: meta.id, fileName: meta.name };
}

// ── trashFile（v201：移植完整性掃描收尾）────────────────────────────────────
// 對映 trashFile_（GAS：drivePatch_(fileId, {trashed:true})，軟刪除）。唯一呼叫點是
// confirmClearAllCases 清空個案 chunk（見 dev/index.html）——GAS 版本身未把此 action 列入
// ADMIN_ONLY_ACTIONS，只受一般授權閘＋F3 ROOT_GUARDED（gate.js 早已預留 trashFile:'fileId'
// 映射，dispatch.js 步驟 4c 通用套用）保護，此處比照不額外加驗證。
function trashFile(db, { fileId }) {
  if (!fileId) throw new Error('trashFile: 缺少 fileId');
  return vdrive.trashFile(db, fileId);
}

// ── downloadFileBase64（三層查找）───────────────────────────────────────────
// 對映 downloadFileBase64_，但額外處理 GAS 時代沒有的兩種情境：
//   Tier 1：本庫（vdrive）——最常見情境，本環境上傳的附件。
//   Tier 2：issues.json dev/prod 共用（v198，見 storage/sharedIssuesDb.js）——問題回報/留言附件
//           可能是在「對方環境」上傳，本庫查無屬正常，只有當 fileId 確實被共用庫 issues.json
//           記錄引用（issue 本身或留言的 attachments，含 pdf_pages 類型的 pages[].fileId）時，
//           才去讀 PEER_DB（對方環境主庫，唯讀連線）——白名單語意對映 GAS 版 issuesHasAttachment_，
//           但額外涵蓋 pages[].fileId（GAS 版原僅檢查 attachments[].fileId，pdf_pages 附件的
//           fileId 實際上藏在巢狀 pages 陣列中，GAS 版對這類附件的跨環境查找本就有缺口——此處
//           一併修正，屬於比 GAS 更完整的白名單，不縮小既有安全邊界）。
//   Tier 3：cutover 前（GAS+Drive 時代）上傳的舊附件——fileId 是真實 Google Drive file id，
//           vdrive/PEER_DB 皆查無屬正常（該檔案從未匯入 sqlite）。啟用條件：DRIVE_SYNC_CREDS
//           （唯讀 OAuth 憑證，與 scripts/pull-attendance.js 共用同一憑證檔機制）與
//           DRIVE_LEGACY_ROOTS（允許的系統根資料夾 id 清單，逗號分隔）皆須設定；驗證該 fileId
//           沿 parents 鏈在 LEGACY_ROOT_MAX_DEPTH 步內確實能到達允許清單中的某個根，才放行
//           （對映 GAS F3 isUnderRoot_／_ancestorContains_ 語意），否則一律視為查無——避免此
//           fallback 被濫用成任意 Drive 檔案 id 的探測器。
// 三層皆查無、Drive 呼叫失敗、或未設定對應環境變數 → 一律拋「找不到附件」業務錯誤（不是 500；
// 沿用其他 vdrive 讀取失敗時的既有慣例，見 vdrive.readJsonById 的 throw 會在 dispatch.js 外層
// catch 轉為 envelope.fail，前端 alert 顯示訊息字串）。
// deps 參數（選填）：{ drive } 供測試注入假的 Drive client，避免測試真的打網路（見
// server/test/attachments.test.js）。
async function downloadFileBase64(db, params, ctx, config, deps) {
  const fileId = params && params.fileId;
  if (!fileId) throw new Error('downloadFileBase64: 缺少 fileId');

  // Tier 1：本庫。isUnderRoot 對「files 表內根本不存在的 fileId」天然回 false（該函式沿 files
  // 表自身的 parent_id 鏈往上走，查無此列即找不到路徑），故「isUnderRoot 為真」已隱含「該列存在」，
  // 不需要另外判斷「找不到」與「越權」兩種情況。
  if (vdrive.isUnderRoot(db, fileId, ctx.root)) {
    const hit = rowToDownload(vdrive.getFileById(db, fileId));
    if (hit) return hit;
  }

  // Tier 2：issues.json 跨環境附件白名單 + PEER_DB。
  const peerHit = tryPeerLookup(fileId, config);
  if (peerHit) return peerHit;

  // Tier 3：cutover 前 GAS+Drive 時代舊附件（唯讀 fallback）。
  const legacyHit = await tryDriveLegacyFallback(fileId, config, deps);
  if (legacyHit) return legacyHit;

  throw new Error('找不到附件');
}

function rowToDownload(row) {
  if (!row || row.trashed || row.blob == null) return null;
  return {
    fileName: row.name,
    mimeType: row.mime_type,
    base64: Buffer.from(row.blob).toString('base64'),
  };
}

// ── Tier 2 helpers ──────────────────────────────────────────────────────

// 純函式（可單元測試）：附件清單（issue.attachments 或 comment.attachments）內是否含此 fileId——
// 含頂層 fileId（image/word 類型）與巢狀 pages[].fileId（pdf_pages 類型，見檔頭註解）。
function attachListHasFileId(list, fileId) {
  if (!Array.isArray(list) || !fileId) return false;
  return list.some((a) => {
    if (!a) return false;
    if (a.fileId === fileId) return true;
    if (Array.isArray(a.pages)) return a.pages.some((p) => p && p.fileId === fileId);
    return false;
  });
}

// 純函式（可單元測試）：issues.json 內容（{issues:[...]}）是否記錄了此 fileId 為某筆 issue 本身
// 或其留言（comments）的附件。issuesJson 為 null／格式不符 → false（fail-closed，呼叫端視為
// 查無而拒絕升級到 PEER_DB 查找）。對映 GAS issuesHasAttachment_。
function issuesHasAttachment(issuesJson, fileId) {
  if (!fileId || !issuesJson || !Array.isArray(issuesJson.issues)) return false;
  for (const iss of issuesJson.issues) {
    if (!iss) continue;
    if (attachListHasFileId(iss.attachments, fileId)) return true;
    const comments = Array.isArray(iss.comments) ? iss.comments : [];
    for (const c of comments) {
      if (attachListHasFileId(c && c.attachments, fileId)) return true;
    }
  }
  return false;
}

// PEER_DB 路徑 → 已開啟唯讀 db handle 的快取（同一路徑同進程只 open 一次，比照
// storage/sharedIssuesDb.js 的快取慣例）。開檔失敗（未設定/檔案不存在/對方環境尚未啟動過一次
// 建檔）一律回 null 並快取「失敗」本身，避免每次呼叫都重新嘗試 open 拖慢回應——
// 但若對方環境是「稍後才建檔」的暫時性狀況，需重啟本行程才會重新嘗試，屬可接受的取捨
// （附件跨環境 fallback 本就是低頻冷路徑，不是热路徑）。
const peerDbCache = new Map();
function getPeerDb(peerDbPath) {
  if (!peerDbPath) return null;
  if (peerDbCache.has(peerDbPath)) return peerDbCache.get(peerDbPath);
  let db = null;
  try {
    db = openDb(peerDbPath, { readonly: true });
  } catch (_e) {
    db = null;
  }
  peerDbCache.set(peerDbPath, db);
  return db;
}

function tryPeerLookup(fileId, config) {
  if (!config || !config.SHARED_ISSUES_DB || !config.PEER_DB) return null;
  const shared = sharedIssuesDb.getSharedIssuesDb(config.SHARED_ISSUES_DB);
  if (!shared) return null;
  let issuesJson = null;
  try {
    issuesJson = vdrive.readJson(shared, 'issues.json', sharedIssuesDb.SHARED_CTX).data;
  } catch (_notFound) {
    issuesJson = null;
  }
  if (!issuesHasAttachment(issuesJson, fileId)) return null;
  const peerDb = getPeerDb(config.PEER_DB);
  if (!peerDb) return null;
  let row = null;
  try {
    row = vdrive.getFileById(peerDb, fileId);
  } catch (_e) {
    row = null;
  }
  return rowToDownload(row);
}

// ── Tier 3 helpers ──────────────────────────────────────────────────────

const tokenCaches = new Map();
function getDriveTokenCache(credsPath) {
  let cache = tokenCaches.get(credsPath);
  if (!cache) {
    const creds = googleAuth.loadCreds(credsPath);
    cache = googleAuth.createTokenCache(creds);
    tokenCaches.set(credsPath, cache);
  }
  return cache;
}

// 純函式（getParents 注入，可單元測試，仿 GAS _ancestorContains_）：fileId 沿 parents 鏈往上走
// 至多 maxHops 步，是否曾經到達 allowedRoots 任一個 id。
async function isUnderAllowedRoot(getParents, fileId, allowedRoots, maxHops) {
  if (!fileId || !allowedRoots || !allowedRoots.length) return false;
  const limit = maxHops || LEGACY_ROOT_MAX_DEPTH;
  let frontier = [fileId];
  const seen = new Set();
  let hops = 0;
  while (frontier.length && hops < limit) {
    const next = [];
    for (const id of frontier) {
      if (allowedRoots.includes(id)) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      let parents = [];
      try {
        parents = (await getParents(id)) || [];
      } catch (_e) {
        parents = [];
      }
      for (const p of parents) next.push(p);
    }
    frontier = next;
    hops += 1;
  }
  return false;
}

async function tryDriveLegacyFallback(fileId, config, deps) {
  if (!config || !config.DRIVE_SYNC_CREDS || !config.DRIVE_LEGACY_ROOTS) return null;
  const allowedRoots = String(config.DRIVE_LEGACY_ROOTS).split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowedRoots.length) return null;
  const driveClient = (deps && deps.drive) || driveClientDefault;

  let accessToken;
  try {
    accessToken = await getDriveTokenCache(config.DRIVE_SYNC_CREDS).getAccessToken();
  } catch (_e) {
    return null;
  }

  const getParents = async (id) => {
    const meta = await driveClient.getMetadata(accessToken, id, 'id,parents');
    return meta && Array.isArray(meta.parents) ? meta.parents : [];
  };

  let allowed = false;
  try {
    allowed = await isUnderAllowedRoot(getParents, fileId, allowedRoots, LEGACY_ROOT_MAX_DEPTH);
  } catch (_e) {
    allowed = false;
  }
  if (!allowed) return null;

  try {
    const meta = await driveClient.getMetadata(accessToken, fileId, 'id,name,mimeType');
    const buf = await driveClient.downloadMedia(accessToken, fileId);
    return {
      fileName: (meta && meta.name) || fileId,
      mimeType: (meta && meta.mimeType) || 'application/octet-stream',
      base64: buf.toString('base64'),
    };
  } catch (_e) {
    return null;
  }
}

// 測試專用：清空 PEER_DB／token 快取，避免不同測試案例間的暫存 db handle 互相汙染。
function _resetCachesForTest() {
  for (const db of peerDbCache.values()) {
    try { db && db.close(); } catch (_e) { /* 已關閉或連線失效 */ }
  }
  peerDbCache.clear();
  tokenCaches.clear();
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  LEGACY_ROOT_MAX_DEPTH,
  createFolder,
  uploadFile,
  trashFile,
  downloadFileBase64,
  attachListHasFileId,
  issuesHasAttachment,
  isUnderAllowedRoot,
  _resetCachesForTest,
};
