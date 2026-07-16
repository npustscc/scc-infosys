// server/test/dispatch-calendar.test.js — 日曆同步 7 個 action（createCalendarEvent／
// updateCalendarEvent／deleteCalendarEvent／listCalendarEvents／shareCalendarWriters／
// gcAnnotateEvent／getCalendarMeta）經 dispatch.handleRequest 的整合測試（:memory: db，直接呼叫
// handleRequest，比照 test/dispatch-mental-leaves.test.js 寫法）。Calendar REST 呼叫透過
// monkey-patch src/google/calendar.js 的 calendarFetch（所有高階 helper 內部皆透過
// exports.calendarFetch 呼叫，patch 這一個底層函式即可攔截全部）避免觸網；OAuth token 交換同樣
// monkey-patch src/google/auth.js。
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

const ROOT = 'ROOT_GC_DISPATCH_TEST';
const CAL_NAME = 'SCC 空間預約（測試）';
const CAL_ID = 'cal-test-id@group.calendar.google.com';

function tmpCredsFile() {
  const p = path.join(os.tmpdir(), 'scc-test-gc-creds-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify({ client_id: 'cid', client_secret: 'cs', refresh_token: 'rt' }));
  return p;
}

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-gc-dispatch',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    CALENDAR_SYNC_CREDS: tmpCredsFile(),
    GC_CALENDAR_NAME: CAL_NAME,
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

// 每個測試各自 monkey-patch／還原。calendarFetchHandler 依 (accessToken, path, opts) 判斷回應，
// 未命中的路徑丟明確錯誤，避免測試靜默通過非預期的呼叫。
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

// 標準的 calendarList 回應：唯一一顆符合 CAL_NAME 的日曆。events 由呼叫端逐測試客製。
function baseRouter(extraHandlers) {
  return async (_accessToken, reqPath, opts) => {
    opts = opts || {};
    if (reqPath.startsWith('/users/me/calendarList')) {
      return { items: [{ id: CAL_ID, summary: CAL_NAME }] };
    }
    for (const [matcher, handler] of extraHandlers) {
      const m = reqPath.match(matcher);
      if (m && (!handler.method || (opts.method || 'GET') === handler.method)) {
        return handler.fn(m, opts);
      }
    }
    throw new Error('unexpected calendarFetch call: ' + (opts.method || 'GET') + ' ' + reqPath);
  };
}

// ── createCalendarEvent ──────────────────────────────────────────────

test('createCalendarEvent：成功 → 回傳新事件 id（REST 格式字串，不含 @google.com 後綴）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  let seenBody;
  const handler = baseRouter([
    [new RegExp('^/calendars/' + encodeURIComponent(CAL_ID) + '/events$'), { method: 'POST', fn: (_m, opts) => { seenBody = opts.body; return { id: 'NEW_EVT_ID' }; } }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'createCalendarEvent', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    room: '玉山', customRoom: '', date: '2026-07-15', startTime: '09:00', endTime: '10:00',
    counselorName: '王小明', notes: '個別諮商', creatorName: '王小明', createdAt: '2026-07-14T00:00:00.000Z', bkSerial: 3,
  }));

  assert.equal(r.success, true);
  assert.equal(r.data, 'NEW_EVT_ID');
  assert.equal(seenBody.summary, '玉.王小明');
  assert.match(seenBody.description, /個別諮商/);
  assert.equal(seenBody.start.dateTime, '2026-07-15T09:00:00+08:00');
});

test('createCalendarEvent：colorId 另一次 PATCH 失敗 → 不影響事件建立成功（對映 GAS event.setColor try/catch）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = baseRouter([
    [new RegExp('^/calendars/' + encodeURIComponent(CAL_ID) + '/events$'), { method: 'POST', fn: () => ({ id: 'NEW2' }) }],
    [new RegExp('^/calendars/' + encodeURIComponent(CAL_ID) + '/events/NEW2$'), { method: 'PATCH', fn: () => { const e = new Error('bad colorId'); e.status = 400; throw e; } }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'createCalendarEvent', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    room: '玉山', date: '2026-07-15', startTime: '09:00', endTime: '10:00', colorId: '99',
  }));

  assert.equal(r.success, true);
  assert.equal(r.data, 'NEW2');
});

test('createCalendarEvent：未設定 CALENDAR_SYNC_CREDS → 業務失敗（fail envelope）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig({ CALENDAR_SYNC_CREDS: '' });

  const r = await handleRequest(db, config, { action: 'createCalendarEvent', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });
  assert.equal(r.success, false);
  assert.match(r.error, /CALENDAR_SYNC_CREDS/);
});

// ── updateCalendarEvent ──────────────────────────────────────────────

test('updateCalendarEvent：成功 → { ok: true }；eventId 帶舊版 @google.com 後綴時 PATCH 呼叫用正規化後的 id', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  let seenUrl;
  const handler = baseRouter([
    [new RegExp('^/calendars/' + encodeURIComponent(CAL_ID) + '/events/(.+)$'), { method: 'PATCH', fn: (m, opts) => { seenUrl = m[0]; return { id: m[1] }; } }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'updateCalendarEvent', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    eventId: 'legacyEvt@google.com', room: '玉山', date: '2026-07-15', startTime: '09:00', endTime: '10:00', isEdit: true,
  }));

  assert.equal(r.success, true);
  assert.deepEqual(r.data, { ok: true });
  assert.ok(seenUrl.endsWith('/events/legacyEvt'), 'PATCH 應打正規化後（無 @google.com 後綴）的 eventId：' + seenUrl);
});

test('updateCalendarEvent：事件已不存在（404）→ throw "Event not found: <eventId>"（逐字對齊 GAS）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = baseRouter([
    [/^\/calendars\/.+\/events\/.+$/, { method: 'PATCH', fn: () => { const e = new Error('Not Found'); e.status = 404; throw e; } }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'updateCalendarEvent', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    eventId: 'gone123', room: '玉山', date: '2026-07-15', startTime: '09:00', endTime: '10:00',
  }));

  assert.equal(r.success, false);
  assert.equal(r.error, 'Event not found: gone123');
});

// ── deleteCalendarEvent ──────────────────────────────────────────────

test('deleteCalendarEvent：成功 → { ok: true }', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = baseRouter([
    [/^\/calendars\/.+\/events\/.+$/, { method: 'DELETE', fn: () => ({}) }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'deleteCalendarEvent', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, eventId: 'evtX',
  }));

  assert.equal(r.success, true);
  assert.deepEqual(r.data, { ok: true });
});

test('deleteCalendarEvent：事件已不存在（404）→ 視為 no-op，仍回 { ok: true }（不 throw，對映 GAS getEventById 找不到即略過）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = baseRouter([
    [/^\/calendars\/.+\/events\/.+$/, { method: 'DELETE', fn: () => { const e = new Error('gone'); e.status = 404; throw e; } }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'deleteCalendarEvent', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, eventId: 'alreadyGone',
  }));

  assert.equal(r.success, true);
  assert.deepEqual(r.data, { ok: true });
});

// ── listCalendarEvents ───────────────────────────────────────────────

test('listCalendarEvents：回傳陣列，形狀對映 GAS listCalendarEvents_', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = baseRouter([
    [/^\/calendars\/.+\/events\?/, { method: 'GET', fn: () => ({
      items: [{
        id: 'evt1', summary: '玉.王小明', description: '備註',
        start: { dateTime: '2026-07-15T09:00:00+08:00' }, end: { dateTime: '2026-07-15T10:00:00+08:00' },
        updated: '2026-07-14T00:00:00.000Z', creator: { email: 'a@x.com' }, colorId: '3',
      }],
    }) }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'listCalendarEvents', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
    startDate: '2026-07-01', endDate: '2026-07-31',
  }));

  assert.equal(r.success, true);
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].id, 'evt1');
  assert.equal(r.data[0].date, '2026-07-15');
  assert.equal(r.data[0].startTime, '09:00');
});

// ── gcAnnotateEvent ──────────────────────────────────────────────────

test('gcAnnotateEvent：成功補註 → { ok: true, skipped: false }', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  let patchedBody;
  const handler = baseRouter([
    [/^\/calendars\/.+\/events\/evtA$/, { method: 'GET', fn: () => ({ description: '原本備註' }) }],
    [/^\/calendars\/.+\/events\/evtA$/, { method: 'PATCH', fn: (_m, opts) => { patchedBody = opts.body; return {}; } }],
  ]);

  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'gcAnnotateEvent', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, eventId: 'evtA', noteText: '補充事項',
  }));

  assert.equal(r.success, true);
  assert.deepEqual(r.data, { ok: true, skipped: false });
  assert.equal(patchedBody.description, '原本備註\n---\n補充事項');
});

// ── getCalendarMeta ──────────────────────────────────────────────────

test('getCalendarMeta：回傳 { calendarId }', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = baseRouter([]);
  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'getCalendarMeta', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
  }));

  assert.equal(r.success, true);
  assert.deepEqual(r.data, { calendarId: CAL_ID });
});

test('getCalendarMeta：日曆同名找到 0 筆 → fail envelope，含 GAS 逐字錯誤訊息', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = async (_t, reqPath) => {
    if (reqPath.startsWith('/users/me/calendarList')) return { items: [] };
    throw new Error('unexpected: ' + reqPath);
  };
  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'getCalendarMeta', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
  }));

  assert.equal(r.success, false);
  assert.match(r.error, /找不到日曆/);
});

test('getCalendarMeta：日曆同名找到多筆 → fail envelope，含 GAS 逐字錯誤訊息', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'a@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'a@x.com', 'right-password');
  const config = testConfig();

  const handler = async (_t, reqPath) => {
    if (reqPath.startsWith('/users/me/calendarList')) return { items: [{ id: 'A', summary: CAL_NAME }, { id: 'B', summary: CAL_NAME }] };
    throw new Error('unexpected: ' + reqPath);
  };
  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'getCalendarMeta', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
  }));

  assert.equal(r.success, false);
  assert.match(r.error, /找到 2 顆同名日曆/);
});

// ── shareCalendarWriters（含閘門：非管理者僅能對自己）─────────────────

test('shareCalendarWriters：管理者可授權任意 email', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'admin@x.com', 'right-password', { role: '主任' });
  const login1 = await login(db, testConfig(), 'admin@x.com', 'right-password');
  const config = testConfig();

  const handler = baseRouter([
    [/^\/calendars\/.+\/acl$/, { method: 'POST', fn: () => ({}) }],
  ]);
  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'shareCalendarWriters', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, emails: ['other@x.com'],
  }));

  assert.equal(r.success, true);
  assert.deepEqual(r.data.granted, ['other@x.com']);
});

test('shareCalendarWriters：非管理者授權他人（非自己）→ Forbidden（閘門擋下，不觸網）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'staff@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'staff@x.com', 'right-password');
  const config = testConfig();

  const r = await handleRequest(db, config, {
    action: 'shareCalendarWriters', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, emails: ['other@x.com'],
  });

  assert.equal(r.data.error, 'Forbidden: non-admin may only share to self');
});

test('shareCalendarWriters：非管理者授權自己（自助日曆連結）→ 放行', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'staff@x.com', 'right-password');
  const login1 = await login(db, testConfig(), 'staff@x.com', 'right-password');
  const config = testConfig();

  const handler = baseRouter([
    [/^\/calendars\/.+\/acl$/, { method: 'POST', fn: () => ({}) }],
  ]);
  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'shareCalendarWriters', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, emails: ['staff@x.com'],
  }));

  assert.equal(r.success, true);
  assert.deepEqual(r.data.granted, ['staff@x.com']);
});

test('shareCalendarWriters：revoke:true → 呼叫 acl delete，回傳 removed', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'admin@x.com', 'right-password', { role: '主任' });
  const login1 = await login(db, testConfig(), 'admin@x.com', 'right-password');
  const config = testConfig();

  let seenMethod;
  const handler = baseRouter([
    [/^\/calendars\/.+\/acl\/.+$/, { method: 'DELETE', fn: (_m, opts) => { seenMethod = opts.method; return {}; } }],
  ]);
  const r = await withPatched(handler, () => handleRequest(db, config, {
    action: 'shareCalendarWriters', sessionToken: login1.data.sessionToken, rootFolderId: ROOT, emails: ['other@x.com'], revoke: true,
  }));

  assert.equal(r.success, true);
  assert.equal(seenMethod, 'DELETE');
  assert.deepEqual(r.data.removed, ['other@x.com']);
});
