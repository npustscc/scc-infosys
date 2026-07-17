// server/src/actions/config.js — configSelfPatch／configCasesPatch 垂直切片。
// 對映 dev/Code.gs configSelfPatch_/configCasesPatch_/selfPatchKeyAllowed_/applyCasesPatchOps_
// （L3268-3530）。cutover 後這兩個 action 一直缺席（dispatch default 分支回 Not implemented），
// 導致個人偏好寫入（syncUserPref_）與七個個案存取授權流程（v164 收口後唯一合法通道）在
// Node 後端全部靜默失敗——本檔補齊。
//
// 併發模型：GAS 版用 LockService 全域鎖保護「讀-改-寫」；Node 版比照 actions/commit.js 用
// db.transaction(fn).immediate()，整段讀-改-寫在同一交易內完成，無舊快照互蓋窗口。
// fail-closed：config.json 缺失或形狀異常一律 throw 中止，絕不以空殼覆寫。
'use strict';

const vdrive = require('../storage/vdrive');
const audit = require('../audit');

const CONFIG_PATH = 'config.json';
const CASES_INDEX_PATH = 'cases-index.json';
const MAX_PATCH_BYTES = 200 * 1024;

// ── SELF PATCH 欄位白名單（對映 GAS selfPatchKeyAllowed_）──
// DENY 為雙重保險：即使外層授權閘漏檢查，授權欄位也永遠無法經此通道提權。
// 'avatar' 為 Node 版新增（自訂頭像上傳，v194）：僅本人顯示用途，非授權欄位。
const SELF_PATCH_DENY = new Set([
  'role', 'extraRole', 'isAdmin', 'disabled', 'allowedCases',
  'allowedCasesSems', 'isTransferContact', 'isMentalLeaveContact', 'leaveQuota', 'name',
]);
const SELF_PATCH_FIXED = new Set([
  'semesterPref', 'counselorFreqs', 'sortStatusLocked', 'recPageSize', 'recSortDesc',
  'todosUnclosedCollapsed', 'myAttTab', 'auditColsHidden', 'pin', 'pinTmo', 'pinSkipped',
  'confirmBeforeLeave', 'bkFreqs', 'counselorFreqMode', 'unassignedScanDate', 'mlTab',
  'bkViewMode', 'bkDaySpan', 'bkPageTab', 'bkCustomRooms', 'bkCustomOpts',
  'sidebarCollapsed', 'sidebarPinned', 'bkColor', 'bkColorGc', 'dismissedAlerts', 'gcAclSynced',
  'avatar',
]);

function allDigits(s) {
  return /^\d*$/.test(s);
}

function selfPatchKeyAllowed(key) {
  if (!key || typeof key !== 'string') return false;
  if (SELF_PATCH_DENY.has(key)) return false;
  if (SELF_PATCH_FIXED.has(key)) return true;
  if (key.startsWith('navOrder_')) return true; // 側邊欄/待辦 tab 自訂排序
  const idx = key.indexOf('ColWidths'); // 表格欄寬記憶（含 mlColWidths2 這類尾碼數字）
  if (idx > 0 && allDigits(key.slice(idx + 'ColWidths'.length))) return true;
  return false;
}

// 懶清理：v154 已遷移到 notifications.json 的舊欄位（對映 GAS stripLegacyNotifications_）。
function stripLegacyNotifications(cfg) {
  if (!cfg || typeof cfg.users !== 'object' || cfg.users === null || Array.isArray(cfg.users)) return false;
  let cleaned = false;
  Object.keys(cfg.users).forEach((email) => {
    const u = cfg.users[email];
    if (u && typeof u === 'object' && Object.prototype.hasOwnProperty.call(u, 'notifications')) {
      delete u.notifications;
      cleaned = true;
    }
  });
  return cleaned;
}

// 共用：交易內讀出 config.json（含形狀驗證，fail-closed）。
function readConfigOrThrow(db, ctx, label) {
  let fileId;
  try {
    fileId = vdrive.resolvePathToId(db, CONFIG_PATH, ctx);
  } catch (_e) {
    throw new Error(`${label}: 找不到 config.json`);
  }
  const row = vdrive.getFileById(db, fileId);
  if (!row || row.trashed) throw new Error(`${label}: 找不到 config.json`);
  let cfg;
  try {
    cfg = row.content == null ? null : JSON.parse(row.content);
  } catch (_e) {
    throw new Error(`${label}: 讀取 config.json 失敗，已中止寫入以保護資料`);
  }
  if (!cfg || typeof cfg.users !== 'object' || cfg.users === null || Array.isArray(cfg.users)) {
    throw new Error(`${label}: config.json 內容異常（users 非物件），已中止寫入以保護資料`);
  }
  return { fileId, cfg };
}

// ── configSelfPatch：只 PATCH 呼叫者本人條目的白名單欄位，回傳更新後的本人條目 ──
function configSelfPatch(db, { updates }, ctx, userEmail) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('configSelfPatch: updates required');
  }
  const keys = Object.keys(updates);
  if (!keys.length) throw new Error('configSelfPatch: updates 不可為空');
  if (JSON.stringify(updates).length > MAX_PATCH_BYTES) {
    throw new Error('configSelfPatch: updates 過大（上限 200KB）');
  }
  for (const k of keys) {
    if (!selfPatchKeyAllowed(k)) throw new Error(`configSelfPatch: 欄位不在白名單（${k}）`);
  }

  return db.transaction(() => {
    const { fileId, cfg } = readConfigOrThrow(db, ctx, 'configSelfPatch');
    const me = cfg.users[userEmail];
    if (!me) throw new Error('configSelfPatch: 呼叫者條目不存在，拒絕建立新條目');

    keys.forEach((k) => {
      const v = updates[k];
      if (v === null) delete me[k];
      else me[k] = v;
    });

    stripLegacyNotifications(cfg);
    cfg.updatedAt = new Date().toISOString();
    vdrive.updateContentById(db, fileId, cfg);
    return { user: me };
  }).immediate();
}

// ── configCasesPatch：宣告式 ops 鎖內合併（對映 GAS applyCasesPatchOps_，6 種 op type）──

function casesPatchEmailSane(s) {
  return typeof s === 'string' && s.length > 0 && (s.includes('@') || s.startsWith('nomail_'));
}

function nomailAddOk(key, entry) {
  if (typeof key !== 'string' || !key.startsWith('nomail_')) return false;
  if (!entry || typeof entry !== 'object') return false;
  if (entry.role === '主任' || entry.role === '系統管理者') return false;
  if (entry.isAdmin || entry.extraRole || entry.isTransferContact
    || entry.isMentalLeaveContact || entry.leaveQuota !== undefined) return false;
  if (entry.disabled !== undefined && entry.disabled !== false) return false;
  return true;
}

// 純函式：把 ops 套用到 users（就地修改）。任一步驗證失敗立即 throw（fail-closed，不部分套用）。
// callerEmail 僅 selfRename 使用——呼叫者無法透過 op 參數偽造搬遷別人的帳號。
function applyCasesPatchOps(users, ops, callerEmail) {
  if (!users || typeof users !== 'object' || Array.isArray(users)) {
    throw new Error('applyCasesPatchOps: users 必須為物件');
  }
  if (!Array.isArray(ops) || !ops.length) {
    throw new Error('applyCasesPatchOps: ops 必須為非空陣列');
  }

  ops.forEach((op) => {
    if (!op || typeof op !== 'object' || typeof op.type !== 'string') {
      throw new Error('applyCasesPatchOps: op 格式錯誤');
    }

    if (op.type === 'caseAccessUpsert') {
      if (!casesPatchEmailSane(op.email)) throw new Error('caseAccessUpsert: email 格式錯誤');
      if (typeof op.caseId !== 'string' || !op.caseId) throw new Error('caseAccessUpsert: caseId 必填');
      const entry = users[op.email];
      if (!entry) throw new Error(`caseAccessUpsert: 使用者不存在（${op.email}）`);
      entry.allowedCases = entry.allowedCases || [];
      if (!entry.allowedCases.includes(op.caseId)) entry.allowedCases.push(op.caseId);
      if (op.sems !== undefined && op.sems !== null) {
        if (!Array.isArray(op.sems)) throw new Error('caseAccessUpsert: sems 須為陣列');
        if (!entry.allowedCasesSems) entry.allowedCasesSems = {};
        const union = (entry.allowedCasesSems[op.caseId] || []).concat(op.sems);
        entry.allowedCasesSems[op.caseId] = union.filter((v, i) => union.indexOf(v) === i);
      }
      if (!entry.extraRole) entry.extraRole = '個案管理員';

    } else if (op.type === 'caseAccessRemove') {
      if (!casesPatchEmailSane(op.email)) throw new Error('caseAccessRemove: email 格式錯誤');
      if (typeof op.caseId !== 'string' || !op.caseId) throw new Error('caseAccessRemove: caseId 必填');
      const entry = users[op.email];
      if (!entry) throw new Error(`caseAccessRemove: 使用者不存在（${op.email}）`);
      entry.allowedCases = (entry.allowedCases || []).filter((id) => id !== op.caseId);
      if (entry.allowedCasesSems) {
        delete entry.allowedCasesSems[op.caseId];
        if (!Object.keys(entry.allowedCasesSems).length) delete entry.allowedCasesSems;
      }
      if (!entry.allowedCases.length) {
        delete entry.allowedCases;
        if (entry.extraRole === '個案管理員') delete entry.extraRole;
      }

    } else if (op.type === 'caseAccessSemsSet') {
      if (!casesPatchEmailSane(op.email)) throw new Error('caseAccessSemsSet: email 格式錯誤');
      if (typeof op.caseId !== 'string' || !op.caseId) throw new Error('caseAccessSemsSet: caseId 必填');
      const entry = users[op.email];
      if (!entry) throw new Error(`caseAccessSemsSet: 使用者不存在（${op.email}）`);
      if (!(entry.allowedCases || []).includes(op.caseId)) {
        throw new Error(`caseAccessSemsSet: caseId 不在該使用者 allowedCases（${op.caseId}）`);
      }
      if (Array.isArray(op.sems) && op.sems.length) {
        if (!entry.allowedCasesSems) entry.allowedCasesSems = {};
        entry.allowedCasesSems[op.caseId] = op.sems.filter((v, i) => op.sems.indexOf(v) === i);
      } else if (entry.allowedCasesSems) {
        delete entry.allowedCasesSems[op.caseId];
        if (!Object.keys(entry.allowedCasesSems).length) delete entry.allowedCasesSems;
      }

    } else if (op.type === 'caseIdRemap') {
      if (typeof op.fromId !== 'string' || !op.fromId) throw new Error('caseIdRemap: fromId 必填');
      if (typeof op.toId !== 'string' || !op.toId) throw new Error('caseIdRemap: toId 必填');
      Object.keys(users).forEach((email) => {
        const info = users[email];
        if (!info) return;
        if (Array.isArray(info.allowedCases) && info.allowedCases.includes(op.fromId)) {
          const remapped = info.allowedCases.map((id) => (id === op.fromId ? op.toId : id));
          info.allowedCases = remapped.filter((v, i) => remapped.indexOf(v) === i);
        }
        if (info.allowedCasesSems && info.allowedCasesSems[op.fromId]) {
          const sems = info.allowedCasesSems[op.fromId];
          delete info.allowedCasesSems[op.fromId];
          const union = (info.allowedCasesSems[op.toId] || []).concat(sems);
          info.allowedCasesSems[op.toId] = union.filter((v, i) => union.indexOf(v) === i);
        }
      });

    } else if (op.type === 'nomailAdd') {
      if (typeof op.email !== 'string' || !op.email) throw new Error('nomailAdd: email 必填');
      if (Object.prototype.hasOwnProperty.call(users, op.email)) {
        throw new Error(`nomailAdd: 條目已存在（${op.email}）`);
      }
      if (!nomailAddOk(op.email, op.entry)) throw new Error('nomailAdd: entry 未通過驗證');
      users[op.email] = op.entry;

    } else if (op.type === 'selfRename') {
      if (!casesPatchEmailSane(op.toEmail)) throw new Error('selfRename: toEmail 格式錯誤');
      if (!callerEmail) throw new Error('selfRename: callerEmail 必填');
      if (Object.prototype.hasOwnProperty.call(users, op.toEmail)) {
        throw new Error(`selfRename: 目標帳號已存在（${op.toEmail}）`);
      }
      const meEntry = users[callerEmail];
      if (!meEntry) throw new Error('selfRename: 呼叫者條目不存在');
      // 整個條目原樣搬遷（不接受 params 提供的任何內容）；previousEmails 由後端附加，不含前端可控內容。
      const movedEntry = { ...meEntry };
      const prevEmails = Array.isArray(movedEntry.previousEmails) ? movedEntry.previousEmails.slice() : [];
      prevEmails.push({ email: callerEmail, changedAt: new Date().toISOString(), by: callerEmail });
      movedEntry.previousEmails = prevEmails;
      users[op.toEmail] = movedEntry;
      delete users[callerEmail];

    } else {
      throw new Error(`applyCasesPatchOps: 未知 op type（${op.type}）`);
    }
  });

  return users;
}

// ── #035 個管派任物件級授權（casesPatchOpAuthz）────────────────────────
// 政策（2026-07-18 使用者定案，shadow 先行）：對「動到個案存取名單」的 op，呼叫者須為
// 管理者（主任/isAdmin/extraRole 管理者）、督導（實習生行政/專業督導）、轉銜窗口
// （isTransferContact 或 extraRole 轉銜管理員）、該案現任主責（index.counselorEmail）、
// 該案初談員（index.interviewerEmails——初談自動列管的觸發者）、或該案既有個管
// （呼叫者自己的 allowedCases 已含該案）。selfRename 只搬呼叫者本人條目，恆放行。
// lookupCase(caseId) 回傳 index 條目或 null；查無案（例如同批新建）在 shadow/enforce 皆
// 記錄 reason 但放行——擋「對既有案自授」已涵蓋主要風險，不因索引時差誤殺新案流程。
function callerPrivileged(users, callerEmail) {
  const me = users[callerEmail];
  if (!me) return false;
  if (me.role === '主任' || me.isAdmin || me.extraRole === '管理者') return true;
  if (me.extraRole === '實習生行政督導' || me.extraRole === '實習生專業督導') return true;
  if (me.isTransferContact || me.extraRole === '轉銜管理員') return true;
  return false;
}

function casesPatchOpAuthz(users, op, callerEmail, lookupCase) {
  if (!op || typeof op !== 'object') return { ok: false, reason: 'bad_op' };
  if (op.type === 'selfRename') return { ok: true, reason: 'self_scoped' };
  if (callerPrivileged(users, callerEmail)) return { ok: true, reason: 'privileged' };

  if (op.type === 'nomailAdd') return { ok: false, reason: 'nomail_requires_privileged' };

  const caseId = op.type === 'caseIdRemap' ? op.fromId : op.caseId;
  if (typeof caseId !== 'string' || !caseId) return { ok: false, reason: 'no_case_id' };

  const me = users[callerEmail];
  if (me && Array.isArray(me.allowedCases) && me.allowedCases.includes(caseId)) {
    return { ok: true, reason: 'existing_manager' };
  }
  const entry = lookupCase ? lookupCase(caseId) : null;
  if (!entry) return { ok: true, reason: 'case_not_found' };
  if (entry.counselorEmail && entry.counselorEmail === callerEmail) {
    return { ok: true, reason: 'main_counselor' };
  }
  if (Array.isArray(entry.interviewerEmails) && entry.interviewerEmails.includes(callerEmail)) {
    return { ok: true, reason: 'interviewer' };
  }
  return { ok: false, reason: 'not_case_related' };
}

// 交易內讀 cases-index.json 建 caseId→條目查詢（讀不到＝索引缺失，回恆 null 的查詢，
// authz 對查無案一律放行並記 reason，不阻斷業務）。
function buildCaseLookup(db, ctx) {
  let byId = null;
  try {
    const { data } = vdrive.readJson(db, CASES_INDEX_PATH, ctx);
    if (data && Array.isArray(data.cases)) {
      byId = new Map();
      data.cases.forEach((c) => { if (c && c.id) byId.set(c.id, c); });
    }
  } catch (_e) { byId = null; }
  return (caseId) => (byId ? (byId.get(caseId) || null) : null);
}

function configCasesPatch(db, { ops }, ctx, userEmail, authzMode) {
  if (!Array.isArray(ops) || !ops.length) throw new Error('configCasesPatch: ops 必須為非空陣列');
  if (JSON.stringify(ops).length > MAX_PATCH_BYTES) {
    throw new Error('configCasesPatch: ops 過大（上限 200KB）');
  }
  const mode = authzMode || 'shadow';

  const runTx = () => db.transaction(() => {
    const { fileId, cfg } = readConfigOrThrow(db, ctx, 'configCasesPatch');

    // #035 物件級授權：在套用前以「當下」users/index 判定（套用後 users 已被改動，不可用）。
    let violations = [];
    if (mode !== 'off') {
      const lookupCase = buildCaseLookup(db, ctx);
      ops.forEach((op, i) => {
        const d = casesPatchOpAuthz(cfg.users, op, userEmail, lookupCase);
        if (!d.ok) violations.push(`op${i}:${op && op.type}:${(op && (op.caseId || op.fromId)) || ''}:${d.reason}`);
      });
      if (violations.length && mode === 'enforce') {
        // 稽核不能寫在這裡：throw 會讓整個交易 ROLLBACK 連稽核一起消失——丟帶標記的錯誤，
        // 由外層（交易外）補寫 denied 稽核後再回拋業務錯誤。
        const err = new Error('configCasesPatch: 呼叫者無此案派任權限');
        err.casesPatchViolations = violations;
        throw err;
      }
    }

    applyCasesPatchOps(cfg.users, ops, userEmail);
    stripLegacyNotifications(cfg);
    cfg.updatedAt = new Date().toISOString();
    vdrive.updateContentById(db, fileId, cfg);

    // shadow：只記錄「若 enforce 會被擋」，不阻擋（觀察期用，翻 enforce 前逐筆確認皆為本該擋的）。
    if (violations.length && mode === 'shadow') {
      audit.appendAuditLog(db, {
        email: userEmail, action: 'configCasesPatch.authz', target: null, outcome: 'would_deny',
        detail: `shadow;${violations.join(';')}`.slice(0, 900),
      });
    }
    return { ok: true };
  }).immediate();

  try {
    return runTx();
  } catch (e) {
    if (e && e.casesPatchViolations) {
      audit.appendAuditLog(db, {
        email: userEmail, action: 'configCasesPatch.authz', target: null, outcome: 'denied',
        detail: `enforce_deny;${e.casesPatchViolations.join(';')}`.slice(0, 900),
      });
    }
    throw e;
  }
}

module.exports = {
  configSelfPatch,
  configCasesPatch,
  selfPatchKeyAllowed,
  applyCasesPatchOps,
  stripLegacyNotifications,
  casesPatchOpAuthz,
};
