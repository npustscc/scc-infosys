// server/src/freshmanTest/tutorsysSync.js — 導師名冊「與導師系統同步」（v209 Slice 3）：唯讀讀取
// 同機 scc-tutorsys server 的 store JSON。
//
// 背景：infosys 與 tutorsys 同在 scc-server 這台機器（各自獨立的 Node process／sqlite／.env，見
// CLAUDE.md「正式版 vs 測試版」表），tutorsys 的導師名冊資料落在
// <tutorsys DATA_DIR>/store/classes.json 與 .../departments.json（純檔案，非 sqlite）。與 v198
// SHARED_ISSUES_DB／PEER_DB 的「另開一份 sqlite」不同，這裡是直接唯讀另一個專案的檔案系統路徑，
// 資安風險更高（任意檔名可能讀到任何檔案），因此白名單比照 SHARED_ISSUES_DB「只准 issues.json」
// 的精神但更嚴格：只有 classes.json／departments.json 兩個精確檔名可讀，其餘一律拒絕（見
// ALLOWED_FILES，exact-match Set，不接受任何 pattern/前綴比對，杜絕以檔名夾帶 `..` 之類的路徑
// 遍歷嘗試）。
//
// 欄位最小揭露：pickClasses/pickDepartments 只投影同步需要的欄位（見 memory
// project_freshman_test.md「tutorsys 資料結構」），tutorsys 內部欄位（uploadWhitelist／
// dualApprovalMode／graduationGrade 等實習系統管理用途、與心理測驗同步無關）一律不外流。
// 停用/軟刪除（active:false／deleted:true）的班級與已軟刪除（deleted:true）的系所排除在外——
// 停用系所若仍有 active 班級掛在它底下，仍保留其 headEmail/headName 供該班級查找系主任
// （只濾 deleted，不濾 active，見 pickDepartments 註解）。
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// 白名單（exact-match，非 pattern）——新增可讀檔案須明確擴充此清單並重新評估資安影響，
// 比照 storage/sharedIssuesDb.js 檔頭「不可只加檔名字串了事」的提醒。
const ALLOWED_FILES = new Set(['classes.json', 'departments.json']);

// 唯讀讀取 tutorsys store 目錄下白名單內的單一檔案。storeDir 未設定（TUTORSYS_STORE_DIR 空字串）
// 時明確拋錯（前端據此顯示「未設定」，見 dispatch.js 呼叫端），不可靜默回空陣列——那會讓「尚未設定」
// 與「tutorsys 目前沒有任何班級/系所」兩種情境在前端無法區分。
function readTutorsysStoreFile(storeDir, fileName) {
  if (!storeDir) {
    const err = new Error('tutorsys: 尚未設定 TUTORSYS_STORE_DIR，請聯絡管理者設定伺服器環境變數');
    err.code = 'tutorsys_not_configured';
    throw err;
  }
  if (!ALLOWED_FILES.has(fileName)) {
    throw new Error(`tutorsys: 不在白名單內的檔案（${fileName}）`);
  }
  const resolvedDir = path.resolve(storeDir);
  const filePath = path.join(resolvedDir, fileName);
  // 縱深防禦：即使 fileName 目前只可能是上面兩個字面值常數（呼叫端不會把使用者輸入傳進來），
  // 仍額外驗證解析後路徑確實落在 resolvedDir 之下，防止未來有人不慎讓 fileName 可被外部影響時
  // 出現路徑遍歷（如 fileName 含 `..`）。
  const rel = path.relative(resolvedDir, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('tutorsys: 路徑越界，已拒絕讀取');
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    const err = new Error(`tutorsys: 讀取 ${fileName} 失敗（${(e && e.code) || (e && e.message) || 'unknown'}）`);
    err.code = 'tutorsys_read_failed';
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (_e) {
    throw new Error(`tutorsys: ${fileName} 內容非合法 JSON`);
  }
}

// 投影 classes.json → 同步所需欄位。只收 active!==false 且未軟刪除的班級（見檔頭「欄位最小揭露」）。
function pickClasses(raw) {
  if (!Array.isArray(raw)) throw new Error('tutorsys: classes.json 格式異常（非陣列）');
  return raw
    .filter((c) => c && c.deleted !== true && c.active !== false)
    .map((c) => ({
      id: String(c.id || ''),
      deptId: String(c.deptId || ''),
      displayName: String(c.displayName || c.name || c.id || ''),
      tutors: Array.isArray(c.tutors)
        ? c.tutors.map((t) => ({ name: String((t && t.name) || ''), email: String((t && t.email) || '') }))
        : [],
    }));
}

// 投影 departments.json → 同步所需欄位。只濾 deleted（軟刪除的系所整個不該再被引用），刻意不濾
// active——停用中的系所若仍有 active 班級掛在它底下（尚未整理完成的過渡狀態），同步仍要能查到
// 該系所的系主任資訊，不應該因為系所本身 active:false 就查不到（見檔頭說明）。
function pickDepartments(raw) {
  if (!Array.isArray(raw)) throw new Error('tutorsys: departments.json 格式異常（非陣列）');
  return raw
    .filter((d) => d && d.deleted !== true)
    .map((d) => ({
      id: String(d.id || ''),
      name: String(d.name || d.id || ''),
      headEmail: String(d.headEmail || ''),
      headName: String(d.headName || ''),
    }));
}

function fetchTutorsysSnapshot(storeDir) {
  const classesRaw = readTutorsysStoreFile(storeDir, 'classes.json');
  const departmentsRaw = readTutorsysStoreFile(storeDir, 'departments.json');
  return { classes: pickClasses(classesRaw), departments: pickDepartments(departmentsRaw) };
}

module.exports = {
  ALLOWED_FILES,
  readTutorsysStoreFile,
  pickClasses,
  pickDepartments,
  fetchTutorsysSnapshot,
};
