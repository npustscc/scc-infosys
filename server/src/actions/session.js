// server/src/actions/session.js — sessionStart／sessionLogout／listMySessions 垂直切片。
// 對映 dev/Code.gs sessionStart_/sessionLogout_/sessionsListForUser_（L410-456、L711-736），
// 差異：身分來源由 Google idToken 改為本地帳密＋TOTP／Email 驗證碼（auth/local.js）。
// v166 登入異常偵測（熟識裝置/位置降噪＋7 天保底信）已移植：決策見 src/mail/loginNotify.js
// 的 loginMailDecision，寄送經 src/mail/mailer.js（缺 MAIL_SEND_CREDS 時降級為 audit-only，
// mailSent 恆為 false）。v167 非台灣登入自動鎖定（geoLockDecision_/_sendGeoLockMail_）與定位
// 失敗雙向提醒（geoEmptyNoticeDecision_/_sendGeoEmptyMail_）尚未移植——這兩則通知依附的「帳號
// 自動鎖定」整套行為本身在本檔還沒有對應分支，屬於獨立的安全功能移植，非本次「补真寄信」範圍，
// 留待後續排入（見任務回報）。
// Email 驗證碼後備第二因素：決策/驗證在 auth/local.js（純 DB，不觸網），本檔負責在
// kind:'email_otp_required' 時實際寄信（比照 v166 登入通知信的既有分工）——見下方 sessionStart
// 內的 emailOtpCode 分支。
'use strict';

const vdrive = require('../storage/vdrive');
const sessionAuth = require('../auth/session');
const local = require('../auth/local');
const deviceTrust = require('../auth/deviceTrust');
const gate = require('../authz/gate');
const loginNotify = require('../mail/loginNotify');
const emailOtpMail = require('../mail/emailOtp');
const mailer = require('../mail/mailer');

const SESSIONS_PATH = 'sessions.json';
const MAX_SESSIONS_PER_USER = 15;
const RETENTION_DAYS = 45;

function readSessionsData(db, ctx) {
  try {
    const { data } = vdrive.readJson(db, SESSIONS_PATH, ctx);
    if (data && Array.isArray(data.sessions)) return data;
  } catch (_e) { /* 檔不存在，稍後建立 */ }
  return { sessions: [] };
}

function appendSessionRecord(db, ctx, rec) {
  const data = readSessionsData(db, ctx);
  data.sessions.push(rec);
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  data.sessions = data.sessions.filter((s) => s && s.issuedAtMs && s.issuedAtMs >= cutoff);
  data.sessions.sort((a, b) => (b.issuedAtMs || 0) - (a.issuedAtMs || 0));
  const perUser = {};
  const kept = [];
  data.sessions.forEach((s) => {
    const e = s.email || '';
    perUser[e] = (perUser[e] || 0) + 1;
    if (perUser[e] <= MAX_SESSIONS_PER_USER) kept.push(s);
  });
  data.sessions = kept;
  vdrive.updateJson(db, SESSIONS_PATH, data, ctx);
}

function readConfigUsers(db, ctx) {
  try {
    const { data } = vdrive.readJson(db, 'config.json', ctx);
    return (data && data.users) || null;
  } catch (_e) {
    return null;
  }
}

// 回傳 { kind: 'invalid_credentials' | 'totp_required' | 'invalid_totp' | 'email_otp_sent' |
//        'invalid_email_otp' | 'email_otp_unavailable' | 'otp_emails_required' |
//        'too_many_otp_emails' | 'invalid_otp_email' | 'unauthorized' | 'ok',
//        ...(email_otp_sent 時附 resent；ok 時附 sessionToken/exp/email/mailSent/totpEnrolled/
//        newDeviceToken?) }
// totp_required／invalid_totp／email_otp_sent／invalid_email_otp 只在密碼已驗證正確時才會出現
// （見 local.verifyLocalCredentialsDetailed 的 kind 語意註解）——帳密錯誤一律回 invalid_credentials，
// 不洩漏帳密是否正確以外的資訊。
//
// Phase 3b 信任裝置：deviceToken（由 index.js 從 Cookie header 注入 payload，見該檔頭註解）若為
// 該帳號目前有效的裝置憑證，等同第二因素（TOTP／Email 驗證碼皆算）已滿足——密碼正確、本次未附
// otp/emailOtp 的情境（即原本會回 totp_required／email_otp_required）改為直接放行，且不會觸發
// email 寄送（見下方判斷順序：deviceValid 短路發生在寄信分支之前）。deviceDays＝
// config.TRUSTED_DEVICE_DAYS。
//
// config：整包 config 物件（見 src/config.js），本函式取用 SESSION_SECRET／TRUSTED_DEVICE_DAYS／
// MAIL_SEND_CREDS（經 mailer.sendMail 間接使用）／GC_CALENDAR_NAME（經 loginNotify.mailEnvPrefix
// 間接使用）——改用整包物件而非逐一列參數，避免每新增一個寄信/決策所需的 config 欄位就要再加一個
// 位置參數。
async function sessionStart(db, { email, password, otp, emailOtp, switchToEmailOtp, otpEmails, ua, ip, geo, cc, deviceToken }, ctx, config) {
  const secret = config.SESSION_SECRET;
  const deviceDays = config.TRUSTED_DEVICE_DAYS;
  const revokedBefore = sessionAuth.getRevokedBefore(db, email);
  const deviceValid = !!(email && deviceToken
    && deviceTrust.verifyDeviceToken(db, deviceToken, email, revokedBefore, deviceDays));

  let authResult = await local.verifyLocalCredentialsDetailed(db, email, password, otp, emailOtp, switchToEmailOtp === true, otpEmails);
  if ((authResult.kind === 'totp_required' || authResult.kind === 'email_otp_required') && deviceValid) {
    // 裝置信任放行：比照一般登入成功重置鎖定計數（verifyLocalCredentialsDetailed 在
    // totp_required/email_otp_required 分支不會呼叫內部的 registerSuccess，見
    // local.registerLoginSuccess 註解）。email_otp_required 分支即使已經在 local.js 內產生/存了
    // 新碼（issueEmailOtp），這裡短路後也不會寄出（下方寄信邏輯只在 kind 仍為
    // 'email_otp_required' 時才會跑到）——多存一個當下用不到的雜湊碼是無害的，下次真的需要
    // Email 驗證碼時仍會依 60 秒冷卻規則決定是否要重新產生。
    local.registerLoginSuccess(db, email);
    authResult = { kind: 'ok', email, totpEnrolled: authResult.totpEnrolled };
  }

  // Email 驗證碼待寄送：local.js 不觸網，只決定「要不要寄、寄什麼碼、寄給誰」（見
  // emailOtpCode/resent/emailOtpRecipients），這裡才是真正呼叫 mailer 觸網寄信的地方（比照 v166
  // 登入通知信的既有分工）。收件清單 1~3 個地址各自收一封同樣內容的信（不是同一封信塞多個 To），
  // 逐一呼叫 mailer.sendMail——只要至少一個地址寄成功就視為「寄出去了」（best-effort：使用者只要
  // 有一個信箱收得到就能完成登入，不因其中一個信箱設定有誤就整體卡死；全部失敗才回
  // email_otp_unavailable）。
  if (authResult.kind === 'email_otp_required') {
    if (authResult.emailOtpCode) {
      const envPrefix = loginNotify.mailEnvPrefix(config);
      const { subject, textBody } = emailOtpMail.buildEmailOtpMail({
        code: authResult.emailOtpCode, nowMs: Date.now(), envPrefix,
      });
      const recipients = (authResult.emailOtpRecipients && authResult.emailOtpRecipients.length)
        ? authResult.emailOtpRecipients : [authResult.email]; // 防禦性 fallback，理論上 local.js 已保證非空
      let anySent = false;
      for (const to of recipients) {
        const sendResult = await mailer.sendMail(config, db, { to, subject, textBody }, {
          email: authResult.email, action: 'sessionStart.emailOtpMail',
        });
        if (sendResult && sendResult.mailSent) anySent = true;
      }
      if (!anySent) {
        // 全部地址都寄不出（憑證未設定／Gmail API 失敗）：使用者永遠等不到碼，如實回報而非讓他們枯等。
        return { kind: 'email_otp_unavailable' };
      }
    }
    return { kind: 'email_otp_sent', resent: !!authResult.resent };
  }

  if (authResult.kind !== 'ok') return { kind: authResult.kind };
  const authedEmail = authResult.email;

  const users = readConfigUsers(db, ctx);
  if (!gate.authzDecision(users, authedEmail)) return { kind: 'unauthorized' };

  const issued = sessionAuth.issueSessionToken(authedEmail, secret);
  const uaStr = String(ua || '').slice(0, 200) || '（未提供）';
  const ipStr = String(ip || '').slice(0, 64);
  const geoStr = String(geo || '').slice(0, 120);
  const ccStr = String(cc || '').slice(0, 8);

  // v166 異常偵測＋寄信：對映 dev/Code.gs sessionsAppendRecordWithMailDecision_（L784-828）——
  // 依該帳號既有登入紀錄（history）判斷本次是否需寄送通知信，決策/組信/寄送任一步驟失敗都不可
  // 阻斷登入（GAS 版整段包在 try/catch 內，Logger.log 後繼續往下走）。
  let mailSent = false;
  let mailReason = '';
  try {
    const history = readSessionsData(db, ctx).sessions.filter((s) => s && s.email === authedEmail);
    const nowSec = Math.floor(Date.now() / 1000);
    const decision = loginNotify.loginMailDecision(history, uaStr, ipStr, geoStr, nowSec);
    mailReason = decision.reason || '';
    if (decision.mail) {
      const envPrefix = loginNotify.mailEnvPrefix(config);
      const { subject, textBody } = loginNotify.buildLoginNotifyMail({
        ua: uaStr, ip: ipStr, geo: geoStr, reason: decision.reason, nowMs: Date.now(), envPrefix,
      });
      const sendResult = await mailer.sendMail(config, db, { to: authedEmail, subject, textBody }, {
        email: authedEmail, action: 'sessionStart.loginMail',
      });
      mailSent = !!(sendResult && sendResult.mailSent);
    }
  } catch (_e) { /* 異常偵測決策/寄信失敗不阻斷登入 */ }

  try {
    appendSessionRecord(db, ctx, {
      jti: issued.jti, email: authedEmail,
      ua: uaStr, ip: ipStr, geo: geoStr, cc: ccStr,
      iat: issued.iat, exp: issued.exp,
      issuedAtMs: Date.now(), issuedAt: new Date().toISOString(),
      mailSent, mailReason,
    });
  } catch (_e) { /* 登入紀錄寫入失敗不阻斷登入，同 GAS 版行為 */ }

  // 裝置憑證：既有裝置有效則沿用（verifyDeviceToken 已順手更新 last_seen_at），否則視為新裝置／
  // 無痕首登／裝置信任已過期／已被撤銷／尚未註冊 TOTP 的帳號首次登入，一律簽發新憑證——
  // 未註冊 TOTP 的帳號簽發裝置 cookie 目前無實際「免 TOTP」效果，但簽發本身無害；刻意選擇單一
  // 路徑（不為「已註冊/未註冊 TOTP」分岔兩套簽發邏輯），實作與後續維護都更簡單（見任務回報）。
  let newDeviceToken;
  if (!deviceValid) {
    const issuedDevice = deviceTrust.issueDevice(db, authedEmail, ua);
    newDeviceToken = issuedDevice.cookieValue;
  }

  return {
    kind: 'ok', sessionToken: issued.token, exp: issued.exp, email: authedEmail, mailSent,
    totpEnrolled: !!authResult.totpEnrolled,
    ...(newDeviceToken ? { newDeviceToken } : {}),
  };
}

function sessionLogout(db, userEmail) {
  sessionAuth.revokeAllDevices(db, userEmail);
  return { ok: true };
}

function listMySessions(db, userEmail, params, ctx) {
  const data = readSessionsData(db, ctx);
  const revokedBefore = sessionAuth.getRevokedBefore(db, userEmail);
  const nowSec = Math.floor(Date.now() / 1000);
  const curJti = String((params && params.currentJti) || '');
  const mine = data.sessions.filter((s) => s && s.email === userEmail);
  mine.sort((a, b) => (b.issuedAtMs || 0) - (a.issuedAtMs || 0));
  mine.forEach((s) => {
    s.expired = Number(s.exp) <= nowSec;
    s.revoked = !!(revokedBefore && Number(s.iat) < Number(revokedBefore));
    s.active = !s.expired && !s.revoked;
    s.current = !!(curJti && s.jti === curJti);
  });
  return { sessions: mine };
}

module.exports = { sessionStart, sessionLogout, listMySessions, readConfigUsers };
