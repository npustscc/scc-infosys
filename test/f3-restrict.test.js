// F3 剩餘三項資安加固（P1）純決策單元測試：
//   1) downloadFileBase64 跨 root 附件白名單（issuesHasAttachment_ / _attachListHasFileId_）
//   2) query action 限根（_extractParentsIds_ / queryParentsAllowed_）
//   3) moveFile 目的地檢查（moveFileDestAllowed_）
// 執行：node --test test/*.test.js
// 測試對象從 dev/Code.gs 就地抽出（harness.extractFunction），改壞正式碼即紅燈。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./harness');

function loadFromCodeGs(names) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dev', 'Code.gs'), 'utf8');
  const sandbox = { JSON, Array, Object, String };
  vm.createContext(sandbox);
  vm.runInContext(names.map((n) => extractFunction(src, n)).join('\n\n'), sandbox);
  return sandbox;
}

const ROOT = '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx';
const CASES_ID = '1CasesFolderIdxxxxxxxxxxxxxxxxxxxxx';
const EVIL_ID  = '0AFakeAttackerFolderId_xxxxxxxxxxx';

// ── _attachListHasFileId_ ──────────────────────────────────────────────────

test('attachList：清單中含此 fileId → true', () => {
  const S = loadFromCodeGs(['_attachListHasFileId_']);
  assert.equal(S._attachListHasFileId_([{ fileId: 'f1' }, { fileId: 'f2' }], 'f2'), true);
});

test('attachList：清單中無此 fileId → false', () => {
  const S = loadFromCodeGs(['_attachListHasFileId_']);
  assert.equal(S._attachListHasFileId_([{ fileId: 'f1' }], 'f2'), false);
});

test('attachList：非陣列／空 fileId → false（不炸）', () => {
  const S = loadFromCodeGs(['_attachListHasFileId_']);
  assert.equal(S._attachListHasFileId_(null, 'f1'), false);
  assert.equal(S._attachListHasFileId_(undefined, 'f1'), false);
  assert.equal(S._attachListHasFileId_([{ fileId: 'f1' }], ''), false);
});

// ── issuesHasAttachment_：issue 本身與留言(comments)的附件皆須查得到 ──────────

test('issuesHasAttachment：issue 本身附件命中 → true', () => {
  const S = loadFromCodeGs(['issuesHasAttachment_', '_attachListHasFileId_']);
  const issuesJson = { issues: [{ id: 'i1', attachments: [{ fileId: 'atk1' }] }] };
  assert.equal(S.issuesHasAttachment_(issuesJson, 'atk1'), true);
});

test('issuesHasAttachment：留言(comment)附件命中 → true', () => {
  const S = loadFromCodeGs(['issuesHasAttachment_', '_attachListHasFileId_']);
  const issuesJson = {
    issues: [{ id: 'i1', attachments: [], comments: [
      { id: 'c1', attachments: [{ fileId: 'x' }] },
      { id: 'c2', attachments: [{ fileId: 'atk2' }] },
    ] }],
  };
  assert.equal(S.issuesHasAttachment_(issuesJson, 'atk2'), true);
});

test('issuesHasAttachment：不存在的 fileId（攻擊者亂帶）→ false', () => {
  const S = loadFromCodeGs(['issuesHasAttachment_', '_attachListHasFileId_']);
  const issuesJson = { issues: [{ id: 'i1', attachments: [{ fileId: 'atk1' }] }] };
  assert.equal(S.issuesHasAttachment_(issuesJson, 'not-an-attachment'), false);
});

test('issuesHasAttachment：issuesJson 為 null（讀不到）→ false（fail-closed）', () => {
  const S = loadFromCodeGs(['issuesHasAttachment_', '_attachListHasFileId_']);
  assert.equal(S.issuesHasAttachment_(null, 'atk1'), false);
});

test('issuesHasAttachment：issues 非陣列／缺欄位 → false（不炸）', () => {
  const S = loadFromCodeGs(['issuesHasAttachment_', '_attachListHasFileId_']);
  assert.equal(S.issuesHasAttachment_({}, 'atk1'), false);
  assert.equal(S.issuesHasAttachment_({ issues: [null, {}] }, 'atk1'), false);
});

// ── _extractParentsIds_：從 q 字串抽出所有 "'ID' in parents" 引用的 ID ────────

test('extractParents：單一 parents 條件 → 抽出該 ID', () => {
  const S = loadFromCodeGs(['_extractParentsIds_']);
  const q = "name='cases' and mimeType='application/vnd.google-apps.folder' and '" + ROOT + "' in parents and trashed=false";
  assert.deepEqual(S._extractParentsIds_(q), [ROOT]);
});

test('extractParents：無 parents 條件（純 name 查詢）→ 空陣列', () => {
  const S = loadFromCodeGs(['_extractParentsIds_']);
  assert.deepEqual(S._extractParentsIds_("name='config.json' and trashed=false"), []);
});

test('extractParents：多個 parents 條件 → 全部抽出', () => {
  const S = loadFromCodeGs(['_extractParentsIds_']);
  const q = "'" + ROOT + "' in parents or '" + CASES_ID + "' in parents";
  assert.deepEqual(S._extractParentsIds_(q), [ROOT, CASES_ID]);
});

test('extractParents：空字串／非字串 → 空陣列（不炸）', () => {
  const S = loadFromCodeGs(['_extractParentsIds_']);
  assert.deepEqual(S._extractParentsIds_(''), []);
  assert.deepEqual(S._extractParentsIds_(null), []);
  assert.deepEqual(S._extractParentsIds_(undefined), []);
});

// ── queryParentsAllowed_：checkUnderRoot 注入，驗證整體放行/拒絕邏輯 ──────────

const inRootOf = (allowedIds) => (id) => allowedIds.indexOf(id) !== -1;

test('queryAllowed：唯一 parents 條件在 root 子樹下 → 放行（對照前端 name+folder 樣板）', () => {
  const S = loadFromCodeGs(['queryParentsAllowed_', '_extractParentsIds_', '_qHasForbiddenOp_']);
  const q = "name='114' and mimeType='application/vnd.google-apps.folder' and '" + CASES_ID + "' in parents and trashed=false";
  assert.equal(S.queryParentsAllowed_(q, inRootOf([CASES_ID])), true);
});

test('queryAllowed：parents 為 root 本身 → 放行（對照前端 attachments/debug_log 樣板）', () => {
  const S = loadFromCodeGs(['queryParentsAllowed_', '_extractParentsIds_', '_qHasForbiddenOp_']);
  const q = "'" + ROOT + "' in parents and name='attachments' and mimeType='application/vnd.google-apps.folder' and trashed=false";
  assert.equal(S.queryParentsAllowed_(q, inRootOf([ROOT])), true);
});

test('queryAllowed：parents 指向 root 子樹外的資料夾（枚舉攻擊）→ 拒絕', () => {
  const S = loadFromCodeGs(['queryParentsAllowed_', '_extractParentsIds_', '_qHasForbiddenOp_']);
  const q = "name='config.json' and '" + EVIL_ID + "' in parents and trashed=false";
  assert.equal(S.queryParentsAllowed_(q, inRootOf([ROOT, CASES_ID])), false);
});

test('queryAllowed：完全不含 parents 條件 → 拒絕（防任意 name 全域搜尋）', () => {
  const S = loadFromCodeGs(['queryParentsAllowed_', '_extractParentsIds_', '_qHasForbiddenOp_']);
  assert.equal(S.queryParentsAllowed_("name='config.json' and trashed=false", inRootOf([ROOT])), false);
});

test('queryAllowed：多個 parents 條件其中一個在子樹外 → 整體拒絕', () => {
  const S = loadFromCodeGs(['queryParentsAllowed_', '_extractParentsIds_', '_qHasForbiddenOp_']);
  const q = "'" + ROOT + "' in parents or '" + EVIL_ID + "' in parents";
  assert.equal(S.queryParentsAllowed_(q, inRootOf([ROOT])), false);
});

// ── _qHasForbiddenOp_／or 稀釋攻擊：parents 條件不得被 or/not 架空 ────────────

test('forbiddenOp：純 and 串接的前端樣板 → false（放行）', () => {
  const S = loadFromCodeGs(['_qHasForbiddenOp_']);
  const q = "name='cases' and mimeType='application/vnd.google-apps.folder' and '" + ROOT + "' in parents and trashed=false";
  assert.equal(S._qHasForbiddenOp_(q), false);
});

test('forbiddenOp：含 or／not 運算子 → true（拒絕）', () => {
  const S = loadFromCodeGs(['_qHasForbiddenOp_']);
  assert.equal(S._qHasForbiddenOp_("'" + ROOT + "' in parents or trashed=false"), true);
  assert.equal(S._qHasForbiddenOp_("not '" + ROOT + "' in parents"), true);
  assert.equal(S._qHasForbiddenOp_("'" + ROOT + "' in parents OR trashed=false"), true);
});

test('forbiddenOp：引號內的 or/not 字樣（檔名）不誤殺；含跳脫引號亦然', () => {
  const S = loadFromCodeGs(['_qHasForbiddenOp_']);
  assert.equal(S._qHasForbiddenOp_("name='report or not.json' and '" + ROOT + "' in parents"), false);
  assert.equal(S._qHasForbiddenOp_("name='o\\'reilly or note' and '" + ROOT + "' in parents"), false);
});

test('forbiddenOp：or 為其他字的一部分（record/north/for）不誤殺', () => {
  const S = loadFromCodeGs(['_qHasForbiddenOp_']);
  assert.equal(S._qHasForbiddenOp_("name contains 'x' and '" + ROOT + "' in parents and record=north for"), false);
});

test('queryAllowed：合法 parents 後掛 or 稀釋條件（繞過攻擊）→ 拒絕', () => {
  const S = loadFromCodeGs(['queryParentsAllowed_', '_extractParentsIds_', '_qHasForbiddenOp_']);
  const q = "'" + CASES_ID + "' in parents or trashed=false";
  assert.equal(S.queryParentsAllowed_(q, inRootOf([CASES_ID])), false);
});

test('queryAllowed：not 反轉 parents 範圍 → 拒絕', () => {
  const S = loadFromCodeGs(['queryParentsAllowed_', '_extractParentsIds_', '_qHasForbiddenOp_']);
  const q = "not '" + CASES_ID + "' in parents and '" + CASES_ID + "' in parents";
  assert.equal(S.queryParentsAllowed_(q, inRootOf([CASES_ID])), false);
});

// ── moveFileDestAllowed_：moveFile 目的地（addParents）須在 root 子樹 ─────────

test('moveDest：單一目的地在 root 子樹下 → 放行', () => {
  const S = loadFromCodeGs(['moveFileDestAllowed_']);
  assert.equal(S.moveFileDestAllowed_(CASES_ID, inRootOf([CASES_ID])), true);
});

test('moveDest：目的地在 root 子樹外（越界搬移）→ 拒絕', () => {
  const S = loadFromCodeGs(['moveFileDestAllowed_']);
  assert.equal(S.moveFileDestAllowed_(EVIL_ID, inRootOf([ROOT, CASES_ID])), false);
});

test('moveDest：逗號分隔多個目的地，全部通過 → 放行；任一不過 → 拒絕', () => {
  const S = loadFromCodeGs(['moveFileDestAllowed_']);
  assert.equal(S.moveFileDestAllowed_(ROOT + ',' + CASES_ID, inRootOf([ROOT, CASES_ID])), true);
  assert.equal(S.moveFileDestAllowed_(ROOT + ',' + EVIL_ID, inRootOf([ROOT, CASES_ID])), false);
});

test('moveDest：空值／未帶 addParents → 拒絕', () => {
  const S = loadFromCodeGs(['moveFileDestAllowed_']);
  assert.equal(S.moveFileDestAllowed_('', inRootOf([ROOT])), false);
  assert.equal(S.moveFileDestAllowed_(undefined, inRootOf([ROOT])), false);
});
