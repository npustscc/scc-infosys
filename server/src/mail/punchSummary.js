// server/src/mail/punchSummary.js — 打卡彙整信（v168）純函式：當日打卡彙整＋內容組字。對映
// dev/Code.gs punchDaySummary_／_fmtHoursMinutes_／_sendPunchSummaryMail_（L2916-2969）。
// 純函式、不觸網、不寫檔，方便單元測試；實際寄送由 src/mail/mailer.js 負責，觸發點見
// src/actions/commit.js 的 attendanceCommit。
'use strict';

const { taipeiHms } = require('../util/taipeiTime');

// 從 records 篩出同一人同一天的 punch 紀錄，依時間排序後回傳筆數、最早/最晚 timestamp、涵蓋工時
// (ms)。純計算、無副作用。逐字對映 punchDaySummary_。
function punchDaySummary(records, email, date) {
  const ts = (records || [])
    .filter((r) => r && r.type === 'punch' && r.email === email && r.date === date && r.timestamp)
    .map((r) => r.timestamp)
    .sort();
  if (!ts.length) return { count: 0, first: null, last: null, spanMs: 0, timestamps: [] };
  const first = ts[0];
  const last = ts[ts.length - 1];
  const spanMs = ts.length >= 2 ? (new Date(last).getTime() - new Date(first).getTime()) : 0;
  return { count: ts.length, first, last, spanMs, timestamps: ts };
}

// 毫秒差轉「X 小時 Y 分」（不足 1 分顯示 0 分）。逐字對映 _fmtHoursMinutes_。
function fmtHoursMinutes(spanMs) {
  const totalMin = Math.floor((spanMs || 0) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} 小時 ${m} 分`;
}

// 組出打卡彙整信主旨/內文。對映 _sendPunchSummaryMail_ 組信段（不含寄送本身）。
// email/name：打卡當事人；date：打卡當日（yyyy-MM-dd）；punchTs：本次打卡的 timestamp（ISO）；
// records：attendanceCommit 寫回後的全部 records（供彙整當日該人所有打卡）。
function buildPunchSummaryMail({ email, name, date, punchTs, records, envPrefix }) {
  const summary = punchDaySummary(records, email, date);
  const subject = (envPrefix || '') + '【屏科大學諮資訊系統】打卡通知（' + date + '）';
  const fmtT = (iso) => taipeiHms(iso);
  const lines = [
    (name || email) + '（' + email + '）您好，系統已記錄您的一筆打卡。',
    '本次打卡時間：' + fmtT(punchTs),
    '',
    '── 當日（' + date + '）打卡紀錄 ──',
  ];
  summary.timestamps.forEach((t, i) => {
    let mark = '';
    if (t === summary.first) mark += '　← 最早';
    if (t === summary.last) mark += '　← 最晚';
    lines.push((i + 1) + '. ' + fmtT(t) + mark);
  });
  lines.push('');
  if (summary.count >= 2) {
    lines.push('最早打卡：' + fmtT(summary.first));
    lines.push('最晚打卡：' + fmtT(summary.last));
    lines.push('涵蓋工時（最晚−最早，午休不另扣）：' + fmtHoursMinutes(summary.spanMs));
  } else {
    lines.push('目前僅一筆打卡紀錄，尚無法計算工時（需至少兩筆）。');
  }
  lines.push('');
  lines.push('※ 此為系統自動通知信，工時定義與差勤月報一致（滿 9 小時為正常，午休不另扣）。');
  return { subject, textBody: lines.join('\n') };
}

module.exports = { punchDaySummary, fmtHoursMinutes, buildPunchSummaryMail };
