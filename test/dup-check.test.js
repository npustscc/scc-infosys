// 同時段重複紀錄檢核（#9）純函式測試。執行：node --test test/*.test.js
// 對象：_dupFindSameSlot——晤談紀錄／初談紀錄／精神科醫師評估／事件處理紀錄共用的比對邏輯。
// 呼叫端（各表單）需先把自己的既有紀錄轉成統一形狀：
//   { id, date, time, counselorEmails:[email,...], createdAt }
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

test('_dupFindSameSlot：同日期同時間且人員有交集 → 命中', () => {
  const S = load(['_dupFindSameSlot']);
  const records = [
    { id: 'r1', date: '2026-07-07', time: '第5節 13:30-14:20', counselorEmails: ['a@x.com'], createdAt: '2026-07-01T00:00:00Z' },
  ];
  const match = S._dupFindSameSlot(records, { date: '2026-07-07', time: '第5節 13:30-14:20', counselorEmails: ['a@x.com', 'b@x.com'] });
  assert.equal(match?.id, 'r1');
});

test('_dupFindSameSlot：日期或時間不同 → 不命中', () => {
  const S = load(['_dupFindSameSlot']);
  const records = [
    { id: 'r1', date: '2026-07-07', time: '第5節 13:30-14:20', counselorEmails: ['a@x.com'] },
  ];
  assert.equal(S._dupFindSameSlot(records, { date: '2026-07-08', time: '第5節 13:30-14:20', counselorEmails: ['a@x.com'] }), null);
  assert.equal(S._dupFindSameSlot(records, { date: '2026-07-07', time: '第6節 14:30-15:20', counselorEmails: ['a@x.com'] }), null);
});

test('_dupFindSameSlot：同時段但人員完全無交集 → 不命中', () => {
  const S = load(['_dupFindSameSlot']);
  const records = [
    { id: 'r1', date: '2026-07-07', time: '13:30-14:20', counselorEmails: ['a@x.com'] },
  ];
  assert.equal(S._dupFindSameSlot(records, { date: '2026-07-07', time: '13:30-14:20', counselorEmails: ['c@x.com'] }), null);
});

test('_dupFindSameSlot：排除目前正在編輯的那筆本身（excludeId）', () => {
  const S = load(['_dupFindSameSlot']);
  const records = [
    { id: 'r1', date: '2026-07-07', time: '13:30-14:20', counselorEmails: ['a@x.com'] },
  ];
  assert.equal(S._dupFindSameSlot(records, { date: '2026-07-07', time: '13:30-14:20', counselorEmails: ['a@x.com'], excludeId: 'r1' }), null);
});

test('_dupFindSameSlot：日期／時間／人員缺任一項 → 不檢查，回 null', () => {
  const S = load(['_dupFindSameSlot']);
  const records = [{ id: 'r1', date: '2026-07-07', time: '13:30-14:20', counselorEmails: ['a@x.com'] }];
  assert.equal(S._dupFindSameSlot(records, { date: '', time: '13:30-14:20', counselorEmails: ['a@x.com'] }), null);
  assert.equal(S._dupFindSameSlot(records, { date: '2026-07-07', time: '', counselorEmails: ['a@x.com'] }), null);
  assert.equal(S._dupFindSameSlot(records, { date: '2026-07-07', time: '13:30-14:20', counselorEmails: [] }), null);
});

test('_dupFindSameSlot：命中多筆時回傳第一筆', () => {
  const S = load(['_dupFindSameSlot']);
  const records = [
    { id: 'r1', date: '2026-07-07', time: '13:30-14:20', counselorEmails: ['a@x.com'] },
    { id: 'r2', date: '2026-07-07', time: '13:30-14:20', counselorEmails: ['a@x.com'] },
  ];
  const match = S._dupFindSameSlot(records, { date: '2026-07-07', time: '13:30-14:20', counselorEmails: ['a@x.com'] });
  assert.equal(match?.id, 'r1');
});

test('_dupFindSameSlot：空紀錄陣列/undefined 不炸', () => {
  const S = load(['_dupFindSameSlot']);
  assert.doesNotThrow(() => S._dupFindSameSlot([], { date: '2026-07-07', time: '13:30-14:20', counselorEmails: ['a@x.com'] }));
  assert.doesNotThrow(() => S._dupFindSameSlot(undefined, { date: '2026-07-07', time: '13:30-14:20', counselorEmails: ['a@x.com'] }));
});
