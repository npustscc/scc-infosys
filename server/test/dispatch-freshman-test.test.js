// server/test/dispatch-freshman-test.test.js — dispatch.js 對 ft*（新生心理測驗，v207 Slice 1）
// action 的接線／授權閘 smoke test。比照 test/dispatch-sms.test.js 寫法：直接呼叫 handleRequest，
// :memory: db；額外驗證 audit_log 不含學生個資明細（見 audit.js summarizeFtParams）。
// 測試 fixture 一律用假學號/假姓名（B99999999／測試員甲），不得出現真實個案資料（CLAUDE.md）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { handleRequest } = require('../src/dispatch');
const vdrive = require('../src/storage/vdrive');
const local = require('../src/auth/local');
const freshmanTestActions = require('../src/freshmanTest/actions');

const ROOT = 'ROOT_FT_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-ft',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
  }, overrides || {});
}

async function setupUser(db, email, password, entry) {
  await local.upsertUser(db, email, password, {});
  let cfgId;
  try { cfgId = vdrive.resolvePathToId(db, 'config.json', { root: ROOT }); } catch (_e) { cfgId = null; }
  if (cfgId == null) {
    vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { [email]: entry || {} } } });
  } else {
    const { data } = vdrive.readJson(db, 'config.json', { root: ROOT });
    data.users[email] = entry || {};
    vdrive.updateContentById(db, cfgId, data);
  }
}

async function login(db, config, email, password) {
  return handleRequest(db, config, { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
}

test('ftListSemesters：未帶 sessionToken → Session expired（一般授權閘，非 AUTHZ_EXEMPT）', async () => {
  const db = openDb(':memory:');
  const r = await handleRequest(db, testConfig(), { action: 'ftListSemesters', rootFolderId: ROOT });
  assert.equal(r.data.error, 'Session expired');
});

test('ftListSemesters：一般授權使用者（非管理者、非 isFreshmenTestContact）→ Forbidden', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'staff@x.com', 'right-password', { role: '專任諮商心理師' });
  const login1 = await login(db, testConfig(), 'staff@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'ftListSemesters', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
  });
  // bizError 回應 success 恆為 true，業務語意在 data.error（見 envelope.js 檔頭三態說明）。
  assert.equal(r.success, true);
  assert.match(r.data.error, /Forbidden/);
});

test('ftListSemesters：isFreshmenTestContact=true 的非管理者 → 放行（可多人同時擔任，不需管理者身分）', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'ft@x.com', 'right-password', { role: '專任諮商心理師', isFreshmenTestContact: true });
  const login1 = await login(db, testConfig(), 'ft@x.com', 'right-password');
  const r = await handleRequest(db, testConfig(), {
    action: 'ftListSemesters', sessionToken: login1.data.sessionToken, rootFolderId: ROOT,
  });
  assert.equal(r.success, true);
  assert.deepEqual(r.data.semesters, []);
});

test('ftListSemesters：主任（role）與管理者（isAdmin）皆放行，即使無 isFreshmenTestContact', async () => {
  const db = openDb(':memory:');
  await setupUser(db, 'director@x.com', 'right-password', { role: '主任' });
  await setupUser(db, 'admin@x.com', 'right-password2', { role: '專任諮商心理師', isAdmin: true });
  const l1 = await login(db, testConfig(), 'director@x.com', 'right-password');
  const l2 = await login(db, testConfig(), 'admin@x.com', 'right-password2');
  const r1 = await handleRequest(db, testConfig(), { action: 'ftListSemesters', sessionToken: l1.data.sessionToken, rootFolderId: ROOT });
  const r2 = await handleRequest(db, testConfig(), { action: 'ftListSemesters', sessionToken: l2.data.sessionToken, rootFolderId: ROOT });
  assert.equal(r1.success, true);
  assert.equal(r2.success, true);
});

async function setupFtUser(db, email = 'ft@x.com', password = 'right-password') {
  await setupUser(db, email, password, { role: '專任諮商心理師', isFreshmenTestContact: true });
  const l = await login(db, testConfig(), email, password);
  return l.data.sessionToken;
}

test('ftCreateSemester → ftGetSheet：新學期回預設 14 欄 schema、rows 為空陣列', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  const created = await handleRequest(db, testConfig(), {
    action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1', label: '114學年度第1學期',
  });
  assert.equal(created.success, true);
  assert.equal(created.data.semester.id, '114-1');

  const sheet = await handleRequest(db, testConfig(), {
    action: 'ftGetSheet', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students',
  });
  assert.equal(sheet.success, true);
  assert.equal(sheet.data.schema.cols.length, 14);
  assert.equal(sheet.data.schema.cols[0].id, 'stu_id');
  assert.equal(sheet.data.schema.cols[0].locked, true);
  assert.deepEqual(sheet.data.rows, []);
});

test('ftCreateSemester：格式錯誤的學期代碼 → 業務錯誤', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  const r = await handleRequest(db, testConfig(), {
    action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '2025-1',
  });
  assert.equal(r.success, false);
});

test('ftCreateSemester：重複學期代碼 → 業務錯誤（不覆蓋既有）', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  const r2 = await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  assert.equal(r2.success, false);
});

test('ftSaveRows：新列由後端配發 _id；更新既有列時保留原 _createdAt', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });

  const r1 = await handleRequest(db, testConfig(), {
    action: 'ftSaveRows', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students',
    rows: [{ cells: { stu_id: 'B99999999', name_zh: '測試員甲' } }],
  });
  assert.equal(r1.success, true);
  assert.equal(r1.data.count, 1);

  const sheet1 = await handleRequest(db, testConfig(), {
    action: 'ftGetSheet', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students',
  });
  const savedRow = sheet1.data.rows[0];
  assert.ok(savedRow._id);
  const firstCreatedAt = savedRow._createdAt;

  // 更新該列（帶回 _id）＋新增第二列
  const r2 = await handleRequest(db, testConfig(), {
    action: 'ftSaveRows', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students',
    rows: [
      { _id: savedRow._id, cells: { stu_id: 'B99999999', name_zh: '測試員甲（更新）' } },
      { cells: { stu_id: 'B88888888', name_zh: '測試員乙' } },
    ],
  });
  assert.equal(r2.success, true);
  assert.equal(r2.data.count, 2);

  const sheet2 = await handleRequest(db, testConfig(), {
    action: 'ftGetSheet', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students',
  });
  assert.equal(sheet2.data.rows.length, 2);
  const updatedRow = sheet2.data.rows.find((r) => r._id === savedRow._id);
  assert.equal(updatedRow._createdAt, firstCreatedAt); // 保留原建立時間
  assert.equal(updatedRow.cells.name_zh, '測試員甲（更新）');
});

test('ftSaveSchema：不可刪除固定欄位（stu_id）', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  const cols = freshmanTestActions.STUDENTS_DEFAULT_COLS.filter((c) => c.id !== 'stu_id');
  const r = await handleRequest(db, testConfig(), {
    action: 'ftSaveSchema', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students', cols,
  });
  assert.equal(r.success, false);
});

test('ftSaveSchema：刪除非固定欄位不影響歷史列的 cells 資料（schema／rows 分檔的結構性保證）', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  await handleRequest(db, testConfig(), {
    action: 'ftSaveRows', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students',
    rows: [{ cells: { stu_id: 'B99999999', name_zh: '測試員甲', gender: '女' } }],
  });

  // 刪掉「性別」欄（gender，非固定欄位）
  const remainingCols = freshmanTestActions.STUDENTS_DEFAULT_COLS.filter((c) => c.id !== 'gender');
  const rSchema = await handleRequest(db, testConfig(), {
    action: 'ftSaveSchema', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students', cols: remainingCols,
  });
  assert.equal(rSchema.success, true);
  assert.equal(rSchema.data.schema.cols.some((c) => c.id === 'gender'), false);

  // rows.json 完全未被觸碰：舊列的 cells.gender 資料原樣保留
  const sheet = await handleRequest(db, testConfig(), {
    action: 'ftGetSheet', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students',
  });
  assert.equal(sheet.data.rows[0].cells.gender, '女');
  // schema 已不含該欄，前端據此決定不再顯示這一欄（資料仍在、只是沒有欄位會再顯示它）
  assert.equal(sheet.data.schema.cols.some((c) => c.id === 'gender'), false);
});

test('ftSaveRows／ftSaveSchema：修改非最新學期 → audit_log 標記 historical:true；最新學期不標記', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-2' });

  await handleRequest(db, testConfig(), {
    action: 'ftSaveRows', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students',
    rows: [{ cells: { stu_id: 'B99999999', name_zh: '測試員甲' } }],
  });
  const auditOld = db.prepare("SELECT * FROM audit_log WHERE action = 'ftSaveRows' ORDER BY id DESC LIMIT 1").get();
  assert.match(auditOld.detail, /historical:true/);

  await handleRequest(db, testConfig(), {
    action: 'ftSaveRows', sessionToken: tok, rootFolderId: ROOT, semester: '114-2', sheet: 'students',
    rows: [{ cells: { stu_id: 'B99999999', name_zh: '測試員甲' } }],
  });
  const auditLatest = db.prepare("SELECT * FROM audit_log WHERE action = 'ftSaveRows' ORDER BY id DESC LIMIT 1").get();
  assert.doesNotMatch(auditLatest.detail, /historical:true/);
});

test('ftSaveRows：audit_log 不含學生個資明細（姓名/學號），只記筆數與學期/sheet', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  await handleRequest(db, testConfig(), {
    action: 'ftSaveRows', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students',
    rows: [{ cells: { stu_id: 'B99999999', name_zh: '測試員甲（機密不該進稽核）' } }],
  });
  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'ftSaveRows' ORDER BY id DESC LIMIT 1").get();
  assert.equal(auditRow.outcome, 'ok');
  assert.doesNotMatch(auditRow.detail, /測試員甲/);
  assert.doesNotMatch(auditRow.detail, /B99999999/);
  assert.match(auditRow.detail, /rows=1/);
  assert.match(auditRow.detail, /semester=114-1/);
  assert.match(auditRow.detail, /sheet=students/);
});

test('ftSaveSchema：audit_log 記欄位 id 但不含學生資料（本就不在 params 內）', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  await handleRequest(db, testConfig(), {
    action: 'ftSaveSchema', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'students',
    cols: freshmanTestActions.STUDENTS_DEFAULT_COLS,
  });
  const auditRow = db.prepare("SELECT * FROM audit_log WHERE action = 'ftSaveSchema' ORDER BY id DESC LIMIT 1").get();
  assert.match(auditRow.detail, /cols=stu_id\|name_zh/);
});

test('ftGetSheet：不支援的 sheet（尚未實作的後續切片 tab，如整合）→ 業務錯誤', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  const r = await handleRequest(db, testConfig(), {
    // v209：導師名冊（tutors）已於 Slice 3 開放，整合（merged）仍是前端純衍生視圖、不落地儲存，
    // 維持白名單外（見 freshmanTest/actions.js SHEETS 檔頭註解）。
    action: 'ftGetSheet', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'merged',
  });
  assert.equal(r.success, false);
});

// ══════════════ v208 Slice 2：sheet 泛化（測驗資料 146 欄／Google表單 8 欄）══════════════

test('ftGetSheet：新學期「測驗資料」sheet 回預設 146 欄 schema，學號/姓名為固定＋必填欄位', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  const r = await handleRequest(db, testConfig(), {
    action: 'ftGetSheet', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'tests',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.schema.cols.length, 146);
  const byId = Object.fromEntries(r.data.schema.cols.map((c) => [c.id, c]));
  assert.equal(byId.stu_id.locked, true);
  assert.equal(byId.stu_id.required, true);
  assert.equal(byId.name_zh.required, true);
  assert.deepEqual(r.data.rows, []);
  // 欄位 id 全部唯一（無手誤重複）
  const ids = r.data.schema.cols.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('ftGetSheet：新學期「Google表單」sheet 回預設 8 欄 schema', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  const r = await handleRequest(db, testConfig(), {
    action: 'ftGetSheet', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'gforms',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.schema.cols.length, 8);
  assert.equal(r.data.schema.cols[2].id, 'stu_id');
  assert.equal(r.data.schema.cols[2].locked, true);
});

test('ftSaveRows：excluded 旗標往返（Google表單同學號多筆選主條目用）——未帶 excluded 預設 false', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  await handleRequest(db, testConfig(), {
    action: 'ftSaveRows', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'gforms',
    rows: [
      { cells: { stu_id: 'B99999999', name_zh: '測試員甲' } },
      { cells: { stu_id: 'B99999999', name_zh: '測試員甲（另一筆填寫）' }, excluded: true },
    ],
  });
  const sheet = await handleRequest(db, testConfig(), {
    action: 'ftGetSheet', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'gforms',
  });
  assert.equal(sheet.data.rows[0].excluded, false);
  assert.equal(sheet.data.rows[1].excluded, true);
});

test('ftGetSheet：白名單外的 sheet 名稱（如 __proto__ 或任意字串）一律業務錯誤，不會意外回傳資料', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  const r = await handleRequest(db, testConfig(), {
    action: 'ftGetSheet', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'merged',
  });
  assert.equal(r.success, false);
});
