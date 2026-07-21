// server/test/openmail-offboard.test.js — v236：學諮系統資料夾離職清理排程
// （openmail/offboardSweep.js，migrations/010_omsv_offboard_grace.sql）。
//
// 直接測 sweepWithUsers（純函式，不需要 vdrive/config），比照 openmail-archive.test.js 的
// in-memory db + migrations 手法。核心關切：users 讀不到／全空／全停用時的 fail-safe 護欄
// （一根汗毛都不能動），以及寬限鐘的起算/歸零/跨 owner 隔離。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const credStore = require('../src/openmail/credStore');
const offboardSweep = require('../src/openmail/offboardSweep');

const GRACE_DAYS = 90;
const DAY_MS = 24 * 3600 * 1000;

function seedFolder(db, owner, name) {
  return db.prepare('INSERT INTO openmail_archive_folders (owner_email, name) VALUES (?, ?)').run(owner, name).lastInsertRowid;
}
function seedMessage(db, folderId, owner) {
  return db.prepare(
    `INSERT INTO openmail_archive_messages (folder_id, owner_email, subject, size_bytes, source) VALUES (?, ?, ?, ?, ?)`
  ).run(folderId, owner, 'test subject', 10, Buffer.from('hello')).lastInsertRowid;
}
function seedSavedCred(db, owner) {
  db.prepare(`INSERT INTO openmail_saved_creds (owner_email, enc) VALUES (?, ?)`).run(owner, 'fake.enc.value');
}
function countFolders(db, owner) {
  return db.prepare('SELECT COUNT(*) AS n FROM openmail_archive_folders WHERE owner_email = ?').get(owner).n;
}
function countMessages(db, owner) {
  return db.prepare('SELECT COUNT(*) AS n FROM openmail_archive_messages WHERE owner_email = ?').get(owner).n;
}
function hasSavedCred(db, owner) {
  return !!db.prepare('SELECT 1 FROM openmail_saved_creds WHERE owner_email = ?').get(owner);
}
function graceRow(db, owner) {
  return db.prepare('SELECT * FROM openmail_offboard_grace WHERE owner_email = ?').get(owner);
}

// ── 護欄：users 讀不到／非物件／全空／全停用 → skipped:true，資料一根汗毛都沒動 ──

function seedUntouchableFixture(db) {
  const owner = 'guarded-user@x.com';
  const folderId = seedFolder(db, owner, '個案往來');
  seedMessage(db, folderId, owner);
  seedSavedCred(db, owner);
  return owner;
}

test('users 為 null → skipped:true，封存與 saved_creds 都不動', () => {
  const db = openDb(':memory:');
  const owner = seedUntouchableFixture(db);

  const result = offboardSweep.sweepWithUsers(db, null, GRACE_DAYS);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'users_unavailable_or_empty');
  assert.equal(countFolders(db, owner), 1);
  assert.equal(countMessages(db, owner), 1);
  assert.equal(hasSavedCred(db, owner), true);
  assert.equal(graceRow(db, owner), undefined);
});

test('users 為非物件（字串/陣列）→ skipped:true，資料不動', () => {
  const db = openDb(':memory:');
  const owner = seedUntouchableFixture(db);

  assert.equal(offboardSweep.sweepWithUsers(db, 'not-an-object', GRACE_DAYS).skipped, true);
  assert.equal(offboardSweep.sweepWithUsers(db, ['a', 'b'], GRACE_DAYS).skipped, true);
  assert.equal(countFolders(db, owner), 1);
  assert.equal(countMessages(db, owner), 1);
  assert.equal(hasSavedCred(db, owner), true);
});

test('users 為 {}（空物件）→ skipped:true，資料不動', () => {
  const db = openDb(':memory:');
  const owner = seedUntouchableFixture(db);

  const result = offboardSweep.sweepWithUsers(db, {}, GRACE_DAYS);
  assert.equal(result.skipped, true);
  assert.equal(countFolders(db, owner), 1);
  assert.equal(hasSavedCred(db, owner), true);
});

test('users 全部 disabled:true（無任何未停用使用者）→ skipped:true，資料不動，連寬限鐘都不動', () => {
  const db = openDb(':memory:');
  const owner = seedUntouchableFixture(db);
  const users = {
    'a@x.com': { disabled: true },
    'b@x.com': { disabled: true },
    [owner]: { disabled: true },
  };

  const result = offboardSweep.sweepWithUsers(db, users, GRACE_DAYS);
  assert.equal(result.skipped, true);
  assert.equal(countFolders(db, owner), 1);
  assert.equal(countMessages(db, owner), 1);
  assert.equal(hasSavedCred(db, owner), true);
  assert.equal(graceRow(db, owner), undefined); // 連寬限鐘都不該啟動
});

// ── active 使用者：一切不動 ──

test('active 使用者：封存與 saved_creds 都不動，也不會有寬限列', () => {
  const db = openDb(':memory:');
  const owner = 'active-user@x.com';
  const otherActive = 'other-active@x.com'; // 用來滿足「至少一個未停用使用者」的護欄
  const folderId = seedFolder(db, owner, '個案往來');
  seedMessage(db, folderId, owner);
  seedSavedCred(db, owner);

  const users = { [owner]: { disabled: false }, [otherActive]: { disabled: false } };
  const result = offboardSweep.sweepWithUsers(db, users, GRACE_DAYS);

  assert.equal(result.skipped, false);
  assert.equal(countFolders(db, owner), 1);
  assert.equal(countMessages(db, owner), 1);
  assert.equal(hasSavedCred(db, owner), true);
  assert.equal(graceRow(db, owner), undefined);
});

// ── 停用使用者：creds 立即刪＋credStore 清除；封存不動；寬限鐘起算 ──

test('停用使用者：saved_creds 立即刪除且 credStore 記憶體也被清除；封存不動；寬限鐘起算', () => {
  const db = openDb(':memory:');
  const owner = 'disabled-user@x.com';
  const otherActive = 'other-active@x.com';
  const folderId = seedFolder(db, owner, '個案往來');
  seedMessage(db, folderId, owner);
  seedSavedCred(db, owner);
  credStore.set(owner, 'mailUser', 'mailPass');
  assert.notEqual(credStore.get(owner), null); // 前置驗證：記憶體確實有值

  const users = { [owner]: { disabled: true }, [otherActive]: { disabled: false } };
  const result = offboardSweep.sweepWithUsers(db, users, GRACE_DAYS);

  assert.equal(result.skipped, false);
  assert.deepEqual(result.credsRemoved, [owner]);
  assert.deepEqual(result.graceStarted, [owner]);
  assert.equal(hasSavedCred(db, owner), false);
  assert.equal(credStore.get(owner), null); // credStore 也被清除
  assert.equal(countFolders(db, owner), 1); // 封存本身不受影響
  assert.equal(countMessages(db, owner), 1);
  assert.ok(graceRow(db, owner)); // 寬限鐘已啟動

  credStore.clear(owner); // 測試收尾，避免污染其他測試（模組級 Map）
});

test('未滿 90 天再跑一次 sweep：不刪除，寬限列不重複新增', () => {
  const db = openDb(':memory:');
  const owner = 'disabled-user-2@x.com';
  const otherActive = 'other-active@x.com';
  const folderId = seedFolder(db, owner, '個案往來');
  seedMessage(db, folderId, owner);
  const users = { [owner]: { disabled: true }, [otherActive]: { disabled: false } };

  const first = offboardSweep.sweepWithUsers(db, users, GRACE_DAYS);
  assert.deepEqual(first.graceStarted, [owner]);
  const firstGrace = graceRow(db, owner);
  assert.ok(firstGrace);

  // 隔天再跑一次（遠低於 90 天）
  const second = offboardSweep.sweepWithUsers(db, users, GRACE_DAYS, Date.now() + 1 * DAY_MS);
  assert.equal(second.skipped, false);
  assert.deepEqual(second.graceStarted, []); // 不重複新增
  assert.deepEqual(second.purged, []);       // 未滿寬限不刪
  assert.equal(countFolders(db, owner), 1);
  assert.equal(countMessages(db, owner), 1);
  const secondGrace = graceRow(db, owner);
  assert.equal(secondGrace.first_seen_disabled_at, firstGrace.first_seen_disabled_at); // 鐘沒被重置
});

// ── 快轉 90 天：封存整批刪除，其他 owner 不受影響 ──

test('注入 nowMs 快轉 90 天後：封存 folders+messages 與寬限列全刪；其他 owner 資料不受波及', () => {
  const db = openDb(':memory:');
  const owner = 'purge-target@x.com';
  const untouchedOwner = 'untouched-owner@x.com';
  const otherActive = 'other-active@x.com';

  const folderId1 = seedFolder(db, owner, '資料夾一');
  const folderId2 = seedFolder(db, owner, '資料夾二');
  seedMessage(db, folderId1, owner);
  seedMessage(db, folderId1, owner);
  seedMessage(db, folderId2, owner);

  const untouchedFolderId = seedFolder(db, untouchedOwner, '別人的資料夾');
  seedMessage(db, untouchedFolderId, untouchedOwner);

  const users = {
    [owner]: { disabled: true },
    [untouchedOwner]: { disabled: false },
    [otherActive]: { disabled: false },
  };

  const t0 = Date.now();
  const first = offboardSweep.sweepWithUsers(db, users, GRACE_DAYS, t0);
  assert.deepEqual(first.graceStarted, [owner]);

  // 快轉超過 90 天
  const later = t0 + (GRACE_DAYS * DAY_MS) + DAY_MS;
  const second = offboardSweep.sweepWithUsers(db, users, GRACE_DAYS, later);

  assert.equal(second.skipped, false);
  assert.equal(second.purged.length, 1);
  assert.equal(second.purged[0].owner, owner);
  assert.equal(second.purged[0].folders, 2);
  assert.equal(second.purged[0].messages, 3);

  assert.equal(countFolders(db, owner), 0);
  assert.equal(countMessages(db, owner), 0);
  assert.equal(graceRow(db, owner), undefined);

  // 其他 owner（未停用）完全不受影響
  assert.equal(countFolders(db, untouchedOwner), 1);
  assert.equal(countMessages(db, untouchedOwner), 1);
});

// ── 重新啟用：寬限列被刪（鐘歸零），封存仍在；之後再停用會重新起算 ──

test('重新啟用：寬限列被刪除（鐘歸零），封存仍保留；之後再停用則重新起算', () => {
  const db = openDb(':memory:');
  const owner = 'reactivate-user@x.com';
  const otherActive = 'other-active@x.com';
  const folderId = seedFolder(db, owner, '個案往來');
  seedMessage(db, folderId, owner);

  const disabledUsers = { [owner]: { disabled: true }, [otherActive]: { disabled: false } };
  const t0 = Date.now();
  const first = offboardSweep.sweepWithUsers(db, disabledUsers, GRACE_DAYS, t0);
  assert.deepEqual(first.graceStarted, [owner]);
  assert.ok(graceRow(db, owner));

  // 重新啟用
  const activeUsers = { [owner]: { disabled: false }, [otherActive]: { disabled: false } };
  const reactivateTime = t0 + 5 * DAY_MS;
  const second = offboardSweep.sweepWithUsers(db, activeUsers, GRACE_DAYS, reactivateTime);
  assert.deepEqual(second.reactivated, [owner]);
  assert.equal(graceRow(db, owner), undefined); // 鐘歸零
  assert.equal(countFolders(db, owner), 1); // 封存仍在
  assert.equal(countMessages(db, owner), 1);

  // 之後再次停用：從這次的時間點重新起算，不沿用之前累積的天數
  const redisableTime = reactivateTime + 1 * DAY_MS;
  const third = offboardSweep.sweepWithUsers(db, disabledUsers, GRACE_DAYS, redisableTime);
  assert.deepEqual(third.graceStarted, [owner]);
  const newGrace = graceRow(db, owner);
  assert.ok(newGrace);
  assert.equal(Date.parse(newGrace.first_seen_disabled_at), redisableTime);

  // 快轉：距離「原本第一次停用」已經超過 90 天，但距離「重新起算」的時間點還沒到 90 天 → 不該刪
  const notEnoughAfterRestart = redisableTime + 10 * DAY_MS;
  const fourth = offboardSweep.sweepWithUsers(db, disabledUsers, GRACE_DAYS, notEnoughAfterRestart);
  assert.deepEqual(fourth.purged, []);
  assert.equal(countFolders(db, owner), 1);
});

// ── owner 整個從 users 移除（帳號被刪）視同停用 ──

test('owner 不在 users 裡（帳號整個被移除）視同停用：立即清 creds、啟動寬限鐘', () => {
  const db = openDb(':memory:');
  const owner = 'removed-user@x.com';
  const otherActive = 'other-active@x.com';
  const folderId = seedFolder(db, owner, '個案往來');
  seedMessage(db, folderId, owner);
  seedSavedCred(db, owner);

  const users = { [otherActive]: { disabled: false } }; // owner 完全不在表內
  const result = offboardSweep.sweepWithUsers(db, users, GRACE_DAYS);

  assert.equal(result.skipped, false);
  assert.deepEqual(result.credsRemoved, [owner]);
  assert.deepEqual(result.graceStarted, [owner]);
  assert.equal(hasSavedCred(db, owner), false);
  assert.equal(countFolders(db, owner), 1); // 封存仍受寬限保護，未到期不刪
});
