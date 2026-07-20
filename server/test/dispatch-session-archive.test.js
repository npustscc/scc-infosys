// server/test/dispatch-session-archive.test.js — 登入紀錄封存（archiveMySessions／listMySessions
// 的 archived 欄位）與管理者登入紀錄總覽／封存（adminListAllSessions／adminArchiveSessions，v214）
// 整合測試（:memory: db，經 dispatch.handleRequest）。比照 test/dispatch-trusted-devices.test.js 的
// 手法：sessions.json 是單一整檔，用 vdrive.readJson/updateJson 直接注入模擬的「舊裝置／已過期」
// 紀錄，不需要真的等待 session 過期。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');

const ROOT = 'ROOT_SESSION_ARCHIVE_TEST';
const ctx = { root: ROOT };

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-session-archive',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    TRUSTED_DEVICE_DAYS: 30,
  }, overrides || {});
}

async function setupConfigUsers(db, usersMap) {
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: usersMap } });
}

async function login(db, config, email, password) {
  return handleRequest(db, config, { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
}

// 直接把一筆「假的過期紀錄」塞進 sessions.json（模擬很久以前的登入），不需要真的等待過期。
function injectExpiredSession(db, email, jti) {
  const { data } = vdrive.readJson(db, 'sessions.json', ctx);
  const nowSec = Math.floor(Date.now() / 1000);
  data.sessions.push({
    jti, email, ua: 'old-device', ip: '1.2.3.4', geo: 'TW', cc: 'TW',
    iat: nowSec - 999999, exp: nowSec - 100, // 早已過期
    issuedAtMs: Date.now() - 999999000, issuedAt: new Date(Date.now() - 999999000).toISOString(),
    mailSent: false, mailReason: '',
  });
  vdrive.updateJson(db, 'sessions.json', data, ctx);
}

// 目前這台裝置對應的 jti：登入後 sessions.json 只有這一筆屬於該 email，直接取出。
function currentJtiOf(db, email) {
  const { data } = vdrive.readJson(db, 'sessions.json', ctx);
  const mine = data.sessions.filter((s) => s.email === email);
  mine.sort((a, b) => (b.issuedAtMs || 0) - (a.issuedAtMs || 0));
  return mine[0].jti;
}

async function setupAdminAndStaff(db) {
  await local.upsertUser(db, 'admin@x.com', 'admin-pw-123456');
  await local.upsertUser(db, 'staff@x.com', 'staff-pw-123456');
  await setupConfigUsers(db, {
    'admin@x.com': { role: '主任' },
    'staff@x.com': { role: '專任諮商心理師' },
  });
  const config = testConfig();
  const adminLogin = await login(db, config, 'admin@x.com', 'admin-pw-123456');
  const staffLogin = await login(db, config, 'staff@x.com', 'staff-pw-123456');
  return { config, adminTok: adminLogin.data.sessionToken, staffTok: staffLogin.data.sessionToken };
}

// ══════════════════════════════════════════════════════════════════════════
// listMySessions：archived 欄位
// ══════════════════════════════════════════════════════════════════════════

test('listMySessions：每筆多帶 archived 欄位（未封存過補為 false）', async () => {
  const db = openDb(':memory:');
  const { config, staffTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, { action: 'listMySessions', sessionToken: staffTok, rootFolderId: ROOT });
  assert.equal(r.data.sessions.length, 1);
  assert.equal(r.data.sessions[0].archived, false);
});

// ══════════════════════════════════════════════════════════════════════════
// archiveMySessions
// ══════════════════════════════════════════════════════════════════════════

test('archiveMySessions：使用中（active）的紀錄一律不可封存，即使被指名或 all:true', async () => {
  const db = openDb(':memory:');
  const { config, staffTok } = await setupAdminAndStaff(db);
  const curJti = currentJtiOf(db, 'staff@x.com');

  const byName = await handleRequest(db, config, {
    action: 'archiveMySessions', sessionToken: staffTok, rootFolderId: ROOT, jtis: [curJti],
  });
  assert.equal(byName.data.archived, 0);
  assert.equal(byName.data.skipped, 1, '指名使用中的紀錄應被跳過，不封存');

  const byAll = await handleRequest(db, config, {
    action: 'archiveMySessions', sessionToken: staffTok, rootFolderId: ROOT, all: true,
  });
  assert.equal(byAll.data.archived, 0);
  assert.equal(byAll.data.skipped, 1, 'all:true 時使用中的紀錄同樣應被跳過');

  const list = await handleRequest(db, config, { action: 'listMySessions', sessionToken: staffTok, rootFolderId: ROOT });
  assert.equal(list.data.sessions.find((s) => s.jti === curJti).archived, false, '目前這台裝置不應被封存');
});

test('archiveMySessions：指名 jtis 封存非使用中的紀錄；跨帳號無效（只動自己 email 的紀錄）', async () => {
  const db = openDb(':memory:');
  const { config, staffTok } = await setupAdminAndStaff(db);
  injectExpiredSession(db, 'staff@x.com', 'expired-jti-1');
  injectExpiredSession(db, 'admin@x.com', 'other-user-jti'); // 屬於別人，不該被 staff 封存

  const r = await handleRequest(db, config, {
    action: 'archiveMySessions', sessionToken: staffTok, rootFolderId: ROOT,
    jtis: ['expired-jti-1', 'other-user-jti', 'no-such-jti'],
  });
  assert.equal(r.data.archived, 1, '只有屬於自己且非使用中的那一筆會被封存');
  assert.equal(r.data.skipped, 0, '不存在／不屬於自己的 jti 不計入 skipped（單純無事可做）');

  const listStaff = await handleRequest(db, config, { action: 'listMySessions', sessionToken: staffTok, rootFolderId: ROOT });
  assert.equal(listStaff.data.sessions.find((s) => s.jti === 'expired-jti-1').archived, true);

  // 直接檢查 sessions.json：屬於 admin 的那筆不應被動到。
  const { data } = vdrive.readJson(db, 'sessions.json', ctx);
  const otherRec = data.sessions.find((s) => s.jti === 'other-user-jti');
  assert.equal(!!otherRec.archived, false, '不可跨帳號封存別人的紀錄');
});

test('archiveMySessions：all:true 只封存非使用中且尚未封存的紀錄（已封存的不重複計數）', async () => {
  const db = openDb(':memory:');
  const { config, staffTok } = await setupAdminAndStaff(db);
  injectExpiredSession(db, 'staff@x.com', 'expired-jti-1');
  injectExpiredSession(db, 'staff@x.com', 'expired-jti-2');

  const first = await handleRequest(db, config, { action: 'archiveMySessions', sessionToken: staffTok, rootFolderId: ROOT, all: true });
  assert.equal(first.data.archived, 2, '兩筆過期紀錄應一次封存');
  assert.equal(first.data.skipped, 1, '目前使用中的那一筆應被跳過');

  const second = await handleRequest(db, config, { action: 'archiveMySessions', sessionToken: staffTok, rootFolderId: ROOT, all: true });
  assert.equal(second.data.archived, 0, '已封存過的不應再被計入');
  assert.equal(second.data.skipped, 1, '使用中那一筆依然被跳過');
});

test('archiveMySessions：jtis 與 all 皆未附 → 無事可做，回 archived:0/skipped:0', async () => {
  const db = openDb(':memory:');
  const { config, staffTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, { action: 'archiveMySessions', sessionToken: staffTok, rootFolderId: ROOT });
  assert.deepEqual(r.data, { ok: true, archived: 0, skipped: 0 });
});

test('archiveMySessions：未登入 → Session expired', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), { action: 'archiveMySessions', rootFolderId: ROOT, all: true });
  assert.equal(r.data.error, 'Session expired');
});

// ══════════════════════════════════════════════════════════════════════════
// adminListAllSessions
// ══════════════════════════════════════════════════════════════════════════

test('adminListAllSessions：非管理者呼叫 → Forbidden: admin only；未登入 → Session expired', async () => {
  const db = openDb(':memory:');
  const { config, staffTok } = await setupAdminAndStaff(db);
  const r1 = await handleRequest(db, config, { action: 'adminListAllSessions', sessionToken: staffTok, rootFolderId: ROOT });
  assert.equal(r1.data.error, 'Forbidden: admin only');

  const r2 = await handleRequest(db, config, { action: 'adminListAllSessions', rootFolderId: ROOT });
  assert.equal(r2.data.error, 'Session expired');
});

test('adminListAllSessions：跨全部使用者列出登入紀錄，預設濾掉已封存；includeArchived:true 才看得到', async () => {
  const db = openDb(':memory:');
  const { config, adminTok, staffTok } = await setupAdminAndStaff(db);
  injectExpiredSession(db, 'staff@x.com', 'expired-jti-1');
  await handleRequest(db, config, { action: 'archiveMySessions', sessionToken: staffTok, rootFolderId: ROOT, all: true });

  // 此時 sessions.json 共 3 筆：admin 使用中 1、staff 使用中 1、staff 已封存 1。
  const defaultView = await handleRequest(db, config, { action: 'adminListAllSessions', sessionToken: adminTok, rootFolderId: ROOT });
  assert.equal(defaultView.data.sessions.length, 2, '預設應濾掉已封存的那一筆');
  assert.ok(defaultView.data.sessions.every((s) => !s.archived));

  const withArchived = await handleRequest(db, config, {
    action: 'adminListAllSessions', sessionToken: adminTok, rootFolderId: ROOT, includeArchived: true,
  });
  assert.equal(withArchived.data.sessions.length, 3, 'includeArchived:true 應看到全部 3 筆');
  const archivedOne = withArchived.data.sessions.find((s) => s.jti === 'expired-jti-1');
  assert.ok(archivedOne);
  assert.equal(archivedOne.archived, true);
  assert.equal(archivedOne.email, 'staff@x.com');
  assert.equal(archivedOne.expired, true);
  assert.equal(archivedOne.active, false);
});

// ══════════════════════════════════════════════════════════════════════════
// adminArchiveSessions（v214：管理者「登入紀錄」tab 封存勾選，可跨帳號指名封存）
// ══════════════════════════════════════════════════════════════════════════

test('adminArchiveSessions：非管理者呼叫 → Forbidden: admin only；未登入 → Session expired', async () => {
  const db = openDb(':memory:');
  const { config, staffTok } = await setupAdminAndStaff(db);
  const r1 = await handleRequest(db, config, {
    action: 'adminArchiveSessions', sessionToken: staffTok, rootFolderId: ROOT, items: [],
  });
  assert.equal(r1.data.error, 'Forbidden: admin only');

  const r2 = await handleRequest(db, config, { action: 'adminArchiveSessions', rootFolderId: ROOT, items: [] });
  assert.equal(r2.data.error, 'Session expired');
});

test('adminArchiveSessions：可跨帳號指名封存非使用中的紀錄；active 的紀錄即使被指名也 skip', async () => {
  const db = openDb(':memory:');
  const { config, adminTok, staffTok } = await setupAdminAndStaff(db);
  injectExpiredSession(db, 'staff@x.com', 'expired-jti-1');
  injectExpiredSession(db, 'admin@x.com', 'expired-jti-2');
  const staffCurJti = currentJtiOf(db, 'staff@x.com');

  const r = await handleRequest(db, config, {
    action: 'adminArchiveSessions', sessionToken: adminTok, rootFolderId: ROOT,
    items: [
      { email: 'staff@x.com', jti: 'expired-jti-1' },
      { email: 'admin@x.com', jti: 'expired-jti-2' },
      { email: 'staff@x.com', jti: staffCurJti }, // 使用中，應被跳過
      { email: 'staff@x.com', jti: 'no-such-jti' }, // 找不到，應被跳過
    ],
  });
  assert.equal(r.data.ok, true);
  assert.equal(r.data.archived, 2, '兩筆跨帳號的過期紀錄應一次封存');
  assert.equal(r.data.skipped, 2, '使用中與不存在的各一筆應跳過');

  const withArchived = await handleRequest(db, config, {
    action: 'adminListAllSessions', sessionToken: adminTok, rootFolderId: ROOT, includeArchived: true,
  });
  assert.equal(withArchived.data.sessions.find((s) => s.jti === 'expired-jti-1').archived, true);
  assert.equal(withArchived.data.sessions.find((s) => s.jti === 'expired-jti-2').archived, true);
  assert.equal(withArchived.data.sessions.find((s) => s.jti === staffCurJti).archived, false, '使用中的紀錄不應被封存');

  // 另一名管理者能看到 staff 的紀錄也被真的封存了（不是只在 staff 自己視角），驗證管理端與
  // 自助端（archiveMySessions）動的是同一份 sessions.json。
  const staffView = await handleRequest(db, config, { action: 'listMySessions', sessionToken: staffTok, rootFolderId: ROOT });
  assert.equal(staffView.data.sessions.find((s) => s.jti === 'expired-jti-1').archived, true);
});

test('adminArchiveSessions：items 為空陣列或未附 → 無事可做，回 archived:0/skipped:0', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  const r = await handleRequest(db, config, {
    action: 'adminArchiveSessions', sessionToken: adminTok, rootFolderId: ROOT, items: [],
  });
  assert.deepEqual(r.data, { ok: true, archived: 0, skipped: 0 });

  const r2 = await handleRequest(db, config, {
    action: 'adminArchiveSessions', sessionToken: adminTok, rootFolderId: ROOT,
  });
  assert.deepEqual(r2.data, { ok: true, archived: 0, skipped: 0 });
});

test('adminArchiveSessions：已封存過的紀錄再次指名 → 不重複計數（計入 skipped）', async () => {
  const db = openDb(':memory:');
  const { config, adminTok } = await setupAdminAndStaff(db);
  injectExpiredSession(db, 'staff@x.com', 'expired-jti-1');

  const first = await handleRequest(db, config, {
    action: 'adminArchiveSessions', sessionToken: adminTok, rootFolderId: ROOT,
    items: [{ email: 'staff@x.com', jti: 'expired-jti-1' }],
  });
  assert.equal(first.data.archived, 1);

  const second = await handleRequest(db, config, {
    action: 'adminArchiveSessions', sessionToken: adminTok, rootFolderId: ROOT,
    items: [{ email: 'staff@x.com', jti: 'expired-jti-1' }],
  });
  assert.equal(second.data.archived, 0);
  assert.equal(second.data.skipped, 1);
});
