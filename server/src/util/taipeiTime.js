// server/src/util/taipeiTime.js — 台北時區（UTC+8，全年無日光節約）純算術工具。
// 對映 dev/Code.gs 在 appsscript.json 設定 timeZone: 'Asia/Taipei' 之後，各處 `new Date(...).getFullYear()`
// 等「以腳本時區為準」的區域時間運算——GAS 執行環境固定跑在該時區，Node 版伺服器 process 不保證
// TZ 環境變數一定是 Asia/Taipei（測試環境尤其不可信賴），故一律用 UTC+8 offset 算術取代
// `Intl`/本機時區 API，寫法與 src/auth/session.js 的 nextTaipeiMidnightEpochSec 同一慣例。
'use strict';

const OFF_MS = 8 * 3600 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 給定任一時間點（epoch ms 或可被 Date 解析的字串/Date），回傳其台北時區的年月日時分＋ISO
// weekday（1=週一…7=週日，對映 GAS Utilities.formatDate(d,'Asia/Taipei','u') 的格式）。
function taipeiParts(input) {
  const ms = input instanceof Date ? input.getTime() : (typeof input === 'number' ? input : new Date(input).getTime());
  const d = new Date(ms + OFF_MS);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat（已經是位移後的「台北時間」對應的 UTC getter）
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: dow === 0 ? 7 : dow,
  };
}

// yyyy-MM-dd（台北時區）。
function taipeiYmd(input) {
  const p = taipeiParts(input);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

// HH:mm（台北時區）。
function taipeiHm(input) {
  const p = taipeiParts(input);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

// yyyy/MM/dd HH:mm（台北時區）——對映 dev/Code.gs buildEventDesc_ 組 actorLine 用的格式。
function taipeiYmdHm(input) {
  const p = taipeiParts(input);
  return `${p.year}/${pad2(p.month)}/${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

module.exports = { OFF_MS, pad2, taipeiParts, taipeiYmd, taipeiHm, taipeiYmdHm };
