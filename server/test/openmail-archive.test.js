// server/test/openmail-archive.test.js — v220 學諮伺服器資料夾（openmail/archive.js，
// migrations/007_openmail_archive.sql）：資料夾 CRUD、owner 隔離、非空資料夾拒刪、封存訊息大小
// 上限、封存後刪除原信失敗的降級處理，以及 dispatch 授權閘整合測試。
//
// 資安要求：比照 test/openmail.test.js 既有慣例，本檔不得觸網——omsvArchiveMessage 會呼叫
// openmail/client.js 的 withImap()，測試中一律 monkey-patch 該函式，不打真實的 mail.npust.edu.tw。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const credStore = require('../src/openmail/credStore');
const client = require('../src/openmail/client');
const archive = require('../src/openmail/archive');

const ROOT = 'ROOT_OPENMAIL_ARCHIVE_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-openmail-archive',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
  }, overrides || {});
}

async function setupAuthorizedUser(db, email, password) {
  await local.upsertUser(db, email, password);
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { [email]: { role: '專任諮商心理師' } } } });
}

async function login(db, config, email, password) {
  return handleRequest(db, config, { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
}

const RAW_EML = Buffer.from(
  'From: Sender <sender@example.com>\r\n' +
  'To: Receiver <receiver@example.com>\r\n' +
  'Subject: Archive Test Subject\r\n' +
  'Date: Mon, 01 Jan 2024 00:00:00 +0000\r\n' +
  'Content-Type: text/plain; charset=utf-8\r\n' +
  '\r\n' +
  'Hello archive world\r\n',
  'utf8'
);

// monkey-patch openmail/client.js withImap：回傳一個假 imap 物件，只實作 archive.js 用得到的
// 三個方法（getMailboxLock/fetchOne/messageDelete），不觸網。opts.source 可覆寫回傳的原始信件；
// opts.deleteThrows 可模擬「封存成功但從 openmail 刪除原信失敗」的降級情境。
function withMockImap(opts, runner) {
  const orig = client.withImap;
  client.withImap = async (email, mailUser, mailPass, config, fn) => {
    const fakeImap = {
      async getMailboxLock(_folder) { return { release() {} }; },
      async fetchOne(_uid, _query, _fetchOpts) { return { source: opts.source || RAW_EML }; },
      async messageDelete(_uid, _fetchOpts) {
        if (opts.deleteThrows) throw new Error('mock imap delete failed');
      },
    };
    return fn(fakeImap);
  };
  return runner().finally(() => { client.withImap = orig; });
}

// ── omsvFolder* CRUD（直接呼叫業務層，db 已跑過 migrations） ────────────────

test('omsvFolderCreate/List/Rename/Delete：基本 CRUD roundtrip', () => {
  const db = openDb(':memory:');
  const owner = 'crud-test@x.com';

  const created = archive.omsvFolderCreate(db, owner, { name: '個案 A 往來' });
  assert.equal(created.ok, true);
  assert.ok(created.id);

  const listed = archive.omsvFolderList(db, owner);
  assert.equal(listed.folders.length, 1);
  assert.equal(listed.folders[0].name, '個案 A 往來');
  assert.equal(listed.folders[0].messageCount, 0);

  const renamed = archive.omsvFolderRename(db, owner, { folderId: created.id, name: '個案 A 往來（改名）' });
  assert.equal(renamed.ok, true);
  assert.equal(archive.omsvFolderList(db, owner).folders[0].name, '個案 A 往來（改名）');

  const deleted = archive.omsvFolderDelete(db, owner, { folderId: created.id });
  assert.equal(deleted.ok, true);
  assert.equal(archive.omsvFolderList(db, owner).folders.length, 0);
});

test('omsvFolderCreate：同一人同名資料夾 → omsv_folder_name_taken；不同人同名不受影響', () => {
  const db = openDb(':memory:');
  const r1 = archive.omsvFolderCreate(db, 'dup-a@x.com', { name: '同名資料夾' });
  assert.equal(r1.ok, true);
  const r2 = archive.omsvFolderCreate(db, 'dup-a@x.com', { name: '同名資料夾' });
  assert.equal(r2.error, 'omsv_folder_name_taken');
  const r3 = archive.omsvFolderCreate(db, 'dup-b@x.com', { name: '同名資料夾' });
  assert.equal(r3.ok, true); // 不同 owner，同名不衝突
});

test('omsvFolderCreate：空白/過長名稱 → omsv_invalid_name', () => {
  const db = openDb(':memory:');
  assert.equal(archive.omsvFolderCreate(db, 'name-test@x.com', { name: '' }).error, 'omsv_invalid_name');
  assert.equal(archive.omsvFolderCreate(db, 'name-test@x.com', { name: '   ' }).error, 'omsv_invalid_name');
  assert.equal(archive.omsvFolderCreate(db, 'name-test@x.com', { name: 'x'.repeat(101) }).error, 'omsv_invalid_name');
});

test('omsvFolderDelete：資料夾內還有信時拒刪（omsv_folder_not_empty）', async () => {
  const db = openDb(':memory:');
  const owner = 'nonempty-test@x.com';
  const folder = archive.omsvFolderCreate(db, owner, { name: '有信的資料夾' });
  credStore.set(owner, 'u', 'p');
  try {
    await withMockImap({}, async () => {
      const r = await archive.omsvArchiveMessage(db, owner, testConfig(), {
        folder: 'INBOX', uid: 1, targetFolderId: folder.id, deleteFromMail: false,
      });
      assert.equal(r.ok, true);
    });
  } finally {
    credStore.clear(owner);
  }
  const del = archive.omsvFolderDelete(db, owner, { folderId: folder.id });
  assert.equal(del.error, 'omsv_folder_not_empty');
  // 清空後才能刪
  const list = archive.omsvList(db, owner, { folderId: folder.id });
  assert.equal(list.messages.length, 1);
  archive.omsvDelete(db, owner, { id: list.messages[0].id });
  assert.equal(archive.omsvFolderDelete(db, owner, { folderId: folder.id }).ok, true);
});

// ── owner 隔離：A 存的信／資料夾 B 讀不到 ───────────────────────────────────

test('owner 隔離：B 無法 list/rename/delete A 的資料夾，也看不到 A 的封存信', async () => {
  const db = openDb(':memory:');
  const a = 'owner-a@x.com';
  const b = 'owner-b@x.com';
  const folderA = archive.omsvFolderCreate(db, a, { name: 'A 的資料夾' });

  credStore.set(a, 'u', 'p');
  let msgId;
  try {
    await withMockImap({}, async () => {
      const r = await archive.omsvArchiveMessage(db, a, testConfig(), {
        folder: 'INBOX', uid: 1, targetFolderId: folderA.id, deleteFromMail: false,
      });
      assert.equal(r.ok, true);
      msgId = r.archivedId;
    });
  } finally {
    credStore.clear(a);
  }

  // B 看不到 A 的資料夾（B 自己的清單是空的）
  assert.equal(archive.omsvFolderList(db, b).folders.length, 0);
  // B 用 A 的 folderId 操作 → 查無（不是 403，是「查無」，見 archive.js 檔頭原則）
  assert.equal(archive.omsvFolderRename(db, b, { folderId: folderA.id, name: 'hijacked' }).error, 'omsv_folder_not_found');
  assert.equal(archive.omsvFolderDelete(db, b, { folderId: folderA.id }).error, 'omsv_folder_not_found');
  assert.equal(archive.omsvList(db, b, { folderId: folderA.id }).error, 'omsv_folder_not_found');
  // B 用 A 的訊息 id 讀取/下載附件/刪除 → 一律查無
  const got = await archive.omsvGet(db, b, { id: msgId });
  assert.equal(got.error, 'omsv_message_not_found');
  const att = await archive.omsvDownloadAttachment(db, b, { id: msgId, index: 0 });
  assert.equal(att.error, 'omsv_message_not_found');
  assert.equal(archive.omsvDelete(db, b, { id: msgId }).error, 'omsv_message_not_found');

  // A 自己讀得到，且欄位正確
  const gotA = await archive.omsvGet(db, a, { id: msgId });
  assert.equal(gotA.subject, 'Archive Test Subject');
  assert.equal(gotA.from.address, 'sender@example.com');
});

// ── omsvArchiveMessage：大小上限／刪除原信失敗的降級處理 ───────────────────

test('omsvArchiveMessage：單封超過 25MB → omsv_too_large，且不寫入資料表', async () => {
  const db = openDb(':memory:');
  const owner = 'toolarge-test@x.com';
  const folder = archive.omsvFolderCreate(db, owner, { name: '容量測試' });
  credStore.set(owner, 'u', 'p');
  const bigBuf = Buffer.alloc(26 * 1024 * 1024, 'a');
  try {
    await withMockImap({ source: bigBuf }, async () => {
      const r = await archive.omsvArchiveMessage(db, owner, testConfig(), {
        folder: 'INBOX', uid: 2, targetFolderId: folder.id, deleteFromMail: false,
      });
      assert.equal(r.error, 'omsv_too_large');
    });
  } finally {
    credStore.clear(owner);
  }
  assert.equal(archive.omsvList(db, owner, { folderId: folder.id }).messages.length, 0);
});

test('omsvArchiveMessage：未 omConnect（無 credStore）→ mail_not_connected，不觸網', async () => {
  const db = openDb(':memory:');
  const owner = 'notconnected-archive@x.com';
  const folder = archive.omsvFolderCreate(db, owner, { name: 'x' });
  credStore.clear(owner);
  const r = await archive.omsvArchiveMessage(db, owner, testConfig(), {
    folder: 'INBOX', uid: 1, targetFolderId: folder.id, deleteFromMail: false,
  });
  assert.equal(r.error, 'mail_not_connected');
});

test('omsvArchiveMessage：目標資料夾不存在（或不是自己的）→ omsv_folder_not_found，不觸網也不呼叫 IMAP', async () => {
  const db = openDb(':memory:');
  const owner = 'badfolder-test@x.com';
  credStore.set(owner, 'u', 'p');
  const orig = client.withImap;
  let calledImap = false;
  client.withImap = async () => { calledImap = true; throw new Error('should not be called'); };
  try {
    const r = await archive.omsvArchiveMessage(db, owner, testConfig(), {
      folder: 'INBOX', uid: 1, targetFolderId: 999999, deleteFromMail: false,
    });
    assert.equal(r.error, 'omsv_folder_not_found');
    assert.equal(calledImap, false);
  } finally {
    client.withImap = orig;
    credStore.clear(owner);
  }
});

test('omsvArchiveMessage：deleteFromMail=true 且封存成功、IMAP 刪除失敗 → 封存仍成功（不回滾），deleted:false 並帶 deleteError', async () => {
  const db = openDb(':memory:');
  const owner = 'deletefail-test@x.com';
  const folder = archive.omsvFolderCreate(db, owner, { name: '刪除失敗測試' });
  credStore.set(owner, 'u', 'p');
  try {
    await withMockImap({ deleteThrows: true }, async () => {
      const r = await archive.omsvArchiveMessage(db, owner, testConfig(), {
        folder: 'INBOX', uid: 3, targetFolderId: folder.id, deleteFromMail: true,
      });
      assert.equal(r.ok, true);
      assert.ok(r.archivedId);
      assert.equal(r.deleted, false);
      assert.ok(r.deleteError);
    });
  } finally {
    credStore.clear(owner);
  }
  // 封存列確實寫入，即使刪除原信失敗——寧可信件同時留兩邊，也不能讓唯一副本消失。
  const list = archive.omsvList(db, owner, { folderId: folder.id });
  assert.equal(list.messages.length, 1);
});

test('omsvArchiveMessage：deleteFromMail=true 且皆成功 → deleted:true，不帶 deleteError', async () => {
  const db = openDb(':memory:');
  const owner = 'deleteok-test@x.com';
  const folder = archive.omsvFolderCreate(db, owner, { name: '刪除成功測試' });
  credStore.set(owner, 'u', 'p');
  try {
    await withMockImap({}, async () => {
      const r = await archive.omsvArchiveMessage(db, owner, testConfig(), {
        folder: 'INBOX', uid: 4, targetFolderId: folder.id, deleteFromMail: true,
      });
      assert.equal(r.ok, true);
      assert.equal(r.deleted, true);
      assert.equal(r.deleteError, undefined);
    });
  } finally {
    credStore.clear(owner);
  }
});

// ── dispatch 整合測試：授權閘 ────────────────────────────────────────────

test('omsv* action：未登入（無 token）→ Session expired', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  const actions = [
    { action: 'omsvFolderList', extra: {} },
    { action: 'omsvFolderCreate', extra: { name: 'x' } },
    { action: 'omsvFolderRename', extra: { folderId: 1, name: 'y' } },
    { action: 'omsvFolderDelete', extra: { folderId: 1 } },
    { action: 'omsvArchiveMessage', extra: { folder: 'INBOX', uid: 1, targetFolderId: 1 } },
    { action: 'omsvList', extra: { folderId: 1 } },
    { action: 'omsvGet', extra: { id: 1 } },
    { action: 'omsvDownloadAttachment', extra: { id: 1, index: 0 } },
    { action: 'omsvDelete', extra: { id: 1 } },
  ];
  for (const { action, extra } of actions) {
    const r = await handleRequest(db, cfg, { action, rootFolderId: ROOT, ...extra });
    assert.equal(r.data.error, 'Session expired', action);
  }
});

test('omsv* action：已登入但不在 config.users（未授權）→ Unauthorized user', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  // 建立一個「有效帳密但不在 config.users」的情境：先建授權使用者登入拿 token 的機制不允許
  // 這樣做（sessionStart 本身就會擋非授權使用者），改用直接組一顆合法但 email 不在 users 的
  // sessionToken，比照既有 gate 測試手法。
  const sessionAuth = require('../src/auth/session');
  const tok = sessionAuth.issueSessionToken('not-in-users@x.com', cfg.SESSION_SECRET).token;
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: {} } });
  const r = await handleRequest(db, cfg, { action: 'omsvFolderList', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(r.data.error, 'Unauthorized user');
});

test('omsv* action：已登入已授權 → omsvFolderCreate/List 正常運作（走完整 dispatch 管線）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'dispatch-omsv@x.com', 'right-password');
  const tok = (await login(db, cfg, 'dispatch-omsv@x.com', 'right-password')).data.sessionToken;

  const created = await handleRequest(db, cfg, { action: 'omsvFolderCreate', sessionToken: tok, rootFolderId: ROOT, name: '正式測試資料夾' });
  assert.equal(created.data.ok, true);

  const listed = await handleRequest(db, cfg, { action: 'omsvFolderList', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(listed.data.folders.length, 1);
  assert.equal(listed.data.folders[0].name, '正式測試資料夾');
});

test('audit_log：omsv* action 的 detail 只記資料夾名/計數等，subject/from/to 不會出現在 params（server 端自行解析，前端本就不傳）', async () => {
  const db = openDb(':memory:');
  const cfg = testConfig();
  await setupAuthorizedUser(db, 'audit-omsv@x.com', 'right-password');
  const tok = (await login(db, cfg, 'audit-omsv@x.com', 'right-password')).data.sessionToken;

  await handleRequest(db, cfg, { action: 'omsvFolderCreate', sessionToken: tok, rootFolderId: ROOT, name: '稽核測試資料夾' });

  const row = db.prepare("SELECT detail FROM audit_log WHERE action = 'omsvFolderCreate' ORDER BY id DESC LIMIT 1").get();
  assert.match(row.detail, /name=稽核測試資料夾/);
});
