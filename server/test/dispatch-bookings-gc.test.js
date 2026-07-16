// server/test/dispatch-bookings-gc.test.js — bookingsCommit 的 gc 參數整合測試（src/sync/gcSync.js
// bookingsCommitWithGc，經 dispatch.handleRequest 的 'bookingsCommit' action）。對映 dev/Code.gs
// bookingsCommit_ 的 Phase 2（鎖外 GC best-effort）＋Phase 3（拿到新 eventId 才補寫 calendarEventId）。
// Calendar REST 呼叫透過 monkey-patch src/google/calendar.js 的 calendarFetch，寫法比照
// test/dispatch-calendar.test.js。
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
const calendar = require('../src/google/calendar');
const commitActions = require('../src/actions/commit');

const ROOT = 'ROOT_BK_GC_DISPATCH_TEST';
const CAL_NAME = 'SCC 空間預約（測試）';
const CAL_ID = 'cal-bk-test@group.calendar.google.com';
const CTX = { root: ROOT };

function tmpCredsFile() {
  const p = path.join(os.tmpdir(), 'scc-test-bk-gc-creds-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' }));
  return p;
}

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-bk-gc',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    CALENDAR_SYNC_CREDS: tmpCredsFile(),
    GC_CALENDAR_NAME: CAL_NAME,
  }, overrides || {});
}

async function setupUser(db, email, password) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { [email]: { role: '專任諮商心理師' } } } });
}

async function login(db, config, email, password) {
  return handleRequest(db, config, { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
}

function withPatched(calendarFetchHandler, fn) {
  const origCalendarFetch = calendar.calendarFetch;
  const origTokenFromRefresh = googleAuth.tokenFromRefresh;
  calendar.calendarFetch = calendarFetchHandler;
  googleAuth.tokenFromRefresh = async () => ({ accessToken: 'FAKE_ACCESS_TOKEN', expiresIn: 3600 });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      calendar.calendarFetch = origCalendarFetch;
      googleAuth.tokenFromRefresh = origTokenFromRefresh;
    });
}

function baseRouter(extraHandlers) {
  return async (_accessToken, reqPath, opts) => {
    opts = opts || {};
    if (reqPath.startsWith('/users/me/calendarList')) return { items: [{ id: CAL_ID, summary: CAL_NAME }] };
    for (const [matcher, handler] of extraHandlers) {
      const m = reqPath.match(matcher);
      if (m && (!handler.method || (opts.method || 'GET') === handler.method)) return handler.fn(m, opts);
    }
    throw new Error('unexpected calendarFetch call: ' + (opts.method || 'GET') + ' ' + reqPath);
  };
}

function gcParamsFor(date) {
  return {
    room: '玉山', customRoom: '', date, startTime: '09:00', endTime: '10:00',
    counselorName: '王小明', notes: '個別諮商', creatorName: '王小明',
    createdAt: '2026-07-14T00:00:00.000Z', bkSerial: 1,
  };
}

// ── gc.mode='create' ──────────────────────────────────────────────────

test('bookingsCommit：gc.mode=create → 建立 GC 事件成功後，回傳的 booking 帶新 calendarEventId（Phase 3 補寫）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = baseRouter([
    [new RegExp('^/calendars/' + encodeURIComponent(CAL_ID) + '/events$'), { method: 'POST', fn: () => ({ id: 'NEW_GC_EVT' }) }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'bookingsCommit', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    ops: [{ op: 'upsert', booking: { id: 'BK1', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山' }, gc: { mode: 'create', params: gcParamsFor('2026-07-15') } }],
    checkConflicts: true,
  }));

  assert.equal(r.success, true);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.gcErrors.length, 0);
  assert.equal(r.data.bookings.length, 1);
  assert.equal(r.data.bookings[0].calendarEventId, 'NEW_GC_EVT');

  // 確認確實寫回 bookings.json（不只是回傳值帶新 id）
  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  assert.equal(data.bookings[0].calendarEventId, 'NEW_GC_EVT');
});

test('bookingsCommit：gc.mode=create 但 Calendar API 失敗 → RMW 已成功（booking 已寫入，無 calendarEventId），gcErrors 記錄失敗原因', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = baseRouter([
    [new RegExp('^/calendars/' + encodeURIComponent(CAL_ID) + '/events$'), { method: 'POST', fn: () => { throw new Error('Calendar API 掛了'); } }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'bookingsCommit', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    ops: [{ op: 'upsert', booking: { id: 'BK2', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山' }, gc: { mode: 'create', params: gcParamsFor('2026-07-15') } }],
  }));

  assert.equal(r.success, true);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.gcErrors.length, 1);
  assert.equal(r.data.gcErrors[0].id, 'BK2');
  assert.equal(r.data.bookings[0].calendarEventId, undefined);

  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  assert.equal(data.bookings.length, 1, 'RMW 本身仍應成功寫入，不因 GC 失敗而回滾');
});

// ── gc.mode='update' ──────────────────────────────────────────────────

test('bookingsCommit：gc.mode=update → 呼叫 PATCH（不新增 booking 的 calendarEventId，因為既有值不變）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  // 先建一筆既有 booking（帶 calendarEventId）
  commitActions.bookingsCommit(db, { ops: [{ op: 'upsert', booking: { id: 'BK3', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山', calendarEventId: 'EXIST_EVT' } }] }, CTX);

  let seenUrl;
  const handler = baseRouter([
    [/^\/calendars\/.+\/events\/EXIST_EVT$/, { method: 'PATCH', fn: (m) => { seenUrl = m[0]; return {}; } }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'bookingsCommit', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    ops: [{ op: 'upsert', booking: { id: 'BK3', date: '2026-07-15', startTime: '11:00', endTime: '12:00', room: '玉山', calendarEventId: 'EXIST_EVT' }, gc: { mode: 'update', params: gcParamsFor('2026-07-15') } }],
    checkConflicts: false,
  }));

  assert.equal(r.success, true);
  assert.equal(r.data.gcErrors.length, 0);
  assert.ok(seenUrl, 'PATCH 應被呼叫');
});

// ── gc.mode='none'（如 GC 同步流程自身寫回，不應觸發任何 Calendar API）─────

test('bookingsCommit：gc.mode=none 或未帶 gc → 完全不觸網，gcErrors 恆為空', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = async (_t, reqPath) => { throw new Error('不應觸網：' + reqPath); };

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'bookingsCommit', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    ops: [{ op: 'upsert', booking: { id: 'BK4', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山' }, gc: { mode: 'none' } }],
  }));

  assert.equal(r.success, true);
  assert.deepEqual(r.data.gcErrors, []);
});

// ── delete op + gcEventId ──────────────────────────────────────────────

test('bookingsCommit：delete op 帶 gcEventId → 呼叫 DELETE', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  commitActions.bookingsCommit(db, { ops: [{ op: 'upsert', booking: { id: 'BK5', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山', calendarEventId: 'DEL_EVT' } }] }, CTX);

  let deleteCalled = false;
  const handler = baseRouter([
    [/^\/calendars\/.+\/events\/DEL_EVT$/, { method: 'DELETE', fn: () => { deleteCalled = true; return {}; } }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'bookingsCommit', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    ops: [{ op: 'delete', id: 'BK5', gcEventId: 'DEL_EVT' }],
  }));

  assert.equal(r.success, true);
  assert.equal(deleteCalled, true);
});

// ── 未設定 CALENDAR_SYNC_CREDS：維持 Phase 1.5 行為（僅 RMW，不觸網，gcErrors 恆為空）───

test('bookingsCommit：未設定 CALENDAR_SYNC_CREDS → 即使帶 gc.mode=create 也完全不觸網，行為等同 Phase 1.5', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig({ CALENDAR_SYNC_CREDS: '' });

  const r = await handleRequest(db, config, {
    action: 'bookingsCommit', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    ops: [{ op: 'upsert', booking: { id: 'BK6', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山' }, gc: { mode: 'create', params: gcParamsFor('2026-07-15') } }],
  });

  assert.equal(r.success, true);
  assert.equal(r.data.ok, true);
  assert.deepEqual(r.data.gcErrors, []);
  assert.equal(r.data.bookings[0].calendarEventId, undefined);
});

// ── 撞房衝突：Phase 1 即擋下，完全不做 GC 操作 ──────────────────────────

test('bookingsCommit：撞房衝突 → 回傳 conflict，不呼叫任何 Calendar API', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  commitActions.bookingsCommit(db, { ops: [{ op: 'upsert', booking: { id: 'BK7', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山' } }] }, CTX);

  const handler = async (_t, reqPath) => { throw new Error('不應觸網：' + reqPath); };
  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'bookingsCommit', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    ops: [{ op: 'upsert', booking: { id: 'BK8', date: '2026-07-15', startTime: '09:30', endTime: '10:30', room: '玉山' }, gc: { mode: 'create', params: gcParamsFor('2026-07-15') } }],
    checkConflicts: true,
  }));

  assert.equal(r.success, true);
  assert.equal(r.data.error, 'conflict');
});
