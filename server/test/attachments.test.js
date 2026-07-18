// server/test/attachments.test.js — src/actions/attachments.js 單元測試（createFolder／uploadFile／
// downloadFileBase64 三層查找）。對映 dev/Code.gs createFolder_/uploadFile_/downloadFileBase64_
// （v200 cutover 回歸修補，見 src/actions/attachments.js 檔頭）。不打真實 Drive 網路——Tier 3
// 一律以 deps.drive 注入假 client，token 交換以 monkey-patch global.fetch 模擬（比照
// test/google-auth.test.js 慣例）。
'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openDb } = require('../src/db');
const vdrive = require('../src/storage/vdrive');
const sharedIssuesDb = require('../src/storage/sharedIssuesDb');
const attachments = require('../src/actions/attachments');

const ROOT = 'ROOT_ATTACH_TEST';
const CTX = { root: ROOT };

function freshDb() { return openDb(':memory:'); }

function tmpSqlitePath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `scc-attach-${label}-`));
  return path.join(dir, 'main.sqlite');
}

function tmpCredsFile(content) {
  const p = path.join(os.tmpdir(), 'scc-attach-creds-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify(content));
  return p;
}

afterEach(() => {
  attachments._resetCachesForTest();
  sharedIssuesDb._resetCacheForTest();
});

// ── createFolder ────────────────────────────────────────────────────────

test('createFolder：建立資料夾，回傳形狀含 id/name/mimeType/parents（對齊 GAS Drive 資源形狀）', () => {
  const db = freshDb();
  const r = attachments.createFolder(db, { name: 'attachments', parentId: ROOT });
  assert.ok(r.id);
  assert.equal(r.name, 'attachments');
  assert.equal(r.mimeType, 'application/vnd.google-apps.folder');
  assert.deepEqual(r.parents, [ROOT]);
});

test('createFolder：不做 idempotent 檢查，重複呼叫各建一筆（bug-for-bug 對齊 GAS createFolder_，前端呼叫端自行以 query 檢查是否已存在）', () => {
  const db = freshDb();
  const a = attachments.createFolder(db, { name: 'dup', parentId: ROOT });
  const b = attachments.createFolder(db, { name: 'dup', parentId: ROOT });
  assert.notEqual(a.id, b.id);
});

test('createFolder：缺 name/parentId → throw', () => {
  const db = freshDb();
  assert.throws(() => attachments.createFolder(db, { name: '', parentId: ROOT }));
  assert.throws(() => attachments.createFolder(db, { name: 'x', parentId: '' }));
});

// ── uploadFile ──────────────────────────────────────────────────────────

test('uploadFile：正常上傳 → 回傳 {fileId, fileName}，內容可經 downloadFileBase64 roundtrip 讀回', async () => {
  const db = freshDb();
  const folder = attachments.createFolder(db, { name: 'attachments', parentId: ROOT });
  const original = Buffer.from('hello attachment');
  const r = attachments.uploadFile(db, {
    parentFolderId: folder.id, fileName: 'a.txt', mimeType: 'text/plain', base64Data: original.toString('base64'),
  });
  assert.ok(r.fileId);
  assert.equal(r.fileName, 'a.txt');

  const dl = await attachments.downloadFileBase64(db, { fileId: r.fileId }, CTX, {});
  assert.equal(dl.fileName, 'a.txt');
  assert.equal(dl.mimeType, 'text/plain');
  assert.equal(Buffer.from(dl.base64, 'base64').toString('utf8'), 'hello attachment');
});

test('uploadFile：缺 mimeType 時預設 application/octet-stream', () => {
  const db = freshDb();
  const r = attachments.uploadFile(db, { parentFolderId: ROOT, fileName: 'b.bin', base64Data: Buffer.from('x').toString('base64') });
  const row = vdrive.getFileById(db, r.fileId);
  assert.equal(row.mime_type, 'application/octet-stream');
});

test('uploadFile：缺 parentFolderId/fileName/base64Data → throw', () => {
  const db = freshDb();
  assert.throws(() => attachments.uploadFile(db, { fileName: 'x', base64Data: 'aGk=' }));
  assert.throws(() => attachments.uploadFile(db, { parentFolderId: ROOT, base64Data: 'aGk=' }));
  assert.throws(() => attachments.uploadFile(db, { parentFolderId: ROOT, fileName: 'x' }));
});

test('uploadFile：超過 20MB 單檔上限 → throw（明確拒絕，不靜默截斷）', () => {
  const db = freshDb();
  const big = Buffer.alloc(21 * 1024 * 1024, 1).toString('base64');
  assert.throws(() => attachments.uploadFile(db, {
    parentFolderId: ROOT, fileName: 'big.bin', mimeType: 'application/octet-stream', base64Data: big,
  }), /單檔上限 20MB/);
});

test('uploadFile：恰好 20MB → 允許（邊界不誤殺）', () => {
  const db = freshDb();
  const exact = Buffer.alloc(20 * 1024 * 1024, 1).toString('base64');
  const r = attachments.uploadFile(db, {
    parentFolderId: ROOT, fileName: 'exact.bin', mimeType: 'application/octet-stream', base64Data: exact,
  });
  assert.ok(r.fileId);
});

// ── downloadFileBase64：Tier 1（本庫）───────────────────────────────────

test('downloadFileBase64 Tier1：本庫命中，root 外/查無一律「找不到附件」', async () => {
  const db = freshDb();
  const r = attachments.uploadFile(db, { parentFolderId: ROOT, fileName: 'c.png', mimeType: 'image/png', base64Data: Buffer.from('img').toString('base64') });

  const hit = await attachments.downloadFileBase64(db, { fileId: r.fileId }, CTX, {});
  assert.equal(hit.fileName, 'c.png');
  assert.equal(hit.mimeType, 'image/png');

  await assert.rejects(() => attachments.downloadFileBase64(db, { fileId: 'no-such-id' }, CTX, {}), /找不到附件/);

  const outside = vdrive.uploadFile(db, { parentId: 'OTHER_ROOT', name: 'd.png', mimeType: 'image/png', blob: Buffer.from('x') });
  await assert.rejects(() => attachments.downloadFileBase64(db, { fileId: outside.id }, CTX, {}), /找不到附件/, 'root 外的本庫檔案不應被當作 Tier1 命中（無 SHARED_ISSUES_DB/PEER_DB 時也不應誤放行）');
});

test('downloadFileBase64：缺 fileId → throw', async () => {
  const db = freshDb();
  await assert.rejects(() => attachments.downloadFileBase64(db, {}, CTX, {}), /缺少 fileId/);
});

test('downloadFileBase64 Tier1：trash 過的附件視為查無', async () => {
  const db = freshDb();
  const r = attachments.uploadFile(db, { parentFolderId: ROOT, fileName: 'e.png', mimeType: 'image/png', base64Data: Buffer.from('x').toString('base64') });
  db.prepare('UPDATE files SET trashed = 1 WHERE id = ?').run(r.fileId);
  await assert.rejects(() => attachments.downloadFileBase64(db, { fileId: r.fileId }, CTX, {}), /找不到附件/);
});

// ── attachListHasFileId / issuesHasAttachment（純函式）──────────────────

test('attachListHasFileId：頂層 fileId（image/word 類型）命中', () => {
  assert.equal(attachments.attachListHasFileId([{ type: 'image', fileId: 'F1' }], 'F1'), true);
  assert.equal(attachments.attachListHasFileId([{ type: 'image', fileId: 'F1' }], 'F2'), false);
});

test('attachListHasFileId：巢狀 pages[].fileId（pdf_pages 類型）命中——比 GAS 版 _attachListHasFileId_ 多涵蓋此欄位（見 attachments.js 檔頭「Tier 2」註解，非縮小既有安全邊界）', () => {
  const list = [{ type: 'pdf_pages', fileName: 'x.pdf', pages: [{ fileId: 'P1', pageNum: 1 }, { fileId: 'P2', pageNum: 2 }] }];
  assert.equal(attachments.attachListHasFileId(list, 'P2'), true);
  assert.equal(attachments.attachListHasFileId(list, 'P9'), false);
});

test('attachListHasFileId：非陣列/空 fileId → false（fail-closed）', () => {
  assert.equal(attachments.attachListHasFileId(null, 'F1'), false);
  assert.equal(attachments.attachListHasFileId([{ fileId: 'F1' }], ''), false);
});

test('issuesHasAttachment：issue 本身的 attachments 與留言（comments）的 attachments 皆會被掃描', () => {
  const json = {
    issues: [
      { id: 'i1', attachments: [{ type: 'image', fileId: 'A1' }], comments: [{ attachments: [{ type: 'word', fileId: 'A2' }] }] },
      { id: 'i2', attachments: [{ type: 'pdf_pages', pages: [{ fileId: 'A3' }] }] },
    ],
  };
  assert.equal(attachments.issuesHasAttachment(json, 'A1'), true);
  assert.equal(attachments.issuesHasAttachment(json, 'A2'), true);
  assert.equal(attachments.issuesHasAttachment(json, 'A3'), true);
  assert.equal(attachments.issuesHasAttachment(json, 'A9'), false);
});

test('issuesHasAttachment：格式異常（null／非陣列 issues）→ false（fail-closed）', () => {
  assert.equal(attachments.issuesHasAttachment(null, 'A1'), false);
  assert.equal(attachments.issuesHasAttachment({ issues: 'not-array' }, 'A1'), false);
});

// ── downloadFileBase64：Tier 2（PEER_DB 跨環境附件白名單）───────────────

function testConfigWithPeer(sharedPath, peerPath) {
  return { SHARED_ISSUES_DB: sharedPath, PEER_DB: peerPath };
}

test('downloadFileBase64 Tier2：fileId 被共用庫 issues.json 引用時，讀 PEER_DB 命中', async () => {
  const localDb = freshDb();
  const sharedPath = tmpSqlitePath('tier2-hit-shared');
  const peerPath = tmpSqlitePath('tier2-hit-peer');

  // 模擬「對方環境」：獨立主庫，已上傳一個附件。
  const peerDbRw = openDb(peerPath);
  const peerUpload = vdrive.uploadFile(peerDbRw, { parentId: 'PEER_ROOT', name: 'peer.png', mimeType: 'image/png', blob: Buffer.from('peer-content') });
  peerDbRw.close();

  // 共用庫 issues.json 記錄該 fileId 為某筆問題回報的附件。
  const shared = sharedIssuesDb.getSharedIssuesDb(sharedPath);
  vdrive.createJson(shared, {
    name: 'issues.json', parentId: sharedIssuesDb.SHARED_CTX.root,
    content: { issues: [{ id: 'iss1', attachments: [{ type: 'image', fileId: peerUpload.id }] }] },
  });

  const config = testConfigWithPeer(sharedPath, peerPath);
  const r = await attachments.downloadFileBase64(localDb, { fileId: peerUpload.id }, CTX, config);
  assert.equal(r.fileName, 'peer.png');
  assert.equal(Buffer.from(r.base64, 'base64').toString('utf8'), 'peer-content');
});

test('downloadFileBase64 Tier2：fileId 未被 issues.json 引用 → 不放行（即使 PEER_DB 裡確實有這個檔案）', async () => {
  const localDb = freshDb();
  const sharedPath = tmpSqlitePath('tier2-deny-shared');
  const peerPath = tmpSqlitePath('tier2-deny-peer');

  const peerDbRw = openDb(peerPath);
  const peerUpload = vdrive.uploadFile(peerDbRw, { parentId: 'PEER_ROOT', name: 'secret.png', mimeType: 'image/png', blob: Buffer.from('x') });
  peerDbRw.close();

  const shared = sharedIssuesDb.getSharedIssuesDb(sharedPath);
  vdrive.createJson(shared, { name: 'issues.json', parentId: sharedIssuesDb.SHARED_CTX.root, content: { issues: [] } });

  const config = testConfigWithPeer(sharedPath, peerPath);
  await assert.rejects(() => attachments.downloadFileBase64(localDb, { fileId: peerUpload.id }, CTX, config), /找不到附件/);
});

test('downloadFileBase64 Tier2：未設定 SHARED_ISSUES_DB／PEER_DB 任一者 → 不啟用，直接落到「找不到附件」', async () => {
  const localDb = freshDb();
  await assert.rejects(() => attachments.downloadFileBase64(localDb, { fileId: 'whatever' }, CTX, {}), /找不到附件/);
  await assert.rejects(() => attachments.downloadFileBase64(localDb, { fileId: 'whatever' }, CTX, { SHARED_ISSUES_DB: tmpSqlitePath('only-shared') }), /找不到附件/);
});

test('downloadFileBase64 Tier2：PEER_DB 路徑不存在（對方環境尚未建檔）→ 優雅視為查無，不拋非預期例外', async () => {
  const localDb = freshDb();
  const sharedPath = tmpSqlitePath('tier2-nopeer-shared');
  const shared = sharedIssuesDb.getSharedIssuesDb(sharedPath);
  vdrive.createJson(shared, {
    name: 'issues.json', parentId: sharedIssuesDb.SHARED_CTX.root,
    content: { issues: [{ id: 'i1', attachments: [{ type: 'image', fileId: 'GHOST' }] }] },
  });
  const config = testConfigWithPeer(sharedPath, path.join(os.tmpdir(), 'scc-no-such-peer-db-' + Date.now() + '.sqlite'));
  await assert.rejects(() => attachments.downloadFileBase64(localDb, { fileId: 'GHOST' }, CTX, config), /找不到附件/);
});

// ── downloadFileBase64：Tier 3（Drive 舊附件唯讀 fallback）──────────────

function withFetch(fakeFetch, fn) {
  const orig = global.fetch;
  global.fetch = fakeFetch;
  return Promise.resolve().then(fn).finally(() => { global.fetch = orig; });
}

test('downloadFileBase64 Tier3：fileId 沿 parents 鏈可到達允許根 → 下載成功', async () => {
  const localDb = freshDb();
  const credsPath = tmpCredsFile({ client_id: 'c', client_secret: 's', refresh_token: 'rt' });
  const config = { DRIVE_SYNC_CREDS: credsPath, DRIVE_LEGACY_ROOTS: 'LEGACY_ROOT_A,LEGACY_ROOT_B' };

  // parents 鏈：FILE1 → SUBFOLDER → LEGACY_ROOT_A（allowed）
  const parentsMap = { FILE1: ['SUBFOLDER'], SUBFOLDER: ['LEGACY_ROOT_A'] };
  const fakeDrive = {
    getMetadata: async (_token, id) => (id === 'FILE1' ? { id, name: 'old.jpg', mimeType: 'image/jpeg', parents: parentsMap[id] } : { id, parents: parentsMap[id] || [] }),
    downloadMedia: async () => Buffer.from('legacy-bytes'),
  };

  try {
    await withFetch(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'AT', expires_in: 3600 }) }), async () => {
      const r = await attachments.downloadFileBase64(localDb, { fileId: 'FILE1' }, CTX, config, { drive: fakeDrive });
      assert.equal(r.fileName, 'old.jpg');
      assert.equal(r.mimeType, 'image/jpeg');
      assert.equal(Buffer.from(r.base64, 'base64').toString('utf8'), 'legacy-bytes');
    });
  } finally {
    fs.unlinkSync(credsPath);
  }
});

test('downloadFileBase64 Tier3：parents 鏈到達的根不在允許清單 → 找不到附件', async () => {
  const localDb = freshDb();
  const credsPath = tmpCredsFile({ client_id: 'c', client_secret: 's', refresh_token: 'rt' });
  const config = { DRIVE_SYNC_CREDS: credsPath, DRIVE_LEGACY_ROOTS: 'LEGACY_ROOT_A' };
  const fakeDrive = {
    getMetadata: async (_token, id) => ({ id, name: 'x', mimeType: 'image/jpeg', parents: id === 'FILE1' ? ['UNTRUSTED_ROOT'] : [] }),
    downloadMedia: async () => Buffer.from('should-not-be-downloaded'),
  };
  try {
    await withFetch(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'AT', expires_in: 3600 }) }), async () => {
      await assert.rejects(() => attachments.downloadFileBase64(localDb, { fileId: 'FILE1' }, CTX, config, { drive: fakeDrive }), /找不到附件/);
    });
  } finally {
    fs.unlinkSync(credsPath);
  }
});

test('downloadFileBase64 Tier3：超過 depth 上限（5 層）仍未到達允許根 → 找不到附件', async () => {
  const localDb = freshDb();
  const credsPath = tmpCredsFile({ client_id: 'c', client_secret: 's', refresh_token: 'rt' });
  const config = { DRIVE_SYNC_CREDS: credsPath, DRIVE_LEGACY_ROOTS: 'LEGACY_ROOT_A' };
  // 鏈長 7 層才到 LEGACY_ROOT_A，超過深度上限 5，不應被判定為允許。
  const chain = ['FILE1', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'LEGACY_ROOT_A'];
  const parentsMap = {};
  for (let i = 0; i < chain.length - 1; i++) parentsMap[chain[i]] = [chain[i + 1]];
  const fakeDrive = {
    getMetadata: async (_token, id) => ({ id, name: 'x', mimeType: 'image/jpeg', parents: parentsMap[id] || [] }),
    downloadMedia: async () => Buffer.from('nope'),
  };
  try {
    await withFetch(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'AT', expires_in: 3600 }) }), async () => {
      await assert.rejects(() => attachments.downloadFileBase64(localDb, { fileId: 'FILE1' }, CTX, config, { drive: fakeDrive }), /找不到附件/);
    });
  } finally {
    fs.unlinkSync(credsPath);
  }
});

test('downloadFileBase64 Tier3：未設定 DRIVE_SYNC_CREDS/DRIVE_LEGACY_ROOTS → 不啟用，找不到附件（不觸網）', async () => {
  const localDb = freshDb();
  let fetchCalled = false;
  await withFetch(async () => { fetchCalled = true; return { ok: true, status: 200, json: async () => ({}) }; }, async () => {
    await assert.rejects(() => attachments.downloadFileBase64(localDb, { fileId: 'FILE1' }, CTX, {}), /找不到附件/);
  });
  assert.equal(fetchCalled, false, '未設定憑證/白名單時不應嘗試打 token endpoint');
});

test('downloadFileBase64 Tier3：token 交換失敗 → 優雅回「找不到附件」（不是 500/未預期例外）', async () => {
  const localDb = freshDb();
  const credsPath = tmpCredsFile({ client_id: 'c', client_secret: 's', refresh_token: 'rt' });
  const config = { DRIVE_SYNC_CREDS: credsPath, DRIVE_LEGACY_ROOTS: 'LEGACY_ROOT_A' };
  try {
    await withFetch(async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_grant' }) }), async () => {
      await assert.rejects(() => attachments.downloadFileBase64(localDb, { fileId: 'FILE1' }, CTX, config), /找不到附件/);
    });
  } finally {
    fs.unlinkSync(credsPath);
  }
});

// ── isUnderAllowedRoot（純函式，直接測，補齊 Tier3 邊界情境）──────────────

test('isUnderAllowedRoot：fileId 本身就是允許根 → true', async () => {
  const ok = await attachments.isUnderAllowedRoot(async () => [], 'ROOT_A', ['ROOT_A'], 5);
  assert.equal(ok, true);
});

test('isUnderAllowedRoot：allowedRoots 為空 → false', async () => {
  const ok = await attachments.isUnderAllowedRoot(async () => ['X'], 'F1', [], 5);
  assert.equal(ok, false);
});

test('isUnderAllowedRoot：getParents 拋錯視為無父層（不中斷整體判斷，該分支判 false）', async () => {
  const getParents = async (id) => { if (id === 'F1') throw new Error('boom'); return []; };
  const ok = await attachments.isUnderAllowedRoot(getParents, 'F1', ['ROOT_A'], 5);
  assert.equal(ok, false);
});
