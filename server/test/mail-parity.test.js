// server/test/mail-parity.test.js — 寄信純函式（決策／彙整）與 dev/Code.gs 對應函式的 parity 測試。
// 手法同 test/commit-actions.test.js：從 dev/Code.gs 就地抽出原始碼、在隔離 vm context 中執行，
// 與 src/mail/loginNotify.js／src/mail/punchSummary.js 匯出的同名邏輯逐案例對打。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { matchBrace } = require('../../test/harness');

const loginNotify = require('../src/mail/loginNotify');
const punchSummary = require('../src/mail/punchSummary');

const CODE_GS_PATH = path.join(__dirname, '..', '..', 'dev', 'Code.gs');

function readCodeGs() {
  return fs.readFileSync(CODE_GS_PATH, 'utf8');
}

function extractFunctionSrc(src, name) {
  const re = new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('找不到函式：' + name);
  const braceIdx = src.indexOf('{', m.index);
  const endIdx = matchBrace(src, braceIdx);
  return src.slice(m.index, endIdx + 1);
}

function loadGasSandbox(snippets, extraGlobals) {
  const sandbox = Object.assign({ JSON, Array, Object, Math, Number, String, Date, isNaN, RegExp }, extraGlobals || {});
  vm.createContext(sandbox);
  vm.runInContext(snippets.join('\n\n'), sandbox);
  return sandbox;
}

// ══════════════════════════════════════════════════════════════════════════
// parity：loginMailDecision 與 GAS loginMailDecision_
// ══════════════════════════════════════════════════════════════════════════

test('parity：loginMailDecision 與 GAS loginMailDecision_ 逐案例一致', () => {
  const src = readCodeGs();
  const G = loadGasSandbox([extractFunctionSrc(src, 'loginMailDecision_')]);

  const nowSec = 1_700_000_000;
  const cases = [
    { history: [], ua: 'UA1', ip: '1.1.1.1', geo: 'Taiwan' }, // first_login
    { history: [{ ua: 'UA1', geo: 'Taiwan' }], ua: 'UA2', ip: '1.1.1.1', geo: 'Taiwan' }, // new_ua
    { history: [{ ua: 'UA1', geo: 'Taiwan' }], ua: 'UA1', ip: '1.1.1.1', geo: 'Japan' }, // new_geo
    { history: [{ ua: 'UA1', geo: '' }], ua: 'UA1', ip: '1.1.1.1', geo: '' }, // geo 空值不觸發 new_geo
    // 熟識 ua/geo，最近一次 mailSent 在 3 天前 → 不寄
    {
      history: [{ ua: 'UA1', geo: 'Taiwan', mailSent: true, issuedAtMs: (nowSec - 3 * 86400) * 1000 }],
      ua: 'UA1', ip: '1.1.1.1', geo: 'Taiwan',
    },
    // 熟識 ua/geo，最近一次 mailSent 在 8 天前 → periodic 保底寄
    {
      history: [{ ua: 'UA1', geo: 'Taiwan', mailSent: true, issuedAtMs: (nowSec - 8 * 86400) * 1000 }],
      ua: 'UA1', ip: '1.1.1.1', geo: 'Taiwan',
    },
    // 熟識 ua/geo，從未寄過信（mailSent 皆 false）→ periodic 保底寄
    {
      history: [{ ua: 'UA1', geo: 'Taiwan', mailSent: false, issuedAtMs: (nowSec - 1 * 86400) * 1000 }],
      ua: 'UA1', ip: '1.1.1.1', geo: 'Taiwan',
    },
  ];

  cases.forEach((c, i) => {
    const nodeResult = loginNotify.loginMailDecision(c.history, c.ua, c.ip, c.geo, nowSec);
    const gasResult = G.loginMailDecision_(c.history, c.ua, c.ip, c.geo, nowSec);
    assert.deepEqual(nodeResult, gasResult, `case #${i} mismatch`);
  });
});

test('parity：mailEnvPrefix 與 GAS mailEnvPrefix_ 依 CALENDAR_NAME/GC_CALENDAR_NAME 一致', () => {
  const src = readCodeGs();

  const devSandbox = loadGasSandbox([extractFunctionSrc(src, 'mailEnvPrefix_')], { CALENDAR_NAME: '[DEV] SCC 空間預約' });
  assert.equal(loginNotify.mailEnvPrefix({ GC_CALENDAR_NAME: '[DEV] SCC 空間預約' }), devSandbox.mailEnvPrefix_());

  const prodSandbox = loadGasSandbox([extractFunctionSrc(src, 'mailEnvPrefix_')], { CALENDAR_NAME: 'SCC 空間預約' });
  assert.equal(loginNotify.mailEnvPrefix({ GC_CALENDAR_NAME: 'SCC 空間預約' }), prodSandbox.mailEnvPrefix_());
});

// ══════════════════════════════════════════════════════════════════════════
// parity：punchDaySummary／fmtHoursMinutes 與 GAS punchDaySummary_／_fmtHoursMinutes_
// ══════════════════════════════════════════════════════════════════════════

test('parity：punchDaySummary 與 GAS punchDaySummary_ 逐案例一致', () => {
  const src = readCodeGs();
  const G = loadGasSandbox([extractFunctionSrc(src, 'punchDaySummary_')]);

  const records = [
    { type: 'punch', email: 'a@x.com', date: '2026-07-15', timestamp: '2026-07-15T01:00:00.000Z' },
    { type: 'punch', email: 'a@x.com', date: '2026-07-15', timestamp: '2026-07-15T09:30:00.000Z' },
    { type: 'punch', email: 'a@x.com', date: '2026-07-15', timestamp: '2026-07-15T05:00:00.000Z' },
    { type: 'punch', email: 'b@x.com', date: '2026-07-15', timestamp: '2026-07-15T02:00:00.000Z' }, // 不同人
    { type: 'punch', email: 'a@x.com', date: '2026-07-16', timestamp: '2026-07-16T01:00:00.000Z' }, // 不同天
  ];

  assert.deepEqual(punchSummary.punchDaySummary(records, 'a@x.com', '2026-07-15'), G.punchDaySummary_(records, 'a@x.com', '2026-07-15'));
  assert.deepEqual(punchSummary.punchDaySummary(records, 'a@x.com', '2026-07-15'), {
    count: 3, first: '2026-07-15T01:00:00.000Z', last: '2026-07-15T09:30:00.000Z',
    spanMs: new Date('2026-07-15T09:30:00.000Z').getTime() - new Date('2026-07-15T01:00:00.000Z').getTime(),
    timestamps: ['2026-07-15T01:00:00.000Z', '2026-07-15T05:00:00.000Z', '2026-07-15T09:30:00.000Z'],
  });
  // 無紀錄案例
  assert.deepEqual(punchSummary.punchDaySummary(records, 'nobody@x.com', '2026-07-15'), G.punchDaySummary_(records, 'nobody@x.com', '2026-07-15'));
});

test('parity：fmtHoursMinutes 與 GAS _fmtHoursMinutes_ 逐案例一致', () => {
  const src = readCodeGs();
  const G = loadGasSandbox([extractFunctionSrc(src, '_fmtHoursMinutes_')]);

  [0, 1000, 59 * 60000, 60 * 60000, 9 * 3600000 + 5 * 60000, undefined, null].forEach((spanMs) => {
    assert.equal(punchSummary.fmtHoursMinutes(spanMs), G._fmtHoursMinutes_(spanMs));
  });
});
