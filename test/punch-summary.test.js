// v168：打卡後自動寄送當日彙整信——純計算函式 punchDaySummary_ 單元測試。
// 執行：node --test test/*.test.js
// 測試對象從 dev/Code.gs 就地抽出（harness.extractFunction），改壞正式碼即紅燈。
// punchDaySummary_ 為純計算（不碰 MailApp/UrlFetchApp/LockService），故可在 vm sandbox 直接跑。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./harness');

function loadFromCodeGs(names) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dev', 'Code.gs'), 'utf8');
  const sandbox = { JSON, Array, Object, String, Number, Math, Date };
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(src, n)).join('\n\n'), sandbox);
  return sandbox;
}

test('punchDaySummary_：空紀錄 → count 0，first/last null，spanMs 0', () => {
  const S = loadFromCodeGs(['punchDaySummary_']);
  const r = S.punchDaySummary_([], 'a@x.com', '2026-07-13');
  assert.deepEqual(r, { count: 0, first: null, last: null, spanMs: 0, timestamps: [] });
});

test('punchDaySummary_：null/undefined records → 不炸，視同空', () => {
  const S = loadFromCodeGs(['punchDaySummary_']);
  assert.equal(S.punchDaySummary_(null, 'a@x.com', '2026-07-13').count, 0);
  assert.equal(S.punchDaySummary_(undefined, 'a@x.com', '2026-07-13').count, 0);
});

test('punchDaySummary_：單筆 → count 1，first=last，spanMs 0', () => {
  const S = loadFromCodeGs(['punchDaySummary_']);
  const records = [
    { email: 'a@x.com', date: '2026-07-13', type: 'punch', timestamp: '2026-07-13T01:00:00.000Z' },
  ];
  const r = S.punchDaySummary_(records, 'a@x.com', '2026-07-13');
  assert.equal(r.count, 1);
  assert.equal(r.first, '2026-07-13T01:00:00.000Z');
  assert.equal(r.last, '2026-07-13T01:00:00.000Z');
  assert.equal(r.spanMs, 0);
  assert.deepEqual(r.timestamps, ['2026-07-13T01:00:00.000Z']);
});

test('punchDaySummary_：三筆亂序 → 依時間排序，first/last/spanMs 正確', () => {
  const S = loadFromCodeGs(['punchDaySummary_']);
  const records = [
    { email: 'a@x.com', date: '2026-07-13', type: 'punch', timestamp: '2026-07-13T05:30:00.000Z' }, // 最晚
    { email: 'a@x.com', date: '2026-07-13', type: 'punch', timestamp: '2026-07-13T01:00:00.000Z' }, // 最早
    { email: 'a@x.com', date: '2026-07-13', type: 'punch', timestamp: '2026-07-13T03:00:00.000Z' }, // 中間
  ];
  const r = S.punchDaySummary_(records, 'a@x.com', '2026-07-13');
  assert.equal(r.count, 3);
  assert.equal(r.first, '2026-07-13T01:00:00.000Z');
  assert.equal(r.last, '2026-07-13T05:30:00.000Z');
  assert.equal(r.spanMs, 4.5 * 3600 * 1000);
  assert.deepEqual(r.timestamps, [
    '2026-07-13T01:00:00.000Z',
    '2026-07-13T03:00:00.000Z',
    '2026-07-13T05:30:00.000Z',
  ]);
});

test('punchDaySummary_：跨 email 篩選正確（只算同一人）', () => {
  const S = loadFromCodeGs(['punchDaySummary_']);
  const records = [
    { email: 'a@x.com', date: '2026-07-13', type: 'punch', timestamp: '2026-07-13T01:00:00.000Z' },
    { email: 'b@x.com', date: '2026-07-13', type: 'punch', timestamp: '2026-07-13T02:00:00.000Z' },
    { email: 'a@x.com', date: '2026-07-13', type: 'punch', timestamp: '2026-07-13T08:00:00.000Z' },
  ];
  const r = S.punchDaySummary_(records, 'a@x.com', '2026-07-13');
  assert.equal(r.count, 2);
  assert.equal(r.first, '2026-07-13T01:00:00.000Z');
  assert.equal(r.last, '2026-07-13T08:00:00.000Z');
});

test('punchDaySummary_：跨 date 篩選正確（只算同一天）', () => {
  const S = loadFromCodeGs(['punchDaySummary_']);
  const records = [
    { email: 'a@x.com', date: '2026-07-12', type: 'punch', timestamp: '2026-07-12T09:00:00.000Z' },
    { email: 'a@x.com', date: '2026-07-13', type: 'punch', timestamp: '2026-07-13T01:00:00.000Z' },
    { email: 'a@x.com', date: '2026-07-13', type: 'punch', timestamp: '2026-07-13T02:00:00.000Z' },
  ];
  const r = S.punchDaySummary_(records, 'a@x.com', '2026-07-13');
  assert.equal(r.count, 2);
  assert.equal(r.first, '2026-07-13T01:00:00.000Z');
});

test('punchDaySummary_：非 punch type 被排除（如「更新定位」等其他紀錄）', () => {
  const S = loadFromCodeGs(['punchDaySummary_']);
  const records = [
    { email: 'a@x.com', date: '2026-07-13', type: 'punch', timestamp: '2026-07-13T01:00:00.000Z' },
    { email: 'a@x.com', date: '2026-07-13', type: 'note', timestamp: '2026-07-13T12:00:00.000Z' },
    { email: 'a@x.com', date: '2026-07-13', timestamp: '2026-07-13T13:00:00.000Z' }, // 無 type
  ];
  const r = S.punchDaySummary_(records, 'a@x.com', '2026-07-13');
  assert.equal(r.count, 1);
  assert.equal(r.first, '2026-07-13T01:00:00.000Z');
  assert.equal(r.last, '2026-07-13T01:00:00.000Z');
});
