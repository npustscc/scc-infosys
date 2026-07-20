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
//      回固定業務錯誤，見 NPUST5_WEB_AUTH_RETIRED_MSG）；v201 起 resolveDir/listDir/createFile/
//      trashFile 亦已接線（見下方對應 case 註解）；v202 起 13 個 om* 校內 openmail 收發信 action
//      已接線（見 openmail/actions.js，走一般授權閘，不在 AUTHZ_EXEMPT）；v220 起 9 個 omsv* 學諮
//      伺服器資料夾（信件封存）action 已接線（見 openmail/archive.js，同樣走一般授權閘）；v203 起
//      6 個 sms* 簡訊發送 action 已接線（見 sms/actions.js，三竹 Mitake／Every8D，同樣走一般授權閘）；
//      v207 起 5 個 ft* 新生心理測驗 action 已接線（見 freshmanTest/actions.js，另外過 4a-3
//      freshmanTestDecision 角色閘——管理者或 isFreshmenTestContact 主責）；
//      其餘未實作 action → 明確業務錯誤（deleteFile/moveFile＝刻意不移植的純攻擊面死碼，
//      clockContext/clockPunch＝依定案留在 GAS）；decryptOfficeFile 已接線（見
//      actions/officeDecrypt.js，前端 Excel 匯入／附件上傳解密有密碼的 Office 檔用，走一般授權閘）
// 每個請求無論成功/拒絕/例外都寫一筆 audit_log（見 audit.js，content 類參數只記長度；om*/sms*/ft*
// action 另有專用摘要，見 audit.summarizeParams 的 action 參數）。
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
const attachmentActions = require('./actions/attachments');
const officeDecryptActions = require('./actions/officeDecrypt');
const commitActions = require('./actions/commit');
const mailActions = require('./actions/mail');
const openmailActions = require('./openmail/actions');
const openmailArchive = require('./openmail/archive');
const openmailCredStore = require('./openmail/credStore');
const openmailClient = require('./openmail/client');
const smsActions = require('./sms/actions');
const freshmanTestActions = require('./freshmanTest/actions');
const gcSync = require('./sync/gcSync');
const clockBridge = require('./actions/clockBridge');
const adminUsersActions = require('./actions/adminUsers');
const systemHealthActions = require('./actions/systemHealth');
const passwordActions = require('./actions/password');
const configActions = require('./actions/config');
const sharedIssuesDb = require('./storage/sharedIssuesDb');

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

// v198：issues.json dev/prod 共用（見 storage/sharedIssuesDb.js）呼叫面盤點——前端只會用這 4 個
// action 碰 issues.json（readJson/updateJson/createJson/listCommit，見 dev/index.html
// loadIssues/_saveIssuesFallback/_saveIssues），沒有 by-fileId 存取（readJsonById/
// updateContentById 從未被前端拿來讀寫 issues.json；startupBatch 的 issues 分支另外在
// actions/storage.js 處理，不在此表）。key＝params 內帶檔名的欄位名稱，用來判斷「這次呼叫是不是
// 在動 issues.json」——純檔名比對，不依賴前端送來的 rootFolderId 值是否吻合本環境（見下方
// step 2 的說明）。
const ISSUES_ACTIONS_FILE_PARAM = { readJson: 'path', updateJson: 'path', createJson: 'name', listCommit: 'file' };

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
  // v203：result 提升到函式作用域（而非侷限於下方 try 區塊內）——sms* action 的稽核紀錄需要在
  // finally 區塊內讀出 result.logId（見下方 audit 呼叫），smsSend 的 logId 是回傳值、不是 params
  // 輸入欄位，params-only 的 audit.summarizeParams 拿不到，故改讓 finally 能存取這裡的 result。
  let result;

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

    // v198：本次呼叫是否為「動 issues.json」的四個 action 之一（見上方 ISSUES_ACTIONS_FILE_PARAM
    // 檔頭註解）。純檔名比對，任何 action 皆可能檢出 true/false，與後面 rootFolderId 是否吻合
    // 本環境無關。
    const issuesFileParam = ISSUES_ACTIONS_FILE_PARAM[action];
    const isIssuesFileAction = !!(issuesFileParam && params && params[issuesFileParam] === 'issues.json');

    // ── 2. rootFolderId → ctx（單一 root：必須等於 .env 設定的 ROOT_FOLDER_ID，不符即拒絕）──
    // v198 例外：issues.json 的四個 action。前端沿用 GAS 時代遺留的 ISSUES_FOLDER_ID 常數
    // （實為正式版 Drive 資料夾 id，見 dev/index.html）標記這四個呼叫，在 Node 版單一 root
    // 架構下這個值早已不對應本環境的任何實際資料夾，必然與 config.ROOT_FOLDER_ID 不同（dev 環境
    // 尤其如此——prod 環境的 ROOT_FOLDER_ID 恰好與該常數同值純屬巧合，不能依賴）。這條檢查本身
    // 只是「環境誤連」防呆信號、不是真正的授權邊界（真正邊界是 ctx.root 範圍限制與授權閘：
    // client 只要乾脆不送 rootFolderId 參數就能繞過本檢查，見 `rootFolderId &&` 短路），因此對
    // issues.json 這四個 action 放行不吻合的 rootFolderId 不會擴大攻擊面——是否路由到共用庫
    // 由下方「issues.json 路由」段落純以檔名決定，rootFolderId 的值在那之後不再被使用。
    if (rootFolderId && rootFolderId !== config.ROOT_FOLDER_ID && !isIssuesFileAction) {
      outcome = 'denied';
      return envelope.bizError('Unauthorized rootFolderId');
    }
    const ctx = { root: config.ROOT_FOLDER_ID };

    // ── issues.json 路由（v198）：SHARED_ISSUES_DB 有設定時，這四個 action 改用共用庫的 db
    // handle／ctx；未設定時 issuesDb/issuesCtx 就是原本的 db/ctx，行為與改動前完全一致。
    // createJson 額外覆寫 params.parentId——蓋掉前端送來的 GAS 時代 ISSUES_FOLDER_ID 常數，
    // 改成這次實際要落地的 root，避免下方 4c 的 F3 ROOT_GUARDED 誤判「parentId 不在本環境
    // root 底下」而擋下（該檢查的目的是防止前端指定任意 parentId 逃逸出 root，這裡是伺服器端
    // 自己覆寫、不是前端指定的值，故 4c 對 issues.json 這個分支整段跳過，見下方）。
    const sharedDb = isIssuesFileAction ? sharedIssuesDb.getSharedIssuesDb(config.SHARED_ISSUES_DB) : null;
    const issuesDb = sharedDb || db;
    const issuesCtx = sharedDb ? sharedIssuesDb.SHARED_CTX : ctx;
    if (isIssuesFileAction && action === 'createJson') {
      params.parentId = issuesCtx.root;
    }

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
        twofaMethod: result.twofaMethod || null, loginName: result.loginName || null,
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

    // ── 4a-3. 新生心理測驗（ft*，v207）：管理者或 config.json 該使用者 isFreshmenTestContact===true
    //      （新生心理測驗主責）。所有 ft* action 一律走本閘（見 authz/gate.js freshmanTestDecision）——
    //      比照 4a-2 clearMentalLeaves 的角色特定閘門寫法，但涵蓋一組 action 前綴而非單一 action 名稱。──
    if (typeof action === 'string' && /^ft[A-Z]/.test(action)) {
      const users = getConfigUsersSafe(db, ctx);
      if (!gate.freshmanTestDecision(users, userEmail)) {
        outcome = 'denied';
        return envelope.bizError('Forbidden: admin or freshman-test contact only');
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
    // issues.json 的 createJson 已在上方「issues.json 路由」段落由伺服器端覆寫 params.parentId
    // （不是前端提供的值），故此處對 isIssuesFileAction 整段跳過，避免誤判。
    const rgKey = gate.ROOT_GUARDED[action];
    if (rgKey && params[rgKey] && !isIssuesFileAction && !vdrive.isUnderRoot(db, params[rgKey], ctx.root)) {
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

    switch (action) {
      case 'ping': result = { ok: true, email: userEmail }; break;
      // ── sessionLogout：登出即清 openmail 記憶體憑證＋關閉快取的 IMAP 連線（v202，見
      //    openmail/credStore.js 檔頭「密碼永不落地、與 session 同壽命」的最高資安要求——顯式登出
      //    不必等到台北午夜自然過期，立即清除）。──
      case 'sessionLogout':
        result = sessionActions.sessionLogout(db, userEmail);
        openmailCredStore.clear(userEmail);
        openmailClient.closeConnection(userEmail);
        break;
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
      case 'adminArchiveSessions': result = adminUsersActions.adminArchiveSessions(db, ctx, params, userEmail); break;
      // adminGetDiskHealth（v221）：讀 root systemd timer 寫出的 SMART 摘要 JSON（唯讀，見
      // actions/systemHealth.js／config.js SMART_STATUS_PATH），不吃 params。
      case 'adminGetDiskHealth': result = systemHealthActions.adminGetDiskHealth(config); break;
      // readJson/updateJson/createJson/listCommit：issuesDb/issuesCtx 已在上方「issues.json 路由」
      // 段落算好——目標檔非 issues.json 時就是原本的 db/ctx（行為不變），是 issues.json 時視
      // SHARED_ISSUES_DB 是否設定而指向共用庫（v198）。
      case 'readJson': result = storageActions.readJson(issuesDb, params, issuesCtx, userEmail, config.CASE_AUTHZ_MODE, onShadowStrip); break;
      case 'updateJson': result = storageActions.updateJson(issuesDb, params, issuesCtx); break;
      case 'readJsonById': result = storageActions.readJsonById(db, params, ctx, userEmail, config.CASE_AUTHZ_MODE, onShadowStrip); break;
      case 'updateContentById': result = storageActions.updateContentById(db, params); break;
      case 'createJson': result = storageActions.createJson(issuesDb, params); break;
      case 'getMetadata': result = storageActions.getMetadata(db, params); break;
      case 'listFolder': result = storageActions.listFolder(db, params); break;
      case 'query': result = storageActions.query(db, params); break;
      case 'startupBatch': result = storageActions.startupBatch(db, params, ctx, config); break;
      // ── v201：移植完整性掃描收尾——resolveDir/listDir/createFile/trashFile 接線（此前四個
      //    action 落到下方 default，前端呼叫端每次都吃 not-implemented 業務錯誤後退回 fallback，
      //    見 dev/index.html getCasesFolderFileMap／_debugLogEnsureFolder／_syslogFlushToDrive／
      //    confirmClearAllCases）。resolveDir/listDir 對映 dev/Code.gs resolveDir_/listDir_
      //    （路徑一律從 ctx.root 起算，不需要 ROOT_GUARDED，見 gate.js 該常數頭註解）；createFile
      //    為 GAS 版從未存在過的新 action（前端呼叫的名稱本就不在 GAS switch 裡，見
      //    actions/storage.js createFile 函式頭），parentId 走 ROOT_GUARDED；trashFile 對映
      //    trashFile_（軟刪除），ROOT_GUARDED 映射（gate.js）早已預留、此處才真正接線。──
      case 'resolveDir': result = storageActions.resolveDir(db, params, ctx); break;
      case 'listDir': result = storageActions.listDir(db, params, ctx); break;
      case 'createFile': result = storageActions.createFile(db, params); break;
      case 'trashFile': result = attachmentActions.trashFile(db, params); break;
      // ── v200：附件 action（見 actions/attachments.js 檔頭，cutover 回歸修補）。createFolder／
      //    uploadFile 已由 gate.ROOT_GUARDED（步驟 4c，見上方）限制 parentId/parentFolderId 須在
      //    本次 ctx.root 子樹；downloadFileBase64 不走 ROOT_GUARDED 簡單黑白名單（GAS 版亦然），
      //    改由 attachments.downloadFileBase64 內部三層查找自行決定是否放行（本庫／PEER_DB 跨環境
      //    附件白名單／Drive 舊附件唯讀 fallback），查無時統一拋「找不到附件」業務錯誤。──
      case 'createFolder': result = attachmentActions.createFolder(db, params); break;
      case 'uploadFile': result = attachmentActions.uploadFile(db, params); break;
      case 'downloadFileBase64': result = await attachmentActions.downloadFileBase64(db, params, ctx, config); break;
      // ── decryptOfficeFile：後端解密有密碼的 Office 檔（xlsx/xls），見 actions/officeDecrypt.js
      //    檔頭註解。走一般授權閘（不在 gate.AUTHZ_EXEMPT，不因為是工具函式而破例免授權——CLAUDE.md
      //    資安原則 1）；不需要 ROOT_GUARDED（不涉及 fileId/parentId，純記憶體內解密，不碰 vdrive）。
      case 'decryptOfficeFile': result = await officeDecryptActions.decryptOfficeFile(params); break;
      // ── v202：校內 openmail 收發信（Openfind Mail2000 V8.00，見 openmail/ 檔頭）。走一般授權閘
      //    （不在 gate.AUTHZ_EXEMPT），userEmail 皆來自已驗證 session（同 twofa/password 類 action
      //    的既有原則，不吃 params 裡的身分欄位）。openmail 帳密只存 openmail/credStore.js 記憶體，
      //    未 omConnect 過或已過期一律回業務錯誤 'mail_not_connected'（見 actions.js withCreds）。──
      case 'omStatus': result = openmailActions.omStatus(userEmail); break;
      case 'omReachable': result = await openmailActions.omReachable(userEmail, config); break;
      case 'omConnect': result = await openmailActions.omConnect(userEmail, config, params); break;
      case 'omDisconnect': result = openmailActions.omDisconnect(userEmail); break;
      case 'omListFolders': result = await openmailActions.omListFolders(userEmail, config); break;
      case 'omListMessages': result = await openmailActions.omListMessages(userEmail, config, params); break;
      case 'omGetMessage': result = await openmailActions.omGetMessage(userEmail, config, params); break;
      case 'omDownloadAttachment': result = await openmailActions.omDownloadAttachment(userEmail, config, params); break;
      case 'omMarkSeen': result = await openmailActions.omMarkSeen(userEmail, config, params); break;
      case 'omFlag': result = await openmailActions.omFlag(userEmail, config, params); break;
      case 'omMove': result = await openmailActions.omMove(userEmail, config, params); break;
      case 'omDelete': result = await openmailActions.omDelete(userEmail, config, params); break;
      case 'omSearch': result = await openmailActions.omSearch(userEmail, config, params); break;
      case 'omSend': result = await openmailActions.omSend(userEmail, config, params); break;
      // ── v220：學諮伺服器資料夾（omsv*，見 openmail/archive.js 檔頭）。信件封存到本系統
      //    sqlite，不佔 openmail 信箱空間。走一般授權閘（不在 gate.AUTHZ_EXEMPT），ownerEmail
      //    皆來自已驗證 session（同 om* 既有原則，不吃 params 裡的身分欄位——archive.js 每條查詢都
      //    帶 owner_email 條件，跨 owner 存取一律「查無」視同拒絕）。omsvArchiveMessage 需要
      //    openmail 憑證抓信，未 omConnect 過或已過期同樣回 'mail_not_connected'（見 credStore）。
      case 'omsvFolderList': result = openmailArchive.omsvFolderList(db, userEmail); break;
      case 'omsvFolderCreate': result = openmailArchive.omsvFolderCreate(db, userEmail, params); break;
      case 'omsvFolderRename': result = openmailArchive.omsvFolderRename(db, userEmail, params); break;
      case 'omsvFolderDelete': result = openmailArchive.omsvFolderDelete(db, userEmail, params); break;
      case 'omsvArchiveMessage': result = await openmailArchive.omsvArchiveMessage(db, userEmail, config, params); break;
      case 'omsvList': result = openmailArchive.omsvList(db, userEmail, params); break;
      case 'omsvGet': result = await openmailArchive.omsvGet(db, userEmail, params); break;
      case 'omsvDownloadAttachment': result = await openmailArchive.omsvDownloadAttachment(db, userEmail, params); break;
      case 'omsvDelete': result = openmailArchive.omsvDelete(db, userEmail, params); break;
      // ── v203：簡訊發送（三竹 Mitake／Every8D，見 src/sms/ 檔頭）。走一般授權閘（不在
      //    gate.AUTHZ_EXEMPT）；userEmail 皆來自已驗證 session（同 om*/twofa/password 類 action的
      //    既有原則，smsSend 寫入 sms_batches.sender_email 用的也是這個已驗證身分，不吃 params 裡的
      //    身分欄位）。三竹/Every8D 帳密只存 server .env（config.js），本檔與 sms/actions.js 皆不
      //    落地、不回傳前端；smsSend/smsCancel 的稽核紀錄刻意不含簡訊內容/收件人門號（見下方 finally
      //    區塊的 sms 專用 target/detail 組法，只記 logId 與筆數）。──
      case 'smsStatus': result = smsActions.smsStatus(config); break;
      case 'smsBalance': result = await smsActions.smsBalance(config, params); break;
      case 'smsSend': result = await smsActions.smsSend(db, config, userEmail, params); break;
      case 'smsListLog': result = smsActions.smsListLog(db, params); break;
      case 'smsQueryStatus': result = await smsActions.smsQueryStatus(db, config, params); break;
      case 'smsCancel': result = await smsActions.smsCancel(db, config, params); break;
      // ── v207：新生心理測驗（ft*，見 freshmanTest/actions.js 檔頭）。走一般授權閘＋上方 4a-3
      //    freshmanTestDecision 專屬閘門；userEmail 皆來自已驗證 session（同 sms*/om* 既有原則）。
      case 'ftListSemesters': result = freshmanTestActions.ftListSemesters(db, ctx); break;
      case 'ftCreateSemester': result = freshmanTestActions.ftCreateSemester(db, params, ctx, userEmail); break;
      case 'ftGetSheet': result = freshmanTestActions.ftGetSheet(db, params, ctx); break;
      case 'ftSaveSchema': result = freshmanTestActions.ftSaveSchema(db, params, ctx, userEmail); break;
      case 'ftSaveRows': result = freshmanTestActions.ftSaveRows(db, params, ctx, userEmail); break;
      // v209：導師名冊「與導師系統同步」——唯讀讀取同機 tutorsys store（見
      // freshmanTest/tutorsysSync.js 白名單），未設定 TUTORSYS_STORE_DIR 時直接讓錯誤往上拋，
      // 走一般 catch 區塊變成業務錯誤（前端據此顯示「未設定」）。
      case 'ftTutorSyncFetch': result = freshmanTestActions.ftTutorSyncFetch(config.TUTORSYS_STORE_DIR); break;
      case 'configSelfPatch': result = configActions.configSelfPatch(db, params, ctx, userEmail); break;
      case 'configCasesPatch': result = configActions.configCasesPatch(db, params, ctx, userEmail, config.CASES_PATCH_AUTHZ_MODE); break;
      case 'casesUpsert': result = commitActions.casesUpsert(db, params, ctx); break;
      case 'attendanceCommit': result = await commitActions.attendanceCommit(db, params, ctx, config); break;
      case 'bookingsCommit': result = await gcSync.bookingsCommitWithGc(db, params, ctx, config); break;
      case 'listCommit': result = commitActions.listCommit(issuesDb, params, issuesCtx); break;
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
      // v203：sms* action 的稽核紀錄刻意不含簡訊內容/收件人門號/姓名（audit.summarizeParams 的
      // sms 分支已處理，見 audit.js summarizeSmsParams），但仍要能對應到 sms_batches 的哪一筆
      // ——smsSend 的 logId 是「回傳值」而非輸入參數，params-only 的 target/detail 組法拿不到，
      // 故這裡額外從 result 補上（smsQueryStatus/smsCancel 的 logId 本就是輸入參數，兩種來源
      // 皆涵蓋）。只記 id 與筆數，不記內容——同 CLAUDE.md 資安原則 3 去識別化。
      const isSmsAction = typeof action === 'string' && /^sms[A-Z]/.test(action);
      const smsLogId = isSmsAction
        ? ((result && result.logId != null) ? result.logId : (params && params.logId != null ? params.logId : null))
        : null;
      const smsResultNote = isSmsAction && result
        ? [
          result.logId != null ? `resultLogId=${result.logId}` : null,
          result.sent != null ? `resultSent=${result.sent}` : null,
          result.canceled != null ? `resultCanceled=${result.canceled}` : null,
        ].filter(Boolean).map((s) => `,${s}`).join('')
        : '';
      // v207：ft* action 修改「非目前最新學期」（歷史學期）時，isHistoricalSemester 已在 ft 業務層
      // 算好並隨結果回傳（見 freshmanTest/actions.js）——標記 historical:true 供日後通知機制掛勾
      // （本切片不做通知，見任務規格第 3 節），不需要在這裡重新讀一次 semesters.json。
      const isFtAction = typeof action === 'string' && /^ft[A-Z]/.test(action);
      const ftHistoricalNote = isFtAction && result && result.historical ? ',historical:true' : '';
      // decryptOfficeFile：只記業務結果分類（probe_encrypted/probe_plain/plain/decrypted/
      // wrong_password/decrypt_failed/file_too_large/invalid_params），不記密碼/檔名/檔案內容
      // ——password 已在 audit.CONFIDENTIAL_KEYS 黑名單、dataBase64 走預設長度摘要（見上方
      // audit.summarizeParams），這裡只補上「這次呼叫的結果是哪一種」供事後稽核判讀。
      const officeOutcomeNote = (action === 'decryptOfficeFile' && result)
        ? `,office_outcome=${result.error
          ? result.error
          : ((params && params.probe === true)
            ? (result.encrypted ? 'probe_encrypted' : 'probe_plain')
            : (result.encrypted ? 'decrypted' : 'plain'))}`
        : '';
      // v220：omsvArchiveMessage 的結果（archivedId／是否成功從 openmail 刪除原信）補記於稽核——
      // 只記 id 與布林值，不記信件主旨/內容（同 CLAUDE.md 資安原則 3 去識別化），供事後追查
      // 「這次封存呼叫是否成功刪除原信」時不必去翻 openmail_archive_messages 表本身。
      const omsvResultNote = (action === 'omsvArchiveMessage' && result && result.ok)
        ? `,archivedId=${result.archivedId},deleted=${!!result.deleted}`
        : '';
      // 2026-07-20 事件：omConnect 業務層成敗（帳密被拒/逾時/不可達）補記於稽核——先前只記
      // 「動作有執行」與 latency，事後只能靠 90 秒延遲反推是逾時。不記帳密本身。
      const omConnectNote = (action === 'omConnect' && result)
        ? `,connect_outcome=${result.error || 'ok'}`
        : '';
      const detail = audit.summarizeParams(params, action) + (strippedNote ? `,${strippedNote}` : '') + smsResultNote + ftHistoricalNote + officeOutcomeNote + omsvResultNote + omConnectNote;
      audit.appendAuditLog(db, {
        email: outcomeEmail,
        action: action || '(none)',
        target: (params && (params.path || params.file || params.fileId || params.folderId || params.parentId || params.parentFolderId))
          || (smsLogId != null ? `smsLog:${smsLogId}` : null) || null,
        outcome,
        latencyMs: Date.now() - t0,
        detail,
      });
    } catch (_auditErr) { /* 稽核寫入失敗不可讓請求失敗 */ }
  }
}

module.exports = { handleRequest, STORAGE_ACTIONS, COMMIT_ACTIONS };
