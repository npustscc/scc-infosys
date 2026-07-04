// 個案可見性（_caseVisibleToUser）與案號重複判斷（checkCaseIdDuplicate）單元測試。
// 執行：node --test test/
// 測試對象直接從 dev/index.html 就地抽出（見 harness.js），改壞正式碼即會紅燈。
const { test } = require('node:test');
const assert = require('node:assert');
const { load, makeFixedDate } = require('./harness');

// ── _caseVisibleToUser：非管理者可見性單一真相 ────────────────────────────────
// 相依函式一併就地抽出（皆為只讀 configData 的純函式）
const VIS_FNS = [
  '_caseVisibleToUser',
  '_getLatestCounselorEmail',
  '_isInitialInterviewerOfCase',
  '_getSuperviseeEmails',
  '_isVolunteerContact',
  'openDateToSemPrefix',
];

function loadVis(configData) {
  return load(VIS_FNS, { configData: configData || { users: {} } });
}

test('_caseVisibleToUser：無 email 一律不可見', () => {
  const S = loadVis();
  assert.equal(S._caseVisibleToUser({ id: '1142001' }, '', null), false);
  assert.equal(S._caseVisibleToUser({ id: '1142001' }, null, null), false);
});

test('_caseVisibleToUser：未派案（無主責）全員可見', () => {
  const S = loadVis();
  const c = { id: '1142001', openDate: '2026-06-01' }; // 無 counselorEmail、無 snapshots
  assert.equal(S._caseVisibleToUser(c, 'anyone@x.tw', null), true);
});

test('_caseVisibleToUser：主責本人可見、他人不可見', () => {
  const S = loadVis();
  const c = { id: '1142001', counselorEmail: 'a@x.tw' };
  assert.equal(S._caseVisibleToUser(c, 'a@x.tw', null), true);
  assert.equal(S._caseVisibleToUser(c, 'b@x.tw', null), false);
});

test('_caseVisibleToUser：主責以「最新學期快照」為準，舊學期主責不可見', () => {
  const S = loadVis();
  const c = {
    id: '1141005',
    counselorEmail: 'old@x.tw', // 頂層欄位是舊值
    semesters: ['1141', '1142'],
    basicInfoSnapshots: {
      1141: { counselorEmail: 'old@x.tw' },
      1142: { counselorEmail: 'new@x.tw' }, // 最新學期已轉派
    },
  };
  assert.equal(S._caseVisibleToUser(c, 'new@x.tw', null), true);
  assert.equal(S._caseVisibleToUser(c, 'old@x.tw', null), false);
});

test('_caseVisibleToUser：最新學期快照缺主責時往前找、再 fallback 頂層欄位', () => {
  const S = loadVis();
  // 1142 快照沒有 counselorEmail → 往前用 1141 的
  const c1 = {
    id: '1141005',
    semesters: ['1141', '1142'],
    basicInfoSnapshots: { 1141: { counselorEmail: 'a@x.tw' }, 1142: {} },
  };
  assert.equal(S._caseVisibleToUser(c1, 'a@x.tw', null), true);
  // 所有快照皆無 → fallback c.counselorEmail
  const c2 = { id: '1142001', semesters: ['1142'], basicInfoSnapshots: { 1142: {} }, counselorEmail: 'b@x.tw' };
  assert.equal(S._caseVisibleToUser(c2, 'b@x.tw', null), true);
});

test('_caseVisibleToUser：手動個管（allowedSet）可見', () => {
  const S = loadVis();
  const c = { id: '1142001', counselorEmail: 'a@x.tw' };
  assert.equal(S._caseVisibleToUser(c, 'mgr@x.tw', new Set(['1142001'])), true);
  assert.equal(S._caseVisibleToUser(c, 'mgr@x.tw', new Set(['1142999'])), false);
});

test('_caseVisibleToUser：初次晤談者可見（完整資料與 index-only 皆支援）', () => {
  const S = loadVis();
  // 完整資料：initialInterview / initialInterviews
  const c1 = { id: '1142001', counselorEmail: 'a@x.tw', initialInterview: { interviewerEmail: 'ii@x.tw' } };
  assert.equal(S._caseVisibleToUser(c1, 'ii@x.tw', null), true);
  const c2 = { id: '1142002', counselorEmail: 'a@x.tw', initialInterviews: { 1142: { interviewerEmail: 'ii@x.tw' } } };
  assert.equal(S._caseVisibleToUser(c2, 'ii@x.tw', null), true);
  // index-only entry：只有 interviewerEmails 陣列
  const c3 = { id: '1142003', counselorEmail: 'a@x.tw', interviewerEmails: ['ii@x.tw'] };
  assert.equal(S._caseVisibleToUser(c3, 'ii@x.tw', null), true);
  assert.equal(S._caseVisibleToUser(c3, 'other@x.tw', null), false);
});

test('_caseVisibleToUser：督導/窗口（superviseeEmails 含主責）可見', () => {
  const S = loadVis({
    users: { 'sup@x.tw': { superviseeEmails: ['intern@x.tw'] } },
  });
  const c = { id: '1142001', counselorEmail: 'intern@x.tw' };
  assert.equal(S._caseVisibleToUser(c, 'sup@x.tw', null), true);
  assert.equal(S._caseVisibleToUser(c, 'notsup@x.tw', null), false);
});

test('_caseVisibleToUser：義輔窗口對「主責為義務輔導老師」的案一律可見', () => {
  const S = loadVis({
    users: {
      'vc@x.tw': { isVolunteerContact: true },
      'vol@x.tw': { role: '義務輔導老師' },
      'ft@x.tw': { role: '專任心理師' },
    },
  });
  const cVol = { id: '1142001', counselorEmail: 'vol@x.tw' };
  const cFt = { id: '1142002', counselorEmail: 'ft@x.tw' };
  assert.equal(S._caseVisibleToUser(cVol, 'vc@x.tw', null), true);  // 義輔主責 → 可見
  assert.equal(S._caseVisibleToUser(cFt, 'vc@x.tw', null), false);  // 專任主責 → 不可見
  assert.equal(S._caseVisibleToUser(cVol, 'ft@x.tw', null), false); // 非義輔窗口 → 不可見
});

// ── checkCaseIdDuplicate：案號重複三段式判斷 ─────────────────────────────────
// DOM 以最小 stub 提供：getElementById 回傳 {value, style, innerHTML}，
// 斷言訊息元素的 innerHTML/display 來驗證三種分支（同學期同學生/舊學期同學生/不同學生）。
function makeDoc(values) {
  const els = {};
  return {
    getElementById(id) {
      if (!els[id]) els[id] = { value: values[id] || '', style: {}, innerHTML: '' };
      return els[id];
    },
    _els: els,
  };
}

function loadDup(values, casesData) {
  const doc = makeDoc(values);
  // escHtml 用 stub：其本體含 regex 字面量（/"/g），harness 的括號配對器不解析 regex 會誤判；
  // 且它不是受測對象，斷言只看中文訊息文字。
  const S = load(['checkCaseIdDuplicate', 'currentSemesterPrefix'], {
    Date: makeFixedDate('2026-06-15T00:00:00'), // 本學期前綴 = 1142
    document: doc,
    casesData,
    _editingCaseId: null,
    escHtml: (s) => String(s),
  });
  return { S, doc };
}

const DUP_CASE = { id: '1142003', name: '測生', studentId: 'B11012345', idNumber: 'A123456789' };
const OLD_CASE = { id: '1141007', name: '測生', studentId: 'B11012345', idNumber: 'A123456789' };

test('checkCaseIdDuplicate：同學期同學生（學號相符）→ 紅色警告+另行開案', () => {
  const { S, doc } = loadDup(
    { 'nc-id': '1142003', 'nc-student-id': 'B11012345' },
    [DUP_CASE],
  );
  S.checkCaseIdDuplicate();
  const msg = doc._els['nc-id-message'];
  assert.equal(msg.style.display, '');
  assert.ok(msg.innerHTML.includes('本學期已開案'));
  assert.ok(msg.innerHTML.includes('另外開案'));
});

test('checkCaseIdDuplicate：姓名單一欄位相符也視為同一學生', () => {
  const { S, doc } = loadDup(
    { 'nc-id': '1142003', 'nc-name': '測生' }, // 只填姓名，未填學號/身分證
    [DUP_CASE],
  );
  S.checkCaseIdDuplicate();
  assert.ok(doc._els['nc-id-message'].innerHTML.includes('本學期已開案'));
});

test('checkCaseIdDuplicate：舊學期同學生 → 藍色提示產生本學期新案號', () => {
  const { S, doc } = loadDup(
    { 'nc-id': '1141007', 'nc-student-id': 'B11012345' },
    [OLD_CASE],
  );
  S.checkCaseIdDuplicate();
  const msg = doc._els['nc-id-message'];
  assert.equal(msg.style.display, '');
  assert.ok(msg.innerHTML.includes('舊學期既有案號'));
  assert.ok(msg.innerHTML.includes('產生本學期新案號'));
});

test('checkCaseIdDuplicate：不同學生撞號 → 黃色警告修改案號', () => {
  const { S, doc } = loadDup(
    { 'nc-id': '1142003', 'nc-student-id': 'B99999999', 'nc-name': '別人' },
    [DUP_CASE],
  );
  S.checkCaseIdDuplicate();
  const msg = doc._els['nc-id-message'];
  assert.ok(msg.innerHTML.includes('已被個案'));
  assert.ok(msg.innerHTML.includes('修改'));
});

test('checkCaseIdDuplicate：空值或無重複 → 隱藏訊息', () => {
  // 空值
  const a = loadDup({ 'nc-id': '' }, [DUP_CASE]);
  a.S.checkCaseIdDuplicate();
  assert.equal(a.doc._els['nc-id-message'].style.display, 'none');
  // 無重複
  const b = loadDup({ 'nc-id': '1142099', 'nc-student-id': 'B11012345' }, [DUP_CASE]);
  b.S.checkCaseIdDuplicate();
  assert.equal(b.doc._els['nc-id-message'].style.display, 'none');
});

test('checkCaseIdDuplicate：編輯中的個案本身不算重複（_editingCaseId 排除）', () => {
  const doc = makeDoc({ 'nc-id': '1142003', 'nc-student-id': 'B11012345' });
  const S = load(['checkCaseIdDuplicate', 'currentSemesterPrefix'], {
    Date: makeFixedDate('2026-06-15T00:00:00'),
    document: doc,
    casesData: [DUP_CASE],
    _editingCaseId: '1142003', // 正在編輯同一筆
    escHtml: (s) => String(s),
  });
  S.checkCaseIdDuplicate();
  assert.equal(doc._els['nc-id-message'].style.display, 'none');
});
