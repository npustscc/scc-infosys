// test/freshman-test-reports.test.js — 新生心理測驗（v211 Slice 5）報告 tab 純函式：
// A) 修正後的 _ftValidityAnalysisText（v210 bug：門檻/文案對應顛倒）
// B) 個人報告資料組裝 _ftPersonalReportData（燈號文字對應／F1 標籤／欄位對應／高自殺旗標）
// C) 班級報告（導師版）_ftClassReportData（只收 high_concern=v 且 consent=v／redIssues 只收 ●／
//    tutorName join／top5Issues 排序）
// D) 系主任版 _ftDeptReportData／院長版 _ftCollegeReportData（分組與 metrics／前3 取前3）
// fixture 一律用假學號/假姓名/假班級，不得出現真實個案資料（CLAUDE.md）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { extractFunction, readHtml } = require('./harness');

function loadReports() {
  // v250 起：抽取來源改用 harness.readHtml()（utils.js＋ft-core.js＋index.html 串接），
  // 因為部分常數/函式已隨拆檔搬到 dev/ft-core.js。
  const src = readHtml();
  // 陣列常數用 \[...\]，物件常數用 \{...\}——照 test/freshman-test-stats.test.js 已驗證過的抽取寫法。
  const constPatterns = [
    ['FT_MERGED_PR_IDS', /const FT_MERGED_PR_IDS = \[[\s\S]*?\];/],
    ['FT_ISSUE_S_IDS', /const FT_ISSUE_S_IDS = \[[\s\S]*?\];/],
    ['FT_ISSUE_LABELS', /const FT_ISSUE_LABELS = \{[\s\S]*?\};/],
    ['FT_LAMP_TEXT', /const FT_LAMP_TEXT = \{[\s\S]*?\};/],
    ['FT_SCALE_LABELS', /const FT_SCALE_LABELS = \{[\s\S]*?\};/],
  ];
  const constCode = constPatterns.map(([name, re]) => {
    const m = re.exec(src);
    if (!m) throw new Error('找不到常數宣告：' + name);
    return m[0];
  });
  const fnNames = [
    '_ftParsePrValue', '_ftInvalidCategory', '_ftGroupMetrics', '_ftValidityAnalysisText',
    '_ftComprehensiveAnalysisText', '_ftGroupKey', '_ftFindTutorForClass', '_ftTop5IssuesForRows',
    '_ftLampText', '_ftPersonalReportData', '_ftClassReportData', '_ftDeptReportData', '_ftCollegeReportData',
  ];
  const code = constCode.join('\n') + '\n\n' + fnNames.map((n) => extractFunction(src, n)).join('\n\n');
  const sandbox = Object.assign({ Date, Math, Number, String, Boolean, parseInt, parseFloat, isNaN, RegExp, Array, Object, JSON, Set, Map, console }, {});
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

// ══════════════ A) _ftValidityAnalysisText（v211 修正 v210 顛倒的門檻/文案對應）══════════════

test('_ftValidityAnalysisText：>70 → 認真文案', () => {
  const S = loadReports();
  assert.equal(S._ftValidityAnalysisText('71'), '您很認真填答，測驗報告是準確的。');
  assert.equal(S._ftValidityAnalysisText('80'), '您很認真填答，測驗報告是準確的。');
  assert.equal(S._ftValidityAnalysisText('100'), '您很認真填答，測驗報告是準確的。');
});

test('_ftValidityAnalysisText：>60 且 <=70 → 倉促文案', () => {
  const S = loadReports();
  assert.equal(S._ftValidityAnalysisText('61'), '您似乎填答的有點倉促，結果報告可能有一點點不準。');
  assert.equal(S._ftValidityAnalysisText('65'), '您似乎填答的有點倉促，結果報告可能有一點點不準。');
  assert.equal(S._ftValidityAnalysisText('70'), '您似乎填答的有點倉促，結果報告可能有一點點不準。');
});

test('_ftValidityAnalysisText：<=60 → 不太專心文案（恰與無效判準 <61 一致，同一份 ef 門檻邏輯）', () => {
  const S = loadReports();
  assert.equal(S._ftValidityAnalysisText('60'), '您填答過程可能不太專心，結果報告可信度不高。');
  assert.equal(S._ftValidityAnalysisText('50'), '您填答過程可能不太專心，結果報告可信度不高。');
});

test('_ftValidityAnalysisText：空白/null/無法解析 → 空字串', () => {
  const S = loadReports();
  assert.equal(S._ftValidityAnalysisText(''), '');
  assert.equal(S._ftValidityAnalysisText(null), '');
  assert.equal(S._ftValidityAnalysisText(undefined), '');
});

// ══════════════ B) 個人報告 _ftPersonalReportData ══════════════

function baseCells(overrides) {
  return Object.assign({
    stu_id: 'B1', name_zh: '甲同學', test_date: '2026-09-15',
    college: '理學院', dept_name: '資訊管理系', class_abbr: '四資管一A', gender: '女',
    high_suicide: '', validity: '85',
    alpr: '96', alpr_dot: '●', d1pr_dot: '○', d2pr_dot: '☆',
    f1pr_dot: '◎', f2pr_dot: '', f3pr_dot: '☆', f4pr_dot: '●',
    s01pr_dot: '●', s02pr_dot: '', s03pr_dot: '○', s04pr_dot: '☆',
    s05pr_dot: '', s06pr_dot: '', s07pr_dot: '', s08pr_dot: '',
    s09pr_dot: '', s10pr_dot: '', s11pr_dot: '', s12pr_dot: '',
  }, overrides || {});
}

test('_ftPersonalReportData：燈號文字對應（●→紅燈●／◎→橙燈◎／○→黃燈○／☆→綠燈☆／空→沒有資料）', () => {
  const S = loadReports();
  const d = S._ftPersonalReportData(baseCells());
  assert.equal(d.overall.lamp, '紅燈●'); // alpr_dot='●'
  const f1 = d.factors.find((x) => x.id === 'f1pr');
  assert.equal(f1.lamp, '橙燈◎');
  const f2 = d.factors.find((x) => x.id === 'f2pr');
  assert.equal(f2.lamp, '沒有資料'); // f2pr_dot='' 空值
  const d2 = d.dimensions.find((x) => x.id === 'd2pr');
  assert.equal(d2.lamp, '綠燈☆');
  const d1 = d.dimensions.find((x) => x.id === 'd1pr');
  assert.equal(d1.lamp, '黃燈○');
});

test('_ftPersonalReportData：F1 標籤＝關係保護/危險因子（ef 模板誤植「情緒保護/危險因子」是 ef bug，本系統用正確版）', () => {
  const S = loadReports();
  const d = S._ftPersonalReportData(baseCells());
  const f1 = d.factors.find((x) => x.id === 'f1pr');
  const f3 = d.factors.find((x) => x.id === 'f3pr');
  assert.equal(f1.label, '關係保護/危險因子');
  assert.equal(f3.label, '情緒保護/危險因子'); // F3 才是「情緒保護/危險因子」
});

test('_ftPersonalReportData：header 欄位對應（學號/姓名/施測日期/學院/系所/班級/性別）', () => {
  const S = loadReports();
  const d = S._ftPersonalReportData(baseCells());
  assert.equal(d.stuId, 'B1');
  assert.equal(d.nameZh, '甲同學');
  assert.equal(d.testDate, '2026-09-15');
  assert.equal(d.college, '理學院');
  assert.equal(d.deptName, '資訊管理系');
  assert.equal(d.classAbbr, '四資管一A');
  assert.equal(d.gender, '女');
});

test('_ftPersonalReportData：高自殺旗標（high_suicide=v → true，其餘 → false）', () => {
  const S = loadReports();
  assert.equal(S._ftPersonalReportData(baseCells({ high_suicide: 'v' })).highSuicide, true);
  assert.equal(S._ftPersonalReportData(baseCells({ high_suicide: '' })).highSuicide, false);
});

test('_ftPersonalReportData：S01~S12 量尺沿用 FT_ISSUE_LABELS，共 12 筆', () => {
  const S = loadReports();
  const d = S._ftPersonalReportData(baseCells());
  assert.equal(d.scales.length, 12);
  assert.equal(d.scales[0].id, 's01pr');
  assert.equal(d.scales[0].label, '同儕與人際互動');
  assert.equal(d.scales[0].lamp, '紅燈●');
});

// ══════════════ C) 班級報告（導師版）_ftClassReportData ══════════════

test('_ftClassReportData：高關懷名單只收 high_concern=v 且 consent=v（未填寫/不同意皆排除）', () => {
  const S = loadReports();
  const rows = [
    { _hasTest: true, cells: baseCells({ stu_id: 'B1', high_concern: 'v', consent: 'v' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B2', high_concern: 'v', consent: 'x' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B3', high_concern: 'v', consent: '未填寫' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B4', high_concern: '', consent: 'v' }) },
  ];
  const d = S._ftClassReportData('四資管一A', rows, []);
  assert.deepEqual(d.highConcernConsented.map((x) => x.stuId), ['B1']);
});

test('_ftClassReportData：redIssues 只收該生紅燈●的 S 量尺（中文名）', () => {
  const S = loadReports();
  const rows = [
    { _hasTest: true, cells: baseCells({ stu_id: 'B1', high_concern: 'v', consent: 'v', s01pr_dot: '●', s02pr_dot: '●', s03pr_dot: '○' }) },
  ];
  const d = S._ftClassReportData('四資管一A', rows, []);
  assert.deepEqual(d.highConcernConsented[0].redIssues, ['同儕與人際互動', '家庭功能影響']);
});

test('_ftClassReportData：只納入 class_abbr 精確相符的列（其他班級不計入 metrics）', () => {
  const S = loadReports();
  const rows = [
    { _hasTest: true, cells: baseCells({ stu_id: 'B1', class_abbr: '四資管一A' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B2', class_abbr: '四資管一B' }) },
  ];
  const d = S._ftClassReportData('四資管一A', rows, []);
  assert.equal(d.metrics.total, 1);
});

test('_ftClassReportData：tutorName join 成功／查無回傳 null', () => {
  const S = loadReports();
  const tutors = [{ cells: { class_abbr: '四資管一A', tutor_name: '王老師' } }];
  const found = S._ftClassReportData('四資管一A', [], tutors);
  assert.equal(found.tutorName, '王老師');
  const notFound = S._ftClassReportData('四資管一Z', [], tutors);
  assert.equal(notFound.tutorName, null);
});

test('_ftClassReportData：top5Issues 依紅燈人數排序', () => {
  const S = loadReports();
  const rows = [
    { _hasTest: true, cells: baseCells({ stu_id: 'B1', s01pr_dot: '●' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B2', s01pr_dot: '●' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B3', s01pr_dot: '', s02pr_dot: '●' }) },
  ];
  const d = S._ftClassReportData('四資管一A', rows, []);
  assert.equal(d.top5Issues[0].id, 's01pr');
  assert.equal(d.top5Issues[0].count, 2);
});

// ══════════════ D) 系主任版／院長版 ══════════════

test('_ftDeptReportData：學院→系所分組，metrics 與 top3Issues（取前3）', () => {
  const S = loadReports();
  const rows = [
    { _hasTest: true, cells: baseCells({ stu_id: 'B1', college: 'A學院', dept_name: '甲系', high_concern: 'v', consent: 'v', s01pr_dot: '●' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B2', college: 'A學院', dept_name: '甲系', high_concern: '', consent: '未填寫', s02pr_dot: '●' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B3', college: 'A學院', dept_name: '甲系', s03pr_dot: '●' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B4', college: 'A學院', dept_name: '甲系', s04pr_dot: '●' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B5', college: 'B學院', dept_name: '乙系' }) },
  ];
  const list = S._ftDeptReportData(rows);
  assert.equal(list.length, 2);
  const deptA = list.find((x) => x.dept === '甲系');
  assert.equal(deptA.college, 'A學院');
  assert.equal(deptA.metrics.total, 4);
  assert.equal(deptA.metrics.highConcernConsentOnly, 1);
  assert.equal(deptA.top3Issues.length, 3); // 4 個議題各 1 人，取前 3
});

test('_ftCollegeReportData：依學院分組並含 highConcernConsentOnly', () => {
  const S = loadReports();
  const rows = [
    { _hasTest: true, cells: baseCells({ stu_id: 'B1', college: 'A學院', high_concern: 'v', consent: 'v' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B2', college: 'A學院', high_concern: 'v', consent: 'x' }) },
    { _hasTest: true, cells: baseCells({ stu_id: 'B3', college: 'B學院' }) },
  ];
  const list = S._ftCollegeReportData(rows);
  assert.equal(list.length, 2);
  const collegeA = list.find((x) => x.college === 'A學院');
  assert.equal(collegeA.metrics.total, 2);
  assert.equal(collegeA.metrics.highConcernConsentOnly, 1);
});

test('_ftDeptReportData／_ftCollegeReportData：空值歸「（未分類）」（沿用 _ftGroupKey）', () => {
  const S = loadReports();
  const rows = [{ _hasTest: true, cells: baseCells({ stu_id: 'B1', college: '', dept_name: '' }) }];
  const depts = S._ftDeptReportData(rows);
  const colleges = S._ftCollegeReportData(rows);
  assert.equal(depts[0].college, '（未分類）');
  assert.equal(depts[0].dept, '（未分類）');
  assert.equal(colleges[0].college, '（未分類）');
});
