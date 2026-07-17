// server/src/dispatch.js — 閘門管線＋ACTION_TABLE，1:1 對映 dev/Code.gs doPost（L27-208）。
// 閘門順序（與 GAS 版相同的先後次序，差異見各段註解）：
//   1. token 解析（無 token 僅 sessionStart 走本地認證，其餘回 Session expired）
//   2. rootFolderId → ctx（Node 版單一 root，見 authz/gate.js 檔頭註解）
//   3. 授權閘（isAuthorizedUser_ 對映：AUTHZ_EXEMPT 之外，email 須在 vdrive config.json 的
//      users 且未停用；sessionStart 由 actions/session.js 內部自行判斷，不重複走此閘）
//   4. admin/細部閘（config.json 整檔寫入保護、ROOT_GUARDED、query 白名單）
//   5. ACTION_TABLE 分派；日曆 7 個 action 已實作（走 actions/sync/gcSync.js＋本機 Calendar REST，
//      見 CALENDAR_SYNC_CREDS）；npust5 信件解析 4 個 action 已實作（fetchMentalLeaves/
//      clearMentalLeaves 走 actions/mail.js＋本機 Gmail REST，getNpust5AuthUrl/exchangeNpust5OAuthCode
//      回固定業務錯誤，見 NPUST5_WEB_AUTH_RETIRED_MSG）；其餘未實作 action → 明確業務錯誤
// 每個請求無論成功/拒絕/例外都寫一筆 audit_log（見 audit.js，content 類參數只記長度）。
'use strict';

const envelope = require('./envelope');
const vdrive = require('./storage/vdrive');
const sessionAuth = require('./auth/session');
const gate = require('./authz/gate');
const proxy = require('./actions/proxy');
const audit = require('./audit');
const sessionActions = require('./actions/session');
const trustedDeviceActions = require('./actions/trustedDevices');
const totpSetupActions = require('./actions/totpSetup');
const twofaActions = require('./actions/twofa');
const storageActions = require('./actions/storage');
const commitActions = require('./actions/commit');
const mailActions = require('./actions/mail');
const gcSync = require('./sync/gcSync');
const clockBridge = require('./actions/clockBridge');
const adminUsersActions = require('./actions/adminUsers');
const passwordActions = require('./actions/password');

// npust5 Gmail 網頁 OAuth 授權流程在 Node 版已被伺服器端憑證檔（GMAIL_SYNC_CREDS）取代，
// getNpust5AuthUrl／exchangeNpust5OAuthCode 一律回這則固定業務錯誤（不再導向 Google 同意頁）。
const NPUST5_WEB_AUTH_RETIRED_MSG = '本地後端改用伺服器端憑證檔，毋需網頁授權';

// 帳號發放與管理（migration 005）：帳號改由管理者用 adminCreateLocalAccount 建立，
// submitUserApplication 申請流程退場，一律回這則固定業務錯誤（見下方於身分解析之前的短路判斷，
// 與 gate.AUTHZ_EXEMPT 的取捨說明）。
const SUBMIT_USER_APPLICATION_RETIRED_MSG = '帳號由管理者建立，請洽中心管理者';

const STORAGE_ACTIONS = new Set([
  'readJson', 'updateJson', 'readJsonById', 'updateContentById',
  'createJson', 'getMetadata', 'listFolder', 'query', 'startupBatch',
]);

// Phase 1.5：厚 commit 類 action（見 actions/commit.js），皆為併發安全的鎖內讀-改-寫。
const COMMIT_ACTIONS = new Set([
  'casesUpsert', 'attendanceCommit', 'bookingsCommit', 'listCommit', 'notifCommit',
]);

function getConfigUsersSafe(db, ctx) {
  try {
    const { data } = vdrive.readJson(db, 'config.json', ctx);
    return (data && data.users) || null;
  } catch (_e) {
    return null;
  }
}

function getConfigFileIdSafe(db, ctx) {
  try {
    return vdrive.resolvePathToId(db, 'config.json', ctx);
  } catch (_e) {
    return null;
  }
}

// 主入口：payload 為 doPost 收到的整個 JSON 物件（已由 index.js 從 urlencoded/JSON body 解出）。
async function handleRequest(db, config, payload) {
  const t0 = Date.now();
  const { sessionToken, action, rootFolderId, ...params } = payload || {};
  let outcomeEmail = null;
  let outcome = 'ok';
  let responseEnvelope;
  let strippedNote = ''; // R1 caseAuthz shadow 模式：本應剝除幾筆的稽核備註（見下方 onShadowStrip）

  try {
    // exchangeNpust5OAuthCode：GAS 版不需要 idToken/sessionToken（code 本身即為授權證明），故沿用
    // 同樣「不吃身分/授權閘」的位置；Node 版已改用伺服器端憑證檔（GMAIL_SYNC_CREDS），此網頁授權
    // 流程整個退場，直接回固定業務錯誤。
    if (action === 'exchangeNpust5OAuthCode') {
      outcome = 'denied';
      responseEnvelope = envelope.bizError(NPUST5_WEB_AUTH_RETIRED_MSG);
      return responseEnvelope;
    }

    // submitUserApplication：帳號改由管理者建立（adminCreateLocalAccount），此申請流程退場。
    // 刻意在身分解析（步驟 1）之前短路——若只是把 action 留在 gate.AUTHZ_EXEMPT、仰賴步驟 3 的
    // 授權閘放行，未登入呼叫仍會在步驟 1（無 sessionToken 且 action !== 'sessionStart'）被擋下
    // 回「Session expired」，讓本來就不該有帳號的訪客看到一句誤導的「請重新登入」；短路在此讓
    // 未登入呼叫也能看到這句真正有用的訊息（比照 exchangeNpust5OAuthCode／getNpust5AuthUrl 的固定
    // 業務錯誤退場寫法）。因此本 action 已從 gate.AUTHZ_EXEMPT 移除——留著也是死碼，永遠不會走到。
    if (action === 'submitUserApplication') {
      outcome = 'denied';
      responseEnvelope = envelope.bizError(SUBMIT_USER_APPLICATION_RETIRED_MSG);
      return responseEnvelope;
    }

    // ── 1. 身分解析 ──────────────────────────────────────────────────────────
    let userEmail = null;
    let jti = null;
    if (sessionToken) {
      const decoded = sessionAuth.verifySessionToken(sessionToken, config.SESSION_SECRET);
      if (!decoded) {
        outcome = 'denied';
        return envelope.bizError('Session expired');
      }
      const revokedBefore = sessionAuth.getRevokedBefore(db, decoded.e);
      if (revokedBefore && Number(decoded.iat) < Number(revokedBefore)) {
        outcome = 'denied';
        return envelope.bizError('Session expired');
      }
      userEmail = decoded.e;
      jti = decoded.jti;
      outcomeEmail = userEmail;
      // sessionStart 只收本地帳密：不允許拿舊 session 換新 session（每日重登為設計目標）。
      if (action === 'sessionStart') {
        outcome = 'denied';
        return envelope.bizError('Session expired');
      }
    } else if (action !== 'sessionStart') {
      // 無 token 且非 sessionStart → 一律視為憑證過期（業務級，前端會自動重登重試）。
      outcome = 'denied';
      return envelope.bizError('Session expired');
    }

    // ── 2. rootFolderId → ctx（單一 root：必須等於 .env 設定的 ROOT_FOLDER_ID，不符即拒絕）──
    if (rootFolderId && rootFolderId !== config.ROOT_FOLDER_ID) {
      outcome = 'denied';
      return envelope.bizError('Unauthorized rootFolderId');
    }
    const ctx = { root: config.ROOT_FOLDER_ID };

    // ── sessionStart：本地帳密＋TOTP／Email 驗證碼認證＋授權閘（在 actions/session.js 內部一次
    //      做完）── totp_required／invalid_totp 對映前端 TOTP 欄位顯示（見 login.html）：
    //      totp_required＝帳密正確但該帳號選用 TOTP、本次未附 otp（前端滑出輸入框重送）；
    //      invalid_totp＝已附但錯誤。email_otp_sent／invalid_email_otp／email_otp_unavailable
    //      為 Email 驗證碼後備第二因素的對應三態（見 actions/session.js 檔頭註解）——
    //      email_otp_sent 不是「錯誤」而是請求中間態，比照 totp_required 的模式回 bizError，
    //      額外帶 resent 供前端判斷要不要重置 60 秒倒數計時器（見 login.html）。
    if (action === 'sessionStart') {
      const result = await sessionActions.sessionStart(db, params, ctx, config);
      outcomeEmail = params.email || null;
      if (result.kind === 'invalid_credentials') {
        outcome = 'denied';
        return envelope.bizError('invalid_credentials');
      }
      // 帳號發放與管理（migration 005）：首登強制改密碼——password_change_required＝密碼正確但
      // 還沒改過初始密碼（未附 newPassword）；weak_new_password＝附了 newPassword 但未通過政策
      // 檢查（見 auth/local.js validateNewPassword），reason 一併帶出供 login.html 對映中文訊息。
      if (result.kind === 'password_change_required') {
        outcome = 'denied';
        return envelope.bizError('password_change_required');
      }
      if (result.kind === 'weak_new_password') {
        outcome = 'denied';
        return envelope.bizError('weak_new_password:' + result.reason);
      }
      if (result.kind === 'totp_required') {
        outcome = 'denied';
        return envelope.bizError('totp_required');
      }
      if (result.kind === 'invalid_totp') {
        outcome = 'denied';
        return envelope.bizError('invalid_totp');
      }
      if (result.kind === 'email_otp_sent') {
        outcome = 'denied';
        return envelope.bizError('email_otp_sent', { resent: !!result.resent });
      }
      if (result.kind === 'invalid_email_otp') {
        outcome = 'denied';
        return envelope.bizError('invalid_email_otp');
      }
      if (result.kind === 'email_otp_unavailable') {
        outcome = 'denied';
        return envelope.bizError('email_otp_unavailable');
      }
      // switchToEmailOtp 生效時 otpEmails 未通過正規化（見 auth/local.js normalizeOtpEmails）——
      // 與 twofaSetMethod('email', emails) 共用同一套三種 error 代碼。
      if (result.kind === 'otp_emails_required' || result.kind === 'too_many_otp_emails' || result.kind === 'invalid_otp_email') {
        outcome = 'denied';
        return envelope.bizError(result.kind);
      }
      if (result.kind === 'unauthorized') {
        outcome = 'denied';
        return envelope.bizError('Unauthorized user');
      }
      outcomeEmail = result.email;
      // newDeviceToken（若有）由 index.js 剝除轉為 Set-Cookie，不落 JSON 回應/log（機密紀律）。
      return envelope.ok({
        sessionToken: result.sessionToken, exp: result.exp, email: result.email,
        mailSent: result.mailSent, totpEnrolled: result.totpEnrolled,
        ...(result.newDeviceToken ? { newDeviceToken: result.newDeviceToken } : {}),
      });
    }

    // ── 3. 授權閘（AUTHZ_EXEMPT={ping, submitUserApplication, sessionStart} 之外，
    //      email 須在 vdrive config.json 的 users 且未停用）──
    if (!gate.AUTHZ_EXEMPT[action]) {
      const users = getConfigUsersSafe(db, ctx);
      if (!gate.authzDecision(users, userEmail)) {
        outcome = 'denied';
        return envelope.bizError('Unauthorized user');
      }
    }

    // ── 4a. admin-only actions（deleteFile/moveFile；Phase 1 骨架未實作，仍保留閘門順序）──
    if (gate.ADMIN_ONLY_ACTIONS[action]) {
      const users = getConfigUsersSafe(db, ctx);
      if (!gate.adminDecision(users, userEmail)) {
        outcome = 'denied';
        return envelope.bizError('Forbidden: admin only');
      }
    }

    // ── 4a-1b. shareCalendarWriters：管理者可授權/撤銷任何人；非管理者僅能對「自己」（自助日曆連結，
    //      專任諮商師亦適用，非僅管理者），杜絕非管理者把日曆編輯權授予任意 email。對映 GAS doPost (b)。──
    if (action === 'shareCalendarWriters') {
      const users = getConfigUsersSafe(db, ctx);
      if (!gate.adminDecision(users, userEmail) && !gate.shareToSelfOnly(params.emails, userEmail)) {
        outcome = 'denied';
        return envelope.bizError('Forbidden: non-admin may only share to self');
      }
    }

    // ── 4a-2. clearMentalLeaves：清空 mental_leaves.json（破壞性）；限 admin 或身心調適假窗口聯絡人
    //      （config.json 該使用者 isMentalLeaveContact === true）。對映 GAS doPost (c)（L108-114）。──
    if (action === 'clearMentalLeaves') {
      const users = getConfigUsersSafe(db, ctx);
      if (!gate.adminDecision(users, userEmail)) {
        const u = users && users[userEmail];
        if (!u || u.isMentalLeaveContact !== true) {
          outcome = 'denied';
          return envelope.bizError('Forbidden: admin or mental-leave contact only');
        }
      }
    }

    // ── 4b. config.json 整檔寫入保護：非管理者不得變動 users ──
    const cfgFileId = getConfigFileIdSafe(db, ctx);
    if (gate.isConfigWrite(action, params, cfgFileId)) {
      const users = getConfigUsersSafe(db, ctx);
      if (!gate.adminDecision(users, userEmail)) {
        let oldCfg = null;
        try { oldCfg = vdrive.readJson(db, 'config.json', ctx).data; } catch (_e) { oldCfg = null; }
        if (!gate.configUsersUnchanged(oldCfg, params.content)) {
          outcome = 'denied';
          return envelope.bizError('Forbidden: non-admin config.json write must not modify users; use configSelfPatch/configCasesPatch for user or case-access changes');
        }
      }
    }

    // ── 4c. F3：ROOT_GUARDED（fileId/parentId/folderId 類動作限本次 ctx.root 子樹）──
    const rgKey = gate.ROOT_GUARDED[action];
    if (rgKey && params[rgKey] && !vdrive.isUnderRoot(db, params[rgKey], ctx.root)) {
      outcome = 'denied';
      return envelope.bizError('Forbidden: target outside root');
    }

    // ── 4d. P1：query action 限根 ──
    if (action === 'query' && !gate.queryParentsAllowed(params.q, (id) => vdrive.isUnderRoot(db, id, ctx.root))) {
      outcome = 'denied';
      return envelope.bizError('Forbidden: query must be scoped under root');
    }

    // ── 5. ACTION_TABLE 分派 ──────────────────────────────────────────────────
    const onShadowStrip = (count, label) => { strippedNote = `caseAuthzShadow:${count}@${label}`; };

    let result;
    switch (action) {
      case 'ping': result = { ok: true, email: userEmail }; break;
      case 'sessionLogout': result = sessionActions.sessionLogout(db, userEmail); break;
      case 'listMySessions': result = sessionActions.listMySessions(db, userEmail, params, ctx); break;
      // ── 登入紀錄封存（只封存自己非使用中的紀錄，見 actions/session.js archiveMySessions 檔頭
      //    註解）；自助改密碼（changeMyPassword，見 actions/password.js）——userEmail 皆來自已驗證
      //    session，不吃 params 裡的 email，同上「越權」防線。──
      case 'archiveMySessions': result = sessionActions.archiveMySessions(db, userEmail, params, ctx); break;
      case 'changeMyPassword': result = await passwordActions.changeMyPassword(db, userEmail, params); break;
      // ── 信任裝置清單／逐台撤銷（Phase 3b）：params.deviceToken 由 index.js 從 Cookie header
      //    注入（每個 action 皆有，非 sessionStart 專屬），用於在清單標記「目前這台」。──
      case 'listMyDevices': result = trustedDeviceActions.listMyDevices(db, userEmail, params.deviceToken); break;
      case 'revokeDevice': result = trustedDeviceActions.revokeDevice(db, userEmail, params); break;
      // ── TOTP 註冊／輪替（Phase 3a）：userEmail 來自已驗證 session，不吃 params 裡的 email，
      //    杜絕越權改別人的 2FA 設定。──
      case 'totpSetupStart': result = totpSetupActions.totpSetupStart(db, userEmail); break;
      case 'totpSetupConfirm': result = totpSetupActions.totpSetupConfirm(db, userEmail, params.code); break;
      case 'totpStatus': result = totpSetupActions.totpStatus(db, userEmail); break;
      // ── 第二因素方法選擇（Email 驗證碼後備）：userEmail 一律來自已驗證 session，同上原則。──
      case 'twofaSetMethod': result = twofaActions.twofaSetMethod(db, userEmail, params.method, params.emails); break;
      case 'twofaStatus': result = twofaActions.twofaStatus(db, userEmail); break;
      // ── 帳號發放與管理（migration 005）：twofaSetEmails 為本人一般授權 action（不切換
      //    twofa_method，只更新 otp_emails，見 actions/twofa.js）；其餘 5 個 adminXxx 為管理者專屬，
      //    走 gate.ADMIN_ONLY_ACTIONS 閘門（見上方步驟 4a，非管理者一律 Forbidden，此處不重複判斷）。──
      case 'twofaSetEmails': result = twofaActions.twofaSetEmails(db, userEmail, params.emails); break;
      case 'adminUserAuthGet': result = adminUsersActions.adminUserAuthGet(db, params); break;
      case 'adminCreateLocalAccount': result = await adminUsersActions.adminCreateLocalAccount(db, ctx, params, userEmail); break;
      case 'adminUpdateLocalAccount': result = await adminUsersActions.adminUpdateLocalAccount(db, params, userEmail); break;
      case 'adminResetPassword': result = await adminUsersActions.adminResetPassword(db, params, userEmail); break;
      case 'adminResetTwofa': result = adminUsersActions.adminResetTwofa(db, params, userEmail); break;
      case 'adminListAllSessions': result = adminUsersActions.adminListAllSessions(db, ctx, params); break;
      case 'readJson': result = storageActions.readJson(db, params, ctx, userEmail, config.CASE_AUTHZ_MODE, onShadowStrip); break;
      case 'updateJson': result = storageActions.updateJson(db, params, ctx); break;
      case 'readJsonById': result = storageActions.readJsonById(db, params, ctx, userEmail, config.CASE_AUTHZ_MODE, onShadowStrip); break;
      case 'updateContentById': result = storageActions.updateContentById(db, params); break;
      case 'createJson': result = storageActions.createJson(db, params); break;
      case 'getMetadata': result = storageActions.getMetadata(db, params); break;
      case 'listFolder': result = storageActions.listFolder(db, params); break;
      case 'query': result = storageActions.query(db, params); break;
      case 'startupBatch': result = storageActions.startupBatch(db, params, ctx); break;
      case 'casesUpsert': result = commitActions.casesUpsert(db, params, ctx); break;
      case 'attendanceCommit': result = await commitActions.attendanceCommit(db, params, ctx, config); break;
      case 'bookingsCommit': result = await gcSync.bookingsCommitWithGc(db, params, ctx, config); break;
      case 'listCommit': result = commitActions.listCommit(db, params, ctx); break;
      case 'notifCommit': result = commitActions.notifCommit(db, params, ctx); break;
      case 'fetchMentalLeaves': result = await mailActions.fetchMentalLeaves(db, config, ctx, params); break;
      case 'countMentalLeavesUnprocessed': result = await mailActions.countMentalLeavesUnprocessed(config); break;
      // ── 打卡權杖管理（Phase 2c）：橋接轉發至 GAS（打卡系統永久留 GAS＋Drive，簽發/停用只能由
      //    GAS 執行——權杖用 GAS 的 SESSION_SECRET 簽、登記檔在 Drive）。本地授權閘（上方步驟 3）
      //    已確認 userEmail 在 config.users 且未停用；角色閘（_clockTokenAdminGate_）由 GAS 權威
      //    判定，見 actions/clockBridge.js 檔頭。──
      case 'clockTokenIssue':
      case 'clockTokenRevoke':
      case 'clockTokenList':
        result = await clockBridge.forwardClockAction(config, action, userEmail, params); break;
      case 'clearMentalLeaves': result = await mailActions.clearMentalLeaves(db, config, ctx); break;
      case 'getNpust5AuthUrl': {
        outcome = 'denied';
        return envelope.bizError(NPUST5_WEB_AUTH_RETIRED_MSG);
      }
      // ── Phase 2b：日曆同步 7 個 action，改走本機 Calendar REST 直連（src/sync/gcSync.js）。
      //      對映 dev/Code.gs doPost switch L194-200。CALENDAR_SYNC_CREDS 未設定時
      //      gcSync.requireCalendarClient 會 throw，落入外層 catch → envelope.fail（同
      //      fetchMentalLeaves 對 GMAIL_SYNC_CREDS 未設定的處理方式，見 actions/mail.js）。
      case 'createCalendarEvent': result = await gcSync.createGcEvent(gcSync.requireCalendarClient(config), params); break;
      case 'updateCalendarEvent': result = await gcSync.updateGcEvent(gcSync.requireCalendarClient(config), params); break;
      case 'deleteCalendarEvent': result = await gcSync.deleteGcEvent(gcSync.requireCalendarClient(config), params); break;
      case 'listCalendarEvents': result = await gcSync.listGcEventsNormalized(gcSync.requireCalendarClient(config), params); break;
      case 'shareCalendarWriters': result = await gcSync.shareCalendarWriters(gcSync.requireCalendarClient(config), params); break;
      case 'gcAnnotateEvent': result = await gcSync.annotateGcEvent(gcSync.requireCalendarClient(config), params); break;
      case 'getCalendarMeta': result = await gcSync.getCalendarMeta(gcSync.requireCalendarClient(config)); break;
      default: {
        if (proxy.isProxyAction(action)) {
          outcome = 'denied';
          return envelope.bizError(`Not implemented (phase 2 GAS proxy): ${action}`);
        }
        outcome = 'denied';
        return envelope.bizError(`Not implemented on node backend: ${action}`);
      }
    }

    return envelope.ok(result);
  } catch (err) {
    outcome = 'error';
    return envelope.fail(err);
  } finally {
    try {
      const detail = audit.summarizeParams(params) + (strippedNote ? `,${strippedNote}` : '');
      audit.appendAuditLog(db, {
        email: outcomeEmail,
        action: action || '(none)',
        target: params && (params.path || params.file || params.fileId || params.folderId || params.parentId || null),
        outcome,
        latencyMs: Date.now() - t0,
        detail,
      });
    } catch (_auditErr) { /* 稽核寫入失敗不可讓請求失敗 */ }
  }
}

module.exports = { handleRequest, STORAGE_ACTIONS, COMMIT_ACTIONS };
