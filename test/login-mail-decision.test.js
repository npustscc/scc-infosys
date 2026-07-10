// 登入通知「異常偵測」純決策單元測試（v166：登入通知改新裝置/新位置警示＋7天保底）。
// 執行：node --test test/*.test.js
// 測試對象從 dev/Code.gs 就地抽出（harness.extractFunction），改壞正式碼即紅燈。
// loginMailDecision_ 是純函式（不碰 UrlFetchApp/MailApp/LockService），故可在 vm sandbox 直接跑。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./harness');

function loadFromCodeGs(names) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dev', 'Code.gs'), 'utf8');
  const sandbox = { JSON, Array, Object, Number };
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(src, n)).join('\n\n'), sandbox);
  return sandbox;
}

const NOW_SEC = 1_800_000_000; // 固定基準時間（任意值，僅用於相對天數計算）

test('loginMailDecision_：無任何歷史 → mail=true, reason=first_login', () => {
  const S = loadFromCodeGs(['loginMailDecision_']);
  const d = S.loginMailDecision_([], 'UA-A', '1.2.3.4', 'Taiwan', NOW_SEC);
  assert.equal(d.mail, true);
  assert.equal(d.reason, 'first_login');
});

test('loginMailDecision_：本次 ua 與歷史任一筆都不同 → mail=true, reason=new_ua', () => {
  const S = loadFromCodeGs(['loginMailDecision_']);
  const history = [
    { ua: 'UA-舊裝置', geo: 'Taiwan', mailSent: true, issuedAtMs: (NOW_SEC - 3600) * 1000 },
  ];
  const d = S.loginMailDecision_(history, 'UA-新裝置', '1.2.3.4', 'Taiwan', NOW_SEC);
  assert.equal(d.mail, true);
  assert.equal(d.reason, 'new_ua');
});

test('loginMailDecision_：ua 熟識但 geo 非空且與歷史都不同 → mail=true, reason=new_geo', () => {
  const S = loadFromCodeGs(['loginMailDecision_']);
  const history = [
    { ua: 'UA-A', geo: 'Taiwan', mailSent: true, issuedAtMs: (NOW_SEC - 3600) * 1000 },
  ];
  const d = S.loginMailDecision_(history, 'UA-A', '5.6.7.8', 'Japan', NOW_SEC);
  assert.equal(d.mail, true);
  assert.equal(d.reason, 'new_geo');
});

test('loginMailDecision_：ua 熟識、geo 為空值 → 不觸發 new_geo（查詢失敗保底靠 periodic，不誤報）', () => {
  const S = loadFromCodeGs(['loginMailDecision_']);
  const history = [
    { ua: 'UA-A', geo: 'Taiwan', mailSent: true, issuedAtMs: (NOW_SEC - 3600) * 1000 },
  ];
  const d = S.loginMailDecision_(history, 'UA-A', '9.9.9.9', '', NOW_SEC);
  assert.equal(d.mail, false);
  assert.equal(d.reason, '');
});

test('loginMailDecision_：ua/geo 皆熟識，且 7 天內已寄過信 → 不寄', () => {
  const S = loadFromCodeGs(['loginMailDecision_']);
  const history = [
    { ua: 'UA-A', geo: 'Taiwan', mailSent: true, issuedAtMs: (NOW_SEC - 3 * 24 * 3600) * 1000 },
    { ua: 'UA-A', geo: 'Taiwan', mailSent: false, issuedAtMs: (NOW_SEC - 3600) * 1000 },
  ];
  const d = S.loginMailDecision_(history, 'UA-A', '1.2.3.4', 'Taiwan', NOW_SEC);
  assert.equal(d.mail, false);
  assert.equal(d.reason, '');
});

test('loginMailDecision_：ua/geo 皆熟識，但距上次寄信 ≥7 天 → mail=true, reason=periodic（保底）', () => {
  const S = loadFromCodeGs(['loginMailDecision_']);
  const history = [
    { ua: 'UA-A', geo: 'Taiwan', mailSent: true, issuedAtMs: (NOW_SEC - 8 * 24 * 3600) * 1000 },
    { ua: 'UA-A', geo: 'Taiwan', mailSent: false, issuedAtMs: (NOW_SEC - 2 * 24 * 3600) * 1000 },
  ];
  const d = S.loginMailDecision_(history, 'UA-A', '1.2.3.4', 'Taiwan', NOW_SEC);
  assert.equal(d.mail, true);
  assert.equal(d.reason, 'periodic');
});

test('loginMailDecision_：ip 不參與判斷——即使本次 ip 從未出現於歷史，ua/geo 熟識、未滿 7 天仍不寄', () => {
  const S = loadFromCodeGs(['loginMailDecision_']);
  const history = [
    { ua: 'UA-A', ip: '1.1.1.1', geo: 'Taiwan', mailSent: true, issuedAtMs: (NOW_SEC - 3600) * 1000 },
  ];
  const d = S.loginMailDecision_(history, 'UA-A', '203.0.113.99', 'Taiwan', NOW_SEC);
  assert.equal(d.mail, false);
  assert.equal(d.reason, '');
});

test('loginMailDecision_：ua/geo 皆熟識，但歷史從未成功寄過信（皆 mailSent:false/未設） → 保底寄一次', () => {
  const S = loadFromCodeGs(['loginMailDecision_']);
  const history = [
    { ua: 'UA-A', geo: 'Taiwan', mailSent: false, issuedAtMs: (NOW_SEC - 3600) * 1000 },
  ];
  const d = S.loginMailDecision_(history, 'UA-A', '1.2.3.4', 'Taiwan', NOW_SEC);
  assert.equal(d.mail, true);
  assert.equal(d.reason, 'periodic');
});
