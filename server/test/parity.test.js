// server/test/parity.test.js — GAS parity：Node 版純函式對打從 dev/Code.gs／dev/index.html 就地
// 抽出的原始碼（test/harness.js extractFunction），直接證明 Node 骨架與現有前後端相容。
// 執行：cd server && npm test（也可在 repo 根目錄 node --test server/test/*.test.js）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction, load } = require('../../test/harness');

const sessionAuth = require('../src/auth/session');
const gate = require('../src/authz/gate');

function loadFromCodeGs(names, extraSandbox) {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'dev', 'Code.gs'), 'utf8');
  const sandbox = Object.assign({ JSON, Array, Object, Math, Number, String, Date, isNaN }, extraSandbox);
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(src, n)).join('\n\n'), sandbox);
  return sandbox;
}

// ── nextTaipeiMidnightEpochSec_：與 dev/Code.gs 逐案比對 ────────────────────

test('parity：nextTaipeiMidnightEpochSec 與 GAS 版對任意時間點結果一致', () => {
  const G = loadFromCodeGs(['nextTaipeiMidnightEpochSec_']);
  const samples = [
    Date.parse('2026-07-08T06:30:00Z'),
    Date.parse('2026-07-08T15:59:59Z'),
    Date.parse('2026-07-08T16:00:00Z'),
    Date.parse('2026-07-08T17:00:00Z'),
    Date.parse('2026-01-01T00:00:00Z'),
    Date.parse('2026-12-31T23:59:59Z'),
  ];
  for (const ms of samples) {
    assert.equal(
      sessionAuth.nextTaipeiMidnightEpochSec(ms),
      G.nextTaipeiMidnightEpochSec_(ms),
      `mismatch at ${new Date(ms).toISOString()}`
    );
  }
});

// ── authzDecision_/adminDecision_：GAS 版多帶一個 bootstrapAdmins 參數，Node 版刻意不設
// 緊急備援名單（見 authz/gate.js 檔頭註解）——parity 測試傳空陣列，只比對「一般帳號」語意一致。

test('parity：authzDecision 與 GAS authzDecision_（bootstrapAdmins=[]）語意一致', () => {
  const G = loadFromCodeGs(['authzDecision_']);
  const cases = [
    [{ 'a@x.com': { role: '專任諮商心理師' } }, 'a@x.com'],
    [{ 'a@x.com': { role: '專任諮商心理師', disabled: true } }, 'a@x.com'],
    [{ 'a@x.com': {} }, 'attacker@gmail.com'],
    [null, 'a@x.com'],
    [{ '': {} }, ''],
  ];
  for (const [users, email] of cases) {
    assert.equal(
      gate.authzDecision(users, email),
      G.authzDecision_(users, email, []),
      `mismatch users=${JSON.stringify(users)} email=${email}`
    );
  }
});

test('parity：adminDecision 與 GAS adminDecision_（bootstrapAdmins=[]）語意一致', () => {
  const G = loadFromCodeGs(['adminDecision_']);
  const cases = [
    [{ 'a@x.com': { role: '主任' } }, 'a@x.com'],
    [{ 'a@x.com': { role: '專任諮商心理師', extraRole: '管理者' } }, 'a@x.com'],
    [{ 'a@x.com': { role: '專任諮商心理師', isAdmin: true } }, 'a@x.com'],
    [{ 'a@x.com': { role: '專任諮商心理師' } }, 'a@x.com'],
    [{ 'a@x.com': { role: '主任', disabled: true } }, 'a@x.com'],
    [null, 'a@x.com'],
  ];
  for (const [users, email] of cases) {
    assert.equal(
      gate.adminDecision(users, email),
      G.adminDecision_(users, email, []),
      `mismatch users=${JSON.stringify(users)} email=${email}`
    );
  }
});

// ── isConfigWrite_/_configUsersUnchanged_/_deepEq_：直接比對兩邊實作 ──────────

test('parity：isConfigWrite 與 GAS isConfigWrite_ 一致', () => {
  const G = loadFromCodeGs(['isConfigWrite_']);
  const CFG_ID = '1CKXefjjiB-PrIFZa-DBQ7Q2ASs-TQroj';
  const cases = [
    ['updateJson', { path: 'config.json' }],
    ['updateJson', { path: 'cases/manifest.json' }],
    ['updateContentById', { fileId: CFG_ID }],
    ['updateContentById', { fileId: '1Other' }],
    ['createJson', { name: 'config.json' }],
    ['readJson', { path: 'config.json' }],
  ];
  for (const [action, params] of cases) {
    assert.equal(gate.isConfigWrite(action, params, CFG_ID), G.isConfigWrite_(action, params, CFG_ID));
  }
});

test('parity：configUsersUnchanged 與 GAS _configUsersUnchanged_ 一致', () => {
  const G = loadFromCodeGs(['_configUsersUnchanged_', '_deepEq_']);
  const mkCfg = (users) => ({ users });
  const old = mkCfg({ 'a@x.com': { role: '專任諮商心理師', pin: '1111', allowedCases: ['1'] } });
  const same = mkCfg({ 'a@x.com': { role: '專任諮商心理師', pin: '1111', allowedCases: ['1'] } });
  const changed = mkCfg({ 'a@x.com': { role: '專任諮商心理師', pin: '2222', allowedCases: ['1'] } });
  assert.equal(gate.configUsersUnchanged(old, same), G._configUsersUnchanged_(old, same));
  assert.equal(gate.configUsersUnchanged(old, changed), G._configUsersUnchanged_(old, changed));
  assert.equal(gate.configUsersUnchanged(null, same), G._configUsersUnchanged_(null, same));
});

// ── queryParentsAllowed_：q 字串白名單解析一致 ──────────────────────────────

test('parity：queryParentsAllowed 與 GAS queryParentsAllowed_ 一致', () => {
  const G = loadFromCodeGs(['queryParentsAllowed_', '_extractParentsIds_', '_qHasForbiddenOp_']);
  const underRoot = (id) => id === 'ROOT' || id === 'cases-folder';
  const qs = [
    "'ROOT' in parents and trashed=false",
    "'cases-folder' in parents and name='manifest.json' and trashed=false",
    "'evil-folder' in parents and trashed=false",
    "'ROOT' in parents or trashed=false",
    "trashed=false",
    "'ROOT' in parents and not trashed=true",
  ];
  for (const q of qs) {
    assert.equal(
      gate.queryParentsAllowed(q, underRoot),
      G.queryParentsAllowed_(q, underRoot),
      `mismatch q=${q}`
    );
  }
});

// ── session token 前端相容性：用 dev/index.html 就地抽出的 _getSession 解回 Node 簽發的 token ──
// 證明 Node 版簽發的 token「未改造的前端」讀得懂——不需前端知道後端已換成 Node。

test('parity：Node 簽發的 session token 可被前端 _getSession 正確解回（不需改前端）', () => {
  const fakeStore = {};
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(fakeStore, k) ? fakeStore[k] : null),
    setItem: (k, v) => { fakeStore[k] = String(v); },
  };
  // atob：Node 沒有全域 atob，這裡用等價的 base64 → binary string 解碼餵給前端函式的 sandbox。
  const atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
  const S = load(['_getSession'], { localStorage, atob, _SESSION_LS_KEY: 'testSessKey' });

  const issued = sessionAuth.issueSessionToken('a@x.com', 'test-secret-parity');
  localStorage.setItem('testSessKey', issued.token);

  const sess = S._getSession();
  assert.ok(sess, '前端 _getSession 應成功解出 Node 簽發的 token');
  assert.equal(sess.token, issued.token);
  assert.equal(sess.exp, issued.exp);
});

test('parity：前端 _getSession 對過期 token（exp 剩不到 30 秒緩衝）判定為 null，與 Node 端驗證一致地拒絕', () => {
  const fakeStore = {};
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(fakeStore, k) ? fakeStore[k] : null),
    setItem: (k, v) => { fakeStore[k] = String(v); },
  };
  const atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
  const S = load(['_getSession'], { localStorage, atob, _SESSION_LS_KEY: 'testSessKey' });

  // 手刻一個 exp 為 10 秒後的 token（在前端 30 秒緩衝內視為無效）。
  const nowMs = Date.now();
  const secret = 'test-secret-parity-2';
  const soonExpSec = Math.floor(nowMs / 1000) + 10;
  const payloadB64 = sessionAuth.base64url(Buffer.from(JSON.stringify({ e: 'a@x.com', jti: 'j', iat: Math.floor(nowMs / 1000), exp: soonExpSec })));
  const token = payloadB64 + '.' + sessionAuth.signSessionPayload(payloadB64, secret);
  localStorage.setItem('testSessKey', token);

  assert.equal(S._getSession(), null);
  // 但 Node 端嚴格驗證（無 30 秒緩衝）在真正過期前仍視為有效——證明兩邊「緩衝窗」差異是刻意的
  // （前端提早判定過期以便主動重登，避免請求送到一半才被後端拒絕），非不相容。
  const decoded = sessionAuth.verifySessionToken(token, secret);
  assert.ok(decoded, 'Node 端在 exp 前應仍判定有效');
});
