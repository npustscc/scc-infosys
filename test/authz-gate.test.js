// 後端授權閘純決策單元測試（P0-1 修補 F1：授權快取跨 root 汙染）。
// 執行：node --test test/*.test.js
// 測試對象從 dev/Code.gs 就地抽出（harness.extractFunction），改壞正式碼即紅燈。
// 抽出的是「純決策」函式（不碰 UrlFetchApp/CacheService），故可在 vm sandbox 直接跑。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./harness');

function loadFromCodeGs(names) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dev', 'Code.gs'), 'utf8');
  const sandbox = { JSON, Array, Object };
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(src, n)).join('\n\n'), sandbox);
  return sandbox;
}

const PROD_FOLDER = '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP'; // = ISSUES_FOLDER_ID
const ATTACKER_FOLDER = '0AFakeAttackerFolderId_xxxxxxxxxxx';
const BOOT = ['npust.scc@heartnpust.tw', 'linkinlol528101@gmail.com'];

// ── issuesExceptionAllowed_：跨環境例外只認固定 ISSUES_FOLDER_ID 的 issues.json ──

test('issues 例外：正確的 issues.json + 固定資料夾 → 放行', () => {
  const S = loadFromCodeGs(['issuesExceptionAllowed_']);
  assert.equal(S.issuesExceptionAllowed_(PROD_FOLDER, 'issues.json', PROD_FOLDER), true);
});

test('issues 例外：攻擊者自建 folderId（即使 path=issues.json）→ 拒絕（F1 攻擊鏈斷點）', () => {
  const S = loadFromCodeGs(['issuesExceptionAllowed_']);
  assert.equal(S.issuesExceptionAllowed_(ATTACKER_FOLDER, 'issues.json', PROD_FOLDER), false);
});

test('issues 例外：固定資料夾但存取非 issues.json（想偷讀 config/個案）→ 拒絕', () => {
  const S = loadFromCodeGs(['issuesExceptionAllowed_']);
  assert.equal(S.issuesExceptionAllowed_(PROD_FOLDER, 'config.json', PROD_FOLDER), false);
  assert.equal(S.issuesExceptionAllowed_(PROD_FOLDER, 'cases/manifest.json', PROD_FOLDER), false);
});

test('issues 例外：空/未帶 path → 拒絕', () => {
  const S = loadFromCodeGs(['issuesExceptionAllowed_']);
  assert.equal(S.issuesExceptionAllowed_(PROD_FOLDER, '', PROD_FOLDER), false);
});

// ── authzDecision_：授權判定（含 fail-closed 與 bootstrap 備援）──

test('authz：email 在 users 且未停用 → 放行', () => {
  const S = loadFromCodeGs(['authzDecision_']);
  const users = { 'a@x.com': { role: '專任諮商心理師' } };
  assert.equal(S.authzDecision_(users, 'a@x.com', BOOT), true);
});

test('authz：email 在 users 但 disabled:true → 拒絕', () => {
  const S = loadFromCodeGs(['authzDecision_']);
  const users = { 'a@x.com': { role: '專任諮商心理師', disabled: true } };
  assert.equal(S.authzDecision_(users, 'a@x.com', BOOT), false);
});

test('authz：email 不在 users → 拒絕（攻擊者自家 config 也無法在本環境放行）', () => {
  const S = loadFromCodeGs(['authzDecision_']);
  const users = { 'a@x.com': {} };
  assert.equal(S.authzDecision_(users, 'attacker@gmail.com', BOOT), false);
});

test('authz：users 為 null（config 讀不到）→ fail-closed 拒絕', () => {
  const S = loadFromCodeGs(['authzDecision_']);
  assert.equal(S.authzDecision_(null, 'a@x.com', BOOT), false);
});

test('authz：BOOTSTRAP_ADMINS 即使 config 全毀（users=null）仍放行（防鎖死）', () => {
  const S = loadFromCodeGs(['authzDecision_']);
  assert.equal(S.authzDecision_(null, 'npust.scc@heartnpust.tw', BOOT), true);
});

test('authz：空 email → 拒絕', () => {
  const S = loadFromCodeGs(['authzDecision_']);
  assert.equal(S.authzDecision_({ '': {} }, '', BOOT), false);
});

// ── adminDecision_：管理者判定（P0-2/P0-3 角色分層）──

test('admin：role=主任 → 是管理者', () => {
  const S = loadFromCodeGs(['adminDecision_']);
  assert.equal(S.adminDecision_({ 'a@x.com': { role: '主任' } }, 'a@x.com', BOOT), true);
});

test('admin：extraRole=管理者 → 是管理者', () => {
  const S = loadFromCodeGs(['adminDecision_']);
  assert.equal(S.adminDecision_({ 'a@x.com': { role: '專任諮商心理師', extraRole: '管理者' } }, 'a@x.com', BOOT), true);
});

test('admin：isAdmin:true 新格式 → 是管理者', () => {
  const S = loadFromCodeGs(['adminDecision_']);
  assert.equal(S.adminDecision_({ 'a@x.com': { role: '專任諮商心理師', isAdmin: true } }, 'a@x.com', BOOT), true);
});

test('admin：一般諮商師（無管理身分）→ 非管理者', () => {
  const S = loadFromCodeGs(['adminDecision_']);
  assert.equal(S.adminDecision_({ 'a@x.com': { role: '專任諮商心理師' } }, 'a@x.com', BOOT), false);
});

test('admin：主任但已停用 → 非管理者（fail-closed）', () => {
  const S = loadFromCodeGs(['adminDecision_']);
  assert.equal(S.adminDecision_({ 'a@x.com': { role: '主任', disabled: true } }, 'a@x.com', BOOT), false);
});

test('admin：config 讀不到（users=null）→ 非管理者，但 BOOTSTRAP 仍是', () => {
  const S = loadFromCodeGs(['adminDecision_']);
  assert.equal(S.adminDecision_(null, 'a@x.com', BOOT), false);
  assert.equal(S.adminDecision_(null, 'npust.scc@heartnpust.tw', BOOT), true);
});

// ── isProtectedConfigTarget_：皇冠珠寶檔判定（P0-2）──

const CFG_FID = '1CKXefjjiB-PrIFZa-DBQ7Q2ASs-TQroj';

test('protected：path=config.json → 受保護', () => {
  const S = loadFromCodeGs(['isProtectedConfigTarget_']);
  assert.equal(S.isProtectedConfigTarget_({ path: 'config.json' }, CFG_FID), true);
});

test('protected：path=pending_users.json / 變體 → 受保護', () => {
  const S = loadFromCodeGs(['isProtectedConfigTarget_']);
  assert.equal(S.isProtectedConfigTarget_({ path: 'pending_users.json' }, CFG_FID), true);
  assert.equal(S.isProtectedConfigTarget_({ name: 'pending_users-dev.json' }, CFG_FID), true);
});

test('protected：fileId 命中本環境 config fileId（想用 updateContentById 提權）→ 受保護', () => {
  const S = loadFromCodeGs(['isProtectedConfigTarget_']);
  assert.equal(S.isProtectedConfigTarget_({ fileId: CFG_FID }, CFG_FID), true);
});

test('protected：一般個案檔（cases/... 或其他 fileId）→ 不受此閘限制', () => {
  const S = loadFromCodeGs(['isProtectedConfigTarget_']);
  assert.equal(S.isProtectedConfigTarget_({ path: 'cases/manifest.json' }, CFG_FID), false);
  assert.equal(S.isProtectedConfigTarget_({ fileId: '1SomeOtherCaseFileId' }, CFG_FID), false);
});
