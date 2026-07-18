// test/freshman-test-merged.test.js — 新生心理測驗（v209 Slice 3）整合 tab（唯讀衍生視圖）
// 純函式：PR 字串解析／燈號／高關懷判定（>95）／Google表單同意判定（含不同意優先於同意）／
// O~R debug 旗標／效度skip 規則／彙總統計／未對應清單。抽出對象皆為 dev/index.html 內無 DOM
// 依賴的純函式（見 test/harness.js）。fixture 一律用假學號/假姓名，不得出現真實個案資料（CLAUDE.md）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_(names) {
  return load(names);
}

const MERGED_ROW_FNS = [
  'FT_MERGED_PR_IDS', '_ftParsePrValue', '_ftPrDotDisplay', '_ftIsHighConcern', '_ftGformConsentFromText',
  '_ftMergedSchemaCols', '_ftComputeMergedCells', '_ftComputeMergedRows', '_ftMergedSummaryStats',
];

// harness.load 目前只抽「函式宣告」；FT_MERGED_PR_IDS 是 const 陣列常數，需另外用 extractFunction
// 之外的方式帶入。這裡直接用 loadWithConst 包一層：把常數宣告也當作一段程式碼一併塞進 sandbox。
const { extractFunction, matchBrace } = require('./harness');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMerged() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dev', 'index.html'), 'utf8');
  const constMatch = /const FT_MERGED_PR_IDS = \[[\s\S]*?\];/.exec(src);
  if (!constMatch) throw new Error('找不到 FT_MERGED_PR_IDS 常數宣告');
  const fnNames = ['_ftParsePrValue', '_ftPrDotDisplay', '_ftIsHighConcern', '_ftGformConsentFromText',
    '_ftMergedSchemaCols', '_ftComputeMergedCells', '_ftComputeMergedRows', '_ftMergedSummaryStats'];
  const code = constMatch[0] + '\n\n' + fnNames.map((n) => extractFunction(src, n)).join('\n\n');
  const sandbox = Object.assign({ Date, Math, Number, String, Boolean, parseInt, parseFloat, isNaN, RegExp, Array, Object, JSON, Set, Map, console }, {});
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

// ══════════════ PR 字串解析 ══════════════

test('_ftParsePrValue：純數字直取', () => {
  const S = loadMerged();
  assert.deepEqual(S._ftParsePrValue('88'), { value: 88, error: false });
  assert.deepEqual(S._ftParsePrValue('88.5'), { value: 88.5, error: false });
});

test('_ftParsePrValue：<=20 / >=95 / <80 / >95 取其數值', () => {
  const S = loadMerged();
  assert.equal(S._ftParsePrValue('<=20').value, 20);
  assert.equal(S._ftParsePrValue('>=95').value, 95);
  assert.equal(S._ftParsePrValue('<80').value, 80);
  assert.equal(S._ftParsePrValue('>95').value, 95);
});

test('_ftParsePrValue：20~30 型距取平均', () => {
  const S = loadMerged();
  assert.equal(S._ftParsePrValue('20~30').value, 25);
  assert.equal(S._ftParsePrValue('20-30').value, 25);
});

test('_ftParsePrValue：空白 → value:null, error:false（視同未填，非錯誤）', () => {
  const S = loadMerged();
  assert.deepEqual(S._ftParsePrValue(''), { value: null, error: false });
  assert.deepEqual(S._ftParsePrValue(null), { value: null, error: false });
});

test('_ftParsePrValue：無法辨識格式 → error:true', () => {
  const S = loadMerged();
  assert.equal(S._ftParsePrValue('未知格式abc').error, true);
  assert.equal(S._ftParsePrValue('未知格式abc').value, null);
});

// ══════════════ 燈號 ══════════════

test('_ftPrDotDisplay：●紅≥95、◎橙≥90、○黃≥80、☆綠<80', () => {
  const S = loadMerged();
  assert.equal(S._ftPrDotDisplay({ value: 95, error: false }), '●');
  assert.equal(S._ftPrDotDisplay({ value: 99, error: false }), '●');
  assert.equal(S._ftPrDotDisplay({ value: 90, error: false }), '◎');
  assert.equal(S._ftPrDotDisplay({ value: 94, error: false }), '◎');
  assert.equal(S._ftPrDotDisplay({ value: 80, error: false }), '○');
  assert.equal(S._ftPrDotDisplay({ value: 89, error: false }), '○');
  assert.equal(S._ftPrDotDisplay({ value: 79, error: false }), '☆');
  assert.equal(S._ftPrDotDisplay({ value: 0, error: false }), '☆');
});

test('_ftPrDotDisplay：空值不顯示燈號；解析失敗顯示「數值錯誤」', () => {
  const S = loadMerged();
  assert.equal(S._ftPrDotDisplay({ value: null, error: false }), '');
  assert.equal(S._ftPrDotDisplay({ value: null, error: true }), '數值錯誤');
});

// ══════════════ 高關懷判定（>95，不是 ef VBA 的 >90 bug）══════════════

test('_ftIsHighConcern：高自殺=v → true（不論 ALPR）', () => {
  const S = loadMerged();
  assert.equal(S._ftIsHighConcern('v', 10), true);
  assert.equal(S._ftIsHighConcern('是', null), true);
});

test('_ftIsHighConcern：ALPR>95 → true；ALPR=95（邊界）→ false（使用者裁決：>95 不是 >=95）', () => {
  const S = loadMerged();
  assert.equal(S._ftIsHighConcern('', 96), true);
  assert.equal(S._ftIsHighConcern('', 95), false);
  assert.equal(S._ftIsHighConcern('', 90), false); // 確認不是 ef VBA 的 >90 bug
});

test('_ftIsHighConcern：都沒有 → false', () => {
  const S = loadMerged();
  assert.equal(S._ftIsHighConcern('', null), false);
  assert.equal(S._ftIsHighConcern('x', 50), false);
});

// ══════════════ Google表單同意判定 ══════════════

test('_ftGformConsentFromText：含「不同意」→ x（優先於「同意」子字串誤判）', () => {
  const S = loadMerged();
  assert.equal(S._ftGformConsentFromText('不同意'), 'x');
  assert.equal(S._ftGformConsentFromText('我不同意讓導師知情'), 'x');
});

test('_ftGformConsentFromText：含「同意」→ v', () => {
  const S = loadMerged();
  assert.equal(S._ftGformConsentFromText('同意'), 'v');
  assert.equal(S._ftGformConsentFromText('我同意'), 'v');
});

test('_ftGformConsentFromText：Yes/No 英文判定', () => {
  const S = loadMerged();
  assert.equal(S._ftGformConsentFromText('No'), 'x');
  assert.equal(S._ftGformConsentFromText('Yes'), 'v');
});

test('_ftGformConsentFromText：空白或無法辨識 → 未填寫', () => {
  const S = loadMerged();
  assert.equal(S._ftGformConsentFromText(''), '未填寫');
  assert.equal(S._ftGformConsentFromText(null), '未填寫');
  assert.equal(S._ftGformConsentFromText('其他文字'), '未填寫');
});

// ══════════════ 整合 schema：60 欄 ══════════════

test('_ftMergedSchemaCols：共 60 欄，C 為測驗日期', () => {
  const S = loadMerged();
  const cols = S._ftMergedSchemaCols();
  assert.equal(cols.length, 60);
  assert.equal(cols[2].id, 'test_date'); // C（0-based index 2）
  assert.equal(cols[2].name, '測驗日期');
  assert.equal(cols[10].id, 'gender'); // K（性別，位置不變，但值由測驗資料優先）
});

// ══════════════ 單列計算：O~R 旗標／S 同意／效度skip規則／高關懷 ══════════════

function baseExistence(overrides) {
  return Object.assign({
    stuId: 'B1', nameZh: '甲',
    testIdSet: new Set(), testNameSet: new Set(), gformIdSet: new Set(), gformNameSet: new Set(),
  }, overrides || {});
}

test('_ftComputeMergedCells：C 欄取測驗資料.施測日期，K 欄性別以測驗資料優先', () => {
  const S = loadMerged();
  const sRow = { cells: { stu_id: 'B1', name_zh: '甲', gender: '女' } };
  const tRow = { cells: { stu_id: 'B1', name_zh: '甲', test_date: '2026-03-01', gender: '男', validity: '80', alpr: '50' } };
  const cells = S._ftComputeMergedCells(sRow, tRow, null, baseExistence());
  assert.equal(cells.test_date, '2026-03-01');
  assert.equal(cells.gender, '男'); // 測驗資料優先
});

test('_ftComputeMergedCells：測驗資料無性別 → 用基本資料', () => {
  const S = loadMerged();
  const sRow = { cells: { stu_id: 'B1', name_zh: '甲', gender: '女' } };
  const tRow = { cells: { stu_id: 'B1', name_zh: '甲', validity: '80', alpr: '50' } };
  const cells = S._ftComputeMergedCells(sRow, tRow, null, baseExistence());
  assert.equal(cells.gender, '女');
});

test('_ftComputeMergedCells：O~R 旗標依存在性集合判定', () => {
  const S = loadMerged();
  const sRow = { cells: { stu_id: 'B1', name_zh: '甲' } };
  const existence = baseExistence({
    testIdSet: new Set(['B1']), testNameSet: new Set(), gformIdSet: new Set(), gformNameSet: new Set(['甲']),
  });
  const cells = S._ftComputeMergedCells(sRow, null, null, existence);
  assert.equal(cells.flag_test_id, '是');
  assert.equal(cells.flag_test_name, '');
  assert.equal(cells.flag_gform_id, '');
  assert.equal(cells.flag_gform_name, '是');
});

test('_ftComputeMergedCells：S 欄——查無 Google表單主條目 → 未填寫', () => {
  const S = loadMerged();
  const sRow = { cells: { stu_id: 'B1', name_zh: '甲' } };
  const cells = S._ftComputeMergedCells(sRow, null, null, baseExistence());
  assert.equal(cells.consent, '未填寫');
});

test('_ftComputeMergedCells：S 欄——有主條目則依同意題文字判定', () => {
  const S = loadMerged();
  const sRow = { cells: { stu_id: 'B1', name_zh: '甲' } };
  const gRow = { cells: { consent_mentor: '不同意' } };
  const cells = S._ftComputeMergedCells(sRow, null, gRow, baseExistence());
  assert.equal(cells.consent, 'x');
});

test('_ftComputeMergedCells：效度為 0 或空 → 測驗相關欄整組留空（高自殺/可信度/19PR/19燈號/高關懷）', () => {
  const S = loadMerged();
  const sRow = { cells: { stu_id: 'B1', name_zh: '甲' } };
  const tRowZeroValidity = { cells: { stu_id: 'B1', name_zh: '甲', validity: '0', alpr: '99', high_suicide: 'v' } };
  const cells = S._ftComputeMergedCells(sRow, tRowZeroValidity, null, baseExistence());
  assert.equal(cells.validity, '');
  assert.equal(cells.high_suicide, '');
  assert.equal(cells.alpr, '');
  assert.equal(cells.alpr_dot, '');
  assert.equal(cells.high_concern, '');
});

test('_ftComputeMergedCells：ALPR 為 0 或空 → 同樣視同未受測整組留空', () => {
  const S = loadMerged();
  const sRow = { cells: { stu_id: 'B1', name_zh: '甲' } };
  const tRow = { cells: { stu_id: 'B1', name_zh: '甲', validity: '80', alpr: '' } };
  const cells = S._ftComputeMergedCells(sRow, tRow, null, baseExistence());
  assert.equal(cells.validity, '');
  assert.equal(cells.high_concern, '');
});

test('_ftComputeMergedCells：查無測驗資料（testRow=null）→ 測驗相關欄留空，不報錯', () => {
  const S = loadMerged();
  const sRow = { cells: { stu_id: 'B1', name_zh: '甲' } };
  const cells = S._ftComputeMergedCells(sRow, null, null, baseExistence());
  assert.equal(cells.validity, '');
  assert.equal(cells.high_concern, '');
});

test('_ftComputeMergedCells：有效測驗資料 → 19 PR 與 19 燈號正確算出，高關懷=ALPR>95', () => {
  const S = loadMerged();
  const sRow = { cells: { stu_id: 'B1', name_zh: '甲' } };
  const tRow = { cells: { stu_id: 'B1', name_zh: '甲', validity: '80', alpr: '96', d1pr: '85', high_suicide: '' } };
  const cells = S._ftComputeMergedCells(sRow, tRow, null, baseExistence());
  assert.equal(cells.alpr, '96');
  assert.equal(cells.alpr_dot, '●');
  assert.equal(cells.d1pr_dot, '○');
  assert.equal(cells.high_concern, 'v'); // ALPR 96 > 95
});

// ══════════════ 整批計算：主鍵比對、未對應清單、彙總統計 ══════════════

test('_ftComputeMergedRows：依學號比對 students/tests/gforms，各生一列', () => {
  const S = loadMerged();
  const studentsRows = [
    { cells: { stu_id: 'B1', name_zh: '甲' } },
    { cells: { stu_id: 'B2', name_zh: '乙' } },
  ];
  const testsRows = [{ cells: { stu_id: 'B1', name_zh: '甲', validity: '80', alpr: '96' } }];
  const gformRows = [{ cells: { stu_id: 'B1', name_zh: '甲', consent_mentor: '同意' } }];
  const { rows, unmatched } = S._ftComputeMergedRows(studentsRows, testsRows, gformRows);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cells.high_concern, 'v');
  assert.equal(rows[0].cells.consent, 'v');
  assert.equal(rows[1].cells.high_concern, ''); // 乙查無測驗資料
  assert.equal(unmatched.length, 0);
});

test('_ftComputeMergedRows：Google表單非主條目（excluded:true）不參與 S 欄計算', () => {
  const S = loadMerged();
  const studentsRows = [{ cells: { stu_id: 'B1', name_zh: '甲' } }];
  const gformRows = [
    { cells: { stu_id: 'B1', name_zh: '甲', consent_mentor: '同意' }, excluded: true },
    { cells: { stu_id: 'B1', name_zh: '甲', consent_mentor: '不同意' }, excluded: false },
  ];
  const { rows } = S._ftComputeMergedRows(studentsRows, [], gformRows);
  assert.equal(rows[0].cells.consent, 'x'); // 主條目（非 excluded）是「不同意」那筆
});

test('_ftComputeMergedRows：未對應清單——測驗資料/Google表單中學號查無學生名單 → 列入 unmatched', () => {
  const S = loadMerged();
  const studentsRows = [{ cells: { stu_id: 'B1', name_zh: '甲' } }];
  const testsRows = [{ cells: { stu_id: 'B99999999', name_zh: '查無此人', validity: '80', alpr: '50' } }];
  const gformRows = [{ cells: { stu_id: 'B88888888', name_zh: '也查無', consent_mentor: '同意' } }];
  const { unmatched } = S._ftComputeMergedRows(studentsRows, testsRows, gformRows);
  assert.equal(unmatched.length, 2);
  assert.ok(unmatched.some(u => u.stuId === 'B99999999' && u.source === '測驗資料'));
  assert.ok(unmatched.some(u => u.stuId === 'B88888888' && u.source === 'Google表單'));
});

test('_ftMergedSummaryStats：總人數/有測驗紀錄數/高關懷數/未受測數', () => {
  const S = loadMerged();
  const studentsRows = [
    { cells: { stu_id: 'B1', name_zh: '甲' } },
    { cells: { stu_id: 'B2', name_zh: '乙' } },
    { cells: { stu_id: 'B3', name_zh: '丙' } },
  ];
  const testsRows = [
    { cells: { stu_id: 'B1', name_zh: '甲', validity: '80', alpr: '96' } }, // 高關懷
    { cells: { stu_id: 'B2', name_zh: '乙', validity: '0', alpr: '50' } },  // 有紀錄但無效（非未受測）
  ];
  const { rows } = S._ftComputeMergedRows(studentsRows, testsRows, []);
  const stats = S._ftMergedSummaryStats(rows);
  assert.equal(stats.total, 3);
  assert.equal(stats.withTest, 2); // B1, B2 皆有測驗紀錄（B2 效度雖 0 但仍「有紀錄」）
  assert.equal(stats.untested, 1); // 只有 B3 未受測
  assert.equal(stats.highConcern, 1);
});
