// v167：非台灣登入自動鎖定／定位失敗雙向提醒——純決策函式單元測試。
// 執行：node --test test/*.test.js
// 測試對象從 dev/Code.gs 就地抽出（harness.extractFunction），改壞正式碼即紅燈。
// geoLockDecision_／geoEmptyNoticeDecision_ 皆為純決策（不碰 UrlFetchApp/CacheService/MailApp），
// 故可在 vm sandbox 直接跑。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./harness');

function loadFromCodeGs(names) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dev', 'Code.gs'), 'utf8');
  const sandbox = { JSON, Array, Object, String, Number, Math };
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(src, n)).join('\n\n'), sandbox);
  return sandbox;
}

// ── geoLockDecision_：非台灣登入鎖定判斷 ──

test('geoLockDecision_：cc=TW → 不鎖', () => {
  const S = loadFromCodeGs(['geoLockDecision_']);
  assert.equal(S.geoLockDecision_('Kaohsiung, Taiwan', 'TW').lock, false);
  assert.equal(S.geoLockDecision_('', 'TW').lock, false);
});

test('geoLockDecision_：cc 非 TW（US/JP）→ 鎖', () => {
  const S = loadFromCodeGs(['geoLockDecision_']);
  assert.equal(S.geoLockDecision_('Los Angeles, California, United States', 'US').lock, true);
  assert.equal(S.geoLockDecision_('Tokyo, Japan', 'JP').lock, true);
});

test('geoLockDecision_：cc 空、geo 以 Taiwan 結尾（舊前端相容）→ 不鎖', () => {
  const S = loadFromCodeGs(['geoLockDecision_']);
  assert.equal(S.geoLockDecision_('Kaohsiung, Takao, Taiwan', '').lock, false);
});

test('geoLockDecision_：cc 空、geo 不以 Taiwan 結尾 → 鎖', () => {
  const S = loadFromCodeGs(['geoLockDecision_']);
  assert.equal(S.geoLockDecision_('Los Angeles, California, United States', '').lock, true);
});

test('geoLockDecision_：geo 與 cc 皆空（查詢失敗）→ 不鎖（改由定位失敗提醒處理）', () => {
  const S = loadFromCodeGs(['geoLockDecision_']);
  assert.equal(S.geoLockDecision_('', '').lock, false);
  assert.equal(S.geoLockDecision_(undefined, undefined).lock, false);
  assert.equal(S.geoLockDecision_(null, null).lock, false);
});

test('geoLockDecision_：cc 大小寫/前後空白容錯', () => {
  const S = loadFromCodeGs(['geoLockDecision_']);
  assert.equal(S.geoLockDecision_('', ' tw ').lock, false);
  assert.equal(S.geoLockDecision_('', ' us ').lock, true);
});

test('geoLockDecision_：geo 大小寫/前後空白容錯（結尾比對 taiwan）', () => {
  const S = loadFromCodeGs(['geoLockDecision_']);
  assert.equal(S.geoLockDecision_('  Kaohsiung, TAIWAN  ', '').lock, false);
  assert.equal(S.geoLockDecision_('Kaohsiung, taiwan', '').lock, false);
});

test('geoLockDecision_：cc 非空時優先於 geo（即使 geo 結尾像 Taiwan，cc 說了算）', () => {
  const S = loadFromCodeGs(['geoLockDecision_']);
  // 極端情境：geo 字串誤帶 Taiwan 字樣但 cc 明確非台灣 → 仍鎖（cc 判斷優先）
  assert.equal(S.geoLockDecision_('Some City, Taiwan', 'US').lock, true);
});

// ── geoEmptyNoticeDecision_：定位失敗雙向提醒的 7 天冷卻 ──

const DAY_MS = 24 * 3600 * 1000;

test('geoEmptyNoticeDecision_：無歷史紀錄 → 提醒', () => {
  const S = loadFromCodeGs(['geoEmptyNoticeDecision_']);
  assert.equal(S.geoEmptyNoticeDecision_([], Date.now()), true);
  assert.equal(S.geoEmptyNoticeDecision_(null, Date.now()), true);
});

test('geoEmptyNoticeDecision_：距上次提醒 < 7 天 → 不提醒', () => {
  const S = loadFromCodeGs(['geoEmptyNoticeDecision_']);
  const now = Date.now();
  const hist = [{ geoEmptyNoticedAtMs: now - 3 * DAY_MS }];
  assert.equal(S.geoEmptyNoticeDecision_(hist, now), false);
});

test('geoEmptyNoticeDecision_：距上次提醒 ≥ 7 天 → 提醒', () => {
  const S = loadFromCodeGs(['geoEmptyNoticeDecision_']);
  const now = Date.now();
  const hist = [{ geoEmptyNoticedAtMs: now - 8 * DAY_MS }];
  assert.equal(S.geoEmptyNoticeDecision_(hist, now), true);
});

test('geoEmptyNoticeDecision_：多筆歷史取「最近一次」提醒時間判斷', () => {
  const S = loadFromCodeGs(['geoEmptyNoticeDecision_']);
  const now = Date.now();
  const hist = [
    { geoEmptyNoticedAtMs: now - 20 * DAY_MS },
    { geoEmptyNoticedAtMs: now - 2 * DAY_MS },  // 最近一次
    { ua: 'x' },  // 無 geoEmptyNoticedAtMs 的一般紀錄，應被忽略
  ];
  assert.equal(S.geoEmptyNoticeDecision_(hist, now), false);
});

// ── _managementNotifyList_：通知群組名單（非台灣鎖定／定位失敗提醒共用） ──

test('_managementNotifyList_：符合角色/isAdmin/extraRole 者入列，一般角色不入列', () => {
  const S = loadFromCodeGs(['_managementNotifyList_']);
  const users = {
    'a@x.com': { role: '主任' },
    'b@x.com': { role: '專任諮商心理師' },
    'c@x.com': { role: '實習諮商心理師' },        // 一般角色，不入列
    'd@x.com': { role: '實習諮商心理師', isAdmin: true },
    'e@x.com': { role: '實習諮商心理師', extraRole: '管理者' },
  };
  const list = S._managementNotifyList_(users);
  assert.ok(list.includes('a@x.com'));
  assert.ok(list.includes('b@x.com'));
  assert.ok(!list.includes('c@x.com'));
  assert.ok(list.includes('d@x.com'));
  assert.ok(list.includes('e@x.com'));
});

test('_managementNotifyList_：已停用者排除，即使角色符合', () => {
  const S = loadFromCodeGs(['_managementNotifyList_']);
  const users = { 'a@x.com': { role: '主任', disabled: true } };
  assert.deepEqual(S._managementNotifyList_(users), []);
});

test('_managementNotifyList_：users 為 null/非物件 → 空陣列（不炸）', () => {
  const S = loadFromCodeGs(['_managementNotifyList_']);
  assert.deepEqual(S._managementNotifyList_(null), []);
  assert.deepEqual(S._managementNotifyList_(undefined), []);
});
