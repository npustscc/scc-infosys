// server/test/dispatch-disk-health.test.js — v221 磁碟健康度：adminGetDiskHealth 整合測試
// （:memory: db，經 dispatch.handleRequest）。比照 test/dispatch-admin-users.test.js 的寫法。
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

const ROOT = 'ROOT_DISK_HEALTH_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-disk-health',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    TRUSTED_DEVICE_DAYS: 30,
    SMART_STATUS_PATH: '',
  }, overrides || {});
}

async function setupConfigUsers(db, usersMap) {
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: usersMap } });
}

async function login(db, config, email, password) {
  const p = { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' };
  return handleRequest(db, config, p);
}

async function setupAdminAndStaff(db, config) {
  await local.upsertUser(db, 'admin@x.com', 'admin-pw-123456');
  await local.upsertUser(db, 'staff@x.com', 'staff-pw-123456');
  await setupConfigUsers(db, {
    'admin@x.com': { role: '主任' },
    'staff@x.com': { role: '專任諮商心理師' },
  });
  const adminLogin = await login(db, config, 'admin@x.com', 'admin-pw-123456');
  const staffLogin = await login(db, config, 'staff@x.com', 'staff-pw-123456');
  return { adminTok: adminLogin.data.sessionToken, staffTok: staffLogin.data.sessionToken };
}

test('adminGetDiskHealth：非管理者呼叫 → Forbidden: admin only', async () => {
  const db = openDb(':memory:');
  const config = testConfig({ SMART_STATUS_PATH: path.join(os.tmpdir(), 'does-not-matter.json') });
  const { staffTok } = await setupAdminAndStaff(db, config);
  const r = await handleRequest(db, config, {
    action: 'adminGetDiskHealth', sessionToken: staffTok, rootFolderId: ROOT,
  });
  assert.equal(r.data.error, 'Forbidden: admin only');
});

test('adminGetDiskHealth：未設定 SMART_STATUS_PATH → smart_not_configured', async () => {
  const db = openDb(':memory:');
  const config = testConfig({ SMART_STATUS_PATH: '' });
  const { adminTok } = await setupAdminAndStaff(db, config);
  const r = await handleRequest(db, config, {
    action: 'adminGetDiskHealth', sessionToken: adminTok, rootFolderId: ROOT,
  });
  assert.equal(r.data.error, 'smart_not_configured');
});

test('adminGetDiskHealth：設定但檔案不存在 → smart_not_available', async () => {
  const db = openDb(':memory:');
  const config = testConfig({ SMART_STATUS_PATH: path.join(os.tmpdir(), 'scc-smart-test-missing-' + Date.now() + '.json') });
  const { adminTok } = await setupAdminAndStaff(db, config);
  const r = await handleRequest(db, config, {
    action: 'adminGetDiskHealth', sessionToken: adminTok, rootFolderId: ROOT,
  });
  assert.equal(r.data.error, 'smart_not_available');
});

test('adminGetDiskHealth：設定但檔案內容非合法 JSON → smart_not_available', async () => {
  const db = openDb(':memory:');
  const fixturePath = path.join(os.tmpdir(), 'scc-smart-test-badjson-' + Date.now() + '.json');
  fs.writeFileSync(fixturePath, '{not valid json');
  const config = testConfig({ SMART_STATUS_PATH: fixturePath });
  try {
    const { adminTok } = await setupAdminAndStaff(db, config);
    const r = await handleRequest(db, config, {
      action: 'adminGetDiskHealth', sessionToken: adminTok, rootFolderId: ROOT,
    });
    assert.equal(r.data.error, 'smart_not_available');
  } finally {
    fs.unlinkSync(fixturePath);
  }
});

test('adminGetDiskHealth：正常讀檔 → 原樣回傳＋statusPath 旗標', async () => {
  const db = openDb(':memory:');
  const fixturePath = path.join(os.tmpdir(), 'scc-smart-test-ok-' + Date.now() + '.json');
  const fixture = {
    generatedAt: '2026-07-20T03:00:00.000Z',
    host: 'scc-server',
    disks: [
      {
        device: '/dev/sda', model: 'ST1000DM003', serial: 'ABC123',
        capacityBytes: 1000204886016, rotationRate: 7200, smartPassed: true,
        temperatureC: 38, powerOnHours: 12000,
        ataAttrs: {
          reallocated_sectors: { value: 100, worst: 100, thresh: 36, raw: 0 },
          pending_sectors: { value: 100, worst: 100, thresh: 0, raw: 0 },
          offline_uncorrectable: { value: 100, worst: 100, thresh: 0, raw: 0 },
          reported_uncorrect: { value: 100, worst: 100, thresh: 0, raw: 0 },
        },
        nvme: null,
        selfTestStatus: 'Completed without error',
      },
    ],
  };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  const config = testConfig({ SMART_STATUS_PATH: fixturePath });
  try {
    const { adminTok } = await setupAdminAndStaff(db, config);
    const r = await handleRequest(db, config, {
      action: 'adminGetDiskHealth', sessionToken: adminTok, rootFolderId: ROOT,
    });
    assert.equal(r.data.error, undefined);
    assert.equal(r.data.statusPath, true);
    assert.equal(r.data.generatedAt, fixture.generatedAt);
    assert.equal(r.data.host, 'scc-server');
    assert.equal(r.data.disks.length, 1);
    assert.equal(r.data.disks[0].model, 'ST1000DM003');
  } finally {
    fs.unlinkSync(fixturePath);
  }
});

test('adminGetDiskHealth：未登入呼叫 → Session expired（先卡在步驟 1，不會走到 admin 閘）', async () => {
  const db = openDb(':memory:');
  const config = testConfig({ SMART_STATUS_PATH: path.join(os.tmpdir(), 'does-not-matter2.json') });
  await setupAdminAndStaff(db, config);
  const r = await handleRequest(db, config, { action: 'adminGetDiskHealth', rootFolderId: ROOT });
  assert.equal(r.data.error, 'Session expired');
});
