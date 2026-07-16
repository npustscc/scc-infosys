// server/src/mail/loginNotify.js — 登入通知信（v166 異常偵測）純函式：決策＋內容組字。對映
// dev/Code.gs mailEnvPrefix_／loginMailDecision_（L660-689）與 sessionsAppendRecordWithMailDecision_
// 內組信段（L810-822）。純函式、不觸網、不寫檔，方便單元測試；實際寄送由 src/mail/mailer.js 負責。
//
// 刻意不移植的部分（見任務回報「不確定的判斷點」）：v167 非台灣登入自動鎖定
// （geoLockDecision_／_sendGeoLockMail_）與定位失敗雙向提醒（geoEmptyNoticeDecision_／
// _sendGeoEmptyMail_）——這兩則通知依附的「帳號自動鎖定」整套行為在 Node 版 actions/session.js
// 尚未實作（沒有鎖定分支、沒有 geo/cc 判斷），屬於獨立的一個安全功能移植，而非「既有寄信點补
// 真寄信」，故不在本次範圍內、留待專案後續排入。
'use strict';

const { taipeiYmdHms } = require('../util/taipeiTime');

// 測試版寄出的通知信主旨前綴——對映 dev/Code.gs mailEnvPrefix_：依 GC_CALENDAR_NAME（對映 GAS
// CALENDAR_NAME）是否以 [DEV] 開頭判斷環境，推正式版後自動無前綴。
function mailEnvPrefix(config) {
  const name = (config && config.GC_CALENDAR_NAME) || '';
  return name.indexOf('[DEV]') === 0 ? '【測試版】' : '';
}

// 純決策：熟識裝置/位置降噪，但保底 7 天必寄一次。逐字對映 loginMailDecision_。
// history：該帳號在 sessions.json 的既有紀錄陣列（新舊不拘，函式內部不假設排序）。
// 回傳 { mail: true|false, reason: 'first_login'|'new_ua'|'new_geo'|'periodic'|'' }。
function loginMailDecision(history, ua, ip, geo, nowSec) {
  const hist = Array.isArray(history) ? history : [];
  if (hist.length === 0) return { mail: true, reason: 'first_login' };

  const knownUa = hist.some((s) => s && s.ua === ua);
  if (!knownUa) return { mail: true, reason: 'new_ua' };

  if (geo) {
    const knownGeo = hist.some((s) => s && s.geo === geo);
    if (!knownGeo) return { mail: true, reason: 'new_geo' };
  }

  let lastMailedMs = null;
  hist.forEach((s) => {
    if (s && s.mailSent) {
      const t = Number(s.issuedAtMs || 0);
      if (lastMailedMs === null || t > lastMailedMs) lastMailedMs = t;
    }
  });
  const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
  const nowMs = Number(nowSec) * 1000;
  if (lastMailedMs === null || (nowMs - lastMailedMs) >= SEVEN_DAYS_MS) {
    return { mail: true, reason: 'periodic' };
  }
  return { mail: false, reason: '' };
}

// 組出登入通知信主旨/內文（純字串組裝，不含收件人——收件人由呼叫端決定，見 actions/session.js）。
// 對映 sessionsAppendRecordWithMailDecision_ 組信段（L810-822）。
function buildLoginNotifyMail({ ua, ip, geo, reason, nowMs, envPrefix }) {
  const loginTime = taipeiYmdHms(nowMs == null ? Date.now() : nowMs);
  const isAnomaly = reason === 'new_ua' || reason === 'new_geo';
  const subject = (envPrefix || '') + (isAnomaly ? '【屏科大學諮資訊系統】⚠ 新裝置或新位置登入' : '【屏科大學諮資訊系統】登入通知');
  const lines = [
    isAnomaly ? '偵測到此帳號在「不熟識的裝置或位置」登入屏科大學諮資訊系統，請確認是否為本人操作：'
              : '有人以此帳號登入屏科大學諮資訊系統。', '',
    '登入時間：' + loginTime + '（台北時間）',
    '瀏覽器資訊：' + ua,
  ];
  if (ip) lines.push('IP 位址：' + ip);
  if (geo) lines.push('大致位置：' + geo);
  lines.push('', '此登入憑證將於今日 24:00（台北時間）自動失效。',
    '若非本人操作，請立即聯繫系統管理者停用帳號，並可於系統「登入紀錄」頁按「登出所有裝置」使所有憑證即時失效。');
  return { subject, textBody: lines.join('\n') };
}

module.exports = { mailEnvPrefix, loginMailDecision, buildLoginNotifyMail };
