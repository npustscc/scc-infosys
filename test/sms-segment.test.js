// 簡訊發送（v203）純函式測試：GSM 字集判斷／則數估算／手機號碼驗證／預約時間格式化／狀態碼對照。
// 執行：node --test test/
const { test } = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness');

const SEGMENT_FNS = ['_smsSegmentInfo', '_smsIsGsmMessage'];

test('_smsIsGsmMessage：純英數符號屬於 GSM 基本字集', () => {
  const S = load(SEGMENT_FNS);
  assert.equal(S._smsIsGsmMessage('Hello 123!'), true);
});

test('_smsIsGsmMessage：含中文字元不屬於 GSM 基本字集', () => {
  const S = load(SEGMENT_FNS);
  assert.equal(S._smsIsGsmMessage('您好 Hello'), false);
});

test('_smsIsGsmMessage：GSM 擴充字元（^{}\\[~]|）仍屬於可用字集', () => {
  const S = load(SEGMENT_FNS);
  assert.equal(S._smsIsGsmMessage('a^b{c}d\\e[f~g]h|i'), true);
});

test('_smsSegmentInfo：英數簡訊 160 字內為 1 則', () => {
  const S = load(SEGMENT_FNS);
  const text = 'a'.repeat(160);
  const info = S._smsSegmentInfo(text);
  assert.equal(info.isGsm, true);
  assert.equal(info.len, 160);
  assert.equal(info.segments, 1);
});

test('_smsSegmentInfo：英數簡訊超過 160 字後每 153 字 1 則', () => {
  const S = load(SEGMENT_FNS);
  const text = 'a'.repeat(161);
  const info = S._smsSegmentInfo(text);
  assert.equal(info.segments, Math.ceil(161 / 153)); // = 2
  const text2 = 'a'.repeat(306); // 2*153
  assert.equal(S._smsSegmentInfo(text2).segments, 2);
  const text3 = 'a'.repeat(307);
  assert.equal(S._smsSegmentInfo(text3).segments, 3);
});

test('_smsSegmentInfo：GSM 擴充字元每個佔 2 字額度', () => {
  const S = load(SEGMENT_FNS);
  const info = S._smsSegmentInfo('^'.repeat(80)); // 80 * 2 = 160 字額度，剛好 1 則
  assert.equal(info.len, 160);
  assert.equal(info.segments, 1);
  const info2 = S._smsSegmentInfo('^'.repeat(81)); // 162 字額度 → 超過 160，進入多則級距
  assert.equal(info2.len, 162);
  assert.equal(info2.segments, 2);
});

test('_smsSegmentInfo：中文等非 GSM 內容 70 字內為 1 則，超過每 67 字 1 則', () => {
  const S = load(SEGMENT_FNS);
  const info = S._smsSegmentInfo('中'.repeat(70));
  assert.equal(info.isGsm, false);
  assert.equal(info.len, 70);
  assert.equal(info.segments, 1);
  const info2 = S._smsSegmentInfo('中'.repeat(71));
  assert.equal(info2.segments, Math.ceil(71 / 67)); // = 2
});

test('_smsSegmentInfo：空字串為 0 則', () => {
  const S = load(SEGMENT_FNS);
  const info = S._smsSegmentInfo('');
  assert.equal(info.len, 0);
  assert.equal(info.segments, 0);
});

test('_smsValidatePhone：09 開頭 10 碼與 +886 國際格式皆通過，其餘拒絕', () => {
  const S = load(['_smsValidatePhone']);
  assert.equal(S._smsValidatePhone('0912345678'), '0912345678');
  assert.equal(S._smsValidatePhone(' 0912345678 '), '0912345678'); // 前後空白容忍
  assert.equal(S._smsValidatePhone('+886912345678'), '+886912345678');
  assert.equal(S._smsValidatePhone('0812345678'), null);   // 非 09 開頭
  assert.equal(S._smsValidatePhone('091234567'), null);    // 少一碼
  assert.equal(S._smsValidatePhone('abcdefghij'), null);
  assert.equal(S._smsValidatePhone(''), null);
});

test('_smsFormatScheduledAt：datetime-local 值轉 14 碼 YYYYMMDDHHMMSS', () => {
  const S = load(['_smsFormatScheduledAt']);
  assert.equal(S._smsFormatScheduledAt('2026-07-18T14:30'), '20260718143000');
  assert.equal(S._smsFormatScheduledAt('2026-07-18T14:30:05'), '20260718143005');
  assert.equal(S._smsFormatScheduledAt(''), '');
  assert.equal(S._smsFormatScheduledAt('not-a-date'), '');
});

test('_smsStatusText：三竹狀態碼對照', () => {
  const S = load(['_smsStatusText']);
  assert.equal(S._smsStatusText('mitake', '0'), '預約中');
  assert.equal(S._smsStatusText('mitake', '4'), '已送達手機');
  assert.equal(S._smsStatusText('mitake', '9'), '已取消');
  assert.equal(S._smsStatusText('mitake', '999'), '999'); // 未列出的碼原樣顯示
});

test('_smsStatusText：Every8D 狀態碼對照', () => {
  const S = load(['_smsStatusText']);
  assert.equal(S._smsStatusText('every8d', '100'), '已送達手機');
  assert.equal(S._smsStatusText('every8d', '103'), '空號');
  assert.equal(S._smsStatusText('every8d', '700'), '已傳送');
  assert.equal(S._smsStatusText('every8d', '999'), '999');
});

test('_smsLogStatusMeta：整批狀態 → 繁中文字與 badge 樣式', () => {
  const S = load(['_smsLogStatusMeta']);
  assert.deepEqual(S._smsLogStatusMeta('sent'), { text: '已送出', badge: 'badge-green' });
  assert.deepEqual(S._smsLogStatusMeta('scheduled'), { text: '預約中', badge: 'badge-blue' });
  assert.deepEqual(S._smsLogStatusMeta('canceled'), { text: '已取消', badge: 'badge-gray' });
  assert.deepEqual(S._smsLogStatusMeta('failed'), { text: '失敗', badge: 'badge-orange' });
});

test('_smsErrMsg：錯誤碼對照，detail 有值時附加在後面', () => {
  const S = load(['_smsErrMsg']);
  assert.equal(S._smsErrMsg('sms_not_configured'), '此簡訊平台尚未設定，請聯絡系統管理者於伺服器完成設定');
  assert.equal(S._smsErrMsg('sms_invalid_phone', '0912xxxxxx'), '收訊人手機號碼格式錯誤：0912xxxxxx');
  assert.equal(S._smsErrMsg('unknown_code'), 'unknown_code'); // 未列出碼原樣顯示
});
