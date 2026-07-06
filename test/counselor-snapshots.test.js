// 主責快照函式群測試（重構 Slice 0）。執行：node --test test/*.test.js
// 對象：_getLatestCounselorEmail / _stampSemCounselorSnapshots / _applyCounselorChange / _semCounselorDisplay
// 這群函式是 #023／#026 的雷區（v84/v86 剛修過），重構時最容易改壞「其他學期顯示不受單一學期轉派影響」的行為。
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

// ── _getLatestCounselorEmail：沿 semesters 由新到舊找第一個有 counselorEmail 的快照 ──────
test('_getLatestCounselorEmail：最新學期快照有 counselorEmail 直接回傳', () => {
  const S = load(['_getLatestCounselorEmail', 'openDateToSemPrefix']);
  const c = {
    semesters: ['1141', '1142'],
    basicInfoSnapshots: {
      1141: { counselorEmail: 'old@x.com' },
      1142: { counselorEmail: 'new@x.com' },
    },
  };
  assert.equal(S._getLatestCounselorEmail(c), 'new@x.com');
});

test('_getLatestCounselorEmail：最新學期快照缺 counselorEmail 時往回找較舊學期', () => {
  const S = load(['_getLatestCounselorEmail', 'openDateToSemPrefix']);
  const c = {
    semesters: ['1141', '1142'],
    basicInfoSnapshots: {
      1141: { counselorEmail: 'old@x.com' },
      1142: {}, // 最新學期無主責 email
    },
  };
  assert.equal(S._getLatestCounselorEmail(c), 'old@x.com');
});

test('_getLatestCounselorEmail：semesters 未預先排序也能找到最新的', () => {
  const S = load(['_getLatestCounselorEmail', 'openDateToSemPrefix']);
  const c = {
    semesters: ['1142', '1141'], // 刻意倒序
    basicInfoSnapshots: {
      1141: { counselorEmail: 'old@x.com' },
      1142: { counselorEmail: 'new@x.com' },
    },
  };
  assert.equal(S._getLatestCounselorEmail(c), 'new@x.com');
});

test('_getLatestCounselorEmail：無 semesters 時 fallback openDateToSemPrefix(openDate)', () => {
  const S = load(['_getLatestCounselorEmail', 'openDateToSemPrefix']);
  const c = {
    openDate: '2026-06-15', // -> 1142
    basicInfoSnapshots: { 1142: { counselorEmail: 'a@x.com' } },
  };
  assert.equal(S._getLatestCounselorEmail(c), 'a@x.com');
});

test('_getLatestCounselorEmail：都找不到快照 email 時 fallback 全案層級 counselorEmail', () => {
  const S = load(['_getLatestCounselorEmail', 'openDateToSemPrefix']);
  const c = {
    semesters: ['1141'],
    basicInfoSnapshots: { 1141: {} },
    counselorEmail: 'fallback@x.com',
  };
  assert.equal(S._getLatestCounselorEmail(c), 'fallback@x.com');
});

test('_getLatestCounselorEmail：空物件不炸、回空字串', () => {
  const S = load(['_getLatestCounselorEmail', 'openDateToSemPrefix']);
  assert.equal(S._getLatestCounselorEmail({}), '');
});

// ── _stampSemCounselorSnapshots：把全案層級主責定格到尚無主責資訊的學期快照 ──────────
test('_stampSemCounselorSnapshots：c 為 null/undefined 或無 basicInfoSnapshots 時安全返回', () => {
  const S = load(['_stampSemCounselorSnapshots']);
  assert.doesNotThrow(() => S._stampSemCounselorSnapshots(undefined));
  assert.doesNotThrow(() => S._stampSemCounselorSnapshots(null));
  assert.doesNotThrow(() => S._stampSemCounselorSnapshots({}));
});

test('_stampSemCounselorSnapshots：已有 counselorEmail/Name/Text 任一者的快照不動', () => {
  const S = load(['_stampSemCounselorSnapshots']);
  const c = {
    counselorEmail: 'new@x.com', counselorName: 'New',
    basicInfoSnapshots: {
      1141: { counselorEmail: 'kept@x.com' },
      1142: { counselorText: '舊制文字' },
    },
  };
  S._stampSemCounselorSnapshots(c);
  assert.equal(c.basicInfoSnapshots[1141].counselorEmail, 'kept@x.com');
  assert.equal(c.basicInfoSnapshots[1141].counselorName, undefined);
  assert.equal(c.basicInfoSnapshots[1142].counselorText, '舊制文字');
  assert.equal(c.basicInfoSnapshots[1142].counselorEmail, undefined);
});

test('_stampSemCounselorSnapshots：無主責資訊的快照 + 全案層級有 counselorEmail → 寫入 email+name', () => {
  const S = load(['_stampSemCounselorSnapshots']);
  const c = {
    counselorEmail: 'a@x.com', counselorName: 'A老師',
    basicInfoSnapshots: { 1141: {} },
  };
  S._stampSemCounselorSnapshots(c);
  assert.equal(c.basicInfoSnapshots[1141].counselorEmail, 'a@x.com');
  assert.equal(c.basicInfoSnapshots[1141].counselorName, 'A老師');
});

test('_stampSemCounselorSnapshots：無 counselorEmail 但有 counselorText/Name → 寫入 text+name', () => {
  const S = load(['_stampSemCounselorSnapshots']);
  const c = {
    counselorText: '匯入文字', counselorName: 'B老師',
    basicInfoSnapshots: { 1141: {} },
  };
  S._stampSemCounselorSnapshots(c);
  assert.equal(c.basicInfoSnapshots[1141].counselorText, '匯入文字');
  assert.equal(c.basicInfoSnapshots[1141].counselorName, 'B老師');
  assert.equal(c.basicInfoSnapshots[1141].counselorEmail, undefined);
});

test('_stampSemCounselorSnapshots：全案層級也全無主責資訊時快照維持空白', () => {
  const S = load(['_stampSemCounselorSnapshots']);
  const c = { basicInfoSnapshots: { 1141: {} } };
  S._stampSemCounselorSnapshots(c);
  assert.deepEqual(c.basicInfoSnapshots[1141], {});
});

// ── _applyCounselorChange：#023 情境——先 stamp 再改單一學期，其他學期顯示不變 ──────
test('_applyCounselorChange：改非最新學期時，全案層級與其他學期顯示不受影響（#023）', () => {
  const S = load(
    ['_applyCounselorChange', '_stampSemCounselorSnapshots', '_caseLatestSem', '_semCounselorDisplay', 'openDateToSemPrefix'],
    { configData: { users: {} } }
  );
  const c = {
    semesters: ['1141', '1142'],
    counselorEmail: 'old@x.com', counselorName: 'Old老師',
    basicInfoSnapshots: { 1141: {}, 1142: {} }, // 兩學期快照都尚無主責資訊
  };
  S._applyCounselorChange(c, '1141', 'new@x.com', 'New老師');

  // 目標學期（非最新）被改成新主責
  assert.equal(c.basicInfoSnapshots[1141].counselorEmail, 'new@x.com');
  assert.equal(c.basicInfoSnapshots[1141].counselorName, 'New老師');
  assert.equal(c.basicInfoSnapshots[1141].counselorText, '');

  // 其他學期（1142，最新）被 stamp 定格成「改變前」的全案層級主責，不受這次轉派影響
  assert.equal(c.basicInfoSnapshots[1142].counselorEmail, 'old@x.com');
  assert.equal(c.basicInfoSnapshots[1142].counselorName, 'Old老師');

  // 全案層級主責不變（因為改的不是最新學期）
  assert.equal(c.counselorEmail, 'old@x.com');
  assert.equal(c.counselorName, 'Old老師');

  // 顯示層驗證：1141 顯示新主責、1142 仍顯示舊主責
  assert.equal(S._semCounselorDisplay(c, '1141'), 'New老師');
  assert.equal(S._semCounselorDisplay(c, '1142'), 'Old老師');
});

test('_applyCounselorChange：改最新學期時，全案層級同步更新', () => {
  const S = load(['_applyCounselorChange', '_stampSemCounselorSnapshots', '_caseLatestSem', 'openDateToSemPrefix']);
  const c = {
    semesters: ['1141', '1142'],
    counselorEmail: 'old@x.com', counselorName: 'Old老師', counselorText: '殘留舊文字',
    basicInfoSnapshots: { 1141: {}, 1142: {} },
  };
  S._applyCounselorChange(c, '1142', 'new@x.com', 'New老師');
  assert.equal(c.counselorEmail, 'new@x.com');
  assert.equal(c.counselorName, 'New老師');
  assert.equal(c.counselorText, '');
});

test('_applyCounselorChange：未傳 targetSem 時用 _caseLatestSem 當目標，並同步全案層級', () => {
  const S = load(['_applyCounselorChange', '_stampSemCounselorSnapshots', '_caseLatestSem', 'openDateToSemPrefix']);
  const c = {
    semesters: ['1141', '1142'],
    counselorEmail: 'old@x.com', counselorName: 'Old老師',
    basicInfoSnapshots: { 1141: {}, 1142: {} },
  };
  S._applyCounselorChange(c, null, 'new@x.com', 'New老師');
  assert.equal(c.basicInfoSnapshots[1142].counselorEmail, 'new@x.com'); // 落在最新學期 1142
  assert.equal(c.counselorEmail, 'new@x.com'); // 無 sem 傳入時視同最新學期，同步全案層級
});

test('_applyCounselorChange：無 basicInfoSnapshots 時自動建立目標學期快照', () => {
  const S = load(['_applyCounselorChange', '_stampSemCounselorSnapshots', '_caseLatestSem', 'openDateToSemPrefix']);
  const c = { semesters: ['1141'], counselorEmail: 'old@x.com', counselorName: 'Old' };
  S._applyCounselorChange(c, '1141', 'new@x.com', 'New');
  assert.equal(c.basicInfoSnapshots['1141'].counselorEmail, 'new@x.com');
});

// ── _semCounselorDisplay：configData 名稱優先於快照 counselorName ─────────────────
test('_semCounselorDisplay：快照有 counselorEmail 時優先用 configData.users[email].name', () => {
  const S = load(['_semCounselorDisplay'], {
    configData: { users: { 'a@x.com': { name: '設定檔中的名字' } } },
  });
  const c = { basicInfoSnapshots: { 1141: { counselorEmail: 'a@x.com', counselorName: '快照中的名字' } } };
  assert.equal(S._semCounselorDisplay(c, '1141'), '設定檔中的名字');
});

test('_semCounselorDisplay：configData 查無該 email 時 fallback counselorName，再 fallback email', () => {
  const S = load(['_semCounselorDisplay'], { configData: { users: {} } });
  const withName = { basicInfoSnapshots: { 1141: { counselorEmail: 'a@x.com', counselorName: '快照名字' } } };
  assert.equal(S._semCounselorDisplay(withName, '1141'), '快照名字');
  const withoutName = { basicInfoSnapshots: { 1141: { counselorEmail: 'a@x.com' } } };
  assert.equal(S._semCounselorDisplay(withoutName, '1141'), 'a@x.com');
});

test('_semCounselorDisplay：無 counselorEmail 時 counselorText 優先於 counselorName', () => {
  const S = load(['_semCounselorDisplay'], { configData: {} });
  const c = { basicInfoSnapshots: { 1141: { counselorText: '匯入文字', counselorName: '姓名' } } };
  assert.equal(S._semCounselorDisplay(c, '1141'), '匯入文字');
});

test('_semCounselorDisplay：該學期無快照時 fallback 全案層級', () => {
  const S = load(['_semCounselorDisplay'], {
    configData: { users: { 'a@x.com': { name: '設定檔名字' } } },
  });
  const c = { counselorEmail: 'a@x.com', counselorName: '全案層級名字' };
  assert.equal(S._semCounselorDisplay(c, '9999'), '設定檔名字');
});

test('_semCounselorDisplay：快照與全案層級皆無資訊時回「—」', () => {
  const S = load(['_semCounselorDisplay'], { configData: {} });
  assert.equal(S._semCounselorDisplay({}, '1141'), '—');
  assert.equal(S._semCounselorDisplay({ basicInfoSnapshots: { 1141: {} } }, '1141'), '—');
});
