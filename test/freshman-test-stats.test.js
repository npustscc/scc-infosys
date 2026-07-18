// test/freshman-test-stats.test.js — 新生心理測驗（v210 Slice 4）統計 tab 純函式：
// 指標單一來源（_ftGroupMetrics／_ftInvalidCategory）、①高關懷清冊、②無效名單、③院系統計
// （學院/系所/班級三層分組＋小計）、④學制統計（分類/導師 join/前20排名/前5議題）、
// ⑤高關懷班級前N。全部吃 _ftComputeMergedRows() 產出的 rows 形狀（{cells, _hasTest}[]），
// fixture 一律用假學號/假姓名/假班級，不得出現真實個案資料（CLAUDE.md）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { extractFunction } = require('./harness');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadStats() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dev', 'index.html'), 'utf8');
  const prIdsMatch = /const FT_MERGED_PR_IDS = \[[\s\S]*?\];/.exec(src);
  const issueIdsMatch = /const FT_ISSUE_S_IDS = \[[\s\S]*?\];/.exec(src);
  const issueLabelsMatch = /const FT_ISSUE_LABELS = \{[\s\S]*?\};/.exec(src);
  if (!prIdsMatch) throw new Error('找不到 FT_MERGED_PR_IDS 常數宣告');
  if (!issueIdsMatch) throw new Error('找不到 FT_ISSUE_S_IDS 常數宣告');
  if (!issueLabelsMatch) throw new Error('找不到 FT_ISSUE_LABELS 常數宣告');
  const fnNames = [
    '_ftParsePrValue', '_ftGroupMetrics', '_ftInvalidCategory', '_ftValidityAnalysisText',
    '_ftComprehensiveAnalysisText', '_ftConsentDisplay', '_ftHighConcernListRow', '_ftHighConcernListRows',
    '_ftInvalidListRow', '_ftInvalidListRows', '_ftGroupKey', '_ftBuildCollegeDeptClassStats',
    '_ftFlattenCollegeDeptStats', '_ftClassifyEduLevel', '_ftFindTutorForClass', '_ftTop5IssuesForRows',
    '_ftBuildEduLevelClassStats', '_ftRankFreshmanClasses', '_ftTopNFreshmanSummary', '_ftTopNFreshmanClassesReport',
  ];
  const code = [prIdsMatch[0], issueIdsMatch[0], issueLabelsMatch[0]].join('\n') + '\n\n'
    + fnNames.map((n) => extractFunction(src, n)).join('\n\n');
  const sandbox = Object.assign({ Date, Math, Number, String, Boolean, parseInt, parseFloat, isNaN, RegExp, Array, Object, JSON, Set, Map, console }, {});
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

// ══════════════ 指標單一來源：_ftGroupMetrics／_ftInvalidCategory ══════════════

test('_ftGroupMetrics：total/tested/untested/testRate/highConcern/highConcernConsentOnly/highConcernRate/invalid', () => {
  const S = loadStats();
  const rows = [
    { _hasTest: true, cells: { validity: '80', high_concern: 'v', consent: 'v' } },
    { _hasTest: true, cells: { validity: '80', high_concern: 'v', consent: 'x' } },
    { _hasTest: true, cells: { validity: '50', high_concern: '', consent: '未填寫' } },
    { _hasTest: false, cells: { validity: '', high_concern: '', consent: '未填寫' } },
  ];
  const m = S._ftGroupMetrics(rows);
  assert.equal(m.total, 4);
  assert.equal(m.tested, 3);
  assert.equal(m.untested, 1);
  assert.equal(m.testRate, 3 / 4);
  assert.equal(m.highConcern, 2);
  assert.equal(m.highConcernConsentOnly, 1); // 只算 consent='v' 的高關懷（扣除不同意）
  assert.equal(m.highConcernRate, 2 / 3);
  assert.equal(m.invalid, 2); // 未測 1 + 已測但可信度低 1
});

test('_ftGroupMetrics：空陣列 → 全 0，比率為 0（非 NaN，避免顯示層出現 NaN%）', () => {
  const S = loadStats();
  const m = S._ftGroupMetrics([]);
  assert.deepEqual(m, {
    total: 0, tested: 0, untested: 0, testRate: 0,
    highConcern: 0, highConcernConsentOnly: 0, highConcernRate: 0, invalid: 0,
  });
});

test('_ftInvalidCategory：未受測（_hasTest=false）→ 未接受測驗（不論 validity 內容）', () => {
  const S = loadStats();
  assert.equal(S._ftInvalidCategory({ _hasTest: false, cells: { validity: '90' } }), '未接受測驗');
  assert.equal(S._ftInvalidCategory({ _hasTest: false, cells: {} }), '未接受測驗');
});

test('_ftInvalidCategory：已測但 validity 空白或 <61 → 測驗結果可信度低', () => {
  const S = loadStats();
  assert.equal(S._ftInvalidCategory({ _hasTest: true, cells: { validity: '' } }), '測驗結果可信度低');
  assert.equal(S._ftInvalidCategory({ _hasTest: true, cells: { validity: '60' } }), '測驗結果可信度低');
});

test('_ftInvalidCategory：已測且 validity>=61 → null（非無效）', () => {
  const S = loadStats();
  assert.equal(S._ftInvalidCategory({ _hasTest: true, cells: { validity: '61' } }), null);
  assert.equal(S._ftInvalidCategory({ _hasTest: true, cells: { validity: '95' } }), null);
});

// ══════════════ 文案：可信度分析／綜合分析／同意顯示 ══════════════

test('_ftValidityAnalysisText：三段文案門檻 <61／61~80／>=81', () => {
  const S = loadStats();
  assert.equal(S._ftValidityAnalysisText('60'), '您似乎填答的有點倉促，結果報告可能有一點點不準。');
  assert.equal(S._ftValidityAnalysisText('61'), '您填答過程可能不太專心，結果報告可信度不高。');
  assert.equal(S._ftValidityAnalysisText('80'), '您填答過程可能不太專心，結果報告可信度不高。');
  assert.equal(S._ftValidityAnalysisText('81'), '您很認真填答，測驗報告是準確的。');
});

test('_ftValidityAnalysisText：空白 → 空字串', () => {
  const S = loadStats();
  assert.equal(S._ftValidityAnalysisText(''), '');
  assert.equal(S._ftValidityAnalysisText(null), '');
});

test('_ftComprehensiveAnalysisText：高自殺=v 或 AL燈=紅● → 第一段（不讀 consent，避免 ef 的 P 欄覆寫 bug）', () => {
  const S = loadStats();
  assert.ok(S._ftComprehensiveAnalysisText({ high_suicide: 'v', alpr_dot: '' }).includes('非常建議您找尋專業人員求助'));
  assert.ok(S._ftComprehensiveAnalysisText({ high_suicide: '', alpr_dot: '●' }).includes('非常建議您找尋專業人員求助'));
});

test('_ftComprehensiveAnalysisText：AL燈=橙◎ → 第二段', () => {
  const S = loadStats();
  assert.ok(S._ftComprehensiveAnalysisText({ high_suicide: '', alpr_dot: '◎' }).includes('持續觀察'));
});

test('_ftComprehensiveAnalysisText：黃○/綠☆（或其他）→ 第三段', () => {
  const S = loadStats();
  assert.equal(S._ftComprehensiveAnalysisText({ high_suicide: '', alpr_dot: '○' }), '您最近似乎把自己照顧的不錯喔，繼續維持。');
  assert.equal(S._ftComprehensiveAnalysisText({ high_suicide: '', alpr_dot: '☆' }), '您最近似乎把自己照顧的不錯喔，繼續維持。');
});

test('_ftConsentDisplay：v/x/其他', () => {
  const S = loadStats();
  assert.equal(S._ftConsentDisplay('v'), '同意');
  assert.equal(S._ftConsentDisplay('x'), '不同意');
  assert.equal(S._ftConsentDisplay('未填寫'), '未填寫');
  assert.equal(S._ftConsentDisplay(''), '未填寫');
});

// ══════════════ ①高關懷清冊 ══════════════

test('_ftHighConcernListRow：展開 19 個燈號欄＋可信度/綜合分析文案', () => {
  const S = loadStats();
  const row = {
    _hasTest: true,
    cells: {
      stu_id: 'B1', name_zh: '甲', college: '理學院', dept_name: '資訊管理系', class_abbr: '四資管一A', gender: '女',
      validity: '85', high_suicide: '', high_concern: 'v', consent: 'v', alpr: '96', alpr_dot: '●',
    },
  };
  const r = S._ftHighConcernListRow(row);
  assert.equal(r.stuId, 'B1');
  assert.equal(r.consentDisplay, '同意');
  assert.equal(r.dots.length, 19);
  assert.equal(r.dots[0].id, 'alpr');
  assert.equal(r.dots[0].dot, '●');
  assert.equal(r.validityAnalysis, '您很認真填答，測驗報告是準確的。');
});

test('_ftHighConcernListRows：三檢視（全部／同意S=v／不同意S=x或未填寫）', () => {
  const S = loadStats();
  const rows = [
    { _hasTest: true, cells: { stu_id: 'B1', high_concern: 'v', consent: 'v' } },
    { _hasTest: true, cells: { stu_id: 'B2', high_concern: 'v', consent: 'x' } },
    { _hasTest: true, cells: { stu_id: 'B3', high_concern: 'v', consent: '未填寫' } },
    { _hasTest: true, cells: { stu_id: 'B4', high_concern: '', consent: 'v' } }, // 非高關懷，任何檢視都不出現
  ];
  assert.equal(S._ftHighConcernListRows(rows, 'all').length, 3);
  assert.deepEqual(S._ftHighConcernListRows(rows, 'consent').map((r) => r.stuId), ['B1']);
  assert.deepEqual(S._ftHighConcernListRows(rows, 'noconsent').map((r) => r.stuId), ['B2', 'B3']);
});

// ══════════════ ②無效名單 ══════════════

test('_ftInvalidListRows：兩類無效名單合併列出（比照 ef）', () => {
  const S = loadStats();
  const rows = [
    { _hasTest: false, cells: { stu_id: 'B1', validity: '' } },
    { _hasTest: true, cells: { stu_id: 'B2', validity: '50' } },
    { _hasTest: true, cells: { stu_id: 'B3', validity: '90' } }, // 有效，不列入
  ];
  const list = S._ftInvalidListRows(rows);
  assert.equal(list.length, 2);
  assert.equal(list.find((r) => r.stuId === 'B1').category, '未接受測驗');
  assert.equal(list.find((r) => r.stuId === 'B2').category, '測驗結果可信度低');
});

// ══════════════ ③院系統計：三層分組與小計 ══════════════

test('_ftBuildCollegeDeptClassStats／_ftFlattenCollegeDeptStats：學院→系所→班級三層分組與小計', () => {
  const S = loadStats();
  const rows = [
    { _hasTest: true, cells: { college: 'A學院', dept_name: '甲系', class_abbr: '一A班', high_concern: 'v', consent: 'v', validity: '90' } },
    { _hasTest: true, cells: { college: 'A學院', dept_name: '甲系', class_abbr: '一A班', high_concern: '', consent: '未填寫', validity: '90' } },
    { _hasTest: false, cells: { college: 'A學院', dept_name: '甲系', class_abbr: '一B班', validity: '' } },
    { _hasTest: true, cells: { college: 'B學院', dept_name: '乙系', class_abbr: '一C班', high_concern: '', consent: '未填寫', validity: '70' } },
  ];
  const tree = S._ftBuildCollegeDeptClassStats(rows);
  assert.equal(tree.length, 2);
  const collegeA = tree.find((c) => c.college === 'A學院');
  assert.equal(collegeA.metrics.total, 3);
  assert.equal(collegeA.depts.length, 1);
  assert.equal(collegeA.depts[0].classes.length, 2);

  const flat = S._ftFlattenCollegeDeptStats(tree);
  assert.equal(flat.filter((f) => f.kind === 'class').length, 3);
  assert.equal(flat.filter((f) => f.kind === 'deptSubtotal').length, 2);
  assert.equal(flat.filter((f) => f.kind === 'collegeSubtotal').length, 2);
  const deptSubtotalA = flat.find((f) => f.kind === 'deptSubtotal' && f.dept === '甲系');
  assert.equal(deptSubtotalA.metrics.total, 3);
  assert.equal(deptSubtotalA.metrics.tested, 2);
  assert.equal(deptSubtotalA.metrics.highConcern, 1);
});

test('_ftGroupKey：空值/空白歸「（未分類）」', () => {
  const S = loadStats();
  assert.equal(S._ftGroupKey(''), '（未分類）');
  assert.equal(S._ftGroupKey('   '), '（未分類）');
  assert.equal(S._ftGroupKey(null), '（未分類）');
  assert.equal(S._ftGroupKey('資管系'), '資管系');
});

// ══════════════ ④學制統計：分類／導師 join／前5議題 ══════════════

test('_ftClassifyEduLevel：碩博優先於大一新生（碩農園一同時含「一」與「碩」）', () => {
  const S = loadStats();
  assert.equal(S._ftClassifyEduLevel('碩農園一A'), '碩博士新生');
  assert.equal(S._ftClassifyEduLevel('博森林'), '碩博士新生');
});

test('_ftClassifyEduLevel：轉學生＝含二或三', () => {
  const S = loadStats();
  assert.equal(S._ftClassifyEduLevel('進四科技農業二A'), '轉學生');
  assert.equal(S._ftClassifyEduLevel('四資管三A'), '轉學生');
});

test('_ftClassifyEduLevel：大一新生＝含一且無碩博', () => {
  const S = loadStats();
  assert.equal(S._ftClassifyEduLevel('四農園一A'), '大一新生');
});

test('_ftClassifyEduLevel：其餘 → 無法分類', () => {
  const S = loadStats();
  assert.equal(S._ftClassifyEduLevel('EMBA'), '無法分類');
});

test('_ftFindTutorForClass：精確比對班級簡稱；查無回傳 null', () => {
  const S = loadStats();
  const tutors = [{ cells: { class_abbr: '四農園一A', tutor_name: '王老師' } }];
  assert.equal(S._ftFindTutorForClass('四農園一A', tutors), '王老師');
  assert.equal(S._ftFindTutorForClass('四農園一B', tutors), null);
});

test('_ftTop5IssuesForRows：紅燈●人數排序取前5，中文議題名，明確用 sXXpr_dot（不誤吃 SxxPR/Sxx_dot 兩組欄名）', () => {
  const S = loadStats();
  const rows = [
    { cells: { s01pr_dot: '●' } },
    { cells: { s01pr_dot: '●' } },
    { cells: { s02pr_dot: '●' } },
    { cells: { s12pr_dot: '●' } },
    { cells: { s12pr_dot: '●' } },
    { cells: { s12pr_dot: '●' } },
  ];
  const top = S._ftTop5IssuesForRows(rows);
  assert.equal(top[0].id, 's12pr');
  assert.equal(top[0].count, 3);
  assert.equal(top[0].label, '自殺意圖');
  assert.equal(top[1].id, 's01pr');
  assert.equal(top[1].count, 2);
});

test('_ftTop5IssuesForRows：0 人的議題不列入', () => {
  const S = loadStats();
  assert.equal(S._ftTop5IssuesForRows([{ cells: {} }]).length, 0);
});

test('_ftBuildEduLevelClassStats：依班級分組，大一新生附前5高議題，導師查無標 null', () => {
  const S = loadStats();
  const rows = [
    { _hasTest: true, cells: { class_abbr: '四農園一A', high_concern: 'v', consent: 'v', validity: '90', s01pr_dot: '●' } },
    { _hasTest: true, cells: { class_abbr: '四農園一A', high_concern: '', consent: '未填寫', validity: '90' } },
    { _hasTest: true, cells: { class_abbr: '碩農園一', high_concern: '', consent: '未填寫', validity: '80' } },
  ];
  const tutors = [{ cells: { class_abbr: '四農園一A', tutor_name: '陳老師' } }];
  const list = S._ftBuildEduLevelClassStats(rows, tutors);
  const freshmanClass = list.find((e) => e.classAbbr === '四農園一A');
  assert.equal(freshmanClass.level, '大一新生');
  assert.equal(freshmanClass.tutorFound, true);
  assert.equal(freshmanClass.tutorName, '陳老師');
  assert.equal(freshmanClass.metrics.total, 2);
  assert.ok(freshmanClass.top5Issues.some((x) => x.id === 's01pr'));
  const gradClass = list.find((e) => e.classAbbr === '碩農園一');
  assert.equal(gradClass.level, '碩博士新生');
  assert.equal(gradClass.tutorFound, false);
  assert.equal(gradClass.top5Issues, undefined);
});

// ══════════════ ④前20高排名／⑤高關懷班級前N ══════════════

test('_ftRankFreshmanClasses：同高關懷人數同名次（標準競賽排名），0人不排入，僅大一新生', () => {
  const S = loadStats();
  const list = [
    { classAbbr: 'A一班', level: '大一新生', metrics: { highConcern: 5 } },
    { classAbbr: 'B一班', level: '大一新生', metrics: { highConcern: 5 } },
    { classAbbr: 'C一班', level: '大一新生', metrics: { highConcern: 3 } },
    { classAbbr: 'D一班', level: '大一新生', metrics: { highConcern: 0 } },
    { classAbbr: 'E碩班', level: '碩博士新生', metrics: { highConcern: 9 } },
  ];
  const ranked = S._ftRankFreshmanClasses(list);
  assert.equal(ranked.length, 3); // D(0人)排除、E(非大一新生)排除
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 1); // 同分同名次
  assert.equal(ranked[2].rank, 3); // 名次跳號
});

test('_ftTopNFreshmanSummary：取前N班彙總（不足N班以現有班級數為準），含比例', () => {
  const S = loadStats();
  const list = [
    { classAbbr: 'A一班', level: '大一新生', metrics: { highConcern: 5, tested: 20 } },
    { classAbbr: 'B一班', level: '大一新生', metrics: { highConcern: 3, tested: 15 } },
    { classAbbr: 'C碩班', level: '碩博士新生', metrics: { highConcern: 9, tested: 10 } },
  ];
  const s = S._ftTopNFreshmanSummary(list, 5);
  assert.equal(s.classCount, 2); // 只有兩個大一新生班級
  assert.equal(s.highConcern, 8);
  assert.equal(s.tested, 35);
  assert.equal(s.rate, 8 / 35);
});

test('_ftTopNFreshmanClassesReport：回傳四檔 5/10/15/20', () => {
  const S = loadStats();
  const report = S._ftTopNFreshmanClassesReport([]);
  assert.deepEqual(report.map((r) => r.n), [5, 10, 15, 20]);
});
