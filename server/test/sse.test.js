// server/test/sse.test.js — SSE 即時推播（src/sse.js）授權閘與連線管理測試。
// token 產生手法比照 server/test/dispatch.test.js：用 local.upsertUser + vdrive 建 config.json，
// 再走 dispatch.handleRequest 的 sessionStart 取得真正的 sessionToken（與 handleEventsRequest
// 內部驗證的是同一套 sessionAuth/gate 模組，不需另外手刻簽章邏輯）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const sse = require('../src/sse');

const ROOT = 'ROOT_TEST_SSE';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-sse',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
  }, overrides || {});
}

// 同一支 db 內可能連續呼叫多次（多個測試使用者）——vdrive 對同名檔案「多檔取最新、其餘自動 trash」
// （見 storage/vdrive.js 檔頭），若每次都 createJson 會讓後一次呼叫的新檔覆蓋前一次的 users，
// 故已存在 config.json 時改用 updateJson 合併（比照 dispatch.test.js 停用帳號測試的合併寫法）。
async function setupAuthorizedUser(db, email, password) {
  await local.upsertUser(db, email, password);
  let existing = null;
  try { existing = vdrive.readJson(db, 'config.json', { root: ROOT }).data; } catch (_e) { existing = null; }
  const users = Object.assign({}, existing && existing.users, { [email]: { role: '專任諮商心理師' } });
  if (existing) {
    vdrive.updateJson(db, 'config.json', { users }, { root: ROOT });
  } else {
    vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users } });
  }
}

async function login(db, config, email, password) {
  const r = await handleRequest(db, config, {
    action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent',
  });
  return r.data.sessionToken;
}

function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    chunks: [],
    ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this; },
    write(s) { if (this.ended) return false; this.chunks.push(s); return true; },
    end(s) { if (s) this.chunks.push(s); this.ended = true; },
  };
}

function fakeReq(url) {
  const listeners = {};
  return {
    url,
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return this; },
    _trigger(ev) { (listeners[ev] || []).forEach((fn) => fn()); },
  };
}

// ── 授權閘 ──────────────────────────────────────────────────────────────

test('/events 無 token → 401', () => {
  const db = openDb(':memory:');
  const res = fakeRes();
  const req = fakeReq('/events');
  sse.handleEventsRequest(db, testConfig(), req, res);
  assert.equal(res.statusCode, 401);
});

test('/events 亂 token → 401', () => {
  const db = openDb(':memory:');
  const res = fakeRes();
  const req = fakeReq('/events?token=not.a.valid.token');
  sse.handleEventsRequest(db, testConfig(), req, res);
  assert.equal(res.statusCode, 401);
});

test('/events 有效 token 但帳號已停用 → 401', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'disabled@x.com', 'right-password');
  const config = testConfig();
  const token = await login(db, config, 'disabled@x.com', 'right-password');
  vdrive.updateJson(db, 'config.json', { users: { 'disabled@x.com': { role: '專任諮商心理師', disabled: true } } }, { root: ROOT });
  const res = fakeRes();
  const req = fakeReq('/events?token=' + encodeURIComponent(token));
  sse.handleEventsRequest(db, config, req, res);
  assert.equal(res.statusCode, 401);
});

test('/events 有效 token → 200，先收到 :connected', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'ok@x.com', 'right-password');
  const config = testConfig();
  const token = await login(db, config, 'ok@x.com', 'right-password');
  const res = fakeRes();
  const req = fakeReq('/events?token=' + encodeURIComponent(token));
  sse.handleEventsRequest(db, config, req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.ok(res.chunks.some((c) => c.includes(':connected')));
  req._trigger('close'); // 清理，避免影響下個測試的連線數判斷
});

// ── broadcast / sendTo ───────────────────────────────────────────────────

test('broadcast 後所有已註冊連線都收到 event: fileChanged 與 JSON payload；close 後不再收到', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'u1@x.com', 'right-password');
  await setupAuthorizedUser(db, 'u2@x.com', 'right-password');
  const config = testConfig();
  const token1 = await login(db, config, 'u1@x.com', 'right-password');
  const token2 = await login(db, config, 'u2@x.com', 'right-password');

  const res1 = fakeRes();
  const req1 = fakeReq('/events?token=' + encodeURIComponent(token1));
  sse.handleEventsRequest(db, config, req1, res1);

  const res2 = fakeRes();
  const req2 = fakeReq('/events?token=' + encodeURIComponent(token2));
  sse.handleEventsRequest(db, config, req2, res2);

  sse.broadcast('fileChanged', { path: 'bookings.json' });

  const expected = 'event: fileChanged\ndata: {"path":"bookings.json"}\n\n';
  assert.ok(res1.chunks.includes(expected));
  assert.ok(res2.chunks.includes(expected));

  // close res1 → 之後的 broadcast 不應再寫入 res1
  req1._trigger('close');
  const countBefore = res1.chunks.length;
  sse.broadcast('fileChanged', { path: 'notifications.json' });
  assert.equal(res1.chunks.length, countBefore, 'res1 close 後不應再收到新事件');
  assert.ok(res2.chunks.some((c) => c.includes('notifications.json')));

  req2._trigger('close');
});

test('同一 email 第 7 條連線把最舊的踢掉（連線數上限 6）', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'many@x.com', 'right-password');
  const config = testConfig();
  const token = await login(db, config, 'many@x.com', 'right-password');

  const resList = [];
  const reqList = [];
  for (let i = 0; i < 7; i++) {
    const res = fakeRes();
    const req = fakeReq('/events?token=' + encodeURIComponent(token));
    sse.handleEventsRequest(db, config, req, res);
    resList.push(res);
    reqList.push(req);
  }

  // 第 1 條（最舊）應已被伺服器端主動 end() 掉。
  assert.equal(resList[0].ended, true, '第 1 條（最舊）連線應被踢掉');

  // broadcast 後，被踢掉的第 1 條不應再收到新事件；其餘 6 條（第 2～7 條）都應收到。
  const countBefore0 = resList[0].chunks.length;
  sse.broadcast('fileChanged', { path: 'issues.json' });
  assert.equal(resList[0].chunks.length, countBefore0, '被踢掉的連線不應再收到廣播');
  for (let i = 1; i < 7; i++) {
    assert.ok(resList[i].chunks.some((c) => c.includes('issues.json')), `第 ${i + 1} 條連線應收到廣播`);
  }

  // 清理
  for (const req of reqList) req._trigger('close');
});

test('sendTo 只送給指定 email，不會送到其他人', async () => {
  const db = openDb(':memory:');
  await setupAuthorizedUser(db, 'target@x.com', 'right-password');
  await setupAuthorizedUser(db, 'bystander@x.com', 'right-password');
  const config = testConfig();
  const tokenTarget = await login(db, config, 'target@x.com', 'right-password');
  const tokenBystander = await login(db, config, 'bystander@x.com', 'right-password');

  const resTarget = fakeRes();
  const reqTarget = fakeReq('/events?token=' + encodeURIComponent(tokenTarget));
  sse.handleEventsRequest(db, config, reqTarget, resTarget);

  const resBystander = fakeRes();
  const reqBystander = fakeReq('/events?token=' + encodeURIComponent(tokenBystander));
  sse.handleEventsRequest(db, config, reqBystander, resBystander);

  sse.sendTo('target@x.com', 'privateEvent', { hello: 'world' });

  assert.ok(resTarget.chunks.some((c) => c.includes('privateEvent') && c.includes('hello')));
  assert.ok(!resBystander.chunks.some((c) => c.includes('privateEvent')));

  reqTarget._trigger('close');
  reqBystander._trigger('close');
});

// ── 心跳計時器：無連線時不存在（require 本模組不應啟動背景計時器）──

test('無任何連線時，模組不應留下運作中的心跳計時器（_clientCount 為 0）', () => {
  // 本檔前面每個測試都已在結尾 close 掉自己開的連線，這裡驗證收尾後歸零。
  assert.equal(sse._clientCount(), 0);
});
