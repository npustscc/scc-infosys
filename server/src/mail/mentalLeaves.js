// server/src/mail/mentalLeaves.js — 身心調適假信箱解析與關鍵字比對。對映 dev/Code.gs
// runFetchMentalLeaves/fetchMentalLeaves_/fetchMentalLeavesInner_（L2035-2343）與
// gmailDecodeBody_/loadMlKeywords_（L2586-2640）。
//
// 本檔分兩層：
//   1. 純函式（可離線單元測試，不觸網）：extractBodies／parseMessage／mergeMentalLeaves／loadMlKeywords
//   2. 協調函式 fetchAndMergeMentalLeaves：串接 Gmail REST（google/gmail.js）與本地 vdrive 寫入，
//      供 scripts/pull-mental-leaves.js（CLI／systemd timer）與 src/actions/mail.js（dispatch
//      手動觸發）共用同一核心，避免兩處各自維護一份解析/合併邏輯而漂移。
//
// 刻意不移植的 GAS 行為（詳見 CLAUDE.md 交付回報）：force／reparse 批次重跑模式（含
// fetchPageToken 續頁、reparse 時保留 handlingStatus 等使用者欄位的覆蓋式合併）。Node 版
// 只實作「normal」增量模式（純 add-only，等同 GAS 非 reparse/force 路徑），這也是唯一會被排程
// 與 dispatch 呼叫的模式；GAS 版 force/reparse 屬人工維運工具，未在本次交付範圍內。
'use strict';

const vdrive = require('../storage/vdrive');
const gmail = require('../google/gmail');

// ── 關鍵字比對預設表（config.json 未設定 mentalLeaveKeywords 時使用）──
// 逐字對映 loadMlKeywords_（dev/Code.gs L2620）的硬編碼 fallback。
function buildDefaultKeywords() {
  const list = [];
  '死,結束生命,不想活,自傷,自殘,自殺,跳,崩潰,喘不過氣,恐慌,解離,幻覺,車禍,意外,喪,暴力,性平,性騷,家暴,輕生,消失'
    .split(',').forEach((kw) => list.push({ kw, level: 3 }));
  '身心科,精神科,急診,住院,看診,回診,藥物副作用,換藥,斷藥,戒斷,憂鬱,焦慮,躁鬱,失眠,厭食,暴食,哭,壓力大,情緒'
    .split(',').forEach((kw) => list.push({ kw, level: 2 }));
  list.push({ kw: '諮商', level: 2, scope: 'reason' });
  '分手,感情問題,排擠,霸凌,期中,期末,退學,休學,擋修,家庭衝突,經濟壓力,身心調適,休息調適,個人因素,照顧家人'
    .split(',').forEach((kw) => list.push({ kw, level: 1 }));
  return list;
}
const DEFAULT_KEYWORDS = buildDefaultKeywords();

// 對映 loadMlKeywords_：優先讀 config.json 的 mentalLeaveKeywords，讀不到／空陣列則用預設表。
function loadMlKeywords(db, ctx) {
  try {
    const { data } = vdrive.readJson(db, 'config.json', ctx);
    if (data && Array.isArray(data.mentalLeaveKeywords) && data.mentalLeaveKeywords.length) {
      return data.mentalLeaveKeywords;
    }
  } catch (_e) { /* config.json 不存在或讀取失敗 → 用預設關鍵字表 */ }
  return DEFAULT_KEYWORDS;
}

// ── base64url 解碼（Gmail body.data 編碼）──
function decodeBase64Url(data) {
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch (_e) {
    return '';
  }
}

// 對映 gmailDecodeBody_：遞迴走訪 payload/parts，取第一個非空的 text/plain 與 text/html 內容
// （已有值就不再覆蓋——沿用 GAS 版「第一個找到的優先」語意，不做「哪個較長/較新」之類判斷）。
function decodeBodyParts(payload) {
  if (!payload) return { text: '', html: '' };
  if (payload.body && payload.body.data) {
    const d = decodeBase64Url(payload.body.data);
    return (payload.mimeType || '').indexOf('html') >= 0 ? { text: '', html: d } : { text: d, html: '' };
  }
  const result = { text: '', html: '' };
  (payload.parts || []).forEach((p) => {
    if (p.parts) {
      const sub = decodeBodyParts(p);
      if (!result.text && sub.text) result.text = sub.text;
      if (!result.html && sub.html) result.html = sub.html;
    }
    if (!p.body || !p.body.data) return;
    const d = decodeBase64Url(p.body.data);
    if (p.mimeType === 'text/plain' && !result.text) result.text = d;
    else if (p.mimeType === 'text/html' && !result.html) result.html = d;
  });
  return result;
}

function getHeader(payload, name) {
  const headers = (payload && payload.headers) || [];
  const target = String(name).toLowerCase();
  for (const h of headers) {
    if (h && String(h.name).toLowerCase() === target) return h.value || '';
  }
  return '';
}

// 取 Gmail message resource 的 subject/from/text/html（multipart 情境已於 decodeBodyParts 處理）。
function extractBodies(message) {
  const payload = (message && message.payload) || {};
  const bodies = decodeBodyParts(payload);
  return {
    subject: getHeader(payload, 'subject'),
    from: getHeader(payload, 'from'),
    text: bodies.text,
    html: bodies.html,
  };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// 對映 fetchMentalLeavesInner_ 主旨解析段（L2126-2150）。
function parseSubjectFields(subject) {
  const out = { studentId: '', name: '', department: '', reason: '', leaveDate: '', leaveDateTo: '' };
  const mId = subject.match(/學號[:：]\s*([A-Z0-9]{7,12})/);
  if (mId) {
    out.studentId = mId[1].trim();
    const mN = subject.match(new RegExp(escapeRegExp(out.studentId) + '\\s+([^\\s　]+)'));
    if (mN) out.name = mN[1].trim();
    const mDp = subject.match(/([^\s　，,。]+)\s*學生請/);
    if (mDp) out.department = mDp[1].trim();
    const mRs = subject.match(/因\s+(.+?)\s*[，,]\s*申請/);
    if (mRs) out.reason = mRs[1].trim();
    const mDt = subject.match(/身心調適假從\s*([\d/]+)至\s*([\d/]+)/);
    if (mDt) {
      out.leaveDate = mDt[1].trim().replace(/\//g, '-');
      const mDtEnd = mDt[2].trim().replace(/\//g, '-');
      if (mDtEnd && mDtEnd !== out.leaveDate) out.leaveDateTo = mDtEnd;
    }
  } else {
    const m1 = subject.match(/([A-Z0-9a-z]{8,12})[_\s]*([^\s_（(]+)[_\s]*([^\s_（(]+)[_\s]*(.+)?/);
    const m2 = subject.match(/([^\s（(]+)（([A-Z0-9]{8,12})）/);
    if (m1 && /[A-Z]/.test(m1[1]) && m1[1].length >= 8) {
      out.studentId = m1[1].trim();
      out.name = m1[2].trim();
      out.department = m1[3].trim();
      if (m1[4]) out.reason = m1[4].trim();
    } else if (m2) {
      out.name = m2[1].trim();
      out.studentId = m2[2].trim();
    }
  }
  return out;
}

// 對映 HTML 表格解析段（L2152-2186）：<tr><td>學號</td><td>U1234567</td></tr> 形式的兩欄表格。
function parseHtmlTableFields(htmlBody, plainBody, fields) {
  try {
    const rows = [];
    const tableRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = tableRe.exec(htmlBody)) !== null) {
      const cells = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let tdMatch;
      while ((tdMatch = cellRe.exec(trMatch[1])) !== null) {
        cells.push(tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim());
      }
      if (cells.length >= 2) rows.push(cells);
    }
    rows.forEach((cells) => {
      const label = cells[0] || '';
      const val = cells[1] || '';
      if (!fields.studentId && /學號/.test(label)) fields.studentId = val.trim();
      if (!fields.name && /姓名/.test(label)) fields.name = val.trim();
      if (!fields.department && /系所|科系|班級/.test(label)) fields.department = val.trim();
      if (!fields.reason && /原因|緣由|事由/.test(label)) fields.reason = val.trim();
      if (!fields.leaveDate && /日期|請假日/.test(label)) fields.leaveDate = val.trim();
      if (!fields.course && /課程|科目/.test(label)) fields.course = val.trim();
      if (!fields.semester && /學期/.test(label)) fields.semester = val.trim();
    });
    if (!fields.studentId) {
      const sidMatch = (plainBody + stripHtml(htmlBody)).match(/學號[：:\s]*([A-Z0-9]{8,12})/);
      if (sidMatch) fields.studentId = sidMatch[1].trim();
    }
    if (!fields.name) {
      const nameMatch = plainBody.match(/姓名[：:\s]*([^\s\n\r,，、]{2,6})/);
      if (nameMatch) fields.name = nameMatch[1].trim();
    }
    if (!fields.reason) {
      const rMatch = plainBody.match(/(?:原因|緣由|事由)[：:\s]*([^\n\r]{2,80})/);
      if (rMatch) fields.reason = rMatch[1].trim();
    }
  } catch (_parseErr) { /* 對映 GAS catch(parseErr){ Logger.log(...) }：單封信解析失敗不中斷整批 */ }
}

// 對映課程明細三段 fallback（L2191-2254）。回傳 { coursesArr, course }（course 為既有 course 或
// 由 coursesArr 去重 join 而成，呼叫端應以回傳值覆蓋既有 course 欄位——與 GAS `if (!course && ...)`
// 語意一致：只在尚未由表格解析出 course 時才用課程明細去重結果填入）。
function parseCourses(htmlBody, plainBody, existingCourse) {
  let coursesArr = [];
  let course = existingCourse || '';
  try {
    // ── 方法 1（優先）：直接解析 HTML 表格 <tr><td>×5</tr> ──
    if (htmlBody) {
      const detailIdx = htmlBody.indexOf('請假明細');
      const scanBody = detailIdx >= 0 ? htmlBody.slice(detailIdx) : htmlBody;
      const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let trM;
      while ((trM = trRe.exec(scanBody)) !== null) {
        const cells = [];
        const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let cellM;
        while ((cellM = cellRe.exec(trM[1])) !== null) {
          const txt = cellM[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
          cells.push(txt);
        }
        if (cells.length >= 5 && /^\d{4,6}$/.test(cells[0])) {
          coursesArr.push({ name: cells[1], date: cells[2], weekday: cells[3], period: cells[4] });
        }
      }
    }
    // ── 方法 2（fallback）：純文字 regex ──
    if (!coursesArr.length) {
      const bodyText = plainBody || stripHtml(htmlBody || '');
      const fullCRe = /(\d{4,6})\s+([^\d\s\n][^\n\r]{2,40}?)\s+(\d{4}\/\d{1,2}\/\d{1,2})\s+(?:星期|週|禮拜)?([一二三四五六日])\s+([\d,、-]+)/g;
      let cM;
      while ((cM = fullCRe.exec(bodyText)) !== null) {
        coursesArr.push({ name: cM[2].trim(), date: cM[3].trim(), weekday: cM[4].trim(), period: cM[5].trim() });
      }
    }
    // ── 方法 3（最終 fallback）：只抓課程名稱 ──
    if (!coursesArr.length) {
      const bodyText2 = plainBody || stripHtml(htmlBody || '');
      const cRe2 = /\d{4,6}\s+([^\d\s\n][^\n\r]+?)\s+\d{4}\/\d{1,2}\/\d{1,2}/g;
      let cM2;
      while ((cM2 = cRe2.exec(bodyText2)) !== null) {
        const cn = cM2[1].trim();
        if (cn) coursesArr.push({ name: cn });
      }
    }
    if (!course && coursesArr.length) {
      const seen = {};
      const uniq = [];
      coursesArr.forEach((c) => { if (!seen[c.name]) { seen[c.name] = true; uniq.push(c.name); } });
      course = uniq.join('；');
    }
  } catch (_e2) { /* 對映 GAS catch(e2){ Logger.log(...) }：課程明細解析失敗不影響其餘欄位 */ }
  return { coursesArr, course };
}

// 對映關鍵字比對段（L2261-2270）。
function matchKeywords(subject, reason, plainBody, keywords) {
  const matchedKeywords = [];
  let maxLevel = 0;
  const fullText = subject + ' ' + reason + ' ' + plainBody;
  (keywords || []).forEach((k) => {
    const matchText = k.scope === 'reason' ? reason : fullText;
    if (matchText.indexOf(k.kw) !== -1) {
      matchedKeywords.push({ kw: k.kw, level: k.level });
      if (k.level > maxLevel) maxLevel = k.level;
    }
  });
  return { matchedKeywords, riskLevel: maxLevel };
}

// 對映學期預設值計算（L2272-2277）——民國學年＋上下學期判斷；8 月起算上學期，1 月仍算前一學年
// 上學期，2-7 月算前一學年下學期（此為 GAS 原邏輯的既有寫法，逐字保留，不做「更合理」的改寫）。
function defaultSemester(internalDate) {
  const rd = internalDate ? new Date(parseInt(internalDate, 10)) : new Date();
  const rocY = rd.getFullYear() - 1911;
  const mon = rd.getMonth() + 1;
  return mon >= 8 ? rocY + '1' : (mon === 1 ? (rocY - 1) + '1' : (rocY - 1) + '2');
}

// ── parseMessage：單封信解析為完整紀錄；studentId 與 name 皆抽不出時回傳 null（對映
// `if (!studentId && !name) return;` 略過該封信，L2259）。message 為 Gmail messages.get
// (format=full) 回傳的 resource（含 id/internalDate/payload）。──
function parseMessage(message, keywords) {
  const msgId = message.id;
  const { subject, text: plainBody, html: htmlBody } = extractBodies(message);

  const fields = parseSubjectFields(subject);
  fields.course = '';
  fields.semester = '';
  parseHtmlTableFields(htmlBody, plainBody, fields);

  const { coursesArr, course } = parseCourses(htmlBody, plainBody, fields.course);
  fields.course = course;

  if (!fields.studentId && !fields.name) return null;

  const { matchedKeywords, riskLevel } = matchKeywords(subject, fields.reason, plainBody, keywords);

  const semester = fields.semester || defaultSemester(message.internalDate);
  const receivedAt = message.internalDate ? new Date(parseInt(message.internalDate, 10)).toISOString() : new Date().toISOString();

  return {
    id: 'ml_' + msgId,
    emailId: msgId,
    studentId: fields.studentId,
    name: fields.name,
    department: fields.department,
    reason: fields.reason,
    leaveDate: fields.leaveDate,
    leaveDateTo: fields.leaveDateTo,
    course: fields.course,
    courses: coursesArr,
    semester: String(semester),
    matchedKeywords,
    riskLevel,
    handlingStatus: riskLevel >= 3 ? '待處理' : '非危機',
    receivedAt,
    parsedAt: new Date().toISOString(),
  };
}

// ── mergeMentalLeaves：add-only 合併（比照 scripts/pull-attendance.js 的 mergeAttendance），
// 鍵為 emailId（非 id）——GAS 版非 reparse/force 路徑本就是「emailId 已存在即整封略過」，故本地既有
// 紀錄（含使用者手動編輯過的 handlingStatus/acknowledgedBy/deleted 等欄位）永遠不會被觸碰，
// 「保留使用者欄位」在 add-only 語意下是自動成立的（不需要額外的欄位級合併邏輯）。──
function mergeMentalLeaves(existingRecords, incoming) {
  const base = Array.isArray(existingRecords) ? existingRecords : [];
  const seen = new Set();
  for (const r of base) {
    if (r && typeof r.emailId === 'string' && r.emailId) seen.add(r.emailId);
  }
  const merged = base.slice();
  let added = 0;
  const addedRecords = [];
  for (const r of incoming || []) {
    if (!r || typeof r.emailId !== 'string' || !r.emailId) continue;
    if (seen.has(r.emailId)) continue;
    seen.add(r.emailId);
    merged.push(r);
    addedRecords.push(r);
    added++;
  }
  return { merged, added, addedRecords };
}

// ── fetchAndMergeMentalLeaves：協調函式（會觸網＋寫本地 DB），供 CLI／dispatch 共用同一核心。──
// opts: { accessToken(必要), labelName, batchSize, keywords, gmailClient }
// 回傳 { newCount, totalCount, batchCount, errors, labelErrors }。
async function fetchAndMergeMentalLeaves(db, ctx, opts) {
  opts = opts || {};
  const gmailClient = opts.gmailClient || gmail;
  const labelName = opts.labelName || 'ml-processed-dev';
  const batchSize = opts.batchSize || 50;
  const accessToken = opts.accessToken;
  if (!accessToken) throw new Error('fetchAndMergeMentalLeaves: accessToken required');
  const keywords = opts.keywords || loadMlKeywords(db, ctx);

  // 初步讀取既有紀錄：只用來決定「要不要花 API 額度重新抓信」，權威判斷留給下方交易內的重讀
  // （避免與其他同時寫入 mental_leaves.json 的呼叫互相覆蓋，比照 actions/commit.js 的 RMW-in-transaction）。
  let seedRecords = [];
  try {
    const { data } = vdrive.readJson(db, 'mental_leaves.json', ctx);
    if (data && Array.isArray(data.records)) seedRecords = data.records;
  } catch (_e) { /* 尚無此檔，視為空 */ }
  const seedSet = new Set();
  seedRecords.forEach((r) => { if (r && r.emailId) seedSet.add(r.emailId); });

  const processedLabelId = await gmailClient.getOrCreateLabel(accessToken, labelName);
  const query = `subject:(請假 OR 身心調適假 OR 缺課) -label:${labelName}`;
  const searchData = await gmailClient.listMessages(accessToken, query, { maxResults: batchSize });
  const messages = searchData.messages || [];

  const parsedRecords = [];
  const labelTargets = [];
  const errors = [];

  for (const m of messages) {
    if (seedSet.has(m.id)) continue; // 冪等：即使先前貼標失敗，emailId 已入檔即不重覆處理
    try {
      const msg = await gmailClient.getMessage(accessToken, m.id);
      const rec = parseMessage(msg, keywords);
      // 對映 GAS `if (!studentId && !name) return;`：抽不出關鍵欄位的信件不加 label，
      // 下次仍會被查詢到並重新嘗試解析（GAS 原行為如此，逐字保留，非本次新增的缺陷）。
      if (!rec) continue;
      parsedRecords.push(rec);
      seedSet.add(m.id);
      labelTargets.push(m.id);
    } catch (e) {
      errors.push({ id: m.id, message: e.message });
    }
  }

  const writeResult = db.transaction(() => {
    let existingData = { records: [] };
    try {
      const { data } = vdrive.readJson(db, 'mental_leaves.json', ctx);
      if (data && Array.isArray(data.records)) existingData = data;
    } catch (_e) { /* 尚無此檔 */ }

    const mergeResult = mergeMentalLeaves(existingData.records, parsedRecords);
    const nextData = Object.assign({}, existingData, {
      records: mergeResult.merged,
      lastFetchedAt: new Date().toISOString(),
    });
    vdrive.updateJson(db, 'mental_leaves.json', nextData, ctx);
    return { added: mergeResult.added, total: nextData.records.length };
  }).immediate();

  const labelErrors = [];
  for (const id of labelTargets) {
    try {
      await gmailClient.modifyLabels(accessToken, id, { addLabelIds: [processedLabelId] });
    } catch (e) {
      labelErrors.push({ id, message: e.message });
    }
  }

  return {
    newCount: writeResult.added,
    totalCount: writeResult.total,
    batchCount: messages.length,
    errors,
    labelErrors,
  };
}

module.exports = {
  DEFAULT_KEYWORDS,
  loadMlKeywords,
  extractBodies,
  parseSubjectFields,
  parseHtmlTableFields,
  parseCourses,
  matchKeywords,
  defaultSemester,
  parseMessage,
  mergeMentalLeaves,
  fetchAndMergeMentalLeaves,
};
