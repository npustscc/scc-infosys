// 自簽 session token 效期計算（每日 24:00 台北時間到期）單元測試。
// 執行：node --test test/*.test.js
// 測試對象從 dev/Code.gs 就地抽出（harness.extractFunction 吃任意原始碼字串），改壞正式碼即會紅燈。
// nextTaipeiMidnightEpochSec_ 刻意寫成純算術（台北固定 UTC+8、無日光節約），不依賴 GAS Utilities。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./harness');

function loadFromCodeGs(names) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dev', 'Code.gs'), 'utf8');
  const sandbox = { Math, Number, JSON };
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(src, n)).join('\n\n'), sandbox);
  return sandbox;
}

const utcMs = (iso) => new Date(iso).getTime();

test('nextTaipeiMidnightEpochSec_：台北白天中段 → 當日 24:00（台北）', () => {
  const S = loadFromCodeGs(['nextTaipeiMidnightEpochSec_']);
  // 台北 2026-07-08 14:30 = UTC 2026-07-08 06:30
  const exp = S.nextTaipeiMidnightEpochSec_(utcMs('2026-07-08T06:30:00Z'));
  // 台北 2026-07-09 00:00 = UTC 2026-07-08 16:00
  assert.equal(exp, utcMs('2026-07-08T16:00:00Z') / 1000);
});

test('nextTaipeiMidnightEpochSec_：台北 23:59:59 → 一秒後的午夜', () => {
  const S = loadFromCodeGs(['nextTaipeiMidnightEpochSec_']);
  // 台北 2026-07-08 23:59:59 = UTC 2026-07-08 15:59:59
  const exp = S.nextTaipeiMidnightEpochSec_(utcMs('2026-07-08T15:59:59Z'));
  assert.equal(exp, utcMs('2026-07-08T16:00:00Z') / 1000);
});

test('nextTaipeiMidnightEpochSec_：恰為台北 00:00:00 → 24 小時後（不回當下）', () => {
  const S = loadFromCodeGs(['nextTaipeiMidnightEpochSec_']);
  // 台北 2026-07-09 00:00:00 = UTC 2026-07-08 16:00:00
  const exp = S.nextTaipeiMidnightEpochSec_(utcMs('2026-07-08T16:00:00Z'));
  assert.equal(exp, utcMs('2026-07-09T16:00:00Z') / 1000);
});

test('nextTaipeiMidnightEpochSec_：UTC 日界跨越（UTC 17:00 = 台北隔日 01:00）', () => {
  const S = loadFromCodeGs(['nextTaipeiMidnightEpochSec_']);
  // UTC 2026-07-08 17:00 = 台北 2026-07-09 01:00 → 下個台北午夜為 07-10 00:00 = UTC 07-09 16:00
  const exp = S.nextTaipeiMidnightEpochSec_(utcMs('2026-07-08T17:00:00Z'));
  assert.equal(exp, utcMs('2026-07-09T16:00:00Z') / 1000);
});

test('nextTaipeiMidnightEpochSec_：毫秒尾數不影響結果（floor 到秒）', () => {
  const S = loadFromCodeGs(['nextTaipeiMidnightEpochSec_']);
  const a = S.nextTaipeiMidnightEpochSec_(utcMs('2026-07-08T06:30:00Z') + 999);
  const b = S.nextTaipeiMidnightEpochSec_(utcMs('2026-07-08T06:30:00Z'));
  assert.equal(a, b);
});
