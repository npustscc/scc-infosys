// server/test/case-authz-shadow.test.js — R1 個案物件級授權判斷函式的移植正確性（parity）
// ＋Phase 1 shadow 模式行為（只記錄、原樣回傳，不真的剝除）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('../../test/harness');
const caseAuthz = require('../src/authz/caseAuthz');

function loadFromCodeGs(names) {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'dev', 'Code.gs'), 'utf8');
  const sandbox = { JSON, Array, Object, String, Date, isNaN };
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(src, n)).join('\n\n'), sandbox);
  return sandbox;
}

const VIS_FNS = ['caseVisibleToUser_', 'caseLatestCounselorEmail_', 'caseLatestSemCounselorEmails_',
  'semKeyBase_', 'isInitialInterviewerOfCase_', 'openDateToSemPrefix_'];

test('parity：caseVisibleToUser 與 GAS caseVisibleToUser_ 對一組案例矩陣結果一致', () => {
  const G = loadFromCodeGs(VIS_FNS);
  const cases = [
    [{ id: '1', openDate: '2026-06-01' }, 'anyone@x.tw', {}], // 未派案全員可見
    [{ id: '2', counselorEmail: 'a@x.tw' }, 'a@x.tw', {}],     // 主責可見
    [{ id: '2', counselorEmail: 'a@x.tw' }, 'b@x.tw', {}],     // 他人不可見
    [{ id: '3', counselorEmail: 'a@x.tw' }, 'b@x.tw', { 'b@x.tw': { allowedCases: ['3'] } }], // 個管
    [{ id: '4' }, '', {}], // 無 email
  ];
  for (const [c, email, users] of cases) {
    assert.equal(caseAuthz.caseVisibleToUser(c, email, users), G.caseVisibleToUser_(c, email, users));
  }
});

test('parity：caseFullAccessRole 與 GAS caseFullAccessRole_ 一致', () => {
  const G = loadFromCodeGs(['caseFullAccessRole_']);
  const users = { 'a@x.tw': { role: '主任' }, 'b@x.tw': { role: '系統管理者' }, 'c@x.tw': { role: '主任', disabled: true }, 'd@x.tw': { role: '專任諮商心理師' } };
  for (const email of ['a@x.tw', 'b@x.tw', 'c@x.tw', 'd@x.tw', 'nosuch@x.tw']) {
    assert.equal(caseAuthz.caseFullAccessRole(email, users), G.caseFullAccessRole_(email, users));
  }
});

test('caseStripForRead：只保留白名單欄位＋_authzStripped 標記，剝除臨床內容', () => {
  const c = {
    id: '1', name: '王小明', counselorEmail: 'a@x.tw', status: 'active',
    records: [{ note: '極機密臨床筆記' }], // 應被剝除
    idNumber: 'A123456789', phone: '0912345678', // 應被剝除（最敏感 PII）
  };
  const out = caseAuthz.caseStripForRead(c);
  assert.equal(out._authzStripped, true);
  assert.equal(out.id, '1');
  assert.equal(out.counselorEmail, 'a@x.tw');
  assert.equal(out.records, undefined);
  assert.equal(out.idNumber, undefined);
  assert.equal(out.phone, undefined);
});

test('applyCaseAuthz：shadow 模式——原樣回傳完整內容，即使有筆會被剝除也只觸發 callback', () => {
  const parsed = {
    cases: [
      { id: '1', counselorEmail: 'a@x.tw' }, // 對 b 而言不可見
    ],
  };
  let shadowCount = null;
  const out = caseAuthz.applyCaseAuthz(parsed, 'b@x.tw', {}, [], '2026-07-14', 'shadow', (count) => { shadowCount = count; }, 'test-label');
  assert.deepEqual(out, parsed, 'shadow 模式應原樣回傳，不剝除');
  assert.equal(shadowCount, 1, '應透過 callback 記錄本應剝除的筆數');
});

test('applyCaseAuthz：enforce 模式——實際剝除無權查閱的個案（供未來切換時驗證用，Phase 1 骨架預設不啟用）', () => {
  const parsed = { cases: [{ id: '1', counselorEmail: 'a@x.tw', records: ['secret'] }] };
  const out = caseAuthz.applyCaseAuthz(parsed, 'b@x.tw', {}, [], '2026-07-14', 'enforce', null, 'test-label');
  assert.equal(out.cases[0]._authzStripped, true);
  assert.equal(out.cases[0].records, undefined);
});

test('applyCaseAuthz：full-access 角色完全不受影響（不論 shadow/enforce）', () => {
  const parsed = { cases: [{ id: '1', counselorEmail: 'a@x.tw', records: ['secret'] }] };
  const users = { 'admin@x.tw': { role: '主任' } };
  const out = caseAuthz.applyCaseAuthz(parsed, 'admin@x.tw', users, [], '2026-07-14', 'enforce', null, 'test-label');
  assert.deepEqual(out, parsed);
});

test('applyCaseAuthz：非個案檔（無 .cases 陣列）原樣回傳，不誤判', () => {
  const notACaseFile = { items: [1, 2, 3] };
  const out = caseAuthz.applyCaseAuthz(notACaseFile, 'b@x.tw', {}, [], '2026-07-14', 'enforce', null, 'test-label');
  assert.deepEqual(out, notACaseFile);
});

test('applyCaseAuthz：危機閱讀 carve-out——當日本人該 caseId 的 grant 放行原樣內容', () => {
  const parsed = { cases: [{ id: '1', counselorEmail: 'a@x.tw', records: ['secret'] }] };
  const grants = [{ type: 'grant', email: 'b@x.tw', caseId: '1', t: '2026-07-14T10:00:00Z' }];
  const out = caseAuthz.applyCaseAuthz(parsed, 'b@x.tw', {}, grants, '2026-07-14', 'enforce', null, 'test-label');
  assert.deepEqual(out.cases[0], parsed.cases[0], '有當日 grant 應原樣放行，不剝除');
});
