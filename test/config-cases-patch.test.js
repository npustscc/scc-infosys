// config.json「CASES 類」個案存取授權 PATCH 純函式測試（v164：非管理者整檔寫入全面收口）。
// 對象：applyCasesPatchOps_（宣告式 ops 套用到 users 物件，供 configCasesPatch_ 在 LockService
//       鎖內呼叫）、_nomailAddOk_（v164 起改供其 nomailAdd op 使用）。
// 執行：node --test test/*.test.js
// 測試對象從 dev/Code.gs 就地抽出（harness.extractFunction），改壞正式碼即紅燈。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./harness');

function loadFromCodeGs(names) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dev', 'Code.gs'), 'utf8');
  const sandbox = { JSON, Array, Object, String, Date };
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(src, n)).join('\n\n'), sandbox);
  return sandbox;
}

const FNS = ['applyCasesPatchOps_', '_casesPatchEmailSane_', '_nomailAddOk_'];

// ── caseAccessUpsert ──────────────────────────────────────────────────────────

test('caseAccessUpsert：既有使用者、無 sems → 加入 allowedCases、extraRole 補為個案管理員', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': { role: '兼任諮商心理師' } };
  S.applyCasesPatchOps_(users, [{ type: 'caseAccessUpsert', email: 'a@x.com', caseId: '1141001' }], 'boss@x.com');
  assert.deepEqual(users['a@x.com'].allowedCases, ['1141001']);
  assert.equal(users['a@x.com'].extraRole, '個案管理員');
});

test('caseAccessUpsert：已有其他 extraRole（如督導）→ 不覆寫', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': { role: '實習諮商心理師', extraRole: '實習生行政督導' } };
  S.applyCasesPatchOps_(users, [{ type: 'caseAccessUpsert', email: 'a@x.com', caseId: '1141001' }], 'boss@x.com');
  assert.equal(users['a@x.com'].extraRole, '實習生行政督導');
});

test('caseAccessUpsert：帶 sems → union 進 allowedCasesSems（去重）；再次呼叫冪等', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': { role: '兼任諮商心理師', allowedCasesSems: { '1141001': ['1141'] } } };
  S.applyCasesPatchOps_(users, [{ type: 'caseAccessUpsert', email: 'a@x.com', caseId: '1141001', sems: ['1142', '1141'] }], 'boss@x.com');
  assert.deepEqual(users['a@x.com'].allowedCasesSems['1141001'].sort(), ['1141', '1142']);
});

test('caseAccessUpsert：caseId 重複加入不重複、email 條目不存在 → throw', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': { allowedCases: ['1141001'] } };
  S.applyCasesPatchOps_(users, [{ type: 'caseAccessUpsert', email: 'a@x.com', caseId: '1141001' }], 'boss@x.com');
  assert.deepEqual(users['a@x.com'].allowedCases, ['1141001']);
  assert.throws(() => S.applyCasesPatchOps_({ 'a@x.com': {} }, [{ type: 'caseAccessUpsert', email: 'ghost@x.com', caseId: '1141001' }], 'boss@x.com'));
});

test('caseAccessUpsert：email 格式不 sane（無 @ 也非 nomail_ 前綴）→ throw', () => {
  const S = loadFromCodeGs(FNS);
  assert.throws(() => S.applyCasesPatchOps_({ 'a@x.com': {} }, [{ type: 'caseAccessUpsert', email: 'plainstring', caseId: '1141001' }], 'boss@x.com'));
});

// ── caseAccessRemove ──────────────────────────────────────────────────────────

test('caseAccessRemove：移除 caseId 與對應 sems；allowedCases 因此清空 → 一併刪 extraRole（若為個案管理員）', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': { allowedCases: ['1141001'], allowedCasesSems: { '1141001': ['1141'] }, extraRole: '個案管理員' } };
  S.applyCasesPatchOps_(users, [{ type: 'caseAccessRemove', email: 'a@x.com', caseId: '1141001' }], 'boss@x.com');
  assert.equal('allowedCases' in users['a@x.com'], false);
  assert.equal('allowedCasesSems' in users['a@x.com'], false);
  assert.equal('extraRole' in users['a@x.com'], false);
});

test('caseAccessRemove：仍有其他案號時不刪 allowedCases/extraRole', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': { allowedCases: ['1141001', '1141002'], extraRole: '個案管理員' } };
  S.applyCasesPatchOps_(users, [{ type: 'caseAccessRemove', email: 'a@x.com', caseId: '1141001' }], 'boss@x.com');
  assert.deepEqual(users['a@x.com'].allowedCases, ['1141002']);
  assert.equal(users['a@x.com'].extraRole, '個案管理員');
});

test('caseAccessRemove：extraRole 非「個案管理員」（如督導兼個管）→ 清空後不誤刪其 extraRole', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': { allowedCases: ['1141001'], extraRole: '實習生行政督導' } };
  S.applyCasesPatchOps_(users, [{ type: 'caseAccessRemove', email: 'a@x.com', caseId: '1141001' }], 'boss@x.com');
  assert.equal('allowedCases' in users['a@x.com'], false);
  assert.equal(users['a@x.com'].extraRole, '實習生行政督導');
});

test('caseAccessRemove：使用者不存在 → throw', () => {
  const S = loadFromCodeGs(FNS);
  assert.throws(() => S.applyCasesPatchOps_({ 'a@x.com': {} }, [{ type: 'caseAccessRemove', email: 'ghost@x.com', caseId: '1141001' }], 'boss@x.com'));
});

// ── caseAccessSemsSet ─────────────────────────────────────────────────────────

test('caseAccessSemsSet：caseId 已在 allowedCases → 整組覆寫（去重）', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': { allowedCases: ['1141001'], allowedCasesSems: { '1141001': ['1141'] } } };
  S.applyCasesPatchOps_(users, [{ type: 'caseAccessSemsSet', email: 'a@x.com', caseId: '1141001', sems: ['1142', '1142', '1151'] }], 'boss@x.com');
  assert.deepEqual(users['a@x.com'].allowedCasesSems['1141001'].sort(), ['1142', '1151']);
});

test('caseAccessSemsSet：sems 傳空陣列/null → 刪除該 key（回復不限學期）', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': { allowedCases: ['1141001'], allowedCasesSems: { '1141001': ['1141'] } } };
  S.applyCasesPatchOps_(users, [{ type: 'caseAccessSemsSet', email: 'a@x.com', caseId: '1141001', sems: [] }], 'boss@x.com');
  assert.equal('allowedCasesSems' in users['a@x.com'], false);
});

test('caseAccessSemsSet：caseId 不在該使用者 allowedCases → throw', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': { allowedCases: ['1141002'] } };
  assert.throws(() => S.applyCasesPatchOps_(users, [{ type: 'caseAccessSemsSet', email: 'a@x.com', caseId: '1141001', sems: ['1141'] }], 'boss@x.com'));
});

// ── caseIdRemap ───────────────────────────────────────────────────────────────

test('caseIdRemap：多個使用者的 allowedCases/allowedCasesSems 一併 remap＋合併去重', () => {
  const S = loadFromCodeGs(FNS);
  const users = {
    'a@x.com': { allowedCases: ['1141001', '1141002'], allowedCasesSems: { '1141001': ['1141'] } },
    'b@x.com': { allowedCases: ['1141002'] }, // 不含 oldId，不受影響
    'c@x.com': { allowedCases: ['1141001'], allowedCasesSems: { '1141001': ['1142'] } },
  };
  S.applyCasesPatchOps_(users, [{ type: 'caseIdRemap', fromId: '1141001', toId: '1141099' }], 'boss@x.com');
  assert.deepEqual(users['a@x.com'].allowedCases.sort(), ['1141002', '1141099']);
  assert.deepEqual(users['a@x.com'].allowedCasesSems, { '1141099': ['1141'] });
  assert.deepEqual(users['b@x.com'].allowedCases, ['1141002']);
  assert.deepEqual(users['c@x.com'].allowedCasesSems, { '1141099': ['1142'] });
});

test('caseIdRemap：目標 id 已存在於某使用者的 allowedCases → 合併去重不重複', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': { allowedCases: ['1141001', '1141099'], allowedCasesSems: { '1141001': ['1141'], '1141099': ['1142'] } } };
  S.applyCasesPatchOps_(users, [{ type: 'caseIdRemap', fromId: '1141001', toId: '1141099' }], 'boss@x.com');
  assert.deepEqual(users['a@x.com'].allowedCases, ['1141099']);
  assert.deepEqual(users['a@x.com'].allowedCasesSems['1141099'].sort(), ['1141', '1142']);
});

test('caseIdRemap：fromId/toId 缺漏 → throw', () => {
  const S = loadFromCodeGs(FNS);
  assert.throws(() => S.applyCasesPatchOps_({ 'a@x.com': {} }, [{ type: 'caseIdRemap', fromId: '', toId: '1141099' }], 'boss@x.com'));
  assert.throws(() => S.applyCasesPatchOps_({ 'a@x.com': {} }, [{ type: 'caseIdRemap', fromId: '1141001' }], 'boss@x.com'));
});

// ── nomailAdd ─────────────────────────────────────────────────────────────────

test('nomailAdd：合法佔位條目 → 新增', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': {} };
  S.applyCasesPatchOps_(users, [{ type: 'nomailAdd', email: 'nomail_123_ab', entry: { name: '王老師', role: '義務輔導老師', disabled: false } }], 'a@x.com');
  assert.deepEqual(users['nomail_123_ab'], { name: '王老師', role: '義務輔導老師', disabled: false });
});

test('nomailAdd：條目已存在 → throw', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'nomail_123_ab': { name: '舊' } };
  assert.throws(() => S.applyCasesPatchOps_(users, [{ type: 'nomailAdd', email: 'nomail_123_ab', entry: { name: '王', role: '義務輔導老師' } }], 'a@x.com'));
});

test('nomailAdd：entry 夾帶特權欄位（isAdmin/主任）→ throw（_nomailAddOk_ 把關）', () => {
  const S = loadFromCodeGs(FNS);
  assert.throws(() => S.applyCasesPatchOps_({}, [{ type: 'nomailAdd', email: 'nomail_1_a', entry: { name: 'x', role: '義務輔導老師', isAdmin: true } }], 'a@x.com'));
  assert.throws(() => S.applyCasesPatchOps_({}, [{ type: 'nomailAdd', email: 'nomail_1_a', entry: { name: 'x', role: '主任' } }], 'a@x.com'));
});

// ── selfRename ────────────────────────────────────────────────────────────────

test('selfRename：把呼叫者本人條目搬到 toEmail，附加 previousEmails（伺服器端計算，不受 params 內容影響）', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'old@x.com': { role: '專任諮商心理師', pin: '1111', allowedCases: ['1141001'] } };
  S.applyCasesPatchOps_(users, [{ type: 'selfRename', toEmail: 'new@x.com', role: '主任', isAdmin: true }], 'old@x.com');
  assert.equal('old@x.com' in users, false);
  assert.equal(users['new@x.com'].role, '專任諮商心理師'); // 惡意夾帶的 role/isAdmin 完全被忽略
  assert.equal(users['new@x.com'].isAdmin, undefined);
  assert.equal(users['new@x.com'].pin, '1111');
  assert.deepEqual(users['new@x.com'].allowedCases, ['1141001']);
  assert.equal(users['new@x.com'].previousEmails.length, 1);
  assert.equal(users['new@x.com'].previousEmails[0].email, 'old@x.com');
});

test('selfRename：toEmail 已存在 → throw', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'old@x.com': { role: '專任諮商心理師' }, 'new@x.com': { role: '主任' } };
  assert.throws(() => S.applyCasesPatchOps_(users, [{ type: 'selfRename', toEmail: 'new@x.com' }], 'old@x.com'));
});

test('selfRename：呼叫者條目不存在（callerEmail 對不到 users）→ throw', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'b@x.com': {} };
  assert.throws(() => S.applyCasesPatchOps_(users, [{ type: 'selfRename', toEmail: 'new@x.com' }], 'ghost@x.com'));
});

test('selfRename：toEmail 格式不 sane → throw', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'old@x.com': { role: '專任諮商心理師' } };
  assert.throws(() => S.applyCasesPatchOps_(users, [{ type: 'selfRename', toEmail: 'not-an-email' }], 'old@x.com'));
});

// ── 通用驗證：未知 type／空 ops／非陣列 ──────────────────────────────────────

test('未知 op type → throw（fail-closed，不做部分套用）', () => {
  const S = loadFromCodeGs(FNS);
  assert.throws(() => S.applyCasesPatchOps_({ 'a@x.com': {} }, [{ type: 'grantAdmin', email: 'a@x.com' }], 'a@x.com'));
});

test('ops 為空陣列／非陣列／users 非物件 → throw', () => {
  const S = loadFromCodeGs(FNS);
  assert.throws(() => S.applyCasesPatchOps_({ 'a@x.com': {} }, [], 'a@x.com'));
  assert.throws(() => S.applyCasesPatchOps_({ 'a@x.com': {} }, null, 'a@x.com'));
  assert.throws(() => S.applyCasesPatchOps_(null, [{ type: 'caseAccessUpsert', email: 'a@x.com', caseId: '1' }], 'a@x.com'));
});

test('第一個 op 成功套用、第二個 op 驗證失敗 → 整批 throw（呼叫端鎖內不會寫回半套結果）', () => {
  const S = loadFromCodeGs(FNS);
  const users = { 'a@x.com': {} };
  assert.throws(() => S.applyCasesPatchOps_(users, [
    { type: 'caseAccessUpsert', email: 'a@x.com', caseId: '1141001' },
    { type: 'caseAccessUpsert', email: 'ghost@x.com', caseId: '1141001' },
  ], 'a@x.com'));
  // 純函式本身不保證 atomic rollback（呼叫端靠「throw 就不 driveUpdateContent_」達成 fail-closed），
  // 這裡只驗證第二個 op 確實會讓整體呼叫拋出例外。
});

// ── _nomailAddOk_（v164 起改供 nomailAdd op 使用；沿用既有驗證邏輯）──────────

test('_nomailAddOk_：合法佔位帳號 → true；特權欄位／非 nomail_ 前綴 → false', () => {
  const S = loadFromCodeGs(FNS);
  assert.equal(S._nomailAddOk_('nomail_1_a', { name: 'x', role: '義務輔導老師', disabled: false }), true);
  assert.equal(S._nomailAddOk_('plain@x.com', { name: 'x', role: '義務輔導老師' }), false);
  assert.equal(S._nomailAddOk_('nomail_1_a', { name: 'x', role: '主任' }), false);
  assert.equal(S._nomailAddOk_('nomail_1_a', { name: 'x', role: '義務輔導老師', isAdmin: true }), false);
});
