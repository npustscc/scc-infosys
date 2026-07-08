// GC 日曆同步後端定時觸發：_gcSyncShouldRun 純函式單元測試。
// _gcSyncShouldRun 定義在 dev/Code.gs（不是 dev/index.html），harness.js 的 extractFunction
// 綁死讀 dev/index.html，因此這裡照 harness.js 的風格自建一個讀 dev/Code.gs 的簡易抽取器
// （沿用 harness.js 匯出的 matchBrace 做字串/註解感知的括號配對）。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { matchBrace } = require('./harness');

const CODE_GS_PATH = path.join(__dirname, '..', 'dev', 'Code.gs');

function loadFromCodeGs(names) {
  const src = fs.readFileSync(CODE_GS_PATH, 'utf8');
  const sandbox = { console };
  vm.createContext(sandbox);
  const code = names.map((name) => {
    const re = new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(');
    const m = re.exec(src);
    if (!m) throw new Error('找不到函式：' + name);
    const braceIdx = src.indexOf('{', m.index);
    if (braceIdx === -1) throw new Error('函式無主體：' + name);
    const endIdx = matchBrace(src, braceIdx);
    return src.slice(m.index, endIdx + 1);
  }).join('\n\n');
  vm.runInContext(code, sandbox);
  return sandbox;
}

function load_() {
  return loadFromCodeGs(['_gcSyncShouldRun']);
}

// weekday: 1=週一…7=週日
test('_gcSyncShouldRun：週一（一/四班表 08:00-21:00）上班時段內皆為 true', () => {
  const S = load_();
  assert.equal(S._gcSyncShouldRun(1, 8, 0), true);   // 上班起點
  assert.equal(S._gcSyncShouldRun(1, 20, 59), true); // 收班前一分鐘
});

test('_gcSyncShouldRun：週一 21:00 整點——雖已過收班時刻，但落在 off-hours 整點規則（minute<5）內仍為 true', () => {
  const S = load_();
  assert.equal(S._gcSyncShouldRun(1, 21, 0), true);
  assert.equal(S._gcSyncShouldRun(1, 21, 4), true);
  assert.equal(S._gcSyncShouldRun(1, 21, 5), false); // 過了整點寬限窗
});

test('_gcSyncShouldRun：週二（二/三/五班表 08:00-18:00）上班時段內為 true，下班後依 off-hours 整點規則判定', () => {
  const S = load_();
  assert.equal(S._gcSyncShouldRun(2, 17, 59), true);  // 收班前一分鐘，仍在上班時段
  assert.equal(S._gcSyncShouldRun(2, 19, 0), true);   // 下班後的整點（off-hours 每小時一次）
  assert.equal(S._gcSyncShouldRun(2, 19, 7), false);  // 下班後、非整點窗口
});

test('_gcSyncShouldRun：週六（週末，全天 off-hours）僅整點附近（minute<5）為 true', () => {
  const S = load_();
  assert.equal(S._gcSyncShouldRun(6, 14, 30), false);
  assert.equal(S._gcSyncShouldRun(6, 14, 2), true);
});

test('_gcSyncShouldRun：週日凌晨非整點附近為 false', () => {
  const S = load_();
  assert.equal(S._gcSyncShouldRun(7, 3, 59), false);
});

test('_gcSyncShouldRun：週三／週五比照週二班表（08:00-18:00）', () => {
  const S = load_();
  assert.equal(S._gcSyncShouldRun(3, 8, 0), true);
  assert.equal(S._gcSyncShouldRun(3, 17, 59), true);
  assert.equal(S._gcSyncShouldRun(3, 18, 0), true);  // 下班整點（off-hours 規則）
  assert.equal(S._gcSyncShouldRun(3, 18, 10), false);
  assert.equal(S._gcSyncShouldRun(5, 12, 0), true);
});

test('_gcSyncShouldRun：週四比照週一班表（08:00-21:00）', () => {
  const S = load_();
  assert.equal(S._gcSyncShouldRun(4, 20, 0), true);
  assert.equal(S._gcSyncShouldRun(4, 21, 30), false);
});
