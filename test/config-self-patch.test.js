// config.json「SELF 類」自助欄位 PATCH 純函式測試（P1 延伸修復：configSelfPatch）。
// 對象：selfPatchKeyAllowed_（白名單決策，含 deny-list 雙重保險）、
//       stripLegacyNotifications_（v154 懶清理舊 users[*].notifications 欄位）。
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
  const sandbox = { JSON, Array, Object, String };
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(src, n)).join('\n\n'), sandbox);
  return sandbox;
}

// ── selfPatchKeyAllowed_ ─────────────────────────────────────────────────────

test('selfPatch：固定白名單 key（偏好/PIN/顯示設定）→ 放行', () => {
  const S = loadFromCodeGs(['selfPatchKeyAllowed_', '_selfPatchAllDigits_']);
  ['semesterPref', 'counselorFreqs', 'sortStatusLocked', 'recPageSize', 'recSortDesc',
   'todosUnclosedCollapsed', 'myAttTab', 'auditColsHidden', 'pin', 'pinTmo', 'pinSkipped',
   'confirmBeforeLeave', 'bkFreqs', 'counselorFreqMode', 'unassignedScanDate', 'mlTab',
   'bkViewMode', 'bkDaySpan', 'bkPageTab', 'bkCustomRooms', 'bkCustomOpts',
   'sidebarCollapsed', 'sidebarPinned', 'bkColor', 'bkColorGc', 'dismissedAlerts', 'gcAclSynced',
  ].forEach((k) => assert.equal(S.selfPatchKeyAllowed_(k), true, k));
});

test('selfPatch：授權欄位一律拒絕（deny-list 雙重保險，即使誤入白名單決策也擋下）', () => {
  const S = loadFromCodeGs(['selfPatchKeyAllowed_', '_selfPatchAllDigits_']);
  ['role', 'extraRole', 'isAdmin', 'disabled', 'allowedCases', 'allowedCasesSems',
   'isTransferContact', 'isMentalLeaveContact', 'leaveQuota', 'name',
  ].forEach((k) => assert.equal(S.selfPatchKeyAllowed_(k), false, k));
});

test('selfPatch：navOrder_ 動態前綴 → 放行；不含底線後綴的字面 navOrder → 拒絕', () => {
  const S = loadFromCodeGs(['selfPatchKeyAllowed_', '_selfPatchAllDigits_']);
  assert.equal(S.selfPatchKeyAllowed_('navOrder_sidebar1'), true);
  assert.equal(S.selfPatchKeyAllowed_('navOrder_'), true);
  assert.equal(S.selfPatchKeyAllowed_('navOrder'), false);
});

test('selfPatch：欄寬 key（ColWidths 結尾／ColWidths+純數字）→ 放行', () => {
  const S = loadFromCodeGs(['selfPatchKeyAllowed_', '_selfPatchAllDigits_']);
  ['crisisColWidths', 'casesColWidths', 'cnColWidths', 'auditColWidths',
   'psychDbColWidths', 'gtColWidths', 'tiColWidths', 'mlColWidths2',
  ].forEach((k) => assert.equal(S.selfPatchKeyAllowed_(k), true, k));
});

test('selfPatch：ColWidths 後接非數字字尾／key 開頭即 ColWidths（無前綴）→ 拒絕', () => {
  const S = loadFromCodeGs(['selfPatchKeyAllowed_', '_selfPatchAllDigits_']);
  assert.equal(S.selfPatchKeyAllowed_('xColWidthsFoo'), false);
  assert.equal(S.selfPatchKeyAllowed_('ColWidths'), false);
  assert.equal(S.selfPatchKeyAllowed_('ColWidths2'), false);
});

test('selfPatch：未知 key／空字串／非字串 → 拒絕（預設 deny，不炸）', () => {
  const S = loadFromCodeGs(['selfPatchKeyAllowed_', '_selfPatchAllDigits_']);
  assert.equal(S.selfPatchKeyAllowed_('someRandomField'), false);
  assert.equal(S.selfPatchKeyAllowed_(''), false);
  assert.equal(S.selfPatchKeyAllowed_(null), false);
  assert.equal(S.selfPatchKeyAllowed_(undefined), false);
});

// ── stripLegacyNotifications_ ────────────────────────────────────────────────

test('stripLegacy：有 users[*].notifications 殘留欄位 → 全部刪除，回傳 true', () => {
  const S = loadFromCodeGs(['stripLegacyNotifications_']);
  const cfg = { users: {
    'a@x.com': { role: '專任', notifications: [{ id: 'n1' }] },
    'b@x.com': { role: '主任', notifications: [] },
  } };
  const cleaned = S.stripLegacyNotifications_(cfg);
  assert.equal(cleaned, true);
  assert.equal('notifications' in cfg.users['a@x.com'], false);
  assert.equal('notifications' in cfg.users['b@x.com'], false);
  assert.equal(cfg.users['a@x.com'].role, '專任'); // 其他欄位不動
});

test('stripLegacy：無任何殘留欄位 → 回傳 false，內容不變', () => {
  const S = loadFromCodeGs(['stripLegacyNotifications_']);
  const cfg = { users: { 'a@x.com': { role: '專任' } } };
  const cleaned = S.stripLegacyNotifications_(cfg);
  assert.equal(cleaned, false);
  assert.deepEqual(cfg, { users: { 'a@x.com': { role: '專任' } } });
});

test('stripLegacy：cfg 為 null／users 非物件 → 回傳 false，不炸', () => {
  const S = loadFromCodeGs(['stripLegacyNotifications_']);
  assert.equal(S.stripLegacyNotifications_(null), false);
  assert.equal(S.stripLegacyNotifications_({}), false);
  assert.equal(S.stripLegacyNotifications_({ users: [] }), false);
});
