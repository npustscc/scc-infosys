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

// v165：新建系列／整系列重排會落地 seriesPlan（{dates,startTime,endTime,room,customRoom,stampedAt}，
// 同代成員共用同一份內容）與各自的 planDate（自己那筆的原規劃日期），供之後精確比對／刪除偵測，
// 取代 v163 的多數值反推。以下三例覆蓋：全員同代（精確模式）、代別混雜或部分缺（逐筆精確＋刪除退回推算）、
// 完全無快照（fallback＝v163 行為不變，已由上方既有 6 例涵蓋，此處另補一個混合情境）。
function _plan(dates, extra) {
  return Object.assign({ dates, startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '', stampedAt: 'g1' }, extra || {});
}

test('_bkSeriesDiffAnalyze：精確模式（全員同代快照）— 逐筆比對 date/planDate 與 seriesPlan，不靠多數值', () => {
  const S = load_();
  const dates = ['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22'];
  const plan = _plan(dates);
  const list = [
    { id: 'b1', date: '2026-07-01', planDate: '2026-07-01', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '', seriesPlan: plan },
    { id: 'b2', date: '2026-07-08', planDate: '2026-07-08', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '', seriesPlan: plan },
    // b3：日期／節次／空間三個欄位都被個別改動，但仍是同一代快照（自己那筆的 planDate/seriesPlan 不變）
    { id: 'b3', date: '2026-07-16', planDate: '2026-07-15', startTime: '10:15', endTime: '11:05', room: 'B202', customRoom: '', seriesPlan: plan },
  ];
  const r = S._bkSeriesDiffAnalyze(list);
  assert.equal(r.baseline.exact, true);
  const d1 = r.items.get('b1');
  assert.equal(d1.dateChanged, false); assert.equal(d1.roomChanged, false); assert.equal(d1.periodChanged, false);
  const d3 = r.items.get('b3');
  assert.equal(d3.dateChanged, true); assert.equal(d3.roomChanged, true); assert.equal(d3.periodChanged, true);
  assert.equal(d3.origDate, '2026-07-15');
  // 07-22 那筆在 seriesPlan.dates 中，但現存成員沒有任何一筆 planDate === 07-22 → 精確判定為已刪除
  assert.deepEqual(r.missingDates, ['2026-07-22']);
  assert.equal(r.deletionMode, 'exact');
});

test('_bkSeriesDiffAnalyze：僅此筆單筆編輯不動快照 — 該筆快照與其他成員仍同代，維持精確模式', () => {
  const S = load_();
  // 模拟「僅此筆」編輯：只改了 b2 的 date/room（欄位本身），但 seriesPlan/planDate 完全沒被觸碰
  // （saveBooking 的 scope='this' 分支不寫入 seriesPlan/planDate，見程式碼），其餘成員也原封不動。
  const dates = ['2026-07-01', '2026-07-08', '2026-07-15'];
  const plan = _plan(dates);
  const list = [
    { id: 'b1', date: '2026-07-01', planDate: '2026-07-01', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '', seriesPlan: plan },
    { id: 'b2', date: '2026-07-09', planDate: '2026-07-08', startTime: '09:10', endTime: '10:00', room: 'B202', customRoom: '', seriesPlan: plan },
    { id: 'b3', date: '2026-07-15', planDate: '2026-07-15', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '', seriesPlan: plan },
  ];
  const r = S._bkSeriesDiffAnalyze(list);
  assert.equal(r.deletionMode, 'exact');
  assert.deepEqual(r.missingDates, []); // 三筆的 planDate 恰好覆蓋 seriesPlan.dates 全部三個日期
  const d2 = r.items.get('b2');
  assert.equal(d2.dateChanged, true);
  assert.equal(d2.roomChanged, true);
  assert.equal(d2.origDate, '2026-07-08');
  assert.equal(d2.origRoom, 'A101');
});

test('_bkSeriesDiffAnalyze：快照混代（部分筆「此筆之後」重排過，代別不同）— 逐筆仍精確比對，刪除退回 v163 推算', () => {
  const S = load_();
  const oldPlan = _plan(['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22'], { stampedAt: 'g1' });
  const newPlan = _plan(['2026-07-15', '2026-07-22'], { stampedAt: 'g2', room: 'B202' });
  const list = [
    // b1/b2：舊代快照未被本次「此筆之後」編輯觸碰，維持原樣
    { id: 'b1', date: '2026-07-01', planDate: '2026-07-01', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '', seriesPlan: oldPlan },
    { id: 'b2', date: '2026-07-08', planDate: '2026-07-08', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '', seriesPlan: oldPlan },
    // b3/b4：此筆之後範圍重排，換了新代快照與新空間
    { id: 'b3', date: '2026-07-15', planDate: '2026-07-15', startTime: '09:10', endTime: '10:00', room: 'B202', customRoom: '', seriesPlan: newPlan },
    { id: 'b4', date: '2026-07-22', planDate: '2026-07-22', startTime: '09:10', endTime: '10:00', room: 'B202', customRoom: '', seriesPlan: newPlan },
  ];
  const r = S._bkSeriesDiffAnalyze(list);
  // 代別混雜（stampedAt 不只一種）→ 非精確模式；但每筆仍各自帶自己那代的快照，逐筆比對仍精確（皆無變更）
  for (const x of list) {
    const d = r.items.get(x.id);
    assert.equal(d.exact, true);
    assert.equal(d.dateChanged, false);
    assert.equal(d.roomChanged, false);
    assert.equal(d.periodChanged, false);
  }
  // 刪除偵測退回 v163 推算法（不使用 seriesPlan.dates 聯集，避免把被合法取代的舊日期誤報成刪除）
  assert.equal(r.deletionMode, 'inferred');
});

test('_bkSeriesDiffAnalyze：部分成員完全無快照（舊系列事後手動加新筆）— 缺快照的筆退回多數值比對', () => {
  const S = load_();
  const plan = _plan(['2026-07-01', '2026-07-08', '2026-07-15']);
  const list = [
    { id: 'b1', date: '2026-07-01', planDate: '2026-07-01', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '', seriesPlan: plan },
    { id: 'b2', date: '2026-07-08', planDate: '2026-07-08', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '', seriesPlan: plan },
    { id: 'b3', date: '2026-07-15', planDate: '2026-07-15', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '', seriesPlan: plan },
    // b4：完全沒有 seriesPlan/planDate（例如舊系列後來手動加的一筆），但欄位與多數值一致
    { id: 'b4', date: '2026-07-22', startTime: '09:10', endTime: '10:00', room: 'A101', customRoom: '' },
  ];
  const r = S._bkSeriesDiffAnalyze(list);
  const d4 = r.items.get('b4');
  assert.equal(d4.exact, false);
  assert.equal(d4.roomChanged, false); // 多數值仍是 A101，b4 未偏離
  assert.equal(r.deletionMode, 'inferred'); // 非全員同代 → 退回推算
});
