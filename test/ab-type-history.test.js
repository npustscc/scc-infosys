// _abTypeHistoryLine / _abTypeHistoryIsLegacy：個案詳細資料「案別紀錄」顯示（C：A/B 案設定時間戳記）
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const FNS = ['_abTypeHistoryLine', '_abTypeHistoryIsLegacy'];

test('_abTypeHistoryLine：無 abTypeHistory（舊案）→ 固定舊案註記', () => {
  const S = load(FNS);
  assert.equal(S._abTypeHistoryLine({ id: '1' }), '舊案，無 A/B 案開案/登錄/轉換時間戳記');
  assert.equal(S._abTypeHistoryLine({ id: '1', abTypeHistory: [] }), '舊案，無 A/B 案開案/登錄/轉換時間戳記');
});

test('_abTypeHistoryLine：只有 open 條目 → 「{日期} 開案設定 X」', () => {
  const S = load(FNS);
  const c = { id: '1', abTypeHistory: [
    { kind: 'open', to: 'B案', at: '2026-04-25T09:00:00', by: 'a@x.com', byName: '甲' },
  ] };
  assert.equal(S._abTypeHistoryLine(c), '115.04.25 開案設定 B案');
});

test('_abTypeHistoryLine：open + change → 逗號串接，change 附 byName', () => {
  const S = load(FNS);
  const c = { id: '1', abTypeHistory: [
    { kind: 'open', to: 'B案', at: '2026-04-25T09:00:00', by: 'a@x.com', byName: '甲' },
    { kind: 'change', from: 'B案', to: 'A案', at: '2026-09-20T10:00:00', by: 'b@x.com', byName: '陳幸只', sem: '1151' },
  ] };
  assert.equal(S._abTypeHistoryLine(c), '115.04.25 開案設定 B案，115.09.20 轉為 A案（陳幸只）');
});

test('_abTypeHistoryLine：多筆 change 依序串接', () => {
  const S = load(FNS);
  const c = { id: '1', abTypeHistory: [
    { kind: 'open', to: 'A案', at: '2025-09-01T09:00:00', byName: '甲' },
    { kind: 'change', from: 'A案', to: 'B案', at: '2026-03-01T09:00:00', byName: '乙' },
    { kind: 'change', from: 'B案', to: 'A案', at: '2026-09-20T09:00:00', byName: '丙' },
  ] };
  assert.equal(S._abTypeHistoryLine(c),
    '114.09.01 開案設定 A案，115.03.01 轉為 B案（乙），115.09.20 轉為 A案（丙）');
});

test('_abTypeHistoryLine：舊案之後才首次轉換（只有 change 無 open）→ 舊案註記＋轉換紀錄並存', () => {
  const S = load(FNS);
  const c = { id: '1', abTypeHistory: [
    { kind: 'change', from: 'A案', to: 'B案', at: '2026-07-15T09:00:00', byName: '丁' },
  ] };
  assert.equal(S._abTypeHistoryLine(c),
    '舊案，無 A/B 案開案/登錄/轉換時間戳記；115.07.15 轉為 B案（丁）');
});

test('_abTypeHistoryLine：byName 缺值時 fallback 顯示 by（email）', () => {
  const S = load(FNS);
  const c = { id: '1', abTypeHistory: [
    { kind: 'open', to: 'A案', at: '2026-01-01T09:00:00' },
    { kind: 'change', from: 'A案', to: 'B案', at: '2026-02-01T09:00:00', by: 'noname@x.com' },
  ] };
  assert.equal(S._abTypeHistoryLine(c), '115.01.01 開案設定 A案，115.02.01 轉為 B案（noname@x.com）');
});

test('_abTypeHistoryIsLegacy：無歷史或無 open 條目 → true；有 open → false', () => {
  const S = load(FNS);
  assert.equal(S._abTypeHistoryIsLegacy({ id: '1' }), true);
  assert.equal(S._abTypeHistoryIsLegacy({ id: '1', abTypeHistory: [] }), true);
  assert.equal(S._abTypeHistoryIsLegacy({ id: '1', abTypeHistory: [{ kind: 'change', to: 'A案', at: '2026-01-01T00:00:00' }] }), true);
  assert.equal(S._abTypeHistoryIsLegacy({ id: '1', abTypeHistory: [{ kind: 'open', to: 'A案', at: '2026-01-01T00:00:00' }] }), false);
});
