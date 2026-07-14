// server/src/authz/caseAuthz.js — R1 個案物件級授權判斷函式，逐項移植 dev/Code.gs L824-932。
// Phase 1 骨架固定 shadow 模式（CASE_AUTHZ_MODE，見 config.js）：只呼叫 audit.js 記錄「會剝除幾筆」，
// 原樣回傳完整內容，不真的過濾——與 dev/Code.gs 當前 enforce 狀態不同步是刻意的（本檔案只是
// 移植判斷函式供未來評估切換用，Node 後端骨架階段連 config.json 的個案資料結構都還沒接上正式資料，
// 過早 enforce 會在缺乏完整驗證的情況下對臨床資料下重手，故先落地 shadow）。
'use strict';

function openDateToSemPrefix(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  const rocYear = d.getFullYear() - 1911;
  const month = d.getMonth() + 1;
  if (month >= 8) return rocYear + '1';
  if (month === 1) return (rocYear - 1) + '1';
  return (rocYear - 1) + '2';
}

function semKeyBase(key) {
  if (!key) return '';
  const i = key.indexOf('#');
  return i === -1 ? key : key.slice(0, i);
}

function caseLatestCounselorEmail(c) {
  const sems = (Array.isArray(c.semesters) && c.semesters.length
    ? c.semesters.slice() : [openDateToSemPrefix(c.openDate)].filter(Boolean)).sort();
  for (let i = sems.length - 1; i >= 0; i--) {
    const snap = c.basicInfoSnapshots && c.basicInfoSnapshots[sems[i]];
    if (snap && snap.counselorEmail) return snap.counselorEmail;
  }
  return c.counselorEmail || '';
}

function caseLatestSemCounselorEmails(c) {
  const sems = (Array.isArray(c.semesters) && c.semesters.length
    ? c.semesters.slice() : [openDateToSemPrefix(c.openDate)].filter(Boolean)).sort();
  if (!sems.length) return [];
  const latestBase = semKeyBase(sems[sems.length - 1]);
  const emails = sems.filter((s) => semKeyBase(s) === latestBase)
    .map((s) => c.basicInfoSnapshots && c.basicInfoSnapshots[s] && c.basicInfoSnapshots[s].counselorEmail)
    .filter(Boolean);
  const seen = {}, out = [];
  emails.forEach((e) => { if (!seen[e]) { seen[e] = true; out.push(e); } });
  return out;
}

function isInitialInterviewerOfCase(c, email) {
  if (!email) return false;
  if (c.initialInterview && c.initialInterview.interviewerEmail === email) return true;
  if (c.initialInterviews) {
    const vals = Object.values(c.initialInterviews);
    return vals.some((v) => v && v.interviewerEmail === email);
  }
  if (!c.initialInterview && !c.initialInterviews && Array.isArray(c.interviewerEmails)) {
    return c.interviewerEmails.indexOf(email) !== -1;
  }
  return false;
}

function caseVisibleToUser(c, email, users) {
  if (!email) return false;
  const lat = caseLatestCounselorEmail(c);
  if (!lat) return true; // 未派案：全員可見
  if (lat === email) return true; // 主責
  if (caseLatestSemCounselorEmails(c).indexOf(email) !== -1) return true; // 同 base 學期多筆開案互相可見
  const u = users || {};
  const allowedCases = (u[email] && u[email].allowedCases) || [];
  if (allowedCases.indexOf(c.id) !== -1) return true; // 個管（手動）
  if (isInitialInterviewerOfCase(c, email)) return true; // 初次晤談者
  const supervisees = (u[email] && u[email].superviseeEmails) || [];
  if (Array.isArray(supervisees) && supervisees.indexOf(lat) !== -1) return true; // 督導當然個管
  if (u[email] && u[email].isVolunteerContact === true && u[lat] && u[lat].role === '義務輔導老師') return true; // 義輔窗口
  return false;
}

function caseFullAccessRole(email, users) {
  const u = (users || {})[email];
  if (!u || u.disabled === true) return false;
  return u.role === '主任' || u.role === '系統管理者' || u.isAdmin === true || u.extraRole === '管理者';
}

function caseHasCrisisGrant(caseId, email, accessLogEntries, todayStr) {
  return (accessLogEntries || []).some((e) => e && e.type === 'grant' && e.email === email
    && e.caseId === caseId && String(e.t || '').slice(0, 10) === todayStr);
}

function caseAllowedForRead(c, email, users, accessLogEntries, todayStr) {
  if (caseFullAccessRole(email, users)) return true;
  if (caseVisibleToUser(c, email, users)) return true;
  return caseHasCrisisGrant(c.id, email, accessLogEntries, todayStr);
}

// 無權查閱時的最小可見欄位——與 dev/Code.gs caseStripForRead_ 白名單完全一致。
const STRIP_KEEP = ['id', 'name', 'studentId', 'archived', 'deleted', 'counselorEmail', 'counselorName',
  'counselorText', 'interviewerEmails', 'department', 'grade', 'openDate', 'updatedAt',
  'lastActivityAt', 'status', 'abType', 'caseType', 'isTransferCase', 'hasPsyEval', 'semesters', 'chunk'];

function caseStripForRead(c) {
  const out = {};
  STRIP_KEEP.forEach((k) => { if (c[k] !== undefined) out[k] = c[k]; });
  if (c.basicInfoSnapshots && typeof c.basicInfoSnapshots === 'object') {
    out.basicInfoSnapshots = {};
    Object.keys(c.basicInfoSnapshots).forEach((sem) => {
      const s = c.basicInfoSnapshots[sem] || {};
      const kept = {};
      if (s.counselorEmail !== undefined) kept.counselorEmail = s.counselorEmail;
      if (s.abType !== undefined) kept.abType = s.abType;
      out.basicInfoSnapshots[sem] = kept;
    });
  }
  if (c.semesterStatus) out.semesterStatus = c.semesterStatus;
  out._authzStripped = true;
  return out;
}

// dev/Code.gs _caseAuthzApply_ 對映。mode: 'shadow'（預設，只記錄不過濾）｜'enforce'。
// onShadowStrip(count, label)：shadow 模式下偵測到「本應剝除」的筆數時的 callback（由呼叫端接 audit）。
function applyCaseAuthz(parsed, userEmail, users, accessLogEntries, todayStr, mode, onShadowStrip, label) {
  if (!parsed || !Array.isArray(parsed.cases)) return parsed;
  const casesArr = parsed.cases;
  if (caseFullAccessRole(userEmail, users)) return parsed;

  let strippedCount = 0;
  const outCases = casesArr.map((c) => {
    if (!c || !c.id) return c;
    if (caseVisibleToUser(c, userEmail, users)) return c;
    if (caseHasCrisisGrant(c.id, userEmail, accessLogEntries, todayStr)) return c;
    strippedCount++;
    return caseStripForRead(c);
  });

  if (strippedCount && typeof onShadowStrip === 'function') onShadowStrip(strippedCount, label);

  if (mode === 'enforce') {
    return Object.assign({}, parsed, { cases: outCases });
  }
  return parsed; // shadow：只記錄，原樣回傳完整內容
}

module.exports = {
  openDateToSemPrefix,
  semKeyBase,
  caseLatestCounselorEmail,
  caseLatestSemCounselorEmails,
  isInitialInterviewerOfCase,
  caseVisibleToUser,
  caseFullAccessRole,
  caseHasCrisisGrant,
  caseAllowedForRead,
  caseStripForRead,
  applyCaseAuthz,
};
