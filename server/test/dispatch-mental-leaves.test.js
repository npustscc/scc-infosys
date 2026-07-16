// server/test/dispatch-mental-leaves.test.js — fetchMentalLeaves／clearMentalLeaves／
// getNpust5AuthUrl／exchangeNpust5OAuthCode 經 dispatch.handleRequest 的整合測試（:memory: db，
// 直接呼叫 handleRequest，比照 test/dispatch.test.js 寫法）。Gmail REST 呼叫透過 monkey-patch
// src/google/gmail.js 的 gmailFetch（所有高階 helper 內部皆透過 exports.gmailFetch 呼叫，patch
// 這一個底層函式即可攔截全部）避免觸網；OAuth token 交換同樣 monkey-patch src/google/auth.js。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const googleAuth = require('../src/google/auth');
const gmail = require('../src/google/gmail');

const ROOT = 'ROOT_ML_DISPATCH_TEST';
const LABEL = 'ml-processed-dev';

function tmpCredsFile() {
  const p = path.join(os.tmpdir(), 'scc-test-ml-creds-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' }));
  return p;
}

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-ml-dispatch',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    GMAIL_SYNC_CREDS: tmpCredsFile(),
    ML_GMAIL_LABEL: LABEL,
  }, overrides || {});
}

async function setupUser(db, email, password, extraUserFields) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, {
    name: 'config.json',
    parentId: ROOT,
    content: { users: { [email]: Object.assign({ role: '專任諮商心理師' }, extraUserFields || {}) } },
  });
}

async function login(db, config, email, password) {
  return handleRequest(db, config, { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
}

function b64url(s) {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function makeGmailDoc(id, subject) {
  return {
    id,
    internalDate: '1700000000000',
    payload: { headers: [{ name: 'Subject', value: subject }], mimeType: 'text/plain', body: { data: b64url('') } },
  };
}

function makeGmailFetchHandler({ labelId, listResult, docs }) {
  return async (_accessToken, reqPath, opts) => {
    opts = opts || {};
    if (reqPath === '/labels' && (!opts.method || opts.method === 'GET')) {
      return { labels: [{ id: labelId, name: LABEL }] };
    }
    if (reqPath.startsWith('/messages?q=') || reqPath.startsWith('/messages?labelIds=')) {
      return { messages: listResult || [] };
    }
    const getMsgMatch = reqPath.match(/^\/messages\/([^/?]+)\?format=full$/);
    if (getMsgMatch) {
      const doc = docs && docs[getMsgMatch[1]];
      if (!doc) throw new Error('no such message: ' + getMsgMatch[1]);
      return doc;
    }
    const modifyMatch = reqPath.match(/^\/messages\/([^/]+)\/modify$/);
    if (modifyMatch) return { id: modifyMatch[1] };
    throw new Error('unexpected gmailFetch call: ' + reqPath);
  };
}

// 每個測試各自 monkey-patch／還原，避免跨案例互相汙染（同進程內共用 require cache 單例）。
function withPatched(handler, fn) {
  const origGmailFetch = gmail.gmailFetch;
  const origTokenFromRefresh = googleAuth.tokenFromRefresh;
  gmail.gmailFetch = handler;
  googleAuth.tokenFromRefresh = async () => ({ accessToken: 'FAKE_ACCESS_TOKEN', expiresIn: 3600 });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      gmail.gmailFetch = origGmailFetch;
      googleAuth.tokenFromRefresh = origTokenFromRefresh;
    });
}

// ── fetchMentalLeaves ────────────────────────────────────────────────

test('fetchMentalLeaves：正常模式成功，寫入 mental_leaves.json', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();
  const doc = makeGmailDoc('m1', '學號:U1234567 王小明 資訊工程系 學生請假 因 感冒，申請 身心調適假從2026/07/01至2026/07/01');
  const handler = makeGmailFetchHandler({ labelId: 'LBL1', listResult: [{ id: 'm1' }], docs: { m1: doc } });

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'fetchMentalLeaves', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
  }));

  assert.equal(r.success, true);
  assert.equal(r.data.newCount, 1);
  assert.equal(r.data.totalCount, 1);
  const { data } = vdrive.readJson(db, 'mental_leaves.json', { root: ROOT });
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].studentId, 'U1234567');
});

test('fetchMentalLeaves：mode=force → bizError 提示改用 CLI，不觸網', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = async () => { throw new Error('不應被呼叫：force 模式應在觸網前就被擋下'); };
  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'fetchMentalLeaves', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, mode: 'force',
  }));

  assert.equal(r.success, true);
  assert.match(r.data.error, /mode=force/);
  assert.match(r.data.error, /pull-mental-leaves\.js/);
});

test('fetchMentalLeaves：未設定 GMAIL_SYNC_CREDS → 業務失敗（fail envelope，含提示訊息）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig({ GMAIL_SYNC_CREDS: '' });

  const r = await handleRequest(db, config, { action: 'fetchMentalLeaves', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });

  assert.equal(r.success, false);
  assert.match(r.error, /GMAIL_SYNC_CREDS/);
});

test('fetchMentalLeaves：未登入（無 sessionToken）→ Session expired（一般身分閘，未達 action 邏輯）', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), { action: 'fetchMentalLeaves', rootFolderId: ROOT });
  assert.equal(r.data.error, 'Session expired');
});

// ── clearMentalLeaves ────────────────────────────────────────────────

test('clearMentalLeaves：管理者可清空，清空後 mental_leaves.json 為空陣列', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'admin@x.com', 'right-password', { role: '主任' });
  vdrive.createJson(db, { name: 'mental_leaves.json', parentId: ROOT, content: { records: [{ id: 'ml_a', emailId: 'a' }] } });
  const login1 = await login(db, testConfig(), 'admin@x.com', 'right-password');
  const config = testConfig();

  const handler = makeGmailFetchHandler({ labelId: 'LBL1', listResult: [], docs: {} });
  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'clearMentalLeaves', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
  }));

  assert.equal(r.success, true);
  assert.equal(r.data.ok, true);
  const { data } = vdrive.readJson(db, 'mental_leaves.json', { root: ROOT });
  assert.deepEqual(data.records, []);
});

test('clearMentalLeaves：一般使用者（非 admin、非 isMentalLeaveContact）→ Forbidden', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'staff@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'staff@x.com', 'right-password');

  const r = await handleRequest(db, testConfig(), { action: 'clearMentalLeaves', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });

  assert.equal(r.data.error, 'Forbidden: admin or mental-leave contact only');
});

test('clearMentalLeaves：isMentalLeaveContact=true 的非管理者可清空', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'contact@x.com', 'right-password', { isMentalLeaveContact: true });
  vdrive.createJson(db, { name: 'mental_leaves.json', parentId: ROOT, content: { records: [{ id: 'ml_a', emailId: 'a' }] } });
  const login1 = await login(db, testConfig(), 'contact@x.com', 'right-password');
  const config = testConfig();

  const handler = makeGmailFetchHandler({ labelId: 'LBL1', listResult: [], docs: {} });
  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'clearMentalLeaves', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
  }));

  assert.equal(r.success, true);
  assert.equal(r.data.ok, true);
});

// ── countMentalLeavesUnprocessed ─────────────────────────────────────

test('countMentalLeavesUnprocessed：回傳 count 與 hasMore（對映 GAS L2415）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  let seenPath;
  const handler = async (_accessToken, reqPath) => {
    seenPath = reqPath;
    return { messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'NPT' };
  };
  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'countMentalLeavesUnprocessed', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
  }));

  assert.equal(r.success, true);
  assert.deepEqual(r.data, { count: 2, hasMore: true });
  assert.ok(seenPath.includes('maxResults=500'));
  assert.ok(seenPath.includes(encodeURIComponent(`-label:${LABEL}`)));
});

test('countMentalLeavesUnprocessed：未登入 → Session expired', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), { action: 'countMentalLeavesUnprocessed', rootFolderId: ROOT });
  assert.equal(r.data.error, 'Session expired');
});

// ── getNpust5AuthUrl／exchangeNpust5OAuthCode：網頁授權流程已退場 ──────

test('getNpust5AuthUrl：已登入授權使用者 → 固定業務錯誤（不再導向 Google 同意頁）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), { action: 'getNpust5AuthUrl', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });
  assert.equal(r.data.error, '本地後端改用伺服器端憑證檔，毋需網頁授權');
});

test('exchangeNpust5OAuthCode：不需 sessionToken（同 GAS 版），直接回固定業務錯誤', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), { action: 'exchangeNpust5OAuthCode', rootFolderId: ROOT, code: 'whatever' });
  assert.equal(r.success, true);
  assert.equal(r.data.error, '本地後端改用伺服器端憑證檔，毋需網頁授權');
});

// ── submitUserApplication：帳號發放與管理（migration 005）改由管理者建立，申請流程已退場 ──────

test('submitUserApplication：未登入呼叫也回固定業務錯誤（不是 Session expired）——短路在身分解析之前', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), { action: 'submitUserApplication', rootFolderId: ROOT });
  assert.equal(r.success, true);
  assert.equal(r.data.error, '帳號由管理者建立，請洽中心管理者');
});

test('submitUserApplication：已登入授權使用者呼叫同樣回固定業務錯誤', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'submitUserApplication', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
  });
  assert.equal(r.data.error, '帳號由管理者建立，請洽中心管理者');
});
