// server/test/commit-actions.test.js — 五個厚 commit action（casesUpsert／attendanceCommit／
// bookingsCommit／listCommit／notifCommit）的 parity ＋行為測試。
//
// parity 段：從 dev/Code.gs 就地抽出對應純函式（punchDaySummary_/_notifApplyOp_/_bkFindConflictGs_/
// _listCommitResolveEntry_ 等），與 server/src/actions/commit.js 匯出的同名邏輯對打（手法同
// server/test/parity.test.js）。casesUpsert_/attendanceCommit_/listCommit_/notifCommit_/bookingsCommit_
// 本體依賴 LockService/UrlFetchApp（GAS 專屬 API），無法直接抽出執行，故對這五個「厚」函式改採行為比對
// （依 dev/Code.gs 原始碼手動核對錯誤字串／回傳形狀是否 1:1，見各測試案例的行內註解引用行號）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { matchBrace } = require('../../test/harness');

const { openDb } = require('../src/db');
const vdrive = require('../src/storage/vdrive');
const commit = require('../src/actions/commit');

const CODE_GS_PATH = path.join(__dirname, '..', '..', 'dev', 'Code.gs');

function readCodeGs() {
  return fs.readFileSync(CODE_GS_PATH, 'utf8');
}

function extractFunctionSrc(src, name) {
  const re = new RegExp('function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('找不到函式：' + name);
  const braceIdx = src.indexOf('{', m.index);
  const endIdx = matchBrace(src, braceIdx);
  return src.slice(m.index, endIdx + 1);
}

// 抽出頂層 var NAME = {...}; 物件字面量原始碼（LIST_COMMIT_REGISTRY_ 專用——extractFunction 只認
// function 宣告，這裡另外處理 var 宣告的情形）。
function extractVarObjectSrc(src, name) {
  const re = new RegExp('var\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*');
  const m = re.exec(src);
  if (!m) throw new Error('找不到變數：' + name);
  const braceIdx = src.indexOf('{', m.index);
  const endIdx = matchBrace(src, braceIdx);
  return `var ${name} = ` + src.slice(braceIdx, endIdx + 1) + ';';
}

function loadGasSandbox(snippets) {
  const sandbox = { JSON, Array, Object, Math, Number, String, Date, isNaN, RegExp };
  vm.createContext(sandbox);
  vm.runInContext(snippets.join('\n\n'), sandbox);
  return sandbox;
}

function freshDb() { return openDb(':memory:'); }
const ROOT = 'ROOT';
const CTX = { root: ROOT };

// ══════════════════════════════════════════════════════════════════════════
// parity：純函式對打
// ══════════════════════════════════════════════════════════════════════════

test('parity：LIST_COMMIT_REGISTRY 與 GAS LIST_COMMIT_REGISTRY_ 逐檔一致', () => {
  const src = readCodeGs();
  const G = loadGasSandbox([extractVarObjectSrc(src, 'LIST_COMMIT_REGISTRY_')]);
  assert.deepEqual(commit.LIST_COMMIT_REGISTRY, G.LIST_COMMIT_REGISTRY_);
});

test('parity：resolveListCommitEntry 與 GAS _listCommitResolveEntry_ 對任意檔名判定一致', () => {
  const src = readCodeGs();
  const G = loadGasSandbox([
    extractVarObjectSrc(src, 'LIST_COMMIT_REGISTRY_'),
    extractFunctionSrc(src, '_listCommitResolveEntry_'),
  ]);
  const files = [
    'leaves.json', 'audit_log.json', 'case_access_log.json', 'psych_test_db.json',
    'pending_users.json', 'pending_users-2026.json', 'users/todos_a@x.com_dev.json',
    'not-in-registry.json', 'cases/chunk-a.json',
  ];
  for (const f of files) {
    assert.deepEqual(commit.resolveListCommitEntry(f), G._listCommitResolveEntry_(f), `mismatch file=${f}`);
  }
});

test('parity：notifApplyOp 與 GAS _notifApplyOp_ 對 push/markRead/markAllRead/removeIds 一致', () => {
  const src = readCodeGs();
  const G = loadGasSandbox([extractFunctionSrc(src, '_notifApplyOp_')]);

  function run(applyFn, ops) {
    const users = {};
    ops.forEach((op) => applyFn(users, op));
    return users;
  }

  const opsA = [
    { op: 'push', email: 'a@x.com', notif: { id: 'n1', msg: 'hi' } },
    { op: 'push', email: 'a@x.com', notif: { id: 'n2', msg: 'yo' } },
    { op: 'push', email: 'a@x.com', notif: { id: 'n1', msg: 'updated' } }, // 取代語意：先移除再 unshift
    { op: 'markRead', email: 'a@x.com', id: 'n2', readAt: '2026-01-01T00:00:00.000Z' },
  ];
  assert.deepEqual(run(commit.notifApplyOp, opsA), run(G._notifApplyOp_, opsA));

  const opsB = [
    { op: 'push', email: 'b@x.com', notif: { id: 'n1' } },
    { op: 'push', email: 'b@x.com', notif: { id: 'n2' } },
    { op: 'markAllRead', email: 'b@x.com', readAt: '2026-01-02T00:00:00.000Z' },
    { op: 'removeIds', email: 'b@x.com', ids: ['n1'] },
  ];
  assert.deepEqual(run(commit.notifApplyOp, opsB), run(G._notifApplyOp_, opsB));

  // 超過 100 則裁切語意一致
  const opsC = [];
  for (let i = 0; i < 105; i++) opsC.push({ op: 'push', email: 'c@x.com', notif: { id: 'n' + i } });
  const rC1 = run(commit.notifApplyOp, opsC);
  const rC2 = run(G._notifApplyOp_, opsC);
  assert.equal(rC1['c@x.com'].length, 100);
  assert.deepEqual(rC1, rC2);
});

test('parity：bkFindConflict 與 GAS _bkFindConflictGs_ 對房間/人員衝突判定一致', () => {
  const src = readCodeGs();
  const G = loadGasSandbox([
    extractFunctionSrc(src, '_bkNormalizeCounselorsGs_'),
    extractFunctionSrc(src, '_bkFindConflictGs_'),
  ]);

  const existing = [
    { id: 'B1', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山', counselors: [{ value: 'a@x.com' }] },
    { id: 'B2', date: '2026-07-15', startTime: '10:00', endTime: '11:00', room: '雪山', counselorEmail: 'b@x.com' },
  ];

  const cases = [
    // 同空間重疊 → room 衝突
    { date: '2026-07-15', startTime: '09:30', endTime: '10:30', room: '玉山', counselors: [{ value: 'z@x.com' }] },
    // 不同空間但人員重疊 → person 衝突
    { date: '2026-07-15', startTime: '09:15', endTime: '09:45', room: '中央山脈', counselors: [{ value: 'a@x.com' }] },
    // 時間不重疊 → 無衝突
    { date: '2026-07-15', startTime: '11:00', endTime: '12:00', room: '玉山', counselors: [{ value: 'a@x.com' }] },
    // 不同日期 → 無衝突
    { date: '2026-07-16', startTime: '09:00', endTime: '10:00', room: '玉山', counselors: [{ value: 'a@x.com' }] },
    // 自訂空間相同 → room 衝突（customRoom）
    { date: '2026-07-15', startTime: '10:15', endTime: '10:45', room: '雪山', counselorEmail: 'q@x.com' },
  ];

  for (const cand of cases) {
    const a = commit.bkFindConflict(existing, cand, {});
    const b = G._bkFindConflictGs_(existing, cand, {});
    assert.deepEqual(a, b, `mismatch cand=${JSON.stringify(cand)}`);
  }

  // skipPersonConflict：人員衝突應被忽略，只剩房間衝突判定
  const personOnlyCand = { date: '2026-07-15', startTime: '09:15', endTime: '09:45', room: '中央山脈', counselors: [{ value: 'a@x.com' }] };
  assert.deepEqual(
    commit.bkFindConflict(existing, personOnlyCand, { skipPerson: true }),
    G._bkFindConflictGs_(existing, personOnlyCand, { skipPerson: true }),
  );
  assert.equal(commit.bkFindConflict(existing, personOnlyCand, { skipPerson: true }), null);
});

// ══════════════════════════════════════════════════════════════════════════
// casesUpsert：對映 dev/Code.gs casesUpsert_（L2546）
// ══════════════════════════════════════════════════════════════════════════

test('casesUpsert：檔案不存在時建立新檔＋回傳 count/updatedAt', () => {
  const db = freshDb();
  vdrive.createFolder(db, { name: 'cases', parentId: ROOT });
  const r = commit.casesUpsert(db, { path: 'cases/chunk-a.json', upserts: [{ id: 'C1', name: 'x' }] }, CTX);
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.ok(r.updatedAt);
  const { data } = vdrive.readJson(db, 'cases/chunk-a.json', CTX);
  assert.equal(data.cases.length, 1);
  assert.equal(data.cases[0].id, 'C1');
});

test('casesUpsert：不整檔覆寫——upsert 新 id 時既有其他 case 保留（含只 upsert 一筆也不影響其他既有筆數）', () => {
  const db = freshDb();
  vdrive.createFolder(db, { name: 'cases', parentId: ROOT });
  commit.casesUpsert(db, { path: 'cases/chunk-a.json', upserts: [{ id: 'C1', v: 1 }, { id: 'C2', v: 1 }] }, CTX);
  // 第二次呼叫只帶 C1，且刻意不帶 C2——不應把 C2 弄丟（這正是「整檔覆寫」事故要防的行為）。
  const r = commit.casesUpsert(db, { path: 'cases/chunk-a.json', upserts: [{ id: 'C1', v: 2 }] }, CTX);
  assert.equal(r.count, 2);
  const { data } = vdrive.readJson(db, 'cases/chunk-a.json', CTX);
  const byId = Object.fromEntries(data.cases.map((c) => [c.id, c]));
  assert.equal(byId.C1.v, 2);
  assert.equal(byId.C2.v, 1);
});

test('casesUpsert：removes 依 id 移除', () => {
  const db = freshDb();
  vdrive.createFolder(db, { name: 'cases', parentId: ROOT });
  commit.casesUpsert(db, { path: 'cases/chunk-a.json', upserts: [{ id: 'C1' }, { id: 'C2' }] }, CTX);
  const r = commit.casesUpsert(db, { path: 'cases/chunk-a.json', upserts: [], removes: ['C1'] }, CTX);
  assert.equal(r.count, 1);
  const { data } = vdrive.readJson(db, 'cases/chunk-a.json', CTX);
  assert.deepEqual(data.cases.map((c) => c.id), ['C2']);
});

test('casesUpsert：path 缺漏 → throw "casesUpsert: path required"', () => {
  const db = freshDb();
  assert.throws(() => commit.casesUpsert(db, { upserts: [] }, CTX), /casesUpsert: path required/);
});

test('casesUpsert：fail-closed——內容損毀（cases 非陣列）時 throw，且原內容不被覆寫', () => {
  const db = freshDb();
  const folder = vdrive.createFolder(db, { name: 'cases', parentId: ROOT });
  const file = vdrive.createJson(db, { name: 'chunk-a.json', parentId: folder.id, content: { cases: 'not-an-array' } });
  assert.throws(
    () => commit.casesUpsert(db, { path: 'cases/chunk-a.json', upserts: [{ id: 'C9' }] }, CTX),
    /內容異常（cases 非陣列），已中止寫入以保護資料/,
  );
  const row = vdrive.getFileById(db, file.id);
  assert.deepEqual(JSON.parse(row.content), { cases: 'not-an-array' }); // 未被清空重寫
});

// ══════════════════════════════════════════════════════════════════════════
// attendanceCommit：對映 dev/Code.gs attendanceCommit_（L2660）
// ══════════════════════════════════════════════════════════════════════════

test('attendanceCommit：新增打卡→回傳合併後 records，並落 audit 紀錄（無 MAIL_SEND_CREDS 時 mailSent=false）', async () => {
  const db = freshDb();
  const r = await commit.attendanceCommit(db, {
    upserts: [{ id: 'P1', type: 'punch', email: 'a@x.com', name: 'A', date: '2026-07-15', timestamp: '2026-07-15T01:00:00.000Z' }],
  }, CTX);
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].id, 'P1');

  const rows = db.prepare("SELECT * FROM audit_log WHERE action = 'attendanceCommit.punchMail'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'a@x.com');
  assert.match(rows[0].detail, /mailSent=false/);
  assert.equal(rows[0].outcome, 'skipped');
});

test('attendanceCommit：2026-07-09 事故回歸——兩人先後打卡不互相蓋掉（不整檔覆寫）', async () => {
  const db = freshDb();
  await commit.attendanceCommit(db, { upserts: [{ id: 'P1', type: 'punch', email: 'a@x.com', date: '2026-07-15', timestamp: '2026-07-15T01:00:00.000Z' }] }, CTX);
  const r2 = await commit.attendanceCommit(db, { upserts: [{ id: 'P2', type: 'punch', email: 'b@x.com', date: '2026-07-15', timestamp: '2026-07-15T01:05:00.000Z' }] }, CTX);
  assert.equal(r2.count, 2);
  assert.deepEqual(r2.records.map((r) => r.id).sort(), ['P1', 'P2']);
});

test('attendanceCommit：既有 id 改寫（如「更新定位」）不視為新增打卡，不觸發 punchMail 稽核', async () => {
  const db = freshDb();
  await commit.attendanceCommit(db, { upserts: [{ id: 'P1', type: 'punch', email: 'a@x.com', date: '2026-07-15', timestamp: '2026-07-15T01:00:00.000Z' }] }, CTX);
  await commit.attendanceCommit(db, { upserts: [{ id: 'P1', type: 'punch', email: 'a@x.com', date: '2026-07-15', timestamp: '2026-07-15T01:00:00.000Z', lat: 22.6, lng: 120.6 }] }, CTX);
  const rows = db.prepare("SELECT * FROM audit_log WHERE action = 'attendanceCommit.punchMail'").all();
  assert.equal(rows.length, 1); // 只有第一次（新增）觸發，第二次（改寫既有 id）不觸發
});

test('attendanceCommit：removes 依 id 移除', async () => {
  const db = freshDb();
  await commit.attendanceCommit(db, { upserts: [{ id: 'P1', type: 'punch', email: 'a@x.com', date: '2026-07-15' }, { id: 'P2', type: 'punch', email: 'b@x.com', date: '2026-07-15' }] }, CTX);
  const r = await commit.attendanceCommit(db, { upserts: [], removes: ['P1'] }, CTX);
  assert.deepEqual(r.records.map((x) => x.id), ['P2']);
});

test('attendanceCommit：fail-closed——attendance.json 內容損毀時 throw，絕不以空殼覆寫（核心回歸測試）', async () => {
  const db = freshDb();
  const file = vdrive.createJson(db, { name: 'attendance.json', parentId: ROOT, content: { records: [{ id: 'P1', email: 'a@x.com' }] } });
  // 模擬資料損毀（非 vdrive 正常寫入路徑造成，直接改 SQL 內容欄位）。
  db.prepare('UPDATE files SET content = ? WHERE id = ?').run('{"records":"not-an-array"}', file.id);

  await assert.rejects(
    () => commit.attendanceCommit(db, { upserts: [{ id: 'P2', type: 'punch', email: 'b@x.com', date: '2026-07-15' }] }, CTX),
    /attendanceCommit: attendance\.json 內容異常（records 非陣列），已中止寫入以保護資料/,
  );
  const row = vdrive.getFileById(db, file.id);
  assert.deepEqual(JSON.parse(row.content), { records: 'not-an-array' }); // 原內容（即使已損毀）未被空殼蓋掉
});

// ══════════════════════════════════════════════════════════════════════════
// listCommit：對映 dev/Code.gs listCommit_（L2758）
// ══════════════════════════════════════════════════════════════════════════

test('listCommit：list 模式 upsert/remove（leaves.json）', () => {
  const db = freshDb();
  commit.listCommit(db, { file: 'leaves.json', upserts: [{ id: 'L1' }, { id: 'L2' }] }, CTX);
  const r = commit.listCommit(db, { file: 'leaves.json', upserts: [{ id: 'L1', v: 2 }], removes: ['L2'] }, CTX);
  assert.deepEqual(r.data.applications.map((a) => a.id), ['L1']);
  assert.equal(r.data.applications[0].v, 2);
});

test('listCommit：append 模式（audit_log.json）不允許 removes、只能追加到尾端', () => {
  const db = freshDb();
  commit.listCommit(db, { file: 'audit_log.json', upserts: [{ a: 1 }] }, CTX);
  const r = commit.listCommit(db, { file: 'audit_log.json', upserts: [{ a: 2 }] }, CTX);
  assert.deepEqual(r.data.logs, [{ a: 1 }, { a: 2 }]);

  assert.throws(
    () => commit.listCommit(db, { file: 'audit_log.json', upserts: [], removes: ['x'] }, CTX),
    /listCommit: audit_log\.json 為 append-only，不允許 removes/,
  );
});

test('listCommit：append 模式 touchUpdatedAt（case_access_log.json）', () => {
  const db = freshDb();
  const r = commit.listCommit(db, { file: 'case_access_log.json', upserts: [{ e: 1 }] }, CTX);
  assert.ok(r.data.updatedAt);
  assert.deepEqual(r.data.entries, [{ e: 1 }]);
});

test('listCommit：map 模式（psych_test_db.json）upserts 為物件、removes 為 key 陣列', () => {
  const db = freshDb();
  commit.listCommit(db, { file: 'psych_test_db.json', upserts: { S001: [{ t: 1 }], S002: [{ t: 2 }] } }, CTX);
  const r = commit.listCommit(db, { file: 'psych_test_db.json', upserts: { S001: [{ t: 3 }] }, removes: ['S002'] }, CTX);
  assert.deepEqual(r.data, { S001: [{ t: 3 }] });
});

test('listCommit：不支援的檔名 → throw', () => {
  const db = freshDb();
  assert.throws(() => commit.listCommit(db, { file: 'not-in-registry.json', upserts: [] }, CTX), /listCommit: 不支援的檔案（not-in-registry\.json）/);
});

test('listCommit：動態規則——users/todos_x.json、pending_users*.json 命中白名單', () => {
  const db = freshDb();
  vdrive.createFolder(db, { name: 'users', parentId: ROOT });
  const r1 = commit.listCommit(db, { file: 'users/todos_a@x.com_dev.json', upserts: [{ id: 'T1' }] }, CTX);
  assert.deepEqual(r1.data.todos.map((t) => t.id), ['T1']);
  const r2 = commit.listCommit(db, { file: 'pending_users-batch1.json', upserts: [{ id: 'U1' }] }, CTX);
  assert.deepEqual(r2.data.applications.map((a) => a.id), ['U1']);
});

test('listCommit：meta 覆寫其他頂層欄位', () => {
  const db = freshDb();
  const r = commit.listCommit(db, { file: 'mental_leaves.json', upserts: [{ id: 'M1' }], meta: { lastFetchedAt: '2026-07-15T00:00:00.000Z' } }, CTX);
  assert.equal(r.data.lastFetchedAt, '2026-07-15T00:00:00.000Z');
});

test('listCommit：fail-closed——list 模式內容損毀時 throw，原內容不被覆寫', () => {
  const db = freshDb();
  const file = vdrive.createJson(db, { name: 'leaves.json', parentId: ROOT, content: { applications: {} } }); // 非陣列
  assert.throws(
    () => commit.listCommit(db, { file: 'leaves.json', upserts: [{ id: 'X' }] }, CTX),
    /listCommit: leaves\.json 內容異常（applications 非陣列），已中止寫入以保護資料/,
  );
  const row = vdrive.getFileById(db, file.id);
  assert.deepEqual(JSON.parse(row.content), { applications: {} });
});

// ══════════════════════════════════════════════════════════════════════════
// notifCommit：對映 dev/Code.gs notifCommit_（L2883）
// ══════════════════════════════════════════════════════════════════════════

test('notifCommit：ops 為空 → throw', () => {
  const db = freshDb();
  assert.throws(() => commit.notifCommit(db, { ops: [] }, CTX), /notifCommit: ops required/);
});

test('notifCommit：push/markRead 正常運作，touched 只回傳被影響的 email', () => {
  const db = freshDb();
  const r = commit.notifCommit(db, {
    ops: [
      { op: 'push', email: 'a@x.com', notif: { id: 'n1' } },
      { op: 'push', email: 'b@x.com', notif: { id: 'n2' } },
    ],
  }, CTX);
  assert.deepEqual(Object.keys(r.touched).sort(), ['a@x.com', 'b@x.com']);

  const r2 = commit.notifCommit(db, { ops: [{ op: 'markRead', email: 'a@x.com', id: 'n1' }] }, CTX);
  assert.deepEqual(Object.keys(r2.touched), ['a@x.com']);
  assert.equal(r2.touched['a@x.com'][0].read, true);
  // b@x.com 未被本次 ops 觸及，但資料應仍完整保留（不整檔覆寫）。
  const { data } = vdrive.readJson(db, 'notifications.json', CTX);
  assert.equal(data.users['b@x.com'].length, 1);
});

test('notifCommit：檔案不存在時，首次建檔從 config.json 的 users[].notifications 遷移', () => {
  const db = freshDb();
  vdrive.createJson(db, {
    name: 'config.json', parentId: ROOT,
    content: { users: { 'a@x.com': { role: '專任諮商心理師', notifications: [{ id: 'legacy1' }] } } },
  });
  const r = commit.notifCommit(db, { ops: [{ op: 'push', email: 'b@x.com', notif: { id: 'n1' } }] }, CTX);
  assert.deepEqual(r.touched['b@x.com'].map((n) => n.id), ['n1']);
  const { data } = vdrive.readJson(db, 'notifications.json', CTX);
  assert.deepEqual(data.users['a@x.com'].map((n) => n.id), ['legacy1']); // 遷移進來的既有通知保留
});

test('notifCommit：fail-closed——notifications.json 內容損毀（users 非物件）時 throw', () => {
  const db = freshDb();
  const file = vdrive.createJson(db, { name: 'notifications.json', parentId: ROOT, content: { users: [] } }); // 陣列，非物件
  assert.throws(
    () => commit.notifCommit(db, { ops: [{ op: 'push', email: 'a@x.com', notif: { id: 'n1' } }] }, CTX),
    /notifCommit: notifications\.json 內容異常（users 非物件），已中止寫入以保護資料/,
  );
  const row = vdrive.getFileById(db, file.id);
  assert.deepEqual(JSON.parse(row.content), { users: [] });
});

// ══════════════════════════════════════════════════════════════════════════
// bookingsCommit：對映 dev/Code.gs bookingsCommit_（L3317）
// ══════════════════════════════════════════════════════════════════════════

test('bookingsCommit：ops 為空 → throw', () => {
  const db = freshDb();
  assert.throws(() => commit.bookingsCommit(db, { ops: [] }, CTX), /bookingsCommit: ops required/);
});

test('bookingsCommit：新增預約成功（無衝突）', () => {
  const db = freshDb();
  const r = commit.bookingsCommit(db, {
    ops: [{ op: 'upsert', booking: { id: 'BK1', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山', counselors: [{ value: 'a@x.com' }] } }],
    checkConflicts: true,
  }, CTX);
  assert.equal(r.ok, true);
  assert.equal(r.bookings.length, 1);
  assert.deepEqual(r.gcErrors, []);
});

test('bookingsCommit：撞房 → { error: "conflict", conflictType: "room" }，不寫入', () => {
  const db = freshDb();
  commit.bookingsCommit(db, { ops: [{ op: 'upsert', booking: { id: 'BK1', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山', counselors: [{ value: 'a@x.com' }] } }] }, CTX);
  const r = commit.bookingsCommit(db, {
    ops: [{ op: 'upsert', booking: { id: 'BK2', date: '2026-07-15', startTime: '09:30', endTime: '10:30', room: '玉山', counselors: [{ value: 'z@x.com' }] } }],
    checkConflicts: true,
  }, CTX);
  assert.equal(r.error, 'conflict');
  assert.equal(r.conflictType, 'room');
  assert.equal(r.with.id, 'BK1');
  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  assert.equal(data.bookings.length, 1); // BK2 未寫入
});

test('bookingsCommit：skipPersonConflict 時人員衝突不阻擋（僅房間衝突仍會擋）', () => {
  const db = freshDb();
  commit.bookingsCommit(db, { ops: [{ op: 'upsert', booking: { id: 'BK1', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山', counselors: [{ value: 'a@x.com' }] } }] }, CTX);
  const r = commit.bookingsCommit(db, {
    ops: [{ op: 'upsert', booking: { id: 'BK2', date: '2026-07-15', startTime: '09:15', endTime: '09:45', room: '中央山脈', counselors: [{ value: 'a@x.com' }] } }],
    checkConflicts: true, skipPersonConflict: true,
  }, CTX);
  assert.equal(r.ok, true);
  assert.equal(r.bookings[0].id, 'BK2');
});

test('bookingsCommit：calendarEventId 重複匯入防護——同一 GC 事件不會被建立成兩筆新預約', () => {
  const db = freshDb();
  commit.bookingsCommit(db, {
    ops: [{ op: 'upsert', booking: { id: 'BK1', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山', calendarEventId: 'GCEVT1' } }],
    checkConflicts: false,
  }, CTX);
  // 另一個「同時匯入」路徑帶了不同 booking id、但同一 calendarEventId → 應被忽略（不新增）。
  const r = commit.bookingsCommit(db, {
    ops: [{ op: 'upsert', booking: { id: 'BK2', date: '2026-07-15', startTime: '11:00', endTime: '12:00', room: '雪山', calendarEventId: 'GCEVT1' } }],
    checkConflicts: false,
  }, CTX);
  assert.equal(r.bookings.length, 0); // BK2 被略過，本次回傳的「受影響」清單裡沒有它
  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  assert.equal(data.bookings.length, 1); // 全庫仍只有一筆
  assert.equal(data.bookings[0].id, 'BK1');
});

test('bookingsCommit：delete op 依 id 移除', () => {
  const db = freshDb();
  commit.bookingsCommit(db, { ops: [{ op: 'upsert', booking: { id: 'BK1', date: '2026-07-15', startTime: '09:00', endTime: '10:00', room: '玉山' } }] }, CTX);
  commit.bookingsCommit(db, { ops: [{ op: 'delete', id: 'BK1' }] }, CTX);
  const { data } = vdrive.readJson(db, 'bookings.json', CTX);
  assert.equal(data.bookings.length, 0);
});

test('bookingsCommit：fail-closed——bookings.json 內容損毀時 throw，原內容不被覆寫', () => {
  const db = freshDb();
  const file = vdrive.createJson(db, { name: 'bookings.json', parentId: ROOT, content: { bookings: 'nope' } });
  assert.throws(
    () => commit.bookingsCommit(db, { ops: [{ op: 'upsert', booking: { id: 'BK9', date: '2026-07-15', startTime: '09:00', endTime: '10:00' } }] }, CTX),
    /bookings\.json 內容異常（bookings 非陣列），已中止寫入以保護資料/,
  );
  const row = vdrive.getFileById(db, file.id);
  assert.deepEqual(JSON.parse(row.content), { bookings: 'nope' });
});

// ══════════════════════════════════════════════════════════════════════════
// 併發語意：同一 path 的讀-改-寫必須整段在交易內（IMMEDIATE），不得有遺失更新窗口
// ══════════════════════════════════════════════════════════════════════════

test('併發：兩個「同時到達」的 casesUpsert（不同 id）依序處理後兩筆皆保留，不遺失更新', () => {
  const db = freshDb();
  vdrive.createFolder(db, { name: 'cases', parentId: ROOT });
  // 模擬兩個請求幾乎同時抵達：各自呼叫時都不知道對方的存在（各自 upserts 只帶自己那一筆）。
  const r1 = commit.casesUpsert(db, { path: 'cases/chunk-a.json', upserts: [{ id: 'C1' }] }, CTX);
  const r2 = commit.casesUpsert(db, { path: 'cases/chunk-a.json', upserts: [{ id: 'C2' }] }, CTX);
  assert.equal(r1.count, 1);
  assert.equal(r2.count, 2); // 第二個交易讀到的是第一個交易「已提交」後的最新狀態，而非讀到舊快照
  const { data } = vdrive.readJson(db, 'cases/chunk-a.json', CTX);
  assert.deepEqual(data.cases.map((c) => c.id).sort(), ['C1', 'C2']);
});

test('併發：兩個獨立連線（同一 sqlite 檔）——A 持有 IMMEDIATE 鎖時 B 的交易被擋下，A 釋放後 B 重試才成功且不遺失更新', () => {
  // 用兩個獨立 Database 連線模擬「兩個請求處理序」（比同一連線內依序呼叫更貼近真實跨行程/跨連線場景，
  // 直接驗證 db.transaction(...).immediate() 是否真的取得跨連線互斥，而非只是同一 JS 執行緒單執行緒的假象）。
  const dbPath = path.join(os.tmpdir(), `scc-commit-concurrency-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const dbA = openDb(dbPath);
  const dbB = openDb(dbPath);
  dbB.pragma('busy_timeout = 200'); // 縮短逾時（預設 15000ms 承襲 db.js，測試不必真等 15 秒）
  try {
    vdrive.createFolder(dbA, { name: 'cases', parentId: ROOT });
    commit.casesUpsert(dbA, { path: 'cases/chunk-a.json', upserts: [{ id: 'C1' }] }, CTX);

    dbA.exec('BEGIN IMMEDIATE'); // A 持有寫鎖、尚未 commit——模擬「請求 A 仍在交易中」
    try {
      assert.throws(
        () => commit.casesUpsert(dbB, { path: 'cases/chunk-a.json', upserts: [{ id: 'C2' }] }, CTX),
        /busy|locked/i,
        'A 持有鎖期間，B 的交易應被擋下，而不是讀到舊快照後蓋掉 A 尚未提交的寫入'
      );
    } finally {
      dbA.exec('COMMIT'); // A 釋放鎖
    }

    const r = commit.casesUpsert(dbB, { path: 'cases/chunk-a.json', upserts: [{ id: 'C2' }] }, CTX);
    assert.equal(r.count, 2, 'A 釋放鎖後，B 重試應讀到 A 已提交的最新狀態（C1＋C2 皆在），而非遺失更新');
  } finally {
    dbA.close();
    dbB.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + suffix); } catch (_e) { /* ignore */ }
    }
  }
});

test('併發：attendanceCommit 兩人先後打卡，第二個交易看到第一個交易已提交的紀錄（RMW 非舊快照覆寫）', async () => {
  const db = freshDb();
  await commit.attendanceCommit(db, { upserts: [{ id: 'P1', type: 'punch', email: 'a@x.com', date: '2026-07-15' }] }, CTX);
  const r2 = await commit.attendanceCommit(db, { upserts: [{ id: 'P2', type: 'punch', email: 'b@x.com', date: '2026-07-15' }] }, CTX);
  assert.equal(r2.count, 2);
});
