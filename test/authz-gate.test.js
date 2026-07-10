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

// ── shareToSelfOnly_：非管理者僅能授權自己的日曆編輯權（P0-3）──

test('shareSelf：emails 恰為自己一人 → 放行（自助日曆連結）', () => {
  const S = loadFromCodeGs(['shareToSelfOnly_']);
  assert.equal(S.shareToSelfOnly_(['a@x.com'], 'a@x.com'), true);
});

test('shareSelf：授權給別人 → 擋（非管理者不得授權他人）', () => {
  const S = loadFromCodeGs(['shareToSelfOnly_']);
  assert.equal(S.shareToSelfOnly_(['b@x.com'], 'a@x.com'), false);
});

test('shareSelf：自己＋夾帶別人 → 擋', () => {
  const S = loadFromCodeGs(['shareToSelfOnly_']);
  assert.equal(S.shareToSelfOnly_(['a@x.com', 'b@x.com'], 'a@x.com'), false);
});

test('shareSelf：空陣列／非陣列 → 擋', () => {
  const S = loadFromCodeGs(['shareToSelfOnly_']);
  assert.equal(S.shareToSelfOnly_([], 'a@x.com'), false);
  assert.equal(S.shareToSelfOnly_(undefined, 'a@x.com'), false);
});

// ── _escQ_：Drive query 單引號/反斜線跳脫（F4）──

test('escQ：單引號被跳脫（擋 query injection）', () => {
  const S = loadFromCodeGs(['_escQ_']);
  assert.equal(S._escQ_("a'b"), "a\\'b");
  // 注入嘗試：' or name!=' → 跳脫後單引號不再閉合子句
  assert.equal(S._escQ_("x' or name!='"), "x\\' or name!=\\'");
});

test('escQ：反斜線先跳脫（避免 \\\' 被拆解）', () => {
  const S = loadFromCodeGs(['_escQ_']);
  assert.equal(S._escQ_('a\\b'), 'a\\\\b');
});

test('escQ：一般檔名/中文姓名不受影響', () => {
  const S = loadFromCodeGs(['_escQ_']);
  assert.equal(S._escQ_('manifest.json'), 'manifest.json');
  assert.equal(S._escQ_('王'), '王');
});

test('escQ：null/undefined → 空字串（不炸）', () => {
  const S = loadFromCodeGs(['_escQ_']);
  assert.equal(S._escQ_(null), '');
  assert.equal(S._escQ_(undefined), '');
});

// ── isConfigWrite_：判定是否為寫 config.json（P0-2）──

const CFG_FID2 = '1CKXefjjiB-PrIFZa-DBQ7Q2ASs-TQroj';

test('isConfigWrite：updateJson path=config.json → true；其他 path → false', () => {
  const S = loadFromCodeGs(['isConfigWrite_']);
  assert.equal(S.isConfigWrite_('updateJson', { path: 'config.json' }, CFG_FID2), true);
  assert.equal(S.isConfigWrite_('updateJson', { path: 'cases/manifest.json' }, CFG_FID2), false);
});

test('isConfigWrite：updateContentById fileId 命中 config → true；他檔 → false', () => {
  const S = loadFromCodeGs(['isConfigWrite_']);
  assert.equal(S.isConfigWrite_('updateContentById', { fileId: CFG_FID2 }, CFG_FID2), true);
  assert.equal(S.isConfigWrite_('updateContentById', { fileId: '1Other' }, CFG_FID2), false);
});

test('isConfigWrite：createJson name=config.json → true；讀取類 action → false', () => {
  const S = loadFromCodeGs(['isConfigWrite_']);
  assert.equal(S.isConfigWrite_('createJson', { name: 'config.json' }, CFG_FID2), true);
  assert.equal(S.isConfigWrite_('readJson', { path: 'config.json' }, CFG_FID2), false);
});

// ── configWriteAllowedForNonAdmin_（P0-2）已於 v164 移除，改用 _configUsersUnchanged_ ──
// 沿革：P0-2 用「欄位級 diff 比對」放行非管理者整檔覆寫 config.json 時的
// allowedCases/allowedCasesSems/extraRole 子集變動——字面上仍是整檔覆寫，只是覆寫內容受限，
// 非管理者仍可能在比對縫隙夾帶自授個案存取權／覆寫他人併發變動／把讀到寫之間別人的異動蓋回。
// v164 改為「users 物件級」比對：非管理者整檔寫 config.json 時，users 只要與後端當下最新版
// 有任何差異就整批拒絕（doPost 內 isConfigWrite_ 命中且非管理者即呼叫 _configUsersUnchanged_
// 把關）；七個原本靠 diff 比對放行的合法流程已改走 configCasesPatch（LockService 鎖內宣告式
// ops 合併，見 config-cases-patch.test.js 的 applyCasesPatchOps_ 測試）。config.json 內非
// users 的全域共用設定（自訂選項清單／家系圖自訂元件等）不受影響，維持可寫。
// configWriteAllowedForNonAdmin_／_extraRoleTransitionOk_ 兩個純函式已隨此改動刪除；
// _deepEq_ 改供 _configUsersUnchanged_ 使用；_nomailAddOk_ 改供 applyCasesPatchOps_ 的
// nomailAdd op 使用，測試移至 config-cases-patch.test.js。

const mkCfg = (users) => ({ users });

test('_configUsersUnchanged_：users 完全相同（含巢狀欄位）→ true', () => {
  const S = loadFromCodeGs(['_configUsersUnchanged_', '_deepEq_']);
  const old = mkCfg({ 'a@x.com': { role: '專任諮商心理師', pin: '1111', allowedCases: ['1'] }, 'b@x.com': { role: '主任' } });
  const nw  = mkCfg({ 'a@x.com': { role: '專任諮商心理師', pin: '1111', allowedCases: ['1'] }, 'b@x.com': { role: '主任' } });
  assert.equal(S._configUsersUnchanged_(old, nw), true);
});

test('_configUsersUnchanged_：任何欄位有差異（含自己 pin、他人 role）→ false（整批拒絕，不比對個別欄位）', () => {
  const S = loadFromCodeGs(['_configUsersUnchanged_', '_deepEq_']);
  const old = mkCfg({ 'a@x.com': { role: '專任諮商心理師', pin: '1111' } });
  assert.equal(S._configUsersUnchanged_(old, mkCfg({ 'a@x.com': { role: '專任諮商心理師', pin: '2222' } })), false); // 改自己 pin 也擋（逼走 configSelfPatch）
  assert.equal(S._configUsersUnchanged_(old, mkCfg({ 'a@x.com': { role: '專任諮商心理師', pin: '1111', isAdmin: true } })), false); // 自我提權
  const old2 = mkCfg({ 'a@x.com': {}, 'b@x.com': { role: '實習諮商心理師' } });
  assert.equal(S._configUsersUnchanged_(old2, mkCfg({ 'a@x.com': {}, 'b@x.com': { role: '實習諮商心理師', isAdmin: true } })), false); // 改別人
});

test('_configUsersUnchanged_：新增/刪除使用者 → false', () => {
  const S = loadFromCodeGs(['_configUsersUnchanged_', '_deepEq_']);
  const old = mkCfg({ 'a@x.com': {} });
  assert.equal(S._configUsersUnchanged_(old, mkCfg({ 'a@x.com': {}, 'evil@x.com': { role: '主任' } })), false);
  assert.equal(S._configUsersUnchanged_(mkCfg({ 'a@x.com': {}, 'b@x.com': {} }), mkCfg({ 'a@x.com': {} })), false);
});

test('_configUsersUnchanged_：oldCfg 為 null（讀不到當前 config）→ fail-closed false', () => {
  const S = loadFromCodeGs(['_configUsersUnchanged_', '_deepEq_']);
  assert.equal(S._configUsersUnchanged_(null, mkCfg({ 'a@x.com': {} })), false);
});

test('_configUsersUnchanged_：users 非物件（缺漏／陣列）→ fail-closed false', () => {
  const S = loadFromCodeGs(['_configUsersUnchanged_', '_deepEq_']);
  assert.equal(S._configUsersUnchanged_({}, mkCfg({ 'a@x.com': {} })), false);
  assert.equal(S._configUsersUnchanged_(mkCfg({ 'a@x.com': {} }), {}), false);
  assert.equal(S._configUsersUnchanged_(mkCfg([]), mkCfg([])), false);
});

test('_configUsersUnchanged_：config.json 內非 users 的欄位（自訂選項清單等）不影響判斷 → 只要 users 相同即 true', () => {
  const S = loadFromCodeGs(['_configUsersUnchanged_', '_deepEq_']);
  const old = { users: { 'a@x.com': { role: '專任諮商心理師' } }, customOptions: { psychTests: ['WAIS'] } };
  const nw  = { users: { 'a@x.com': { role: '專任諮商心理師' } }, customOptions: { psychTests: ['WAIS', 'MMPI'] } };
  assert.equal(S._configUsersUnchanged_(old, nw), true); // 非管理者新增自訂選項不動 users，仍放行
});

// ── _deepEq_：深度相等（供 _configUsersUnchanged_ 使用）──

test('_deepEq_：純值/巢狀物件/陣列相等判斷；型別不同、鍵數不同 → false', () => {
  const S = loadFromCodeGs(['_deepEq_']);
  assert.equal(S._deepEq_(1, 1), true);
  assert.equal(S._deepEq_('a', 'a'), true);
  assert.equal(S._deepEq_({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } }), true);
  assert.equal(S._deepEq_({ a: 1 }, { a: 2 }), false);
  assert.equal(S._deepEq_({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(S._deepEq_(1, '1'), false);
  assert.equal(S._deepEq_(null, {}), false);
});

// ── _ancestorContains_：fileId 祖先鏈是否含 root（F3）──
// parentsMap: { fileId: [parentIds...] }；getParents = id => parentsMap[id] || []
const mkGetParents = (map) => (id) => map[id] || [];

test('ancestor：檔案直接在 root 下 → true', () => {
  const S = loadFromCodeGs(['_ancestorContains_']);
  const gp = mkGetParents({ 'f1': ['ROOT'] });
  assert.equal(S._ancestorContains_(gp, 'f1', 'ROOT', 25), true);
});

test('ancestor：檔案在 root 的子資料夾下（多層）→ true', () => {
  const S = loadFromCodeGs(['_ancestorContains_']);
  const gp = mkGetParents({ 'f1': ['cases'], 'cases': ['ROOT'] });
  assert.equal(S._ancestorContains_(gp, 'f1', 'ROOT', 25), true);
});

test('ancestor：檔案在別的資料夾（不在 root 下）→ false（擋越界）', () => {
  const S = loadFromCodeGs(['_ancestorContains_']);
  const gp = mkGetParents({ 'evil': ['otherRoot'], 'otherRoot': [] });
  assert.equal(S._ancestorContains_(gp, 'evil', 'ROOT', 25), false);
});

test('ancestor：fileId 就是 root 本身 → true', () => {
  const S = loadFromCodeGs(['_ancestorContains_']);
  assert.equal(S._ancestorContains_(mkGetParents({}), 'ROOT', 'ROOT', 25), true);
});

test('ancestor：parents 自我循環不無限迴圈 → false', () => {
  const S = loadFromCodeGs(['_ancestorContains_']);
  const gp = mkGetParents({ 'f1': ['f1'] });
  assert.equal(S._ancestorContains_(gp, 'f1', 'ROOT', 25), false);
});

test('ancestor：超過 maxHops 未達 root → false（防過深遍歷）', () => {
  const S = loadFromCodeGs(['_ancestorContains_']);
  const gp = mkGetParents({ 'a': ['b'], 'b': ['c'], 'c': ['ROOT'] });
  assert.equal(S._ancestorContains_(gp, 'a', 'ROOT', 2), false);  // a→b→c 需 3 跳，限 2 跳搆不到
  assert.equal(S._ancestorContains_(gp, 'a', 'ROOT', 25), true);
});

test('ancestor：空 fileId/rootId → false', () => {
  const S = loadFromCodeGs(['_ancestorContains_']);
  assert.equal(S._ancestorContains_(mkGetParents({}), '', 'ROOT', 25), false);
  assert.equal(S._ancestorContains_(mkGetParents({}), 'f1', '', 25), false);
});
