// server/test/freshman-test-tutorsync.test.js — 新生心理測驗（v209 Slice 3）導師名冊 tutorsys
// 同步：白名單路徑防護＋欄位投影（tutorsysSync.js）＋ftTutorSyncFetch dispatch 接線／授權閘。
// fixture 一律用假班級/假姓名，不得出現真實個案資料（CLAUDE.md）。
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
const tutorsysSync = require('../src/freshmanTest/tutorsysSync');

const ROOT = 'ROOT_FT_TUTORSYNC_TEST';

function testConfig(overrides) {
  return Object.assign({
    SESSION_SECRET: 'test-secret-ft-tutorsync',
    ROOT_FOLDER_ID: ROOT,
    CASE_AUTHZ_MODE: 'shadow',
    GAS_PROXY_URL: '',
    TUTORSYS_STORE_DIR: '',
  }, overrides || {});
}

async function setupFtUser(db, email = 'ft@x.com', password = 'right-password') {
  await local.upsertUser(db, email, password, {});
  vdrive.createJson(db, {
    name: 'config.json', parentId: ROOT,
    content: { users: { [email]: { role: '專任諮商心理師', isFreshmenTestContact: true } } },
  });
  const r = await handleRequest(db, testConfig(), { action: 'sessionStart', rootFolderId: ROOT, email, password, ua: 'test-agent' });
  return r.data.sessionToken;
}

function makeStoreDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tutorsys-store-'));
}

function writeStore(dir, classes, departments) {
  fs.writeFileSync(path.join(dir, 'classes.json'), JSON.stringify(classes));
  fs.writeFileSync(path.join(dir, 'departments.json'), JSON.stringify(departments));
}

// ══════════════ readTutorsysStoreFile：白名單路徑防護 ══════════════

test('readTutorsysStoreFile：storeDir 未設定 → 明確錯誤（tutorsys_not_configured）', () => {
  assert.throws(() => tutorsysSync.readTutorsysStoreFile('', 'classes.json'), /TUTORSYS_STORE_DIR/);
});

test('readTutorsysStoreFile：白名單外檔名一律拒絕（含路徑遍歷嘗試）', () => {
  const dir = makeStoreDir();
  writeStore(dir, [], []);
  assert.throws(() => tutorsysSync.readTutorsysStoreFile(dir, '../../etc/passwd'), /不在白名單內/);
  assert.throws(() => tutorsysSync.readTutorsysStoreFile(dir, 'config.json'), /不在白名單內/);
  assert.throws(() => tutorsysSync.readTutorsysStoreFile(dir, 'classes.json/../../../etc/passwd'), /不在白名單內/);
  assert.throws(() => tutorsysSync.readTutorsysStoreFile(dir, '/etc/passwd'), /不在白名單內/);
});

test('readTutorsysStoreFile：白名單內檔名正常讀取並解析 JSON', () => {
  const dir = makeStoreDir();
  writeStore(dir, [{ id: 'c1' }], [{ id: 'd1' }]);
  const classes = tutorsysSync.readTutorsysStoreFile(dir, 'classes.json');
  const departments = tutorsysSync.readTutorsysStoreFile(dir, 'departments.json');
  assert.deepEqual(classes, [{ id: 'c1' }]);
  assert.deepEqual(departments, [{ id: 'd1' }]);
});

test('readTutorsysStoreFile：檔案不存在 → 明確錯誤，不吞例外', () => {
  const dir = makeStoreDir();
  assert.throws(() => tutorsysSync.readTutorsysStoreFile(dir, 'classes.json'), /讀取 classes\.json 失敗/);
});

test('readTutorsysStoreFile：內容非合法 JSON → 明確錯誤', () => {
  const dir = makeStoreDir();
  fs.writeFileSync(path.join(dir, 'classes.json'), '{ 這不是 JSON');
  assert.throws(() => tutorsysSync.readTutorsysStoreFile(dir, 'classes.json'), /非合法 JSON/);
});

// ══════════════ pickClasses／pickDepartments：欄位投影＋停用/軟刪除過濾 ══════════════

test('pickClasses：只投影同步所需欄位，內部欄位（uploadWhitelist 等）不外流', () => {
  const raw = [{
    id: '農園系_四技一A', name: '四技一A', deptId: '農園系', systemId: 'day_college', displayName: '四農園一A',
    tutors: [{ name: '王小明', email: 'wang@test.local' }], suggestedTutors: [], dualApprovalMode: 'any',
    uploadWhitelist: ['a@b.com'], graduationGrade: null, active: true,
  }];
  const picked = tutorsysSync.pickClasses(raw);
  assert.equal(picked.length, 1);
  assert.deepEqual(Object.keys(picked[0]).sort(), ['deptId', 'displayName', 'id', 'tutors'].sort());
  assert.equal(picked[0].displayName, '四農園一A');
  assert.deepEqual(picked[0].tutors, [{ name: '王小明', email: 'wang@test.local' }]);
});

test('pickClasses：停用（active:false）或軟刪除（deleted:true）的班級排除', () => {
  const raw = [
    { id: 'c1', displayName: '四農園一A', deptId: '農園系', tutors: [], active: true },
    { id: 'c2', displayName: '四農園二A', deptId: '農園系', tutors: [], active: false },
    { id: 'c3', displayName: '四農園三A', deptId: '農園系', tutors: [], deleted: true },
  ];
  const picked = tutorsysSync.pickClasses(raw);
  assert.deepEqual(picked.map((c) => c.id), ['c1']);
});

test('pickDepartments：投影 headEmail/headName，只濾 deleted 不濾 active（停用系所仍可能有 active 班級掛著）', () => {
  const raw = [
    { id: '農園系', name: '農園系', headEmail: 'head@test.local', headName: '測試系主任', collegeId: '農學院', active: true },
    { id: '停用系', name: '停用系', headEmail: '', headName: '', active: false },
    { id: '刪除系', name: '刪除系', headEmail: '', headName: '', deleted: true },
  ];
  const picked = tutorsysSync.pickDepartments(raw);
  assert.deepEqual(picked.map((d) => d.id).sort(), ['停用系', '農園系'].sort());
  const dept = picked.find((d) => d.id === '農園系');
  assert.equal(dept.headEmail, 'head@test.local');
  assert.equal(dept.headName, '測試系主任');
  assert.ok(!('collegeId' in dept)); // collegeId 屬於 tutorsys colleges.json 對映用，未在讀取白名單內，不投影
});

// ══════════════ ftTutorSyncFetch：dispatch 接線／授權閘／未設定 TUTORSYS_STORE_DIR ══════════════

test('ftTutorSyncFetch：走一般 ft 授權閘（非授權使用者 → Forbidden）', async () => {
  const db = openDb(':memory:');
  await local.upsertUser(db, 'staff@x.com', 'right-password', {});
  vdrive.createJson(db, { name: 'config.json', parentId: ROOT, content: { users: { 'staff@x.com': { role: '專任諮商心理師' } } } });
  const login1 = await handleRequest(db, testConfig(), { action: 'sessionStart', rootFolderId: ROOT, email: 'staff@x.com', password: 'right-password', ua: 'test-agent' });
  const r = await handleRequest(db, testConfig(), { action: 'ftTutorSyncFetch', sessionToken: login1.data.sessionToken, rootFolderId: ROOT });
  assert.match(r.data.error, /Forbidden/);
});

test('ftTutorSyncFetch：TUTORSYS_STORE_DIR 未設定 → 明確業務錯誤（前端據此顯示「未設定」）', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  const r = await handleRequest(db, testConfig({ TUTORSYS_STORE_DIR: '' }), { action: 'ftTutorSyncFetch', sessionToken: tok, rootFolderId: ROOT });
  // 本 action 拋出的例外走一般 catch 區塊變成 envelope.fail（success:false），比照既有 ft*
  // action（如 ftCreateSemester 重複學期代碼）的業務錯誤慣例——不同於閘門層 bizError（success:true）。
  assert.equal(r.success, false);
  assert.match(r.error, /TUTORSYS_STORE_DIR/);
});

test('ftTutorSyncFetch：已設定 TUTORSYS_STORE_DIR → 回傳投影後的 classes/departments', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  const dir = makeStoreDir();
  writeStore(
    dir,
    [{ id: '農園系_四技一A', deptId: '農園系', displayName: '四農園一A', tutors: [{ name: '王小明', email: 'wang@test.local' }], active: true }],
    [{ id: '農園系', name: '農園系', headEmail: 'head@test.local', headName: '測試系主任', active: true }],
  );
  const r = await handleRequest(db, testConfig({ TUTORSYS_STORE_DIR: dir }), { action: 'ftTutorSyncFetch', sessionToken: tok, rootFolderId: ROOT });
  assert.equal(r.success, true);
  assert.equal(r.data.classes.length, 1);
  assert.equal(r.data.classes[0].displayName, '四農園一A');
  assert.equal(r.data.departments[0].headName, '測試系主任');
});

test('ftGetSheet：新學期「導師名冊」sheet 回預設 6 欄 schema，班級簡稱為固定＋必填欄位', async () => {
  const db = openDb(':memory:');
  const tok = await setupFtUser(db);
  await handleRequest(db, testConfig(), { action: 'ftCreateSemester', sessionToken: tok, rootFolderId: ROOT, id: '114-1' });
  const r = await handleRequest(db, testConfig(), { action: 'ftGetSheet', sessionToken: tok, rootFolderId: ROOT, semester: '114-1', sheet: 'tutors' });
  assert.equal(r.success, true);
  assert.equal(r.data.schema.cols.length, 6);
  const byId = Object.fromEntries(r.data.schema.cols.map((c) => [c.id, c]));
  assert.equal(byId.class_abbr.locked, true);
  assert.equal(byId.class_abbr.required, true);
  assert.deepEqual(r.data.rows, []);
});
