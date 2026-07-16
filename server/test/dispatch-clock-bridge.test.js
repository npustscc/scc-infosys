// server/test/dispatch-clock-bridge.test.js — clockTokenIssue/Revoke/List 經 dispatch.handleRequest
// 的橋接轉發整合測試（:memory: db，比照 test/dispatch-mental-leaves.test.js 寫法）。GAS 轉發透過
// monkey-patch src/actions/clockBridge.js 的 bridgeFetch（forwardClockAction 內部經 module.exports
// 呼叫，patch 這一個底層函式即可攔截）避免觸網。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const clockBridge = require('../src/actions/clockBridge');

const ROOT = 'ROOT_CLOCK_BRIDGE_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-clock-bridge',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    GAS_BRIDGE_URL: 'https://script.google.com/macros/s/FAKE/exec',
    GAS_BRIDGE_KEY: 'fake-bridge-key',
  }, overrides || {});
}

async function setupUser(db, email, password, extraUserFields) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, {
    name: 'config.json',
    parentId: ROOT,
    content: { users: { [email]: Object.assign({ role: '主任' }, extraUserFields || {}) } },
  });
}

async function login(db, config, email, password) {
  return handleRequest(db, config, { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
}

function withPatchedBridge(handler, fn) {
  const orig = clockBridge.bridgeFetch;
  clockBridge.bridgeFetch = handler;
  return Promise.resolve().then(fn).finally(() => { clockBridge.bridgeFetch = orig; });
}

test('clockTokenIssue：轉發 payload 含 bridgeKey/actorEmail/email/rootFolderId，GAS data 原樣透傳', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'boss@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'boss@x.com', 'right-password');

  let seenUrl, seenPayload;
  const r = await withPatchedBridge(async (url, payloadObj) => {
    seenUrl = url; seenPayload = payloadObj;
    return { success: true, data: { token: 'TOK.SIG', exp: 1799999999, email: 'intern@x.com' } };
  }, () => handleRequest(db, testConfig(), {
    action: 'clockTokenIssue', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, email: 'intern@x.com',
  }));

  assert.equal(r.success, true);
  assert.deepEqual(r.data, { token: 'TOK.SIG', exp: 1799999999, email: 'intern@x.com' });
  assert.equal(seenUrl, 'https://script.google.com/macros/s/FAKE/exec');
  assert.deepEqual(seenPayload, {
    bridgeKey: 'fake-bridge-key',
    action: 'clockTokenIssue',
    actorEmail: 'boss@x.com',
    rootFolderId: ROOT,
    email: 'intern@x.com',
  });
});

test('clockTokenList：GAS 業務錯誤（{error:Forbidden}）原樣透傳，前端行為與直打 GAS 一致', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'staff@x.com', 'right-password', { role: '專任諮商心理師' });
  const login1 = await login(db, testConfig(), 'staff@x.com', 'right-password');

  const r = await withPatchedBridge(async () => ({ success: true, data: { error: 'Forbidden' } }),
    () => handleRequest(db, testConfig(), {
      action: 'clockTokenList', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    }));

  assert.equal(r.success, true);
  assert.equal(r.data.error, 'Forbidden');
});

test('clockTokenRevoke：未設定 GAS_BRIDGE_URL/KEY → 業務錯誤，不觸網', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'boss@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'boss@x.com', 'right-password');

  const r = await withPatchedBridge(async () => { throw new Error('不應被呼叫：缺設定應在觸網前擋下'); },
    () => handleRequest(db, testConfig({ GAS_BRIDGE_URL: '', GAS_BRIDGE_KEY: '' }), {
      action: 'clockTokenRevoke', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, email: 'intern@x.com',
    }));

  assert.equal(r.success, true);
  assert.match(r.data.error, /GAS_BRIDGE_URL／GAS_BRIDGE_KEY/);
});

test('clockTokenIssue：GAS envelope 異常（非 success:true）→ fail envelope', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'boss@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'boss@x.com', 'right-password');

  const r = await withPatchedBridge(async () => ({ success: false, error: 'boom' }),
    () => handleRequest(db, testConfig(), {
      action: 'clockTokenIssue', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, email: 'i@x.com',
    }));

  assert.equal(r.success, false);
  assert.match(r.error, /envelope 異常/);
});

test('clockTokenIssue：未登入 → Session expired（一般身分閘，未達轉發邏輯）', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), { action: 'clockTokenIssue', rootFolderId: ROOT, email: 'i@x.com' });
  assert.equal(r.data.error, 'Session expired');
});

test('clockTokenList：未授權使用者（不在 config.users）→ Unauthorized user', async () => {
  const db = openDb(':memory:');
  await local.upsertUser(db, 'ghost@x.com', 'right-password');
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { 'other@x.com': { role: '主任' } } } });
  const login1 = await handleRequest(db, testConfig(), { action: 'sessionStart', rootFolderId: ROOT, email: 'ghost@x.com', password: 'right-password', ua: 'test-agent' });
  // sessionStart 內部已含授權閘，理應直接拒絕；若未來放寬，dispatch 授權閘仍須擋下（雙保險驗證）。
  if (login1.success && login1.data && login1.data.sessionToken) {
    const r = await handleRequest(db, testConfig(), { action: 'clockTokenList', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });
    assert.equal(r.data.error, 'Unauthorized user');
  } else {
    assert.equal(login1.data.error, 'Unauthorized user');
  }
});
