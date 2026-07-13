// R1（後端個案物件級授權，IDOR 修補第一階段 shadow 模式）純函式單元測試。
// 執行：node --test test/*.test.js
// 測試對象從 dev/Code.gs 就地抽出（harness.extractFunction），改壞正式碼即紅燈。
// 對照 test/case-visibility.test.js（前端 _caseVisibleToUser 等）——本檔測後端照移植的等價函式，
// 語意須完全一致；額外覆蓋 full-access 角色與危機當日 grant carve-out。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./harness');

function loadFromCodeGs(names) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dev', 'Code.gs'), 'utf8');
  const sandbox = { JSON, Array, Object, String, Date, isNaN };
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(src, n)).join('\n\n'), sandbox);
  return sandbox;
}

const VIS_FNS = [
  'caseVisibleToUser_',
  'caseLatestCounselorEmail_',
  'caseLatestSemCounselorEmails_',
  'semKeyBase_',
  'isInitialInterviewerOfCase_',
  'openDateToSemPrefix_',
];
const ALLOW_FNS = [...VIS_FNS, 'caseFullAccessRole_', 'caseHasCrisisGrant_', 'caseAllowedForRead_'];

function loadVis() { return loadFromCodeGs(VIS_FNS); }
function loadAllow() { return loadFromCodeGs(ALLOW_FNS); }

// ── caseVisibleToUser_：非 full-access 使用者的可見性單一真相 ────────────────

test('caseVisibleToUser_：無 email 一律不可見', () => {
  const S = loadVis();
  assert.equal(S.caseVisibleToUser_({ id: '1142001' }, '', {}), false);
});

test('caseVisibleToUser_：未派案（無主責）全員可見', () => {
  const S = loadVis();
  const c = { id: '1142001', openDate: '2026-06-01' };
  assert.equal(S.caseVisibleToUser_(c, 'anyone@x.tw', {}), true);
});

test('caseVisibleToUser_：主責本人可見、他人不可見', () => {
  const S = loadVis();
  const c = { id: '1142001', counselorEmail: 'a@x.tw' };
  assert.equal(S.caseVisibleToUser_(c, 'a@x.tw', {}), true);
  assert.equal(S.caseVisibleToUser_(c, 'b@x.tw', {}), false);
});

test('caseVisibleToUser_：以「最新學期快照」為準，舊學期主責不可見', () => {
  const S = loadVis();
  const c = {
    id: '1141005',
    counselorEmail: 'old@x.tw',
    semesters: ['1141', '1142'],
    basicInfoSnapshots: { 1141: { counselorEmail: 'old@x.tw' }, 1142: { counselorEmail: 'new@x.tw' } },
  };
  assert.equal(S.caseVisibleToUser_(c, 'new@x.tw', {}), true);
  assert.equal(S.caseVisibleToUser_(c, 'old@x.tw', {}), false);
});

test('caseVisibleToUser_：同 base 學期多筆開案（#N）各主責互相可見；第三者不可見', () => {
  const S = loadVis();
  const c = {
    id: '1141005',
    semesters: ['1141#1', '1141#2'],
    basicInfoSnapshots: { '1141#1': { counselorEmail: 'a@x.tw' }, '1141#2': { counselorEmail: 'b@x.tw' } },
  };
  assert.equal(S.caseVisibleToUser_(c, 'a@x.tw', {}), true);
  assert.equal(S.caseVisibleToUser_(c, 'b@x.tw', {}), true);
  assert.equal(S.caseVisibleToUser_(c, 'c@x.tw', {}), false);
});

test('caseVisibleToUser_：allowedCases（手動個管）可見', () => {
  const S = loadVis();
  const c = { id: '1142001', counselorEmail: 'a@x.tw' };
  const users = { 'mgr@x.tw': { allowedCases: ['1142001'] } };
  assert.equal(S.caseVisibleToUser_(c, 'mgr@x.tw', users), true);
  assert.equal(S.caseVisibleToUser_(c, 'other@x.tw', users), false);
});

test('caseVisibleToUser_：初次晤談者可見（完整資料與 index-only 皆支援）', () => {
  const S = loadVis();
  const c1 = { id: '1142001', counselorEmail: 'a@x.tw', initialInterview: { interviewerEmail: 'ii@x.tw' } };
  assert.equal(S.caseVisibleToUser_(c1, 'ii@x.tw', {}), true);
  const c2 = { id: '1142002', counselorEmail: 'a@x.tw', initialInterviews: { 1142: { interviewerEmail: 'ii@x.tw' } } };
  assert.equal(S.caseVisibleToUser_(c2, 'ii@x.tw', {}), true);
  const c3 = { id: '1142003', counselorEmail: 'a@x.tw', interviewerEmails: ['ii@x.tw'] };
  assert.equal(S.caseVisibleToUser_(c3, 'ii@x.tw', {}), true);
  assert.equal(S.caseVisibleToUser_(c3, 'other@x.tw', {}), false);
});

test('caseVisibleToUser_：督導（superviseeEmails 含主責）可見', () => {
  const S = loadVis();
  const users = { 'sup@x.tw': { superviseeEmails: ['intern@x.tw'] } };
  const c = { id: '1142001', counselorEmail: 'intern@x.tw' };
  assert.equal(S.caseVisibleToUser_(c, 'sup@x.tw', users), true);
  assert.equal(S.caseVisibleToUser_(c, 'notsup@x.tw', users), false);
});

test('caseVisibleToUser_：義輔窗口對「主責為義務輔導老師」的案一律可見', () => {
  const S = loadVis();
  const users = {
    'vc@x.tw': { isVolunteerContact: true },
    'vol@x.tw': { role: '義務輔導老師' },
    'ft@x.tw': { role: '專任心理師' },
  };
  const cVol = { id: '1142001', counselorEmail: 'vol@x.tw' };
  const cFt = { id: '1142002', counselorEmail: 'ft@x.tw' };
  assert.equal(S.caseVisibleToUser_(cVol, 'vc@x.tw', users), true);
  assert.equal(S.caseVisibleToUser_(cFt, 'vc@x.tw', users), false);
  assert.equal(S.caseVisibleToUser_(cVol, 'ft@x.tw', users), false);
});

test('caseVisibleToUser_：無任何關係的路人 → 不可見', () => {
  const S = loadVis();
  const c = { id: '1142001', counselorEmail: 'a@x.tw' };
  const users = { 'stranger@x.tw': {} };
  assert.equal(S.caseVisibleToUser_(c, 'stranger@x.tw', users), false);
});

// ── caseFullAccessRole_：看全部角色判定（fail-closed） ───────────────────────

test('caseFullAccessRole_：主任／系統管理者／isAdmin／extraRole 管理者 → true', () => {
  const S = loadAllow();
  assert.equal(S.caseFullAccessRole_('a@x.tw', { 'a@x.tw': { role: '主任' } }), true);
  assert.equal(S.caseFullAccessRole_('b@x.tw', { 'b@x.tw': { role: '系統管理者' } }), true);
  assert.equal(S.caseFullAccessRole_('c@x.tw', { 'c@x.tw': { role: '專任諮商心理師', isAdmin: true } }), true);
  assert.equal(S.caseFullAccessRole_('d@x.tw', { 'd@x.tw': { role: '專任諮商心理師', extraRole: '管理者' } }), true);
});

test('caseFullAccessRole_：一般角色 → false', () => {
  const S = loadAllow();
  assert.equal(S.caseFullAccessRole_('a@x.tw', { 'a@x.tw': { role: '專任諮商心理師' } }), false);
});

test('caseFullAccessRole_：停用的 full-access 帳號 → false（fail-closed，不享全看）', () => {
  const S = loadAllow();
  assert.equal(S.caseFullAccessRole_('a@x.tw', { 'a@x.tw': { role: '主任', disabled: true } }), false);
});

test('caseFullAccessRole_：查無此人／users 缺漏 → false', () => {
  const S = loadAllow();
  assert.equal(S.caseFullAccessRole_('nobody@x.tw', {}), false);
  assert.equal(S.caseFullAccessRole_('nobody@x.tw', null), false);
});

// ── caseHasCrisisGrant_ / caseAllowedForRead_：危機當日 grant 與綜合判定 ─────

test('caseHasCrisisGrant_：當日、本人、該 caseId 的 grant → true', () => {
  const S = loadAllow();
  const entries = [{ type: 'grant', email: 'a@x.tw', caseId: '1142001', t: '2026-07-13T09:00:00.000Z' }];
  assert.equal(S.caseHasCrisisGrant_('1142001', 'a@x.tw', entries, '2026-07-13'), true);
});

test('caseHasCrisisGrant_：非當日／非本人／非該 caseId／非 grant type → false', () => {
  const S = loadAllow();
  const entries = [{ type: 'grant', email: 'a@x.tw', caseId: '1142001', t: '2026-07-12T09:00:00.000Z' }];
  assert.equal(S.caseHasCrisisGrant_('1142001', 'a@x.tw', entries, '2026-07-13'), false); // 非當日
  assert.equal(S.caseHasCrisisGrant_('1142001', 'b@x.tw', [{ type: 'grant', email: 'a@x.tw', caseId: '1142001', t: '2026-07-13' }], '2026-07-13'), false); // 非本人
  assert.equal(S.caseHasCrisisGrant_('1142999', 'a@x.tw', [{ type: 'grant', email: 'a@x.tw', caseId: '1142001', t: '2026-07-13' }], '2026-07-13'), false); // 非該 caseId
  assert.equal(S.caseHasCrisisGrant_('1142001', 'a@x.tw', [{ type: 'read', email: 'a@x.tw', caseId: '1142001', t: '2026-07-13' }], '2026-07-13'), false); // 非 grant
});

test('caseAllowedForRead_：full-access 使用者對任何案（含路人）都放行', () => {
  const S = loadAllow();
  const users = { 'admin@x.tw': { role: '主任' } };
  const c = { id: '1142001', counselorEmail: 'someone-else@x.tw' };
  assert.equal(S.caseAllowedForRead_(c, 'admin@x.tw', users, [], '2026-07-13'), true);
});

test('caseAllowedForRead_：可見性放行（主責）', () => {
  const S = loadAllow();
  const users = { 'a@x.tw': { role: '專任諮商心理師' } };
  const c = { id: '1142001', counselorEmail: 'a@x.tw' };
  assert.equal(S.caseAllowedForRead_(c, 'a@x.tw', users, [], '2026-07-13'), true);
});

test('caseAllowedForRead_：無關係但當日有危機 grant → 放行', () => {
  const S = loadAllow();
  const users = { 'a@x.tw': { role: '專任諮商心理師' } };
  const c = { id: '1142001', counselorEmail: 'other@x.tw' };
  const entries = [{ type: 'grant', email: 'a@x.tw', caseId: '1142001', t: '2026-07-13' }];
  assert.equal(S.caseAllowedForRead_(c, 'a@x.tw', users, entries, '2026-07-13'), true);
});

test('caseAllowedForRead_：無任何關係的路人、無 grant → 拒絕', () => {
  const S = loadAllow();
  const users = { 'stranger@x.tw': { role: '專任諮商心理師' } };
  const c = { id: '1142001', counselorEmail: 'a@x.tw' };
  assert.equal(S.caseAllowedForRead_(c, 'stranger@x.tw', users, [], '2026-07-13'), false);
});

test('caseAllowedForRead_：未派案的案（無主責）→ 全員可見，任何人皆放行', () => {
  const S = loadAllow();
  const users = { 'anyone@x.tw': { role: '專任諮商心理師' } };
  const c = { id: '1142001', openDate: '2026-06-01' };
  assert.equal(S.caseAllowedForRead_(c, 'anyone@x.tw', users, [], '2026-07-13'), true);
});

// ── caseStripForRead_（R1 enforce）：無權查閱者只保留 metadata、剝除臨床與敏感 PII ──

function loadStrip() { return loadFromCodeGs(['caseStripForRead_']); }

test('caseStripForRead_：保留 metadata（案號/姓名/學號/主責/狀態/AB/學期）', () => {
  const S = loadStrip();
  const c = { id: '1142001', name: '王小明', studentId: 'S123', counselorEmail: 'a@x.tw',
    status: '進行中', abType: 'A案', semesters: ['1142'], department: '資工系' };
  const out = S.caseStripForRead_(c);
  assert.equal(out.id, '1142001');
  assert.equal(out.name, '王小明');
  assert.equal(out.studentId, 'S123');
  assert.equal(out.counselorEmail, 'a@x.tw');
  assert.equal(out.status, '進行中');
  assert.equal(out.abType, 'A案');
  assert.deepEqual(out.semesters, ['1142']);
  assert.equal(out._authzStripped, true);
});

test('caseStripForRead_：剝除臨床內容（records/精神科/初談/評估）與敏感 PII（idNumber/phone）', () => {
  const S = loadStrip();
  const c = {
    id: '1142001', name: '王小明', idNumber: 'A123456789', phone: '0912345678',
    records: [{ date: '2026-07-01', note: '晤談內容' }],
    psychiatristRecords: [{ date: '2026-07-02' }],
    initialInterview: { interviewerEmail: 'e@x.tw', content: '初談內容' },
    initialInterviews: { '1142': { content: 'x' } },
    semesterEvaluations: [{ sem: '1142', text: '評估' }],
  };
  const out = S.caseStripForRead_(c);
  assert.equal(out.idNumber, undefined, 'idNumber 應被剝除');
  assert.equal(out.phone, undefined, 'phone 應被剝除');
  assert.equal(out.records, undefined, 'records 應被剝除');
  assert.equal(out.psychiatristRecords, undefined);
  assert.equal(out.initialInterview, undefined);
  assert.equal(out.initialInterviews, undefined);
  assert.equal(out.semesterEvaluations, undefined);
});

test('caseStripForRead_：basicInfoSnapshots 只留 counselorEmail/abType、剝掉其餘臨床基本資料', () => {
  const S = loadStrip();
  const c = { id: '1142001', basicInfoSnapshots: { '1142': {
    counselorEmail: 'a@x.tw', abType: 'B案', mainConcern: '主述臨床內容', familyInfo: '家庭狀況' } } };
  const out = S.caseStripForRead_(c);
  assert.deepEqual(out.basicInfoSnapshots['1142'], { counselorEmail: 'a@x.tw', abType: 'B案' });
  assert.equal(out.basicInfoSnapshots['1142'].mainConcern, undefined);
  assert.equal(out.basicInfoSnapshots['1142'].familyInfo, undefined);
});
