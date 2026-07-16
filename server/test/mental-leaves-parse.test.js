// server/test/mental-leaves-parse.test.js — src/mail/mentalLeaves.js 純函式單元測試（不觸網）。
// 逐字對映 dev/Code.gs fetchMentalLeavesInner_ 的主旨 regex／HTML 表格解析／課程明細三段
// fallback／關鍵字風險分級（L2126-2270）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const ml = require('../src/mail/mentalLeaves');

function b64url(s) {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function makeMessage({ id, subject, textBody, htmlBody, internalDate }) {
  const headers = [{ name: 'Subject', value: subject || '' }, { name: 'From', value: 'reg@npust.edu.tw' }];
  let payload;
  if (textBody && htmlBody) {
    payload = {
      headers,
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url(textBody) } },
        { mimeType: 'text/html', body: { data: b64url(htmlBody) } },
      ],
    };
  } else if (htmlBody) {
    payload = { headers, mimeType: 'text/html', body: { data: b64url(htmlBody) } };
  } else {
    payload = { headers, mimeType: 'text/plain', body: { data: b64url(textBody || '') } };
  }
  return { id: id || 'MSG1', internalDate: internalDate || String(Date.now()), payload };
}

// ── extractBodies ────────────────────────────────────────────────────

test('extractBodies：單一 text/plain body（無 parts）', () => {
  const msg = makeMessage({ subject: '測試信', textBody: '純文字內容' });
  const { subject, text, html } = ml.extractBodies(msg);
  assert.equal(subject, '測試信');
  assert.equal(text, '純文字內容');
  assert.equal(html, '');
});

test('extractBodies：multipart/alternative（text+html 同層 parts）', () => {
  const msg = makeMessage({ subject: '測試信2', textBody: '純文字版', htmlBody: '<p>HTML版</p>' });
  const { text, html } = ml.extractBodies(msg);
  assert.equal(text, '純文字版');
  assert.equal(html, '<p>HTML版</p>');
});

test('extractBodies：巢狀 multipart（parts 內還有 parts）', () => {
  const nested = {
    headers: [{ name: 'Subject', value: '巢狀測試' }],
    mimeType: 'multipart/mixed',
    parts: [
      {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64url('內層純文字') } },
          { mimeType: 'text/html', body: { data: b64url('<p>內層HTML</p>') } },
        ],
      },
      { mimeType: 'application/octet-stream', filename: 'x.pdf', body: {} }, // 附件無 body.data，應被忽略
    ],
  };
  const msg = { id: 'MSG-NESTED', internalDate: '1000', payload: nested };
  const { subject, text, html } = ml.extractBodies(msg);
  assert.equal(subject, '巢狀測試');
  assert.equal(text, '內層純文字');
  assert.equal(html, '<p>內層HTML</p>');
});

test('extractBodies：Subject header 大小寫不敏感', () => {
  const msg = { id: 'M', internalDate: '1', payload: { headers: [{ name: 'subject', value: '小寫標頭' }], body: { data: b64url('x') }, mimeType: 'text/plain' } };
  assert.equal(ml.extractBodies(msg).subject, '小寫標頭');
});

// ── parseMessage：主旨 tag 風格（含「學號:」前綴）────────────────────

test('parseMessage：主旨 tag 風格 → studentId/name/department/reason/leaveDate/leaveDateTo 全數抽出', () => {
  const subject = '學號:U1234567 王小明 資訊工程系 學生請假 因 身體不適，申請 身心調適假從2026/07/01至2026/07/03';
  const msg = makeMessage({ id: 'MSG-TAG', subject, internalDate: String(Date.parse('2026-07-01T02:00:00Z')) });
  const rec = ml.parseMessage(msg, []);
  assert.ok(rec, '應成功解析出紀錄');
  assert.equal(rec.studentId, 'U1234567');
  assert.equal(rec.name, '王小明');
  assert.equal(rec.department, '資訊工程系');
  assert.equal(rec.reason, '身體不適');
  assert.equal(rec.leaveDate, '2026-07-01');
  assert.equal(rec.leaveDateTo, '2026-07-03');
  assert.equal(rec.id, 'ml_MSG-TAG');
  assert.equal(rec.emailId, 'MSG-TAG');
});

test('parseMessage：leaveDate 與 leaveDateTo 相同時，leaveDateTo 留空', () => {
  const subject = '學號:U1234567 王小明 資訊工程系 學生請假 因 身體不適，申請 身心調適假從2026/07/01至2026/07/01';
  const msg = makeMessage({ subject });
  const rec = ml.parseMessage(msg, []);
  assert.equal(rec.leaveDate, '2026-07-01');
  assert.equal(rec.leaveDateTo, '');
});

// ── parseMessage：主旨 underscore 風格（m1 分支）────────────────────

test('parseMessage：主旨 underscore 風格（U12345678_姓名_系所_原因）', () => {
  const subject = 'U1234567_陳小華_資訊管理系_腸胃炎';
  const msg = makeMessage({ subject });
  const rec = ml.parseMessage(msg, []);
  assert.ok(rec);
  assert.equal(rec.studentId, 'U1234567');
  assert.equal(rec.name, '陳小華');
  assert.equal(rec.department, '資訊管理系');
  assert.equal(rec.reason, '腸胃炎');
});

// ── parseMessage：找不到 studentId/name → 回傳 null ─────────────────

test('parseMessage：主旨與內文皆無法抽出 studentId/name → 回傳 null', () => {
  const msg = makeMessage({ subject: '請假申請', textBody: '無關內容' });
  assert.equal(ml.parseMessage(msg, []), null);
});

// ── parseMessage：HTML 表格風格＋課程明細方法1 ───────────────────────

test('parseMessage：HTML 兩欄表格抽出基本欄位＋課程明細表格（方法1）', () => {
  const htmlBody = `
    <html><body>
    <table>
      <tr><th>項目</th><th>內容</th></tr>
      <tr><td>學號</td><td>U2233445</td></tr>
      <tr><td>姓名</td><td>李小美</td></tr>
      <tr><td>系所</td><td>企業管理系</td></tr>
      <tr><td>原因</td><td>身心調適</td></tr>
      <tr><td>學期</td><td>1141</td></tr>
    </table>
    <p>請假明細</p>
    <table>
      <tr><td>序號</td><td>課程名稱</td><td>請假日</td><td>星期</td><td>節次</td></tr>
      <tr><td>00001</td><td>普通心理學</td><td>2026/07/10</td><td>五</td><td>3,4</td></tr>
      <tr><td>00002</td><td>統計學</td><td>2026/07/11</td><td>六</td><td>1-2</td></tr>
    </table>
    </body></html>`;
  const msg = makeMessage({ subject: '請假申請', htmlBody });
  const rec = ml.parseMessage(msg, []);
  assert.ok(rec);
  assert.equal(rec.studentId, 'U2233445');
  assert.equal(rec.name, '李小美');
  assert.equal(rec.department, '企業管理系');
  assert.equal(rec.reason, '身心調適');
  assert.equal(rec.semester, '1141');
  assert.deepEqual(rec.courses, [
    { name: '普通心理學', date: '2026/07/10', weekday: '五', period: '3,4' },
    { name: '統計學', date: '2026/07/11', weekday: '六', period: '1-2' },
  ]);
  assert.equal(rec.course, '普通心理學；統計學');
});

// ── parseMessage：純文字課程明細（方法2 fallback）────────────────────

test('parseMessage：無 HTML，純文字課程明細（方法2：含星期/節次）', () => {
  const textBody = '學號：U3344556\n姓名：張三\n原因：感冒\n\n00003 普通物理學 2026/07/12 星期日 5,6\n00004 微積分 2026/07/13 週一 1-2';
  const msg = makeMessage({ subject: '請假通知', textBody });
  const rec = ml.parseMessage(msg, []);
  assert.ok(rec);
  assert.equal(rec.studentId, 'U3344556');
  assert.equal(rec.name, '張三');
  assert.deepEqual(rec.courses, [
    { name: '普通物理學', date: '2026/07/12', weekday: '日', period: '5,6' },
    { name: '微積分', date: '2026/07/13', weekday: '一', period: '1-2' },
  ]);
});

// ── parseMessage：課程明細方法3（只有課程名稱，無星期節次）──────────

test('parseMessage：純文字課程明細（方法3：缺星期節次，只抓課程名稱）', () => {
  const textBody = '學號：U4455667\n姓名：林四\n\n00005 資料結構 2026/07/14';
  const msg = makeMessage({ subject: '請假通知', textBody });
  const rec = ml.parseMessage(msg, []);
  assert.ok(rec);
  assert.deepEqual(rec.courses, [{ name: '資料結構' }]);
  assert.equal(rec.course, '資料結構');
});

// ── 關鍵字風險分級 ───────────────────────────────────────────────────

test('matchKeywords：level 3 關鍵字命中 → riskLevel=3，handlingStatus=待處理', () => {
  const keywords = [{ kw: '自殺', level: 3 }, { kw: '憂鬱', level: 2 }];
  const subject = '學號:U1234567 王小明 資訊工程系 學生請假 因 有輕生念頭自殺，申請 身心調適假從2026/07/01至2026/07/01';
  const msg = makeMessage({ subject });
  const rec = ml.parseMessage(msg, keywords);
  assert.ok(rec);
  assert.equal(rec.riskLevel, 3);
  assert.equal(rec.handlingStatus, '待處理');
  assert.ok(rec.matchedKeywords.some((k) => k.kw === '自殺' && k.level === 3));
});

test('matchKeywords：僅 level 1/2 命中 → riskLevel<3，handlingStatus=非危機', () => {
  const keywords = [{ kw: '憂鬱', level: 2 }];
  const subject = '學號:U1234567 王小明 資訊工程系 學生請假 因 近期情緒憂鬱，申請 身心調適假從2026/07/01至2026/07/01';
  const msg = makeMessage({ subject });
  const rec = ml.parseMessage(msg, keywords);
  assert.ok(rec);
  assert.equal(rec.riskLevel, 2);
  assert.equal(rec.handlingStatus, '非危機');
});

test('matchKeywords：scope=reason 的關鍵字只比對 reason 欄位，不比對整體 fullText', () => {
  const keywords = [{ kw: '諮商', level: 2, scope: 'reason' }];
  // 「諮商」出現在 textBody（非 reason）中，scope=reason 的關鍵字不應命中。
  const msg = makeMessage({ subject: '請假申請', textBody: '學號：U5566778\n姓名：吳五\n原因：感冒\n備註：已安排諮商晤談' });
  const rec = ml.parseMessage(msg, keywords);
  assert.ok(rec);
  assert.equal(rec.riskLevel, 0, '諮商一詞不在 reason 欄位內，scope=reason 關鍵字不應命中');

  const msg2 = makeMessage({ subject: '請假申請', textBody: '學號：U5566779\n姓名：吳六\n原因：諮商需求' });
  const rec2 = ml.parseMessage(msg2, keywords);
  assert.ok(rec2);
  assert.equal(rec2.riskLevel, 2, 'reason 欄位含諮商 → 應命中 scope=reason 關鍵字');
});

test('DEFAULT_KEYWORDS：無 config 覆寫時的預設關鍵字表包含代表性字詞與層級', () => {
  const byKw = {};
  ml.DEFAULT_KEYWORDS.forEach((k) => { byKw[k.kw] = k; });
  assert.equal(byKw['自殺'].level, 3);
  assert.equal(byKw['憂鬱'].level, 2);
  assert.equal(byKw['身心調適'].level, 1);
  assert.equal(byKw['諮商'].level, 2);
  assert.equal(byKw['諮商'].scope, 'reason');
});

// ── defaultSemester ──────────────────────────────────────────────────

test('defaultSemester：8 月起算為當學年上學期', () => {
  const t = new Date(2026, 7, 15).getTime(); // 2026-08-15（本地時區，月份 0-indexed）
  assert.equal(ml.defaultSemester(String(t)), '1151');
});

test('defaultSemester：1 月視為前一學年上學期（GAS 原邏輯逐字保留）', () => {
  const t = new Date(2026, 0, 15).getTime(); // 2026-01-15
  assert.equal(ml.defaultSemester(String(t)), '1141');
});

test('defaultSemester：2-7 月視為前一學年下學期', () => {
  const t = new Date(2026, 3, 15).getTime(); // 2026-04-15
  assert.equal(ml.defaultSemester(String(t)), '1142');
});
