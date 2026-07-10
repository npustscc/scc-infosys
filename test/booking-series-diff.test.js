// v163：「檢視此系列預約」清單與原規劃差異醒目標示 — _bkSeriesDiffAnalyze 純函式單元測試。
// 系列預約無存原始規則／逐筆快照、刪除為硬刪除無墓碑，採方案 C：以現存筆數多數值反推基準
// （日期用星期幾／每月同一天何者較符合多數；節次、空間各自獨立取多數），
// 並在相鄰日期差有明確多數（固定天數頻率）時推算「應有但不存在」的日期視為疑似刪除。
// 執行：node --test test/*.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

function load_() {
  return load(['_bkSeriesDiffAnalyze']);
}

test('_bkSeriesDiffAnalyze：全部一致 — 無任何欄位被標記變更，也無疑似刪除', () => {
  const S = load_();
  const list = [
    { id: 'b1', date: '2026-07-01', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    { id: 'b2', date: '2026-07-08', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    { id: 'b3', date: '2026-07-15', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    { id: 'b4', date: '2026-07-22', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
  ];
  const r = S._bkSeriesDiffAnalyze(list);
  assert.equal(r.baseline.dateRule.type, 'weekday');
  assert.equal(r.baseline.dateRule.value, 3); // 2026-07-01 為週三
  for (const x of list) {
    const d = r.items.get(x.id);
    assert.equal(d.dateChanged, false);
    assert.equal(d.periodChanged, false);
    assert.equal(d.roomChanged, false);
  }
  assert.deepEqual(r.missingDates, []);
});

test('_bkSeriesDiffAnalyze：其中一筆改到別的空間與節次、日期偏離星期幾規律 — 三個欄位都標記變更', () => {
  const S = load_();
  const list = [
    { id: 'b1', date: '2026-07-01', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    { id: 'b2', date: '2026-07-08', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    // b3 被個別調整：改到週四（非週三）、換空間、換節次
    { id: 'b3', date: '2026-07-16', startTime: '10:15', endTime: '11:05', room: 'B202', customRoom: '' },
    { id: 'b4', date: '2026-07-22', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
  ];
  const r = S._bkSeriesDiffAnalyze(list);
  const d1 = r.items.get('b1');
  assert.equal(d1.dateChanged, false);
  assert.equal(d1.roomChanged, false);
  assert.equal(d1.periodChanged, false);
  const d3 = r.items.get('b3');
  assert.equal(d3.dateChanged, true);
  assert.equal(d3.roomChanged, true);
  assert.equal(d3.periodChanged, true);
});

test('_bkSeriesDiffAnalyze：每月頻率（每月同一天）— 日期規則判為 dom，即使日差恰好多數一致也不推算刪除', () => {
  const S = load_();
  // 每月 15 日；月份長短不一，Jan15→Feb15＝31 天、Feb15→Mar15＝28 天、Mar15→Apr15＝31 天
  // （31 天恰佔多數），但 dom 規則下不可用固定天數步進推算，驗證此情境不誤判缺漏。
  const list = [
    { id: 'b1', date: '2026-01-15', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    { id: 'b2', date: '2026-02-15', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    { id: 'b3', date: '2026-03-15', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    { id: 'b4', date: '2026-04-15', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
  ];
  const r = S._bkSeriesDiffAnalyze(list);
  assert.equal(r.baseline.dateRule.type, 'dom');
  assert.equal(r.baseline.dateRule.value, 15);
  assert.deepEqual(r.missingDates, []);
});

test('_bkSeriesDiffAnalyze：每週固定頻率中缺一筆（被刪除）— 推算出缺漏日期', () => {
  const S = load_();
  // 原規劃 07-01/07-08/07-15/07-22/07-29 每週一次，07-15 那筆被刪除、清單中已不存在
  const list = [
    { id: 'b1', date: '2026-07-01', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    { id: 'b2', date: '2026-07-08', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    { id: 'b4', date: '2026-07-22', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    { id: 'b5', date: '2026-07-29', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
  ];
  const r = S._bkSeriesDiffAnalyze(list);
  assert.deepEqual(r.missingDates, ['2026-07-15']);
});

test('_bkSeriesDiffAnalyze：不足 3 筆或空間/節次剛好各半 — 不誤判，不標記', () => {
  const S = load_();
  const twoOnly = [
    { id: 'b1', date: '2026-07-01', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
    { id: 'b2', date: '2026-07-15', startTime: '09:10', endTime: '10:00', room: 'B202', customRoom: '' },
  ];
  const r = S._bkSeriesDiffAnalyze(twoOnly);
  // 空間各半（1/2）未過半，不判斷是否偏離
  assert.equal(r.baseline.roomConfident, false);
  for (const x of twoOnly) assert.equal(r.items.get(x.id).roomChanged, false);
  assert.deepEqual(r.missingDates, []); // 不足 3 筆不推算刪除
});

test('_bkSeriesDiffAnalyze：少於 2 筆回傳空結果', () => {
  const S = load_();
  const r = S._bkSeriesDiffAnalyze([{ id: 'b1', date: '2026-07-01', startTime: '09:10', endTime: '10:00', room: 'A101' }]);
  assert.equal(r.baseline, null);
  assert.equal(r.items.size, 0);
  assert.deepEqual(r.missingDates, []);
});
