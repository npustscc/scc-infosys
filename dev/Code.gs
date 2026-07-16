// Code.gs — SCC Drive Proxy（測試版）
// 執行身份：Me (npust.scc)；存取：任何擁有 Google 帳戶
// ⚠️ 此為測試版專用 GAS，只能存取 dev 資料夾，不可存取正式版資料。

const CLIENT_ID      = '68582831293-fecbka17adht886tm6oh18vrdsdg1hbj.apps.googleusercontent.com';
const ROOT_FOLDER_ID = '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx';  // dev 資料夾
const CALENDAR_NAME  = '[DEV] SCC 空間預約';
const CONFIG_FILE_ID_OVERRIDE = null;  // dev 版從 root 路徑查找 config.json

// 白名單：只允許 dev 資料夾
const ALLOWED_ROOTS = {
  '1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx': { configOverride: null, calendarName: '[DEV] SCC 空間預約', gmailLabel: 'ml-processed-dev' },
};

// issues.json（許願池/錯誤回報）dev/prod 共用同一份、固定存於正式版資料夾。
// 前端存取它會帶「非本環境」的 rootFolderId，需一條跨環境例外——但只認這一個固定 ID，
// 絕不接受前端傳入的任意 folderId（否則攻擊者可指向自建資料夾內的假 config.json 洗白授權）。
// 註：此常數 dev/prod 皆為正式版資料夾 ID（兩環境相同），推正式版時不需修改（非環境專屬常數）。
const ISSUES_FOLDER_ID = '1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP';

// 緊急備援名單：即使 config 讀不到或帳號不在名單，這些帳號仍可登入以修復系統（對應前端 BOOTSTRAP_ADMIN_EMAIL）。
// 註：列出 email 不構成後門——仍須持有該帳號的 Google 憑證（有效 ID token）才通過，攻擊者知道 email 也無法冒充。
const BOOTSTRAP_ADMINS = ['npust.scc@heartnpust.tw', 'linkinlol528101@gmail.com'];

// ── 進入點 ────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const payload = JSON.parse(e.parameter.payload);
    const { idToken, sessionToken, clockToken, bridgeKey, action, rootFolderId, ...params } = payload;

    // OAuth2 code exchange 不需要 idToken（code 本身即為授權證明）
    if (action === 'exchangeNpust5OAuthCode') {
      return jsonResp_(exchangeNpust5OAuthCode_(params));
    }

    // 身分解析：優先走自簽 session token（純 HMAC 運算、無外部 HTTP），
    // 其次是打卡權杖（clockToken，見「打卡權杖」章節；scope 極窄，僅供免登入打卡專屬網址使用），
    // 都沒有才走 Google ID token（sessionStart、申請帳號流程、舊前端相容）。
    let userEmail;
    let isClockToken = false; // clockToken 驗證需要 ctx（登記檔位置），延後到 ctx 解出後再做（見下方）
    if (sessionToken) {
      userEmail = verifySessionToken_(sessionToken);
      if (!userEmail) return jsonResp_({ error: 'Session expired' });
      // sessionStart 只收 idToken：不允許拿舊 session 換新 session（每日重登為設計目標）
      if (action === 'sessionStart') return jsonResp_({ error: 'Session expired' });
    } else if (clockToken) {
      isClockToken = true;
    } else if (bridgeKey) {
      // ── 伺服器橋接（Phase 2c，2026-07-16）：本地 Node 伺服器以共享密鑰代表「已在本地通過
      // 帳密＋授權驗證的使用者」呼叫打卡權杖管理 action（切換後同仁無 GAS session，簽發/停用
      // 打卡網址由 Node 轉發至此）。scope 白名單限打卡權杖管理三 action，其餘一律拒絕——
      // 絕不可讓橋接密鑰變成萬用後門。actorEmail 由 Node 伺服器擔保，但仍須通過下方
      // isAuthorizedUser_ 授權閘與各 action 內的 _clockTokenAdminGate_ 硬閘（縱深防禦：
      // 密鑰外洩時攻擊者仍只能以「本就有權簽發的帳號」操作打卡權杖，接觸不到個案資料）。
      if (!verifyBridgeKey_(bridgeKey)) return jsonResp_({ error: 'Unauthorized' });
      if (action !== 'clockTokenIssue' && action !== 'clockTokenRevoke' && action !== 'clockTokenList') {
        return jsonResp_({ error: 'Forbidden: bridge key scope' });
      }
      userEmail = String(params.actorEmail || '');
      if (!userEmail) return jsonResp_({ error: 'Unauthorized' });
    } else {
      userEmail = verifyIdToken_(idToken);
      if (!userEmail) return jsonResp_({ error: 'Unauthorized' });
    }

    // 根據前端傳入的 rootFolderId 決定此次請求的資料根目錄與日曆名稱
    let ctx = { root: ROOT_FOLDER_ID, configOverride: CONFIG_FILE_ID_OVERRIDE, calendarName: CALENDAR_NAME };
    if (rootFolderId) {
      if (ALLOWED_ROOTS[rootFolderId]) {
        const rootCfg = ALLOWED_ROOTS[rootFolderId];
        ctx = { root: rootFolderId, configOverride: rootCfg.configOverride, calendarName: rootCfg.calendarName || CALENDAR_NAME, gmailLabel: rootCfg.gmailLabel || 'ml-processed-dev' };
      } else {
        // 例外白名單：issues.json (許願池/錯誤回報) 允許跨環境（dev/prod 共用同一份）。
        // 僅接受固定的 ISSUES_FOLDER_ID，不接受任意 folderId——否則攻擊者可把 ctx.root
        // 指向自建資料夾內的假 config.json 來洗白授權（見 isAuthorizedUser_ 現改為只讀本環境固定 config）。
        // params.file：listCommit 專用參數名（見 listCommit_）
        const p = params.path || params.name || params.file || '';
        if (!issuesExceptionAllowed_(rootFolderId, p, ISSUES_FOLDER_ID)) return jsonResp_({ error: 'Unauthorized rootFolderId' });
        ctx = { root: rootFolderId, configOverride: null, calendarName: CALENDAR_NAME };
      }
    }

    // ── 打卡權杖二階段驗證：ctx（登記檔 clock_tokens.json 所在 root）解出後才能比對 jti ──
    // verifyClockToken_ 內會重驗簽章/scope('s'==='clock')/效期，再比對登記檔內該 email 目前登記的
    // jti 是否相符——重新產生／停用會覆寫或刪除登記，舊權杖即使簽章/效期仍合法也會在此被擋下。
    if (isClockToken) {
      userEmail = verifyClockToken_(clockToken, ctx);
      if (!userEmail) return jsonResp_({ error: 'Unauthorized' });
    }

    // ── 打卡權杖 action 白名單：只允許 clockContext／clockPunch，其餘一律拒絕（含 ping/sessionStart
    // 等全部）。這是打卡權杖唯一的權限邊界——絕不可讓它經由任何其他 action 讀寫非打卡資料。
    if (isClockToken && action !== 'clockContext' && action !== 'clockPunch') {
      return jsonResp_({ error: 'Forbidden: clock token scope' });
    }

    // ── 使用者授權閘：email 必須存在於 config.users 且未停用（少數 action 例外）──
    // 修補重大漏洞：先前僅驗證 ID token 對 CLIENT_ID 有效，未比對授權名單，導致任何 Google 帳號
    // 皆可用公開的 CLIENT_ID / APPS_SCRIPT_URL / rootFolderId 直接撈取或竄改全部個案資料。
    // ping（探測）與 submitUserApplication（尚未獲授權者申請帳號的唯一入口）需在授權前放行。
    var AUTHZ_EXEMPT = { ping: true, submitUserApplication: true };
    if (!AUTHZ_EXEMPT[action] && !isAuthorizedUser_(userEmail)) {
      return jsonResp_({ error: 'Unauthorized user' });
    }

    // ── P0-3：敏感動作後端硬閘（前端 UI 隱藏不算數，攻擊者可直呼公開 API）──
    // (a) 純攻擊面：前端從未使用（deleteFile/moveFile），一律限 admin。
    // 註：dumpNpust5Emails／listInboxEmails（信件傾印/列表）已於 F5 從 switch 移除、不可達，
    // 移出本白名單（留著也無害，但避免誤導成「仍可由 admin 呼叫」）。
    var ADMIN_ONLY_ACTIONS = { deleteFile: true, moveFile: true };
    if (ADMIN_ONLY_ACTIONS[action] && !isAdminUser_(userEmail)) {
      return jsonResp_({ error: 'Forbidden: admin only' });
    }
    // (b) shareCalendarWriters：管理者可授權/撤銷任何人；非管理者僅能對「自己」（自助日曆連結，
    //     專任諮商師亦適用，非僅管理者），杜絕非管理者把日曆編輯權授予任意 email。
    if (action === 'shareCalendarWriters' && !isAdminUser_(userEmail)
        && !shareToSelfOnly_(params.emails, userEmail)) {
      return jsonResp_({ error: 'Forbidden: non-admin may only share to self' });
    }
    // (c) clearMentalLeaves：清空 mental_leaves.json（破壞性）；限 admin 或身心調適假窗口。
    if (action === 'clearMentalLeaves' && !isAdminUser_(userEmail)) {
      var _mlEntry = (localConfigUsers_() || {})[userEmail];
      if (!_mlEntry || _mlEntry.isMentalLeaveContact !== true) {
        return jsonResp_({ error: 'Forbidden: admin or mental-leave contact only' });
      }
    }

    // ── P0-2→v164：config.json 整檔寫入的授權面保護，收斂為「非管理者不得變動 users」──
    // 沿革：P0-2 原本用 diff 比對放行 allowedCases/allowedCasesSems/extraRole 子集變動（字面上
    // 仍是「整檔覆寫」，只是覆寫內容受限）——非管理者仍可能在 diff 檢查的縫隙夾帶自授個案存取權、
    // 覆寫他人併發變動、或把讀到寫之間別人的異動蓋回。v164 前端七個原本會整檔覆寫 config 的
    // 非管理者流程（主責新增/移除個管員、每學期範圍切換、初談自動列管、新學期繼承、案號改名
    // remap、本人 Gmail 遷移、轉銜窗口自填新增輔導人員）已全部改走 configSelfPatch（自助欄位）／
    // configCasesPatch（個案存取授權，LockService 鎖內宣告式合併），因此非管理者的整檔寫入請求
    // 現在「users 物件應與後端當下最新版完全相同」——只要 users 有任何差異就整批拒絕（不比對
    // 個別欄位，杜絕字面 diff 檢查的縫隙；fail-closed，即使前端漏改也不會退化回整檔覆寫風險）。
    // config.json 同時裝非授權的全域共用設定（自訂選項清單／家系圖自訂元件等，非管理者本就合法
    // 會寫），這類不動 users 的寫入不受影響，避免無謂波及既有功能。
    // 管理者（isAdminUser_）維持整檔寫入權限不變（權限管理頁、合併遷移引擎等 admin-only 流程）。
    if (!isAdminUser_(userEmail) && isConfigWrite_(action, params, localConfigFileId_())) {
      if (!_configUsersUnchanged_(readConfigFresh_(), params.content)) {
        return jsonResp_({ error: 'Forbidden: non-admin config.json write must not modify users; use configSelfPatch/configCasesPatch for user or case-access changes' });
      }
    }

    // ── F3：fileId/parentId 類動作限制在本次 ctx.root 子樹（杜絕以任意 fileId 越界讀寫/刪除 Drive 檔案）──
    // 只保護「目標必在本地 root」的 JSON 資料/破壞性/資料夾動作；downloadFileBase64（附件，含跨環境
    // issue 附件）與 query（枚舉）另設計如下（P1）。fileId 類動作不會走 issues.json 例外，
    // 故此處 ctx.root 恆為本地 root。
    var ROOT_GUARDED = { readJsonById: 'fileId', updateContentById: 'fileId', deleteFile: 'fileId',
      moveFile: 'fileId', trashFile: 'fileId', getMetadata: 'fileId', createFolder: 'parentId',
      createJson: 'parentId', uploadFile: 'parentFolderId', listFolder: 'folderId' };
    var _rgKey = ROOT_GUARDED[action];
    if (_rgKey && params[_rgKey] && !isUnderRoot_(params[_rgKey], ctx.root)) {
      return jsonResp_({ error: 'Forbidden: target outside root' });
    }

    // ── P1：moveFile 目的地（addParents）也須在 root 子樹 ──
    // 上面 ROOT_GUARDED 已限制來源 fileId，但目的地資料夾未檢查，攻擊者可把檔案移出 root 子樹
    // （即使 moveFile 目前限 admin，仍應 defense-in-depth：管理者帳號被盜用時降低災害範圍）。
    if (action === 'moveFile' &&
        !moveFileDestAllowed_(params.addParents, function (id) { return isUnderRoot_(id, ctx.root); })) {
      return jsonResp_({ error: 'Forbidden: destination outside root' });
    }

    // ── P1：downloadFileBase64 跨 root 附件白名單 ──
    // 目標在本地 root 之下 → 直接放行；否則附件可能是「在其他環境上傳、記錄於跨環境共用的
    // issues.json」——只有當此 fileId 確實出現在某筆 issue 或其留言的 attachments 清單中才放行，
    // 其餘一律拒絕。issues.json 用固定 ISSUES_FOLDER_ID 定位（不信任請求參數），讀取失敗 fail-closed。
    if (action === 'downloadFileBase64' && params.fileId && !isUnderRoot_(params.fileId, ctx.root)) {
      if (!issuesHasAttachment_(readIssuesJsonForAttachCheck_(), params.fileId)) {
        return jsonResp_({ error: 'Forbidden: target outside root and not a known issue attachment' });
      }
    }

    // ── P1：query action 限根 ──
    // 前端 q 字串多為 "'<folderId>' in parents and ..." 形式，folderId 是 root 的子資料夾
    // （如 cases/users）或 root 本身，故不能整體 wrap 'root' in parents（會誤殺）。改為解析 q 中
    // 所有 "'ID' in parents" 引用的 ID，逐一驗證都在 root 子樹下（root 本身亦合法——in parents
    // 語意是列出該資料夾的子項）；不含 parents 條件的 q 一律拒絕（防枚舉任意資料夾）。
    if (action === 'query' &&
        !queryParentsAllowed_(params.q, function (id) { return isUnderRoot_(id, ctx.root); })) {
      return jsonResp_({ error: 'Forbidden: query must be scoped under root' });
    }

    let result;
    switch (action) {
      case 'ping':               result = { ok: true, email: userEmail }; break;
      case 'sessionStart':       result = sessionStart_(userEmail, params, ctx); break;
      case 'sessionLogout':      result = sessionLogout_(userEmail); break;
      case 'listMySessions':     result = sessionsListForUser_(userEmail, params, ctx); break;
      case 'getMetadata':        result = getMetadata_(params); break;
      case 'readJson':           result = readJson_(params, ctx, userEmail); break;
      case 'readJsonById':       result = readJsonById_(params, ctx, userEmail); break;
      case 'createJson':         result = createJson_(params); break;
      case 'updateJson':         result = updateJson_(params, ctx); break;
      case 'createFolder':       result = createFolder_(params); break;
      case 'trashFile':          result = trashFile_(params); break;
      case 'deleteFile':         result = deleteFile_(params); break;
      case 'moveFile':           result = moveFile_(params); break;
      case 'updateContentById':  result = updateContentById_(params); break;
      case 'query':              result = driveQuery_(params); break;
      case 'listFolder':         result = listFolder_(params); break;
      case 'listDir':            result = listDir_(params, ctx); break;
      case 'resolveDir':         result = resolveDir_(params, ctx); break;
      case 'createCalendarEvent':  result = createCalendarEvent_(params, ctx); break;
      case 'updateCalendarEvent':  result = updateCalendarEvent_(params, ctx); break;
      case 'deleteCalendarEvent':  result = deleteCalendarEvent_(params, ctx); break;
      case 'listCalendarEvents':   result = listCalendarEvents_(params, ctx); break;
      case 'shareCalendarWriters': result = shareCalendarWriters_(params, ctx); break;
      case 'gcAnnotateEvent':      result = gcAnnotateEvent_(params, ctx); break;
      case 'getCalendarMeta':      result = getCalendarMeta_(params, ctx); break;
      case 'uploadFile':           result = uploadFile_(params); break;
      case 'downloadFileBase64':   result = downloadFileBase64_(params); break;
      case 'fetchMentalLeaves':    result = fetchMentalLeaves_(ctx, params); break;
      case 'getNpust5AuthUrl':     result = getAuthUrlNpust5_(); break;
      // F5：dumpNpust5Emails／listInboxEmails 已下架（前端零用量的信件傾印/列表，個資落地風險）。
      // 函式本體保留供未來 trigger 手動呼叫用途，switch 移除後經由 doPost 已不可達（落到 default 的
      // Unknown action）。
      case 'clearMentalLeaves':              result = clearMentalLeaves_(ctx); break;
      case 'countMentalLeavesUnprocessed':   result = countMentalLeavesUnprocessed_(ctx); break;
      case 'submitUserApplication': result = submitUserApplication_({ ...params, submittedByEmail: userEmail, ctx }); break;
      case 'startupBatch':         result = startupBatch_(params, ctx); break;
      case 'casesUpsert':          result = casesUpsert_(params, ctx); break;
      case 'attendanceCommit':     result = attendanceCommit_(params, ctx); break;
      case 'bookingsCommit':       result = bookingsCommit_(params, ctx); break;
      case 'listCommit':           result = listCommit_(params, ctx); break;
      case 'notifCommit':          result = notifCommit_(params, ctx); break;
      case 'configSelfPatch':      result = configSelfPatch_(params, ctx, userEmail); break;
      case 'configCasesPatch':     result = configCasesPatch_(params, ctx, userEmail); break;
      // ── 實習生專屬打卡網址（免登入，見「打卡權杖」章節）──
      case 'clockContext':         result = clockContext_(userEmail, ctx); break;
      case 'clockPunch':           result = clockPunch_(userEmail, params, ctx); break;
      // 權杖簽發/停用/列表：一般 session 授權（clockToken 呼叫這三個 action 已被上方白名單擋下）。
      case 'clockTokenIssue':      result = clockTokenIssue_(userEmail, params, ctx); break;
      case 'clockTokenRevoke':     result = clockTokenRevoke_(userEmail, params, ctx); break;
      case 'clockTokenList':       result = clockTokenList_(userEmail, params, ctx); break;
      default: return jsonResp_({ error: 'Unknown action: ' + action });
    }
    return jsonResp_(result);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // Handle OAuth2 callback for npust5 Gmail
  if (e && e.parameter && e.parameter.code) {
    return npust5HandleOAuthCallback_(e);
  }
  return jsonResp_({ ok: true, service: 'SCC Drive Proxy (DEV)' });
}

// ── ID Token 驗證 ─────────────────────────────────────────────────────────────

function verifyIdToken_(idToken) {
  // CacheService 快取：同一 idToken 在 5 分鐘內跳過外部 tokeninfo HTTP 呼叫
  // idToken 末尾為 JWT 簽章（每個 token 唯一），取末 199 字元作為 key（CacheService 限制 250 字元）
  const cache = CacheService.getScriptCache();
  const cacheKey = 't' + idToken.slice(-199);
  try {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
  } catch (_) {}
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + idToken,
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    const d = JSON.parse(res.getContentText());
    if (d.aud !== CLIENT_ID) return null;
    if (Number(d.exp) < Math.floor(Date.now() / 1000)) return null;
    try { cache.put(cacheKey, d.email, 300); } catch (_) {}
    return d.email;
  } catch (e) { return null; }
}

// ── 自簽 Session Token ────────────────────────────────────────────────────────
// 取代「拿 Google ID token（1 小時過期）當 session」：登入後由後端簽發 HMAC token，
// 效期固定至當日 24:00（台北時間），當天所有請求不再依賴 One Tap 靜默刷新。
// 密鑰只存 Script Properties（repo 為 public，絕不進版控）；驗證為純運算、無外部 HTTP。

// 一次性設定：於 GAS 編輯器手動執行，產生並保存 SESSION_SECRET（已存在則不覆寫）。
function setupSessionSecret() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SESSION_SECRET')) {
    Logger.log('SESSION_SECRET 已存在，未覆寫。若需輪替請先手動刪除該 property 再執行。');
    return;
  }
  var secret = Utilities.getUuid() + Utilities.getUuid();
  props.setProperty('SESSION_SECRET', secret);
  Logger.log('SESSION_SECRET 已產生並保存（64+ 字元）。');
}

// 下一個台北午夜的 Unix 秒。台北固定 UTC+8、無日光節約，可用純算術（不依賴 script timezone），
// 也因此可被 test/session-exp.test.js 就地抽出做單元測試。
function nextTaipeiMidnightEpochSec_(nowMs) {
  var OFF = 8 * 3600;
  var tpeSec = Math.floor(nowMs / 1000) + OFF;
  return (Math.floor(tpeSec / 86400) + 1) * 86400 - OFF;
}

function sessionSecret_() {
  return PropertiesService.getScriptProperties().getProperty('SESSION_SECRET') || '';
}

function signSessionPayload_(payloadB64, secret) {
  var sig = Utilities.computeHmacSha256Signature(payloadB64, secret);
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

function issueSessionToken_(email) {
  var secret = sessionSecret_();
  if (!secret) throw new Error('SESSION_SECRET 未設定，請於 GAS 編輯器執行 setupSessionSecret()');
  var now = Math.floor(Date.now() / 1000);
  var jti = Utilities.getUuid();  // 每個 token 唯一識別碼（登入紀錄頁用；每台裝置各自一組）
  var payload = { e: email, jti: jti, iat: now, exp: nextTaipeiMidnightEpochSec_(Date.now()) };
  var payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload)).replace(/=+$/, '');
  return { token: payloadB64 + '.' + signSessionPayload_(payloadB64, secret), exp: payload.exp, jti: jti, iat: now };
}

// ── 登出即註銷（全部裝置）：以「該帳號的 revokedBefore 時間戳」實作 ──
// 登出時把 revokedBefore[email] 設為當下秒數；驗證時 iat < revokedBefore 一律拒絕，
// 等於讓該帳號「登出前簽發的所有 token（不分裝置）」全部失效。存 Script Properties 單一 JSON，
// 以 CacheService 快取 60 秒（登出時主動清快取→實質即時生效），避免每個請求都讀 Property。
function sessionRevokedBeforeMap_() {
  var cache = CacheService.getScriptCache();
  try { var hit = cache.get('sess_rb'); if (hit) return JSON.parse(hit); } catch (_) {}
  var raw = PropertiesService.getScriptProperties().getProperty('SESSION_REVOKED_BEFORE') || '{}';
  try { cache.put('sess_rb', raw, 60); } catch (_) {}
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

function sessionRevokeAllDevices_(email) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (_) {}
  try {
    var props = PropertiesService.getScriptProperties();
    var map = {};
    try { map = JSON.parse(props.getProperty('SESSION_REVOKED_BEFORE') || '{}'); } catch (_) { map = {}; }
    map[email] = Math.floor(Date.now() / 1000);
    props.setProperty('SESSION_REVOKED_BEFORE', JSON.stringify(map));
    try { CacheService.getScriptCache().remove('sess_rb'); } catch (_) {}  // 清快取→下次驗證立即讀到新值
  } finally { try { lock.releaseLock(); } catch (_) {} }
}

// 驗證通過回 email，否則 null（fail-closed：密鑰未設定、格式錯、簽章不符、過期、已被登出註銷都是 null）。
function verifySessionToken_(token) {
  try {
    var secret = sessionSecret_();
    if (!secret || !token || typeof token !== 'string') return null;
    var parts = token.split('.');
    if (parts.length !== 2) return null;
    if (signSessionPayload_(parts[0], secret) !== parts[1]) return null;
    var padded = parts[0] + '='.repeat((4 - parts[0].length % 4) % 4);  // 簽發時去掉的 padding 補回再 decode
    var payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString());
    if (!payload || !payload.e) return null;
    // ⚠️ 安全必要（打卡權杖 scope 邊界）：payload 含 's' 欄位＝非一般登入 session（目前唯一用途是
    // 打卡權杖，payload.s === 'clock'，見「打卡權杖」章節）。一律拒收，絕不可讓 scope 受限的權杖
    // 被當成完整 session 接受——否則打卡權杖（效期長達 180 天、且不受 sessionRevokeAllDevices_/
    // 登出即註銷機制保護）就能冒充完整登入身分，取得遠超「僅打卡」的存取權。
    if (payload.s) return null;
    if (Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
    var rb = sessionRevokedBeforeMap_()[payload.e];  // 登出註銷檢查（全部裝置）
    if (rb && Number(payload.iat) < Number(rb)) return null;
    return payload.e;
  } catch (e) { return null; }
}

// ── 打卡權杖（Clock Token）──────────────────────────────────────────────────
// 給實習生的免登入打卡專屬網址使用（?page=clock#ct=<token>）。與一般 session token 共用同一把
// SESSION_SECRET／同一簽章格式（base64url(payload) + '.' + HMAC-SHA256），但 payload 多帶
// s:'clock' 做 scope 標記——verifySessionToken_ 見到 payload.s 一律拒收，故打卡權杖絕對無法冒充
// 完整 session。效期 180 天（供實習生長期使用同一個網址打卡，不必每天登入）。
//
// 「網址可被隨時撤銷」不是靠密鑰輪替（那會波及全站所有 session），而是登記檔 clock_tokens.json
// （存於 ctx.root，與 attendance.json 同層）：{ tokens: { [email]: { jti, iat, exp, issuedBy } } }。
// 只存 jti、不存權杖本體——jti 沒有密鑰簽不出合法 token，檔案即使被一般授權使用者 readJson 讀到
// 也無法偽造打卡權杖。簽發/重新產生會覆寫該 email 的 jti（舊網址的 jti 對不上→立即失效），
// 停用會直接刪除該筆登記；驗證時比對 payload.jti 是否等於登記檔目前該 email 的 jti。

// 簽發一枚打卡權杖（純運算＋簽章，不寫檔——寫登記檔是呼叫端 clockTokenIssue_ 的責任）。
function issueClockToken_(email, jti) {
  var secret = sessionSecret_();
  if (!secret) throw new Error('SESSION_SECRET 未設定，請於 GAS 編輯器執行 setupSessionSecret()');
  var now = Math.floor(Date.now() / 1000);
  var exp = now + 180 * 86400; // 180 天
  var payload = { e: email, s: 'clock', jti: jti, iat: now, exp: exp };
  var payloadB64 = Utilities.base64EncodeWebSafe(JSON.stringify(payload)).replace(/=+$/, '');
  return { token: payloadB64 + '.' + signSessionPayload_(payloadB64, secret), exp: exp, iat: now };
}

// clock_tokens.json 的 CacheService 快取 key（綁定 ctx.root，避免跨環境快取汙染）。
function _clockTokensCacheKey_(root) { return 'clocktok:' + root; }

// 讀登記檔的 tokens map（CacheService 快取 60 秒）。fail-closed：檔案存在但讀取/內容異常一律回
// null（供 verifyClockToken_ 判定「無法確認→拒絕」）；檔案尚未建立（尚無人領過打卡網址）視為
// 合法的空狀態，回傳 {}（並非 fail-open——任何 email 在空 map 中都查無登記，驗證仍會被拒）。
function clockTokensRead_(ctx) {
  var cache = CacheService.getScriptCache();
  var CK = _clockTokensCacheKey_(ctx.root);
  try { var hit = cache.get(CK); if (hit) return JSON.parse(hit); } catch (_) {}
  try {
    var fileId = null;
    try { fileId = resolvePathToId_('clock_tokens.json', ctx); } catch (_) { fileId = null; }
    if (!fileId) {
      try { cache.put(CK, JSON.stringify({}), 60); } catch (_) {}
      return {};
    }
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() >= 400) return null; // fail-closed
    var data = JSON.parse(res.getContentText());
    var tokens = (data && typeof data.tokens === 'object' && data.tokens && !Array.isArray(data.tokens)) ? data.tokens : null;
    if (!tokens) return null; // 內容異常 fail-closed
    try { cache.put(CK, JSON.stringify(tokens), 60); } catch (_) {}
    return tokens;
  } catch (e) { return null; }
}

function _clockTokensClearCache_(root) {
  try { CacheService.getScriptCache().remove(_clockTokensCacheKey_(root)); } catch (_) {}
}

// LockService 鎖內讀-改-寫登記檔（比照 attendanceCommit_/listCommit_ 慣例）：mutateFn 直接修改
// tokens map（傳入的是「目前最新版」，非快取）。fail-closed：檔案存在但讀取/內容異常一律中止，
// 絕不以空殼覆寫。寫入成功或失敗都會清快取，確保下一次讀取拿到最新狀態。
function _clockTokensWrite_(ctx, mutateFn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var fileId = null;
    var data = { tokens: {} };
    try { fileId = resolvePathToId_('clock_tokens.json', ctx); } catch (_) { fileId = null; /* 檔不存在，稍後建立 */ }
    if (fileId) {
      var res = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
        { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
      );
      if (res.getResponseCode() >= 400) {
        throw new Error('clock_tokens.json 讀取失敗（HTTP ' + res.getResponseCode() + '），已中止寫入以保護資料');
      }
      data = JSON.parse(res.getContentText());
      if (!data || typeof data.tokens !== 'object' || !data.tokens || Array.isArray(data.tokens)) {
        throw new Error('clock_tokens.json 內容異常（tokens 非物件），已中止寫入以保護資料');
      }
    }
    mutateFn(data.tokens);
    if (fileId) {
      driveUpdateContent_(fileId, data);
    } else {
      var pn = resolvePathToParentAndName_('clock_tokens.json', ctx);
      driveUpload_(pn.fileName, data, pn.parentId);
    }
    return data.tokens;
  } finally {
    try { lock.releaseLock(); } catch (_) {}
    _clockTokensClearCache_(ctx.root);
  }
}

// 驗證打卡權杖：簽章、scope（payload.s === 'clock'）、效期，再比對登記檔內該 email 目前登記的
// jti 是否相符。回傳 email，否則 null（fail-closed：任何解析/讀檔失敗、jti 不符、登記已過期皆為 null）。
function verifyClockToken_(token, ctx) {
  try {
    var secret = sessionSecret_();
    if (!secret || !token || typeof token !== 'string') return null;
    var parts = token.split('.');
    if (parts.length !== 2) return null;
    if (signSessionPayload_(parts[0], secret) !== parts[1]) return null;
    var padded = parts[0] + '='.repeat((4 - parts[0].length % 4) % 4);
    var payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString());
    if (!payload || !payload.e || payload.s !== 'clock' || !payload.jti) return null;
    if (Number(payload.exp) <= Math.floor(Date.now() / 1000)) return null;
    var tokens = clockTokensRead_(ctx);
    if (!tokens) return null; // fail-closed：登記檔讀取失敗，無法確認 jti 是否仍有效
    var entry = tokens[payload.e];
    if (!entry || entry.jti !== payload.jti) return null; // 已重新產生或停用，舊 jti 對不上
    if (Number(entry.exp) <= Math.floor(Date.now() / 1000)) return null;
    return payload.e;
  } catch (e) { return null; }
}

// 打卡日期字串所需的「N 天前」台北時區 yyyy-MM-dd（供 clockContext_/clockPunch_ 篩選近期紀錄）。
function _clockCutoffDateStr_(days) {
  return Utilities.formatDate(new Date(Date.now() - days * 86400000), 'Asia/Taipei', 'yyyy-MM-dd');
}

// 參數轉有限數字，否則 null（clockPunch_ 用來驗證前端傳入的定位參數，拒絕 NaN/Infinity/非數字）。
function _clockFiniteNum_(v) {
  if (v === undefined || v === null || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

// ── 伺服器橋接密鑰（Phase 2c）──
// 一次性設定：於 GAS 編輯器手動執行，產生並保存 BRIDGE_KEY（已存在則不覆寫）。
// 執行後從紀錄複製整串密鑰，設定到本地伺服器 server/.env 的 GAS_BRIDGE_KEY。
function setupBridgeKey() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('BRIDGE_KEY')) {
    Logger.log('BRIDGE_KEY 已存在，未覆寫。若需輪替請先手動刪除該 property 再執行。');
    return;
  }
  var key = Utilities.getUuid() + Utilities.getUuid();
  props.setProperty('BRIDGE_KEY', key);
  Logger.log('BRIDGE_KEY 已產生，請將下行整串設定到 server/.env 的 GAS_BRIDGE_KEY：\n' + key);
}

// 驗證橋接密鑰。常數時間比較：GAS 無 timingSafeEqual，改比較兩值以隨機單次鍵計算的 HMAC——
// 攻擊者無法預測 HMAC 輸出，字串 === 的逐字元 timing 差異不再洩漏任何有用資訊。
// fail-closed：BRIDGE_KEY 未設定（property 不存在）時一律拒絕。
function verifyBridgeKey_(provided) {
  var expected = PropertiesService.getScriptProperties().getProperty('BRIDGE_KEY');
  if (!expected || !provided) return false;
  var onceKey = Utilities.getUuid();
  var a = Utilities.base64Encode(Utilities.computeHmacSha256Signature(String(provided), onceKey));
  var b = Utilities.base64Encode(Utilities.computeHmacSha256Signature(String(expected), onceKey));
  return a === b;
}

// 打卡權杖簽發/停用/列表的權限閘：isAdminUser_ 或 config 中 role==='主任'／extraRole 為
// 「實習生行政督導」／「實習生專業督導」。fail-closed：config 讀不到或帳號停用一律拒絕
// （BOOTSTRAP_ADMINS 已由 isAdminUser_ 涵蓋）。這是後端硬閘，不能只靠前端隱藏按鈕。
function _clockTokenAdminGate_(email) {
  if (isAdminUser_(email)) return true;
  var u = (localConfigUsers_() || {})[email];
  if (!u || u.disabled === true) return false;
  return u.role === '主任' || u.extraRole === '實習生行政督導' || u.extraRole === '實習生專業督導';
}

// ── 打卡權杖 actions ──

// clockContext：回傳打卡頁所需的最小資料（不含其他人資料、不含任何個案資料）。
// attendance.json 讀取失敗須 throw（比照 attendanceCommit_ 慣例），不可回空陣列誤導前端「今天沒打卡」。
function clockContext_(userEmail, ctx) {
  var cfg = readConfigFresh_();
  var u = (cfg && cfg.users && cfg.users[userEmail]) || {};
  var name = u.name || '';
  var geoFence = (cfg && cfg.attendanceGeoFence) || null;

  var fileId = null;
  try { fileId = resolvePathToId_('attendance.json', ctx); } catch (_) { fileId = null; /* 尚無任何打卡紀錄 */ }
  var records = [];
  if (fileId) {
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() >= 400) {
      throw new Error('clockContext: 讀取 attendance.json 失敗（HTTP ' + res.getResponseCode() + '）');
    }
    var data = JSON.parse(res.getContentText());
    if (!data || !Array.isArray(data.records)) {
      throw new Error('clockContext: attendance.json 內容異常（records 非陣列）');
    }
    var cutoff = _clockCutoffDateStr_(62);
    records = data.records.filter(function (r) { return r && r.email === userEmail && r.date >= cutoff; });
  }
  return { email: userEmail, name: name, geoFence: geoFence, records: records };
}

// clockPunch：完全不信任前端身分——record 的 email/name 一律由打卡權杖驗證出的 userEmail 與
// config 決定；params 只收 lat/lng/accuracy（須為有限數字才採用）。走既有 attendanceCommit_
// （LockService 併發安全 upsert，自動觸發打卡彙整信），取代任何自行寫檔的路徑。
function clockPunch_(userEmail, params, ctx) {
  var cfg = readConfigFresh_();
  var u = (cfg && cfg.users && cfg.users[userEmail]) || {};
  var name = u.name || '';

  var lat = _clockFiniteNum_(params && params.lat);
  var lng = _clockFiniteNum_(params && params.lng);
  var accuracy = _clockFiniteNum_(params && params.accuracy);
  var hasLoc = lat !== null && lng !== null;

  var now = new Date();
  var record = {
    id: 'att_' + userEmail + '_' + now.getTime(),
    email: userEmail,
    name: name,
    type: 'punch',
    timestamp: now.toISOString(),
    date: Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd'),
  };
  if (hasLoc) {
    record.lat = lat;
    record.lng = lng;
    if (accuracy !== null) {
      record.accuracy = accuracy;
      record.accuracyLow = accuracy > 200;
    }
  }

  var commitResult = attendanceCommit_({ upserts: [record] }, ctx);
  var cutoff = _clockCutoffDateStr_(62);
  var records = (commitResult.records || []).filter(function (r) { return r && r.email === userEmail && r.date >= cutoff; });
  return { ok: true, record: record, records: records };
}

// clockTokenIssue：簽發（或重新簽發，覆蓋舊 jti＝舊網址立即失效）一枚打卡權杖。
// 只能發給 config.users 中未停用、role==='實習諮商心理師' 的帳號，或發給自己（管理者/督導測試用）。
// token 只在此回應出現一次，不落地（登記檔只存 jti）。
function clockTokenIssue_(requesterEmail, params, ctx) {
  if (!_clockTokenAdminGate_(requesterEmail)) return { error: 'Forbidden' };
  var email = params && params.email;
  if (!email) return { error: 'Forbidden' };
  var users = localConfigUsers_() || {};
  var u = users[email];
  if (!u || u.disabled === true) return { error: 'Forbidden' };
  if (!(u.role === '實習諮商心理師' || email === requesterEmail)) return { error: 'Forbidden' };

  var jti = Utilities.getUuid();
  var issued = issueClockToken_(email, jti);
  _clockTokensWrite_(ctx, function (tokens) {
    tokens[email] = { jti: jti, iat: issued.iat, exp: issued.exp, issuedBy: requesterEmail };
  });
  return { token: issued.token, exp: issued.exp, email: email };
}

// clockTokenRevoke：刪除該 email 的登記（該打卡網址立即失效）。
function clockTokenRevoke_(requesterEmail, params, ctx) {
  if (!_clockTokenAdminGate_(requesterEmail)) return { error: 'Forbidden' };
  var email = params && params.email;
  if (!email) return { error: 'Forbidden' };
  _clockTokensWrite_(ctx, function (tokens) { delete tokens[email]; });
  return { ok: true };
}

// clockTokenList：回傳目前登記狀態（不含 jti，避免無謂外流——jti 本身雖無密鑰簽不出 token，
// 仍無必要在列表 API 回傳）。
function clockTokenList_(requesterEmail, params, ctx) {
  if (!_clockTokenAdminGate_(requesterEmail)) return { error: 'Forbidden' };
  var tokens = clockTokensRead_(ctx) || {};
  var out = {};
  Object.keys(tokens).forEach(function (email) {
    var t = tokens[email] || {};
    out[email] = { iat: t.iat, exp: t.exp, issuedBy: t.issuedBy };
  });
  return { tokens: out };
}

// 登入通知「異常偵測」純決策函式（v166）：熟識裝置/位置降噪，但保底 7 天必寄一次。
//   history：該帳號在 sessions.json 的既有紀錄陣列（新舊不拘，函式內部不假設排序）。
//   回傳 { mail: true|false, reason: 'first_login'|'new_ua'|'new_geo'|'periodic'|'' }。
// 判斷順序：①無任何歷史→first_login ②本次 ua 與歷史任一筆完全相同才算熟識 UA，否則 new_ua
//   ③geo 非空且與歷史任何一筆都不同→new_geo（geo 空值不觸發，查詢失敗很常見，靠 periodic 保底）
//   ④以上都熟識→查歷史中「上次實際寄過信」（mailSent:true）的 issuedAtMs，距今 ≥7 天→periodic，否則不寄。
// 安全註記（務必保留）：ua/geo 都是前端自報，攻擊者可任意假冒——熟識判斷只用來「降噪」（減少通知疲勞），
//   不是安全邊界；7 天保底信＋登入紀錄頁（本人隨時可查全部裝置、可一鍵登出所有裝置）才是不可靜默的底線。
// 設計決策：ip 刻意不參與異常判斷。行動網路/校網浮動 IP 天天在變，納入判斷會天天誤報「新裝置」
//   造成通知疲勞、反而讓使用者對警示信免疫；「換地區」訊號已由 geo 涵蓋，ip 只留在登入紀錄頁供人工比對。
// 測試版寄出的通知信主旨前綴——dev/prod 共用同一 npust.scc 信箱，加【測試版】避免收件者把
// 測試信誤當正式版信件（例：dev 的 7 天保底登入信曾被誤認為 prod 漏信）。依 CALENDAR_NAME 是否
// 以 [DEV] 開頭判斷環境；推正式版 Copy-Item 後 CALENDAR_NAME 改回正式值即自動無前綴，無需手改。
function mailEnvPrefix_() {
  return (CALENDAR_NAME && CALENDAR_NAME.indexOf('[DEV]') === 0) ? '【測試版】' : '';
}

function loginMailDecision_(history, ua, ip, geo, nowSec) {
  var hist = Array.isArray(history) ? history : [];
  if (hist.length === 0) return { mail: true, reason: 'first_login' };

  var knownUa = hist.some(function (s) { return s && s.ua === ua; });
  if (!knownUa) return { mail: true, reason: 'new_ua' };

  if (geo) {
    var knownGeo = hist.some(function (s) { return s && s.geo === geo; });
    if (!knownGeo) return { mail: true, reason: 'new_geo' };
  }

  var lastMailedMs = null;
  hist.forEach(function (s) {
    if (s && s.mailSent) {
      var t = Number(s.issuedAtMs || 0);
      if (lastMailedMs === null || t > lastMailedMs) lastMailedMs = t;
    }
  });
  var SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
  var nowMs = Number(nowSec) * 1000;
  if (lastMailedMs === null || (nowMs - lastMailedMs) >= SEVEN_DAYS_MS) {
    return { mail: true, reason: 'periodic' };
  }
  return { mail: false, reason: '' };
}

// ── v167：非台灣登入自動鎖定 ─────────────────────────────────────────────────
// 純決策（可單元測試，見 test/geo-lock.test.js）：本次登入是否應判定為「非台灣地區」而鎖定帳號。
// ⚠️ 安全註記（務必保留）：geo/cc 都是前端自報值（向 ipapi.co 查詢後由瀏覽器帶上來），使用者可用
// VPN／代理讓查詢結果本身就顯示台灣，也可直接竄改請求參數繞過——這道鎖只防「用正常前端的機會型
// 攻擊者／帳號外流後被順手誤用」，不是安全邊界，不能取代後端 isAuthorizedUser_ 等真正的授權檢查。
// 規則：cc（ISO 國碼）非空 → 精準比對，非 'TW' 即鎖；cc 空但 geo（地名字串）非空 → 退回比對 geo
// 字串是否以 'Taiwan' 結尾（cc 是本次新增欄位，舊前端分頁尚未升級時只會帶 geo，需相容）；
// geo 與 cc 皆空（查詢逾時、被廣告/隱私阻擋器擋掉、服務限流）→ 無法判斷，不鎖——避免把「查不到
// 位置」的合法使用者誤鎖死；這種情境改由 geoEmptyNoticeDecision_ 雙向提醒，而非直接鎖定。
function geoLockDecision_(geo, cc) {
  var ccStr = String(cc == null ? '' : cc).trim().toUpperCase();
  if (ccStr) return { lock: ccStr !== 'TW' };
  var geoStr = String(geo == null ? '' : geo).trim().toLowerCase();
  if (geoStr) return { lock: geoStr.slice(-6) !== 'taiwan' };
  return { lock: false };
}

// 純決策（可單元測試）：本次登入 geo 為空（定位失敗）時，是否該寄出雙向提醒信（7 天冷卻，
// 避免同一人常態被廣告阻擋器擋掉查詢卻天天收信）。history：同一 email 在 sessions.json 的既有
// 紀錄（各筆可能帶有上次寄出提醒的 geoEmptyNoticedAtMs）。
function geoEmptyNoticeDecision_(history, nowMs) {
  var hist = Array.isArray(history) ? history : [];
  var lastNoticedMs = null;
  hist.forEach(function (s) {
    if (s && s.geoEmptyNoticedAtMs) {
      var t = Number(s.geoEmptyNoticedAtMs);
      if (lastNoticedMs === null || t > lastNoticedMs) lastNoticedMs = t;
    }
  });
  var SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
  if (lastNoticedMs === null) return true;
  return (Number(nowMs) - lastNoticedMs) >= SEVEN_DAYS_MS;
}

// 簽發 session＋依異常偵測決定是否寄登入通知信＋寫入登入紀錄。IP／大致位置由前端取得後傳入（GAS 拿不到來源 IP）。
// 寄信、記錄失敗都不阻斷登入。
function sessionStart_(userEmail, params, ctx) {
  var ua  = String((params && params.ua)  || '').slice(0, 200) || '（未提供）';
  var ip  = String((params && params.ip)  || '').slice(0, 64);
  var geo = String((params && params.geo) || '').slice(0, 120);
  var cc  = String((params && params.cc)  || '').slice(0, 8);

  // v167：非台灣登入鎖定判斷須在簽發 token 之前——一旦判定鎖定，完全不核發任何可用的 session token。
  var geoDecision = geoLockDecision_(geo, cc);
  if (geoDecision.lock) {
    var lockInfo = { ua: ua, ip: ip, geo: geo };
    try { geoLockAccount_(userEmail, lockInfo); } catch (e) { Logger.log('geoLockAccount_ 例外：' + e.message); }
    // 鎖帳號、登出所有裝置、寄信、寫登入紀錄依序「串行」取放各自的鎖——LockService 全 script
    // 同一把鎖，不可巢狀 waitLock，故此處刻意不共用單一把鎖，逐步各自 waitLock/releaseLock。
    try { sessionRevokeAllDevices_(userEmail); } catch (e) { Logger.log('sessionRevokeAllDevices_（geo_lock）例外：' + e.message); }
    var mailSentLock = false;
    try { mailSentLock = _sendGeoLockMail_(userEmail, lockInfo); } catch (e) { Logger.log('geo_lock 通知信例外：' + e.message); }
    try {
      var nowSecLock = Math.floor(Date.now() / 1000);
      sessionsAppendGeoLockRecord_({
        jti: null, email: userEmail, ua: ua, ip: ip, geo: geo,
        iat: nowSecLock, exp: nowSecLock,  // 未核發可用 token，iat=exp 使其立即視為過期
        issuedAtMs: Date.now(), issuedAt: new Date().toISOString(),
        mailSent: mailSentLock, mailReason: 'geo_lock',
      }, ctx);
    } catch (e) { Logger.log('sessionsAppendGeoLockRecord_ 呼叫例外：' + e.message); }
    return { error: 'geo_locked' };
  }

  var issued = issueSessionToken_(userEmail);
  var mailSent = false;
  try {
    var result = sessionsAppendRecordWithMailDecision_({
      jti: issued.jti, email: userEmail, ua: ua, ip: ip, geo: geo,
      iat: issued.iat, exp: issued.exp, issuedAtMs: Date.now(), issuedAt: new Date().toISOString(),
    }, ctx);
    mailSent = !!(result && result.mailSent);
  } catch (recErr) {
    Logger.log('sessionStart 登入紀錄寫入／通知信處理失敗：' + recErr.message);
  }
  return { sessionToken: issued.token, exp: issued.exp, email: userEmail, mailSent: mailSent };
}

// 登出：註銷該帳號全部裝置的 token（見 sessionRevokeAllDevices_）。
function sessionLogout_(userEmail) {
  sessionRevokeAllDevices_(userEmail);
  return { ok: true };
}

// ── 登入紀錄（sessions.json）：供「登入紀錄」頁顯示（#6）與登入通知（#5/#11/v166 異常偵測）──
// 每筆 { jti, email, ua, ip, geo, iat, exp, issuedAtMs, issuedAt, mailSent, mailReason }；
// 寫入時 prune（>45 天丟棄、每人最多留 15 筆）。
//
// 讀檔取捨：history（判斷是否寄信要用的該帳號既有紀錄）與「寫入本次紀錄」共用同一次讀檔、
// 同一把鎖，讀一次、判斷、寄信、append、寫回全部在鎖內完成——避免兩次獨立讀檔在鎖外各自
// 判斷時，並發登入之間互相看不到彼此剛寫入的紀錄而誤判（例如同時兩次登入都判定 first_login）。
// 代價：MailApp.sendEmail 也在鎖內執行，會拉長鎖持有時間；但寄信頻率低（多數登入因熟識而不寄）、
// 且原本寄信本來就在 doPost 回應之前同步執行（前端本就要等），對整體延遲無額外影響。
function sessionsAppendRecordWithMailDecision_(rec, ctx) {
  if (!ctx) return { mailSent: false, mailReason: '' };  // 無 ctx（不知寫哪個資料夾）則略過記錄，不阻斷登入
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (_) {}
  try {
    var fileId = null;
    var data = { sessions: [] };
    try {
      fileId = resolvePathToId_('sessions.json', ctx);
      var res = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
        { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
      );
      if (res.getResponseCode() < 400) {
        try { data = JSON.parse(res.getContentText()); } catch (_) { data = { sessions: [] }; }
        if (!data || !Array.isArray(data.sessions)) data = { sessions: [] };
      }
    } catch (_) { /* 檔不存在，稍後建立 */ }

    var history = data.sessions.filter(function (s) { return s && s.email === rec.email; });
    var nowSec = Math.floor(Date.now() / 1000);
    var decision = loginMailDecision_(history, rec.ua, rec.ip, rec.geo, nowSec);

    var mailSent = false;
    if (decision.mail) {
      try {
        var loginTime = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');
        var isAnomaly = decision.reason === 'new_ua' || decision.reason === 'new_geo';
        var subject = mailEnvPrefix_() + (isAnomaly ? '【屏科大學諮資訊系統】⚠ 新裝置或新位置登入' : '【屏科大學諮資訊系統】登入通知');
        var lines = [
          isAnomaly ? '偵測到此帳號在「不熟識的裝置或位置」登入屏科大學諮資訊系統，請確認是否為本人操作：'
                    : '有人以此帳號登入屏科大學諮資訊系統。', '',
          '登入時間：' + loginTime + '（台北時間）',
          '瀏覽器資訊：' + rec.ua,
        ];
        if (rec.ip)  lines.push('IP 位址：' + rec.ip);
        if (rec.geo) lines.push('大致位置：' + rec.geo);
        lines.push('', '此登入憑證將於今日 24:00（台北時間）自動失效。',
          '若非本人操作，請立即聯繫系統管理者停用帳號，並可於系統「登入紀錄」頁按「登出所有裝置」使所有憑證即時失效。');
        MailApp.sendEmail(rec.email, subject, lines.join('\n'));
        mailSent = true;
      } catch (mailErr) {
        Logger.log('sessionStart 通知信寄送失敗：' + mailErr.message);
      }
    }
    rec.mailSent = mailSent;
    rec.mailReason = decision.reason || '';

    // v167：geo 空值（定位失敗）雙向提醒——與上面的「異常偵測登入通知」互相獨立，各自照各自規則跑。
    // 7 天冷卻依 history 中最近一次 geoEmptyNoticedAtMs 判斷，本次若寄出則標記在本筆紀錄上。
    if (!rec.geo) {
      if (geoEmptyNoticeDecision_(history, Date.now())) {
        rec.geoEmptyNoticedAtMs = Date.now();
        try { _sendGeoEmptyMail_(rec.email, { ip: rec.ip, ua: rec.ua }); } catch (mailErr2) {
          Logger.log('geo_empty 提醒信寄送失敗：' + mailErr2.message);
        }
      }
    }

    data.sessions.push(rec);
    var cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    data.sessions = data.sessions.filter(function (s) { return s && s.issuedAtMs && s.issuedAtMs >= cutoff; });
    data.sessions.sort(function (a, b) { return (b.issuedAtMs || 0) - (a.issuedAtMs || 0); });
    var perUser = {};
    var kept = [];
    data.sessions.forEach(function (s) {
      var e = s.email || '';
      perUser[e] = (perUser[e] || 0) + 1;
      if (perUser[e] <= 15) kept.push(s);
    });
    data.sessions = kept;

    if (fileId) {
      driveUpdateContent_(fileId, data);
    } else {
      var pn = resolvePathToParentAndName_('sessions.json', ctx);
      driveUpload_(pn.fileName, data, pn.parentId);
    }
    return { mailSent: mailSent, mailReason: decision.reason || '' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// v167：非台灣登入鎖定情境的登入紀錄寫入，與一般登入分流——不跑 loginMailDecision_（該情境是否寄信
// 已在 _sendGeoLockMail_ 階段各自決定），直接把已知的 mailSent/mailReason 寫入一筆紀錄。
// 讀寫/prune 邏輯沿用 sessionsAppendRecordWithMailDecision_（見該函式的鎖內讀-改-寫取捨說明）；
// 呼叫端須確保呼叫當下未持有 ScriptLock（LockService 全 script 同一把鎖，不可巢狀 waitLock，
// sessionStart_ 已將鎖帳號／登出裝置／寄信／本函式串行取放，而非巢狀）。
function sessionsAppendGeoLockRecord_(rec, ctx) {
  if (!ctx) return;
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (_) {}
  try {
    var fileId = null;
    var data = { sessions: [] };
    try {
      fileId = resolvePathToId_('sessions.json', ctx);
      var res = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
        { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
      );
      if (res.getResponseCode() < 400) {
        try { data = JSON.parse(res.getContentText()); } catch (_) { data = { sessions: [] }; }
        if (!data || !Array.isArray(data.sessions)) data = { sessions: [] };
      }
    } catch (_) { /* 檔不存在，稍後建立 */ }

    data.sessions.push(rec);
    var cutoff = Date.now() - 45 * 24 * 3600 * 1000;
    data.sessions = data.sessions.filter(function (s) { return s && s.issuedAtMs && s.issuedAtMs >= cutoff; });
    data.sessions.sort(function (a, b) { return (b.issuedAtMs || 0) - (a.issuedAtMs || 0); });
    var perUser = {};
    var kept = [];
    data.sessions.forEach(function (s) {
      var e = s.email || '';
      perUser[e] = (perUser[e] || 0) + 1;
      if (perUser[e] <= 15) kept.push(s);
    });
    data.sessions = kept;

    if (fileId) {
      driveUpdateContent_(fileId, data);
    } else {
      var pn = resolvePathToParentAndName_('sessions.json', ctx);
      driveUpload_(pn.fileName, data, pn.parentId);
    }
  } catch (e) {
    Logger.log('sessionsAppendGeoLockRecord_ 寫入失敗：' + e.message);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// v167：取得「專任／管理層」通知名單（非台灣登入鎖定、定位失敗雙向提醒共用）——未停用且
// （role 屬於指定名單，或 isAdmin===true，或 extraRole==='管理者'）的 email，去重。
// 判定基準刻意比 adminDecision_ 寬（多納入專任社工師/心理師三類角色，非僅管理者），
// 因為這兩則通知目的是「讓能處理帳號/資安狀況的人知道」，不是權限判定。
function _managementNotifyList_(users) {
  if (!users || typeof users !== 'object') return [];
  var ROLES = { '主任': true, '系統管理者': true, '專任社會工作師': true, '專任諮商心理師': true, '專任臨床心理師': true };
  var seen = {};
  var out = [];
  Object.keys(users).forEach(function (email) {
    var u = users[email];
    if (!u || u.disabled === true) return;
    var qualifies = !!ROLES[u.role] || u.isAdmin === true || u.extraRole === '管理者';
    if (!qualifies) return;
    if (!seen[email]) { seen[email] = true; out.push(email); }
  });
  return out;
}

// v167：鎖帳號本體——自己取 ScriptLock（呼叫端不得已持有鎖，見上方 sessionStart_ 的串行說明），
// 直接讀本環境 config.json（localConfigFileId_：CONFIG_FILE_ID_OVERRIDE || 路徑解析，與授權閘
// 用同一套本環境解析，不受請求帶入的 rootFolderId 影響）→ 標記 disabled → 寫回 → 清授權快取
// （localConfigUsers_ 的 300 秒快取，不清則鎖定延遲最多 5 分鐘生效）。email 若不在 users 表
// （理論上不會，isAuthorizedUser_ 授權閘已先擋過）則略過寫入。info 供稽核 log 用途。
function geoLockAccount_(email, info) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (_) {}
  try {
    var cfgId = localConfigFileId_();
    if (!cfgId) return false;
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + cfgId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return false;
    var cfg = JSON.parse(res.getContentText());
    if (!cfg || !cfg.users || typeof cfg.users !== 'object' || !cfg.users[email]) return false;
    cfg.users[email].disabled = true;
    cfg.users[email].disabledReason = 'geo_lock';
    cfg.users[email].disabledAt = new Date().toISOString();
    driveUpdateContent_(cfgId, cfg);
    try { CacheService.getScriptCache().remove('cfgusers:' + (CONFIG_FILE_ID_OVERRIDE || ROOT_FOLDER_ID)); } catch (_) {}
    Logger.log('geo_lock：帳號已鎖定 email=' + email + ' geo=' + (info && info.geo) + ' ip=' + (info && info.ip));
    return true;
  } catch (e) {
    Logger.log('geoLockAccount_ 失敗：' + e.message);
    return false;
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// v167：寄送「非台灣登入自動鎖定」通知信——管理層＋當事人皆收，內容相同，當事人多一句提醒。
// best-effort：兩封各自 try/catch，任一失敗不影響另一封；回傳是否至少一封寄成功。
function _sendGeoLockMail_(email, info) {
  var toList = _managementNotifyList_(localConfigUsers_());
  var loginTime = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');
  var subject = mailEnvPrefix_() + '【屏科大學諮資訊系統】🚨 帳號已自動鎖定：非台灣地區登入';
  var baseLines = [
    '帳號：' + email,
    '登入時間：' + loginTime + '（台北時間）',
    '回報位置：' + ((info && info.geo) || '（無）'),
    'IP 位址：' + ((info && info.ip) || '（無）'),
    '瀏覽器資訊：' + ((info && info.ua) || '（無）'),
    '',
    '系統偵測到非台灣地區登入，已自動停用該帳號並登出其所有裝置。',
    '解鎖方式：管理者可於使用者管理頁重新啟用該帳號。',
  ];
  var sent = false;
  try {
    if (toList.length) { MailApp.sendEmail(toList.join(','), subject, baseLines.join('\n')); sent = true; }
  } catch (e) { Logger.log('geo_lock 通知信（管理層）寄送失敗：' + e.message); }
  try {
    var selfLines = baseLines.concat(['', '若非您本人操作請立即聯繫中心。']);
    MailApp.sendEmail(email, subject, selfLines.join('\n'));
    sent = true;
  } catch (e) { Logger.log('geo_lock 通知信（當事人）寄送失敗：' + e.message); }
  return sent;
}

// v167：寄送「定位失敗」雙向提醒信（geo 空值、7 天冷卻，見 geoEmptyNoticeDecision_）——說明該次
// 登入未受「非台灣自動鎖定」防護，管理層＋當事人皆收；當事人另附改善指引與驗證方式。
function _sendGeoEmptyMail_(email, info) {
  var toList = _managementNotifyList_(localConfigUsers_());
  var loginTime = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');
  var subject = mailEnvPrefix_() + '【屏科大學諮資訊系統】⚠ 登入位置無法判定';
  var reasonLine = '該次登入無法取得位置資訊，常見原因：瀏覽器安裝廣告/隱私阻擋器（如 uBlock Origin）擋掉 ' +
    'ipapi.co、網路逾時、查詢服務限流。位置判定是「非台灣自動鎖定」防護的前提，該防護對此次登入未生效。';
  var baseLines = [
    '帳號：' + email,
    '登入時間：' + loginTime + '（台北時間）',
    'IP 位址：' + ((info && info.ip) || '（無）'),
    '瀏覽器資訊：' + ((info && info.ua) || '（無）'),
    '',
    reasonLine,
  ];
  try {
    if (toList.length) MailApp.sendEmail(toList.join(','), subject, baseLines.join('\n'));
  } catch (e) { Logger.log('geo_empty 提醒信（管理層）寄送失敗：' + e.message); }
  try {
    var selfLines = baseLines.concat([
      '',
      '改善指引：請將 ipapi.co 加入阻擋器允許清單，或暫停阻擋器後重新登入。',
      '驗證方式：重新登入後至系統「登入紀錄」頁，該筆若顯示大致位置即已改善；改善後將不再收到本通知。',
    ]);
    MailApp.sendEmail(email, subject, selfLines.join('\n'));
  } catch (e) { Logger.log('geo_empty 提醒信（當事人）寄送失敗：' + e.message); }
}

// 回傳指定使用者的登入紀錄（新到舊），每筆標記 revoked（已登出註銷或已過期）與是否為本次 session。
function sessionsListForUser_(userEmail, params, ctx) {
  var data = { sessions: [] };
  try {
    var fileId = resolvePathToId_('sessions.json', ctx);
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() < 400) {
      try { data = JSON.parse(res.getContentText()); } catch (_) { data = { sessions: [] }; }
      if (!data || !Array.isArray(data.sessions)) data = { sessions: [] };
    }
  } catch (_) {}
  var rb = sessionRevokedBeforeMap_()[userEmail];
  var nowSec = Math.floor(Date.now() / 1000);
  var curJti = String((params && params.currentJti) || '');
  var mine = data.sessions.filter(function (s) { return s && s.email === userEmail; });
  mine.sort(function (a, b) { return (b.issuedAtMs || 0) - (a.issuedAtMs || 0); });
  mine.forEach(function (s) {
    s.expired = Number(s.exp) <= nowSec;
    s.revoked = !!(rb && Number(s.iat) < Number(rb));
    s.active  = !s.expired && !s.revoked;
    s.current = curJti && s.jti === curJti;
  });
  return { sessions: mine };
}

// #13 診斷：於 GAS 編輯器手動執行一次，印出 Google 日曆「事件」實際可用的顏色數與色碼。
// 用來確認事件色究竟是 11 還是 24（進階 Calendar 服務已於 appsscript.json 啟用）。
function dumpGcEventColors() {
  var colors = Calendar.Colors.get();
  var ev = (colors && colors.event) || {};
  var keys = Object.keys(ev);
  Logger.log('GC 事件可用色數：' + keys.length);
  keys.forEach(function (k) { Logger.log('  colorId ' + k + ' → ' + ev[k].background); });
  return keys.length;
}

// ── 使用者授權閘 ──────────────────────────────────────────────────────────────
// 授權的唯一真實來源＝「本部署自己固定的 config.json」（永遠用本環境 ROOT_FOLDER_ID /
// CONFIG_FILE_ID_OVERRIDE，絕不看請求帶入的 rootFolderId／ctx）。
//   ⚠️ 這是修補 F1（授權快取跨 root 汙染）的關鍵：先前 isAuthorizedUser_ 從 ctx.root 讀 config，
//   而 issues.json 例外允許 ctx.root＝前端傳入的任意資料夾，攻擊者放一份自己名字的假 config.json
//   即可通過授權並被快取，300 秒內改帶 prod 資料夾 ID 命中快取→全面接管。改為只讀本環境固定 config，
//   任何請求帶進來的 rootFolderId 都不影響「你是不是被授權的人」判定，攻擊鏈斷。
// fail-closed：config 讀不到一律拒絕（BOOTSTRAP_ADMINS 例外，避免 config 全毀時管理者被鎖死）。
// users 表以 CacheService 快取 5 分鐘（key 綁定本環境 config 來源），避免每個請求都多讀一次 config。
// 副作用：新增/停用/改角色後，後端授權狀態最多延遲 5 分鐘生效。
function localConfigUsers_() {
  var cache = CacheService.getScriptCache();
  var CK = 'cfgusers:' + (CONFIG_FILE_ID_OVERRIDE || ROOT_FOLDER_ID);
  try { var hit = cache.get(CK); if (hit) return JSON.parse(hit); } catch (_) {}
  try {
    var cfgId = CONFIG_FILE_ID_OVERRIDE ||
      resolvePathToId_('config.json', { root: ROOT_FOLDER_ID, configOverride: CONFIG_FILE_ID_OVERRIDE });
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + cfgId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    var cfg = JSON.parse(res.getContentText());
    var users = (cfg && cfg.users) || {};
    try { cache.put(CK, JSON.stringify(users), 300); } catch (_) {}
    return users;
  } catch (e) { return null; }
}

// 純決策（可單元測試）：跨環境 rootFolderId 例外——只有「存取固定 ISSUES_FOLDER_ID 內的 issues.json」
// 才放行，其餘一律拒絕。杜絕「攻擊者帶自建 folderId 讓授權改讀假 config」的 F1 攻擊鏈。
function issuesExceptionAllowed_(rootFolderId, actionPath, issuesFolderId) {
  return actionPath === 'issues.json' && rootFolderId === issuesFolderId;
}

// 純決策（可單元測試，見 test/authz-gate.test.js）：給定 users 表、email、緊急備援名單，是否放行。
// users 為 null（config 讀不到）＝ fail-closed 拒絕；BOOTSTRAP_ADMINS 不受此限。
function authzDecision_(users, userEmail, bootstrapAdmins) {
  if (!userEmail) return false;
  if (bootstrapAdmins && bootstrapAdmins.indexOf(userEmail) !== -1) return true;
  if (!users) return false;
  var u = users[userEmail];
  return !!u && u.disabled !== true;
}

function isAuthorizedUser_(userEmail) {
  if (!userEmail) return false;
  if (BOOTSTRAP_ADMINS.indexOf(userEmail) !== -1) return true;  // 短路：免讀 config
  return authzDecision_(localConfigUsers_(), userEmail, BOOTSTRAP_ADMINS);
}

// ── P0-2/P0-3：角色分層與皇冠珠寶保護 ─────────────────────────────────────────
// 純決策（可單元測試，見 test/authz-gate.test.js）：是否為管理者。
// 判定基準與前端 index.html 一致：role==='主任' 或 isAdmin===true 或 extraRole==='管理者'。
// users 為 null／停用／查無 → 非管理者（fail-closed）；BOOTSTRAP_ADMINS 不受此限。
function adminDecision_(users, userEmail, bootstrapAdmins) {
  if (!userEmail) return false;
  if (bootstrapAdmins && bootstrapAdmins.indexOf(userEmail) !== -1) return true;
  if (!users) return false;
  var u = users[userEmail];
  if (!u || u.disabled === true) return false;
  return u.role === '主任' || u.isAdmin === true || u.extraRole === '管理者';
}

function isAdminUser_(userEmail) {
  if (!userEmail) return false;
  if (BOOTSTRAP_ADMINS.indexOf(userEmail) !== -1) return true;
  return adminDecision_(localConfigUsers_(), userEmail, BOOTSTRAP_ADMINS);
}

// 純決策（可單元測試）：shareCalendarWriters 的非管理者路徑——emails 必須恰為「自己一人」。
function shareToSelfOnly_(emails, userEmail) {
  return Array.isArray(emails) && emails.length === 1 && !!userEmail && emails[0] === userEmail;
}

// ── R1：個案物件級授權（IDOR 修補，第一階段 shadow 模式）───────────────────────
// 破口：readJson_/readJsonById_ 先前零授權檢查，任何過 isAuthorizedUser_ 授權閘的人可直呼
// 讀取任意個案 chunk（含他人個案）——前端的 scoped 載入只是 UI 篩選，不是真正的邊界。
// 可見性政策＝最小權限：主任／系統管理者／管理者看全部；其他人（含專任）只看「自己相關」的個案
// （主責／同 base 學期 co-counselor／個管 allowedCases／初談者／督導 supervisee／義輔窗口／未派案
// 全員可見）；危機閱讀 carve-out：case_access_log.json 內「當日、本人、該 caseId」的 type:'grant'
// 仍放行。以下純函式照移植 dev/index.html 對應邏輯（openDateToSemPrefix/_semKeyBase/
// _getLatestCounselorEmail/_getLatestSemCounselorEmails/_isInitialInterviewerOfCase/
// _caseVisibleToUser），語意須完全一致（單元測試見 test/case-authz.test.js）。
// CASE_AUTHZ_MODE：'shadow' 只記錄會擋什麼、不真的擋（本階段）；驗證各角色判定皆正確後才翻 'enforce'。
var CASE_AUTHZ_MODE = 'enforce';

// 學期前綴換算（＝前端 openDateToSemPrefix，語意一致）
function openDateToSemPrefix_(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  var rocYear = d.getFullYear() - 1911;
  var month = d.getMonth() + 1;
  if (month >= 8) return rocYear + '1';
  if (month === 1) return (rocYear - 1) + '1';
  return (rocYear - 1) + '2';
}

// sem key 去掉 '#N' 後綴取 base（＝前端 _semKeyBase，供同 base 學期多筆開案比對）
function semKeyBase_(key) {
  if (!key) return '';
  var i = key.indexOf('#');
  return i === -1 ? key : key.slice(0, i);
}

// 個案「最新學期」主責 email：往前找第一個有值的快照，皆無則 fallback 頂層 counselorEmail。
function caseLatestCounselorEmail_(c) {
  var sems = (Array.isArray(c.semesters) && c.semesters.length
    ? c.semesters.slice() : [openDateToSemPrefix_(c.openDate)].filter(Boolean)).sort();
  for (var i = sems.length - 1; i >= 0; i--) {
    var snap = c.basicInfoSnapshots && c.basicInfoSnapshots[sems[i]];
    if (snap && snap.counselorEmail) return snap.counselorEmail;
  }
  return c.counselorEmail || '';
}

// 最新 base 學期（可能有多筆 #N 開案）所有不重複的主責 email（供同 base 學期 co-counselor 互相可見）。
function caseLatestSemCounselorEmails_(c) {
  var sems = (Array.isArray(c.semesters) && c.semesters.length
    ? c.semesters.slice() : [openDateToSemPrefix_(c.openDate)].filter(Boolean)).sort();
  if (!sems.length) return [];
  var latestBase = semKeyBase_(sems[sems.length - 1]);
  var emails = sems.filter(function (s) { return semKeyBase_(s) === latestBase; })
    .map(function (s) { return c.basicInfoSnapshots && c.basicInfoSnapshots[s] && c.basicInfoSnapshots[s].counselorEmail; })
    .filter(Boolean);
  var seen = {}, out = [];
  emails.forEach(function (e) { if (!seen[e]) { seen[e] = true; out.push(e); } });
  return out;
}

// 是否為此案初次晤談者（完整資料 initialInterview/initialInterviews；index-only 個案 fallback interviewerEmails）。
function isInitialInterviewerOfCase_(c, email) {
  if (!email) return false;
  if (c.initialInterview && c.initialInterview.interviewerEmail === email) return true;
  if (c.initialInterviews) {
    var vals = Object.values(c.initialInterviews);
    for (var i = 0; i < vals.length; i++) { if (vals[i] && vals[i].interviewerEmail === email) return true; }
    return false;
  }
  if (!c.initialInterview && !c.initialInterviews && Array.isArray(c.interviewerEmails)) {
    return c.interviewerEmails.indexOf(email) !== -1;
  }
  return false;
}

// 個案對某使用者是否可見（非 full-access 角色的可見性單一真相；users＝config.users map）。
function caseVisibleToUser_(c, email, users) {
  if (!email) return false;
  var lat = caseLatestCounselorEmail_(c);
  if (!lat) return true; // 未派案：全員可見
  if (lat === email) return true; // 主責
  if (caseLatestSemCounselorEmails_(c).indexOf(email) !== -1) return true; // 同 base 學期多筆開案互相可見
  var u = users || {};
  var allowedCases = (u[email] && u[email].allowedCases) || [];
  if (allowedCases.indexOf(c.id) !== -1) return true; // 個管（手動）
  if (isInitialInterviewerOfCase_(c, email)) return true; // 初次晤談者
  var supervisees = (u[email] && u[email].superviseeEmails) || [];
  if (Array.isArray(supervisees) && supervisees.indexOf(lat) !== -1) return true; // 督導當然個管
  if (u[email] && u[email].isVolunteerContact === true && u[lat] && u[lat].role === '義務輔導老師') return true; // 義輔窗口
  return false;
}

// 是否享有全案可見（主任／系統管理者／isAdmin／extraRole 管理者）；停用帳號 fail-closed 不享。
function caseFullAccessRole_(email, users) {
  var u = (users || {})[email];
  if (!u || u.disabled === true) return false;
  return u.role === '主任' || u.role === '系統管理者' || u.isAdmin === true || u.extraRole === '管理者';
}

// 危機閱讀 carve-out：case_access_log.json 內「當日、本人、該 caseId」的 grant。
function caseHasCrisisGrant_(caseId, email, accessLogEntries, todayStr) {
  return (accessLogEntries || []).some(function (e) {
    return e && e.type === 'grant' && e.email === email && e.caseId === caseId
      && String(e.t || '').slice(0, 10) === todayStr;
  });
}

// 綜合判定（可測）：full-access → 可見性判定 → 危機當日 grant。
function caseAllowedForRead_(c, email, users, accessLogEntries, todayStr) {
  if (caseFullAccessRole_(email, users)) return true;
  if (caseVisibleToUser_(c, email, users)) return true;
  return caseHasCrisisGrant_(c.id, email, accessLogEntries, todayStr);
}

// 本環境 config.json 的 fileId：prod 用寫死的 CONFIG_FILE_ID_OVERRIDE，dev 走路徑解析並快取 5 分鐘。
function localConfigFileId_() {
  if (CONFIG_FILE_ID_OVERRIDE) return CONFIG_FILE_ID_OVERRIDE;
  var cache = CacheService.getScriptCache();
  var CK = 'cfgfid:' + ROOT_FOLDER_ID;
  try { var hit = cache.get(CK); if (hit) return hit; } catch (_) {}
  try {
    var id = resolvePathToId_('config.json', { root: ROOT_FOLDER_ID, configOverride: null });
    if (id) { try { cache.put(CK, id, 300); } catch (_) {} }
    return id;
  } catch (_) { return null; }
}

// 讀「當前」config.json 全文（不走快取，確保 P0-2 寫入前 diff 用的是最新版）。
function readConfigFresh_() {
  try {
    var id = localConfigFileId_();
    if (!id) return null;
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (e) { return null; }
}

// ── P0-2：config.json 寫入的授權面保護 ──
// 純決策（可單元測試）：此動作是否為「寫 config.json」。
function isConfigWrite_(action, params, cfgFileId) {
  if (!params) return false;
  if (action === 'updateJson')        return params.path === 'config.json';
  if (action === 'createJson')        return params.name === 'config.json';
  if (action === 'updateContentById') return !!cfgFileId && params.fileId === cfgFileId;
  return false;
}

// 深度相等（純函式；供 _configUsersUnchanged_ 比較 users 物件）。
function _deepEq_(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (!a || !b || typeof a !== 'object') return false;
  var ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (var i = 0; i < ak.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(b, ak[i])) return false;
    if (!_deepEq_(a[ak[i]], b[ak[i]])) return false;
  }
  return true;
}

// 純決策（可單元測試，見 test/authz-gate.test.js）：非管理者整檔寫 config.json 時，users 物件
// 是否與後端當下最新版（oldCfg，來自 readConfigFresh_）完全相同——v164 用此取代 P0-2 的欄位級
// diff 比對（那個比對方式仍是字面「整檔覆寫」，只是內容受限，非管理者仍可能在比對縫隙夾帶
// 自授個案存取權／覆寫他人併發變動／把讀到寫之間別人的異動蓋回）。只要 users 有任何差異
// 就整批視為「有變動」（拒絕），不比對個別欄位，杜絕字面 diff 檢查的縫隙；config.json 內非
// users 的全域共用設定（自訂選項清單等）不受影響，非管理者本就合法會寫的其他欄位維持可寫。
// oldCfg 為 null（讀不到當前 config）或任一方 users 非物件 → fail-closed 視為「有變動」（拒絕）。
function _configUsersUnchanged_(oldCfg, newCfg) {
  if (!oldCfg || !newCfg || typeof oldCfg !== 'object' || typeof newCfg !== 'object') return false;
  var oldUsers = oldCfg.users, newUsers = newCfg.users;
  if (!oldUsers || typeof oldUsers !== 'object' || Array.isArray(oldUsers)) return false;
  if (!newUsers || typeof newUsers !== 'object' || Array.isArray(newUsers)) return false;
  return _deepEq_(oldUsers, newUsers);
}

// ── F3：fileId/parentId 類動作限制在本次 ctx.root 子樹 ──
// 純函式（getParents 注入，可單元測試）：沿 parents 鏈自 fileId 往上找，能到 rootId 即為 root 子孫。
function _ancestorContains_(getParents, fileId, rootId, maxHops) {
  if (!fileId || !rootId) return false;
  var seen = {};
  var frontier = [fileId];
  var hops = 0;
  var limit = maxHops || 25;
  while (frontier.length && hops < limit) {
    var next = [];
    for (var i = 0; i < frontier.length; i++) {
      var id = frontier[i];
      if (id === rootId) return true;
      if (seen[id]) continue;
      seen[id] = true;
      var parents = getParents(id) || [];
      for (var j = 0; j < parents.length; j++) next.push(parents[j]);
    }
    frontier = next;
    hops++;
  }
  return false;
}

// fileId 是否為 rootId 的子孫（含自身）；正向結果快取 30 分鐘（fileId 的 parents 幾乎不變）。
function isUnderRoot_(fileId, rootId) {
  if (!fileId || !rootId) return false;
  if (fileId === rootId) return true;
  var cache = CacheService.getScriptCache();
  var CK = 'inroot:' + String(rootId).slice(-24) + ':' + String(fileId).slice(-40);
  try { if (cache.get(CK) === '1') return true; } catch (_) {}
  var ok = _ancestorContains_(function(id) {
    try { return (driveGet_('files/' + id, { fields: 'parents' }) || {}).parents || []; }
    catch (e) { return []; }
  }, fileId, rootId, 25);
  if (ok) { try { cache.put(CK, '1', 1800); } catch (_) {} }
  return ok;
}

// ── P1：downloadFileBase64 跨 root 附件白名單（issue/留言附件跨環境合法情境）──
// 純函式（可單元測試）：附件清單（issue.attachments 或 comment.attachments）內是否含此 fileId。
function _attachListHasFileId_(list, fileId) {
  if (!Array.isArray(list) || !fileId) return false;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].fileId === fileId) return true;
  }
  return false;
}

// 純函式（可單元測試）：issues.json 內容（{issues:[...]}）是否記錄了此 fileId 為某筆 issue
// 本身或其留言（comments）的附件。issuesJson 為 null／格式不符 → false（fail-closed 由呼叫端處理）。
function issuesHasAttachment_(issuesJson, fileId) {
  if (!fileId || !issuesJson || !Array.isArray(issuesJson.issues)) return false;
  for (var i = 0; i < issuesJson.issues.length; i++) {
    var iss = issuesJson.issues[i];
    if (!iss) continue;
    if (_attachListHasFileId_(iss.attachments, fileId)) return true;
    var comments = Array.isArray(iss.comments) ? iss.comments : [];
    for (var j = 0; j < comments.length; j++) {
      if (_attachListHasFileId_(comments[j] && comments[j].attachments, fileId)) return true;
    }
  }
  return false;
}

// ── P1：query action 限根 ──
// 純函式（可單元測試）：從 Drive q 字串中抽出所有 "'ID' in parents" 引用的 ID。
// 前端 q 皆由固定樣板字串拼接而成，ID 段本身不含引號（既有 _escQ_ 已跳脫 name 段的單引號/反斜線），
// 故用簡單字串比對即可，不需處理跳脫。
// 不用 regex 字面值（同 _escQ_ 的理由：regex 內含單引號會被 test/harness.js 的 matchBrace
// 誤判為字串邊界，破壞括號配對抽取），改以字串掃描實作。
function _extractParentsIds_(q) {
  var out = [];
  if (typeof q !== 'string' || !q) return out;
  var marker = 'in parents';
  var searchFrom = 0;
  while (true) {
    var idx = q.indexOf(marker, searchFrom);
    if (idx === -1) break;
    // 往前跳過空白，緊接著應是右引號，再往前找對應左引號，中間即為 ID
    var j = idx - 1;
    while (j >= 0 && q.charAt(j) === ' ') j--;
    if (j >= 0 && q.charAt(j) === "'") {
      var closeQuote = j;
      var k = closeQuote - 1;
      while (k >= 0 && q.charAt(k) !== "'") k--;
      if (k >= 0) out.push(q.slice(k + 1, closeQuote));
    }
    searchFrom = idx + marker.length;
  }
  return out;
}

// 純函式（可單元測試）：q 字串剝除單引號字串段後，是否含 or／not 運算子。
// 若放行 or，攻擊者可用「'合法ID' in parents or trashed=false」讓 parents 條件失去約束力；
// not 同理可反轉範圍。前端所有 q 樣板只用 and 串接，擋掉 or/not 不影響既有功能。
// 引號內容（name 值，經 _escQ_ 以 \' 跳脫）先剝除，避免檔名含 "or" 字樣被誤殺。
// 同 _extractParentsIds_ 的理由不用 regex 字面值，逐字元掃描。
function _qHasForbiddenOp_(q) {
  var word = '';
  var inStr = false;
  for (var i = 0; i <= q.length; i++) {
    var ch = i < q.length ? q.charAt(i) : ' ';
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") { inStr = true; word = ''; continue; }
    var lc = ch.toLowerCase();
    var isWordCh = (lc >= 'a' && lc <= 'z') || (lc >= '0' && lc <= '9') || lc === '_';
    if (isWordCh) { word += lc; continue; }
    if (word === 'or' || word === 'not') return true;
    word = '';
  }
  return false;
}

// 純函式（checkUnderRoot 注入，可單元測試，仿 _ancestorContains_ 的注入手法）：
// q 字串是否只查詢 root 子樹內的資料夾——至少要有一個 parents 條件、不得含 or/not
// 運算子（僅准 and 串接，否則 parents 條件會被 or 稀釋而失去約束力），且每一個 ID 都須通過
// checkUnderRoot（root 本身亦合法：'root' in parents 語意為列出 root 的子項）。
// 不含任何 parents 條件的 q 一律拒絕（防止枚舉任意資料夾/檔案）。
function queryParentsAllowed_(q, checkUnderRoot) {
  var ids = _extractParentsIds_(q);
  if (!ids.length) return false;
  if (_qHasForbiddenOp_(q)) return false;
  for (var i = 0; i < ids.length; i++) {
    if (!checkUnderRoot(ids[i])) return false;
  }
  return true;
}

// ── P1：moveFile 目的地檢查 ──
// 純函式（checkUnderRoot 注入，可單元測試）：moveFile 的 addParents（目的地資料夾）是否都在
// root 子樹下。addParents 可能是逗號分隔的多個 parent ID（Drive API 支援一次掛多個父層），
// 每一個都須通過檢查；空值／全部無效 → 拒絕。
function moveFileDestAllowed_(addParents, checkUnderRoot) {
  if (!addParents) return false;
  var ids = String(addParents).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!ids.length) return false;
  for (var i = 0; i < ids.length; i++) {
    if (!checkUnderRoot(ids[i])) return false;
  }
  return true;
}

// 非管理者新增使用者 key 的唯一合法情境：轉銜窗口「自填新增輔導人員」建立 nomail_ 佔位帳號
// （無 Gmail、無法登入，僅作主責標記）。條目不得夾帶任何特權：role 不得為主任/系統管理者、
// 不得帶 isAdmin/extraRole/窗口旗標/leaveQuota，disabled 只能是 false/未設。
// v164：供 applyCasesPatchOps_ 的 nomailAdd op 使用（原本供已刪除的 configWriteAllowedForNonAdmin_
// 整檔 diff 比對使用，該函式與其僅存的呼叫路徑已隨 v164「非管理者整檔寫入全面 deny」一併移除）。
function _nomailAddOk_(key, entry) {
  if (typeof key !== 'string' || key.indexOf('nomail_') !== 0) return false;
  if (!entry || typeof entry !== 'object') return false;
  if (entry.role === '主任' || entry.role === '系統管理者') return false;
  if (entry.isAdmin || entry.extraRole || entry.isTransferContact ||
      entry.isMentalLeaveContact || entry.leaveQuota !== undefined) return false;
  if (entry.disabled !== undefined && entry.disabled !== false) return false;
  return true;
}

// ── 回應工具 ──────────────────────────────────────────────────────────────────

function jsonResp_(data) {
  return ContentService.createTextOutput(JSON.stringify({ success: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Drive API 底層 ────────────────────────────────────────────────────────────

function tok_() { return ScriptApp.getOAuthToken(); }

function driveGet_(path, qParams) {
  const base = { supportsAllDrives: true, includeItemsFromAllDrives: true };
  const merged = Object.assign(base, qParams || {});
  const qs = Object.entries(merged).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/' + path + '?' + qs,
    { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
  );
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(body.error && body.error.message || 'Drive error');
  return body;
}

function drivePatch_(fileId, metadata) {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?supportsAllDrives=true',
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + tok_(), 'Content-Type': 'application/json' },
      payload: JSON.stringify(metadata),
      muteHttpExceptions: true
    }
  );
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(body.error && body.error.message || 'Drive error');
  return body;
}

function driveDelete_(fileId) {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?supportsAllDrives=true',
    { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() >= 400) {
    const body = JSON.parse(res.getContentText() || '{}');
    throw new Error(body.error && body.error.message || 'Delete error');
  }
  return { ok: true };
}

function driveUpload_(name, jsonContent, parentId) {
  const body = JSON.stringify(jsonContent);
  const boundary = 'scc_boundary';
  const metadata = JSON.stringify({ name: name, mimeType: 'application/json', parents: [parentId] });
  const multipart =
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    metadata + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: application/json\r\n\r\n' +
    body + '\r\n' +
    '--' + boundary + '--';
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tok_(),
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      payload: multipart,
      muteHttpExceptions: true
    }
  );
  const data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.error && data.error.message || 'Upload error');
  return data;
}

function driveUpdateContent_(fileId, jsonContent) {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media&supportsAllDrives=true',
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + tok_(), 'Content-Type': 'application/json' },
      payload: JSON.stringify(jsonContent),
      muteHttpExceptions: true
    }
  );
  const data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.error && data.error.message || 'Update error');
  return data;
}

// Drive query 字串跳脫（F4）：path/name 元件內的反斜線與單引號可注入或破壞 Drive 查詢子句，一律跳脫。
// 之後所有以字串拼接進 Drive `q` 的使用者可控 name 元件都須包這層。
function _escQ_(s) {
  // 先跳脫反斜線再跳脫單引號（順序重要）。用 split/join 而非 regex 字面值，
  // 以相容 test/harness.js 的就地抽取（其 matchBrace 不解析 regex literal）。
  return String(s == null ? '' : s).split('\\').join('\\\\').split("'").join("\\'");
}

// 路徑解析：把 "cases/manifest.json" 轉成 fileId
function resolvePathToId_(path, ctx) {
  if (path === 'config.json' && ctx.configOverride) return ctx.configOverride;
  const parts = path.split('/');
  let curId = ctx.root;
  for (let i = 0; i < parts.length - 1; i++) {
    const q = "name='" + _escQ_(parts[i]) + "' and mimeType='application/vnd.google-apps.folder'" +
              " and '" + curId + "' in parents and trashed=false";
    const res = driveGet_('files', { q: q, fields: 'files(id)', pageSize: '1' });
    if (!res.files || res.files.length === 0) throw new Error('Folder not found: ' + parts[i]);
    curId = res.files[0].id;
  }
  const fileName = parts[parts.length - 1];
  const q2 = "name='" + _escQ_(fileName) + "' and '" + curId + "' in parents and trashed=false";
  const res2 = driveGet_('files', { q: q2, fields: 'files(id)', orderBy: 'modifiedTime desc', pageSize: '5' });
  if (!res2.files || res2.files.length === 0) throw new Error('File not found: ' + path);
  if (res2.files.length > 1) {
    res2.files.slice(1).forEach(function(f) { try { drivePatch_(f.id, { trashed: true }); } catch(e) {} });
  }
  return res2.files[0].id;
}

function resolvePathToParentAndName_(path, ctx) {
  const parts = path.split('/');
  const fileName = parts[parts.length - 1];
  let parentId = ctx.root;
  for (let i = 0; i < parts.length - 1; i++) {
    const q = "name='" + _escQ_(parts[i]) + "' and mimeType='application/vnd.google-apps.folder'" +
              " and '" + parentId + "' in parents and trashed=false";
    const res = driveGet_('files', { q: q, fields: 'files(id)', pageSize: '1' });
    if (!res.files || res.files.length === 0) throw new Error('Folder not found: ' + parts[i]);
    parentId = res.files[0].id;
  }
  return { parentId, fileName };
}

// ── Drive Actions ─────────────────────────────────────────────────────────────

function getMetadata_({ fileId, fields }) {
  return driveGet_('files/' + fileId, { fields: fields || 'id,name,mimeType' });
}

function readJson_({ path }, ctx, userEmail) {
  const fileId = resolvePathToId_(path, ctx);
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() >= 400) throw new Error('readJson failed: ' + path);
  const parsed = JSON.parse(res.getContentText());
  return _caseAuthzApply_(parsed, userEmail, ctx, path);
}

function readJsonById_({ fileId }, ctx, userEmail) {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() >= 400) throw new Error('readJsonById failed: ' + fileId);
  const parsed = JSON.parse(res.getContentText());
  return _caseAuthzApply_(parsed, userEmail, ctx, fileId);
}

// R1：readJson_/readJsonById_ 讀完內容後的個案物件級授權關卡。
// 啟發式判定「個案資料檔」：parsed.cases 為陣列（涵蓋 chunk/cases-hot/cases-index，皆此結構），
// chunk 若為裸陣列（parsed 本身是 Array）也一併支援。非個案檔或 caller 為 full-access（看全部）
// → 完全不動、不記錄，原樣回傳（含效能考量：只有非 full-access 讀個案檔才多讀一次 access log）。
// shadow 模式（CASE_AUTHZ_MODE='shadow'）：只 Logger.log 會擋幾筆，原樣回傳完整內容，不過濾。
// enforce 模式：才真正 filter parsed.cases（目前恆為 shadow，此分支不會執行）。
// R1 enforce：對「無權查閱」的個案只保留 metadata，剝除全部臨床內容與敏感 PII。
// 保留＝cases-index 用來做搜尋/AB 徽章/危機閱讀申請顯示的欄位（前端就靠這些找到並辨識個案），
//   但刻意扣掉 idNumber（身分證）與 phone——搜尋/徽章/危機申請都用不到，屬最敏感 PII。
// 剝除＝晤談 records／精神科 psychiatristRecords／初談 initialInterview(s)／各學期評估 semesterEvaluations／
//   基本資料快照 basicInfoSnapshots 的臨床內容（僅留 counselorEmail/abType 供可見性重算與徽章）。
// 白名單自足（不引用外部常數）以便單元測試就地抽取。
function caseStripForRead_(c) {
  var KEEP = ['id', 'name', 'studentId', 'archived', 'deleted', 'counselorEmail', 'counselorName',
    'counselorText', 'interviewerEmails', 'department', 'grade', 'openDate', 'updatedAt',
    'lastActivityAt', 'status', 'abType', 'caseType', 'isTransferCase', 'hasPsyEval', 'semesters', 'chunk'];
  var out = {};
  KEEP.forEach(function (k) { if (c[k] !== undefined) out[k] = c[k]; });
  if (c.basicInfoSnapshots && typeof c.basicInfoSnapshots === 'object') {
    out.basicInfoSnapshots = {};
    Object.keys(c.basicInfoSnapshots).forEach(function (sem) {
      var s = c.basicInfoSnapshots[sem] || {};
      var kept = {};
      if (s.counselorEmail !== undefined) kept.counselorEmail = s.counselorEmail;
      if (s.abType !== undefined) kept.abType = s.abType;
      out.basicInfoSnapshots[sem] = kept;
    });
  }
  if (c.semesterStatus) out.semesterStatus = c.semesterStatus;
  out._authzStripped = true; // 標記：臨床內容已因權限剝除（前端可據此提示「需危機閱讀」）
  return out;
}

// 讀 case_access_log.json 的 entries，CacheService 快取 60 秒——scoped 載入會逐 chunk 各發一個
// readJsonById 請求，快取降低跨請求重複讀（超過快取上限則 put 失敗、退回每次讀，不影響正確性）。
function _readAccessLogCached_(ctx) {
  var cache = CacheService.getScriptCache();
  var CK = 'r1accesslog:' + ROOT_FOLDER_ID;
  try { var hit = cache.get(CK); if (hit) return JSON.parse(hit); } catch (_) {}
  var entries = [];
  try {
    var logData = readJson_({ path: 'case_access_log.json' }, ctx, null); // 非個案檔（{entries}），不遞迴
    if (logData && Array.isArray(logData.entries)) entries = logData.entries;
  } catch (_) {}
  try { cache.put(CK, JSON.stringify(entries), 60); } catch (_) {}
  return entries;
}

// R1：readJson_/readJsonById_ 讀完個案檔後的物件級授權關卡。
// 只認「個案資料檔」＝ parsed.cases 為陣列（cases-index/cases-hot/chunk 皆此結構）。
// ⚠ 刻意「不」認裸陣列——bookings.json 等清單檔可能是裸陣列、且 booking 亦有 counselorEmail，
//   enforce 誤判會把非管理者的預約也剝掉；個案檔一律有 .cases，只認它最安全。
// full-access（主任/系統管理者/管理者）→ 完全不動。非 full-access：可見（主責/個管/初談/督導/義輔/
//   未派案）或當日危機授權 → 原樣；否則剝成 metadata（caseStripForRead_）。
// shadow 模式：只 Logger 記錄剝除筆數、原樣回傳；enforce 模式：實際回傳剝除後內容。
function _caseAuthzApply_(parsed, userEmail, ctx, label) {
  if (!parsed || !Array.isArray(parsed.cases)) return parsed;
  const casesArr = parsed.cases;

  const users = localConfigUsers_() || {};
  if (caseFullAccessRole_(userEmail, users)) return parsed; // full-access：完全不動

  const todayStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  let accessLog = null; // lazy：只有出現「非直接可見」的案才讀危機授權
  const grantsFor = function () { if (accessLog === null) accessLog = _readAccessLogCached_(ctx); return accessLog; };

  let strippedCount = 0;
  const outCases = casesArr.map(function (c) {
    if (!c || !c.id) return c;
    if (caseVisibleToUser_(c, userEmail, users)) return c;                          // 直接可見
    if (caseHasCrisisGrant_(c.id, userEmail, grantsFor(), todayStr)) return c;      // 危機閱讀授權
    strippedCount++;
    return caseStripForRead_(c);                                                    // 無權 → 剝臨床
  });

  if (strippedCount) {
    Logger.log('[R1-' + CASE_AUTHZ_MODE + '] user=' + userEmail + ' file=' + label
      + ' 總' + casesArr.length + '筆 剝除臨床' + strippedCount + '筆');
  }

  if (CASE_AUTHZ_MODE === 'enforce') {
    const out = {};
    for (const k in parsed) out[k] = parsed[k];
    out.cases = outCases;
    return out;
  }
  return parsed; // shadow：只記錄，原樣回傳完整內容
}

function createJson_({ name, content, parentId }) {
  return driveUpload_(name, content, parentId);
}

function updateContentById_({ fileId, content }) {
  return driveUpdateContent_(fileId, content);
}

function updateJson_({ path, content }, ctx) {
  let fileId;
  try {
    fileId = resolvePathToId_(path, ctx);
  } catch (notFound) {
    const { parentId, fileName } = resolvePathToParentAndName_(path, ctx);
    const verify = driveGet_('files', {
      q: "name='" + _escQ_(fileName) + "' and '" + parentId + "' in parents and trashed=false",
      fields: 'files(id)', orderBy: 'modifiedTime desc', pageSize: '5'
    });
    if (verify.files && verify.files.length > 0) {
      fileId = verify.files[0].id;
      verify.files.slice(1).forEach(function(f) { try { drivePatch_(f.id, { trashed: true }); } catch(e) {} });
    } else {
      return driveUpload_(fileName, content, parentId);
    }
  }
  return driveUpdateContent_(fileId, content);
}

function createFolder_({ name, parentId }) {
  const metadata = JSON.stringify({
    name: name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId]
  });
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + tok_(), 'Content-Type': 'application/json' },
      payload: metadata,
      muteHttpExceptions: true
    }
  );
  const data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.error && data.error.message || 'createFolder error');
  return data;
}

function trashFile_({ fileId }) {
  return drivePatch_(fileId, { trashed: true });
}

function deleteFile_({ fileId }) {
  return driveDelete_(fileId);
}

function moveFile_({ fileId, addParents, removeParents }) {
  const res = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId +
    '?addParents=' + encodeURIComponent(addParents) +
    '&removeParents=' + encodeURIComponent(removeParents) +
    '&supportsAllDrives=true&fields=id,parents',
    {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + tok_(), 'Content-Type': 'application/json' },
      payload: '{}',
      muteHttpExceptions: true
    }
  );
  const data = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 400) throw new Error(data.error && data.error.message || 'moveFile error');
  return data;
}

function driveQuery_({ q, fields, pageSize }) {
  return driveGet_('files', {
    q: q,
    fields: 'files(' + (fields || 'id,name,mimeType') + ')',
    pageSize: String(pageSize || 100)
  });
}

function listFolder_({ folderId, fields, pageSize }) {
  return driveGet_('files', {
    q: "'" + folderId + "' in parents and trashed=false",
    fields: 'files(' + (fields || 'id,name,mimeType') + ')',
    pageSize: String(pageSize || 400)
  });
}

function resolveDir_({ path }, ctx) {
  const parts = path.split('/');
  let curId = ctx.root;
  for (let i = 0; i < parts.length; i++) {
    const q = "name='" + _escQ_(parts[i]) + "' and mimeType='application/vnd.google-apps.folder'" +
              " and '" + curId + "' in parents and trashed=false";
    const res = driveGet_('files', { q: q, fields: 'files(id)', pageSize: '1' });
    if (!res.files || res.files.length === 0) throw new Error('Folder not found: ' + parts[i]);
    curId = res.files[0].id;
  }
  return { id: curId };
}

function listDir_({ path, fields, pageSize }, ctx) {
  const { id: folderId } = resolveDir_({ path }, ctx);
  return driveGet_('files', {
    q: "'" + folderId + "' in parents and trashed=false",
    fields: 'files(' + (fields || 'id,name,mimeType') + ')',
    pageSize: String(pageSize || 400)
  });
}

// ── Calendar Actions ──────────────────────────────────────────────────────────

function getOrCreateCalendar_(ctx) {
  const name = (ctx && ctx.calendarName) || CALENDAR_NAME;
  const cals = CalendarApp.getCalendarsByName(name);
  if (cals.length === 1) return cals[0];
  if (cals.length > 1) {
    throw new Error('找到 ' + cals.length + ' 顆同名日曆「' + name + '」，請確認共用設定，移除或改名多餘的日曆後再試。');
  }
  throw new Error('找不到日曆「' + name + '」，請確認執行帳號已被加入該日曆共用名單，且權限為「進行變更並管理共用設定」。');
}

function parseEventTimes_(date, startTime, endTime) {
  const [y, m, d] = date.split('-').map(Number);
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  return {
    start: new Date(y, m - 1, d, sh, sm),
    end:   new Date(y, m - 1, d, eh, em)
  };
}

function buildEventTitle_(room, counselorName, customRoom) {
  const roomPart = (room === '其他') ? (customRoom || '其他') : (room ? room.charAt(0) : '');
  return counselorName ? roomPart + '.' + counselorName : roomPart;
}

function buildEventDesc_(actorName, notes, dateTime, bkSerial, isEdit) {
  const verb = isEdit ? '編輯' : '建立';
  const pad = n => String(n).padStart(2, '0');
  let desc = notes ? notes.trim() : '';
  let actorLine = '';
  if (actorName || dateTime) {
    let dtStr = '';
    if (dateTime) {
      const d = new Date(dateTime);
      dtStr = ' ' + d.getFullYear() + '/' + pad(d.getMonth()+1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    actorLine = (actorName || '') + ' ' + verb + dtStr;
  }
  if (actorLine) desc += (desc ? '\n---\n' : '---\n') + actorLine;
  if (bkSerial) desc += '\n#' + String(bkSerial).padStart(4, '0');
  return desc;
}

function createCalendarEvent_({ room, customRoom, date, startTime, endTime, counselorName, notes, creatorName, createdAt, bkSerial, colorId }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const { start, end } = parseEventTimes_(date, startTime, endTime);
  const title = buildEventTitle_(room, counselorName, customRoom || '');
  const desc  = buildEventDesc_(creatorName || counselorName || '', notes, createdAt, bkSerial, false);
  const event = cal.createEvent(title, start, end, { description: desc });
  if (colorId) {
    try { event.setColor(String(colorId)); } catch (e) { /* colorId 1-11 有效；異常則沿用預設 */ }
  }
  return event.getId();
}

function updateCalendarEvent_({ eventId, room, customRoom, date, startTime, endTime, counselorName, notes, creatorName, createdAt, updatedAt, isEdit, bkSerial, colorId }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const event = cal.getEventById(eventId);
  if (!event) throw new Error('Event not found: ' + eventId);
  const { start, end } = parseEventTimes_(date, startTime, endTime);
  const actorTime = isEdit ? (updatedAt || createdAt) : createdAt;
  event.setTitle(buildEventTitle_(room, counselorName, customRoom || ''));
  event.setDescription(buildEventDesc_(creatorName || counselorName || '', notes, actorTime, bkSerial, !!isEdit));
  event.setTime(start, end);
  if (colorId) {
    try { event.setColor(String(colorId)); } catch (e) { /* 沿用既有色 */ }
  }
  return { ok: true };
}

function uploadFile_({ parentFolderId, fileName, mimeType, base64Data }) {
  const bytes = Utilities.base64Decode(base64Data);
  const blob  = Utilities.newBlob(bytes, mimeType, fileName);
  const folder = DriveApp.getFolderById(parentFolderId);
  const file  = folder.createFile(blob);
  return { fileId: file.getId(), fileName: file.getName() };
}

// issues.json 的 fileId：固定用 ISSUES_FOLDER_ID 定位（不信任請求參數），快取 5 分鐘。
// 供 doPost 的 downloadFileBase64 附件白名單檢查使用。
function issuesFileId_() {
  var cache = CacheService.getScriptCache();
  var CK = 'issuesFid';
  try { var hit = cache.get(CK); if (hit) return hit; } catch (_) {}
  try {
    var id = resolvePathToId_('issues.json', { root: ISSUES_FOLDER_ID, configOverride: null });
    if (id) { try { cache.put(CK, id, 300); } catch (_) {} }
    return id;
  } catch (_) { return null; }
}

// 讀 issues.json 全文，供 downloadFileBase64 附件白名單比對（見 issuesHasAttachment_）；
// 短快取 60 秒降低成本。fail-closed：讀不到／解析失敗一律回 null（呼叫端視為「查無此附件」而拒絕）。
function readIssuesJsonForAttachCheck_() {
  var cache = CacheService.getScriptCache();
  var CK = 'issuesJsonAttach';
  try { var hit = cache.get(CK); if (hit) return JSON.parse(hit); } catch (_) {}
  try {
    var id = issuesFileId_();
    if (!id) return null;
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;
    var data = JSON.parse(res.getContentText());
    try { cache.put(CK, JSON.stringify(data), 60); } catch (_) {}
    return data;
  } catch (e) { return null; }
}

function downloadFileBase64_({ fileId }) {
  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();
  return {
    fileName: file.getName(),
    mimeType: blob.getContentType(),
    base64:   Utilities.base64Encode(blob.getBytes()),
  };
}

function deleteCalendarEvent_({ eventId }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const event = cal.getEventById(eventId);
  if (event) event.deleteEvent();
  return { ok: true };
}

function listCalendarEvents_({ startDate, endDate }, ctx) {
  const tz  = 'Asia/Taipei';
  const cal = getOrCreateCalendar_(ctx);
  const start = new Date(startDate + 'T00:00:00+08:00');
  const end   = new Date(endDate   + 'T23:59:59+08:00');
  const events = cal.getEvents(start, end);
  return events.map(e => {
    var creators = [];
    try { creators = (e.getCreators() || []); } catch (err) { creators = []; }
    var colorId = '';
    try { colorId = String(e.getColor() || ''); } catch (err) { colorId = ''; }
    return {
      id:           e.getId(),
      title:        e.getTitle(),
      date:         Utilities.formatDate(e.getStartTime(), tz, 'yyyy-MM-dd'),
      startTime:    Utilities.formatDate(e.getStartTime(), tz, 'HH:mm'),
      endTime:      Utilities.formatDate(e.getEndTime(),   tz, 'HH:mm'),
      description:  e.getDescription() || '',
      lastModified: e.getLastUpdated().toISOString(),
      creators:     creators,
      colorId:      colorId,
    };
  });
}

// 補註 GC 事件備註：僅追加文字，不動標題/時間/既有內容。
// - 防重複：description 已含 marker（預設 '[系統補註'）時直接跳過
// - 流水號保護：description 以 #流水號 結尾時，補註插在流水號之前，讓 \n#\d+$ 解析不被破壞
function gcAnnotateEvent_({ eventId, noteText, marker }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const event = cal.getEventById(eventId);
  if (!event) throw new Error('Event not found: ' + eventId);
  const desc = event.getDescription() || '';
  const mk = marker || '[系統補註';
  if (desc.indexOf(mk) !== -1) return { ok: true, skipped: true };
  const add = String(noteText || '').slice(0, 500);
  if (!add) throw new Error('noteText required');
  const serialMatch = desc.match(/\n#\d+\s*$/);
  let newDesc;
  if (serialMatch) {
    const body = desc.slice(0, desc.length - serialMatch[0].length).replace(/\s+$/, '');
    newDesc = (body ? body + '\n---\n' : '') + add + serialMatch[0];
  } else {
    const body = desc.replace(/\s+$/, '');
    newDesc = (body ? body + '\n---\n' : '') + add;
  }
  event.setDescription(newDesc);
  return { ok: true, skipped: false };
}

// 提供前端組「開啟 Google 日曆事件」連結所需的日曆識別碼
function getCalendarMeta_(params, ctx) {
  return { calendarId: getOrCreateCalendar_(ctx).getId() };
}

// 授與（或撤除）指定 email 對本行事曆的 owner（進行變更並管理共用設定）權限
// 註：CalendarApp.addEditor()/removeEditor() 只有在日曆為執行帳號「原生擁有」時才可用，
// 對於分享而來（即使被授予「管理共用設定」）的日曆一律不存在該方法，因此改用 Calendar 進階服務（Calendar API v3 ACL）操作，
// 其授權以 ACL 角色為準，不受「原生擁有」限制。
function shareCalendarWriters_({ emails, revoke }, ctx) {
  const cal = getOrCreateCalendar_(ctx);
  const calendarId = cal.getId();
  const results = { granted: [], removed: [], errors: [] };
  (emails || []).forEach(function(email) {
    if (!email || typeof email !== 'string') return;
    const ruleId = 'user:' + email;
    try {
      if (revoke) {
        try {
          Calendar.Acl.remove(calendarId, ruleId);
        } catch (e) {
          if (!/not found/i.test((e && e.message) || '')) throw e;
        }
        results.removed.push(email);
      } else {
        const resource = { role: 'owner', scope: { type: 'user', value: email } };
        try {
          Calendar.Acl.insert(resource, calendarId);
        } catch (e) {
          if (/already exists|duplicate/i.test((e && e.message) || '')) {
            Calendar.Acl.update(resource, calendarId, ruleId);
          } else {
            throw e;
          }
        }
        results.granted.push(email);
      }
    } catch (e) {
      results.errors.push({ email: email, message: (e && e.message) || String(e) });
    }
  });
  return results;
}

// ══════════════════════════════════════════════
//  身心調適假：信箱解析與關鍵字比對
// ══════════════════════════════════════════════

function runFetchMentalLeaves() {
  Object.keys(ALLOWED_ROOTS).forEach(function(rootId) {
    try {
      var ctx = { root: rootId, configOverride: ALLOWED_ROOTS[rootId].configOverride, gmailLabel: ALLOWED_ROOTS[rootId].gmailLabel };
      fetchMentalLeaves_(ctx);
    } catch(e) {
      Logger.log('fetchMentalLeaves 失敗 [' + rootId + ']: ' + e.message);
    }
  });
}

function fetchMentalLeaves_(ctx, opts) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(2000);
  if (!acquired) {
    return { status: 'locked', message: '另一工作階段正在擷取中，請稍後再試' };
  }
  try {
    return fetchMentalLeavesInner_(ctx, opts);
  } finally {
    lock.releaseLock();
  }
}

function fetchMentalLeavesInner_(ctx, opts) {
  var force = opts && opts.force;
  var reparse = opts && opts.reparse;  // 重新解析已擷取信件（保留 handlingStatus 等使用者欄位）
  var token = npust5GetAccessToken_();
  if (!token) {
    return { needsAuth: true, authUrl: npust5BuildAuthUrl_() };
  }

  var labelName = ctx.gmailLabel || 'ml-processed-dev';

  var existingData = { records: [] };
  try {
    var mlFileId = resolvePathToId_('mental_leaves.json', ctx);
    var mlRes = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + mlFileId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (mlRes.getResponseCode() === 200) {
      existingData = JSON.parse(mlRes.getContentText());
      if (!Array.isArray(existingData.records)) existingData.records = [];
    }
  } catch(e) {}

  var keywords = loadMlKeywords_(ctx);

  var processedLabelId = gmailGetOrCreateLabel_(token, labelName);
  // reparse 模式：查詢已標記的信件（重新解析用）
  var query;
  if (reparse) query = 'subject:(請假 OR 身心調適假 OR 缺課) label:' + labelName;
  else if (force) query = 'subject:(請假 OR 身心調適假 OR 缺課)';
  else query = 'subject:(請假 OR 身心調適假 OR 缺課) -label:' + labelName;
  var batchSize = (opts && opts.batchSize) ? opts.batchSize : ((force || reparse) ? 300 : 50);
  var apiUrl = '/messages?q=' + encodeURIComponent(query) + '&maxResults=' + batchSize;
  var pageTokenToUse = (opts && 'pageToken' in opts) ? opts.pageToken : ((force || reparse) ? (existingData.fetchPageToken || null) : null);
  if (pageTokenToUse) apiUrl += '&pageToken=' + encodeURIComponent(pageTokenToUse);
  var searchData = gmailApi_(token, apiUrl);
  var messages = searchData.messages || [];

  var newRecords = [];
  var updatedCount = 0;
  var existingSet = {};
  var existingByEmailId = {};
  existingData.records.forEach(function(r, i) {
    if (r.emailId) { existingSet[r.emailId] = true; existingByEmailId[r.emailId] = i; }
  });

  messages.forEach(function(m) {
    try {
      var msgId = m.id;
      // reparse 模式：不跳過既有，改為 merge；非 reparse 才跳過
      if (!reparse && existingSet[msgId]) return;

      var msg = gmailApi_(token, '/messages/' + msgId + '?format=full');
      var subject = '', fromHdr = '';
      (msg.payload.headers || []).forEach(function(h) {
        var n = h.name.toLowerCase();
        if (n === 'subject') subject = h.value || '';
        else if (n === 'from') fromHdr = h.value || '';
      });

      var bodies = gmailDecodeBody_(msg.payload);
      var plainBody = bodies.text || '';
      var htmlBody  = bodies.html || '';

      var studentId = '', name = '', department = '', reason = '', semester = '';
      var leaveDate = '', leaveDateTo = '', course = '';

      var mId = subject.match(/學號[:：]\s*([A-Z0-9]{7,12})/);
      if (mId) {
        studentId = mId[1].trim();
        var mN = subject.match(new RegExp(studentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+([^\\s　]+)'));
        if (mN) name = mN[1].trim();
        var mDp = subject.match(/([^\s　，,。]+)\s*學生請/);
        if (mDp) department = mDp[1].trim();
        var mRs = subject.match(/因\s+(.+?)\s*[，,]\s*申請/);
        if (mRs) reason = mRs[1].trim();
        var mDt = subject.match(/身心調適假從\s*([\d\/]+)至\s*([\d\/]+)/);
        if (mDt) {
          leaveDate = mDt[1].trim().replace(/\//g, '-');
          var mDtEnd = mDt[2].trim().replace(/\//g, '-');
          if (mDtEnd && mDtEnd !== leaveDate) leaveDateTo = mDtEnd;
        }
      } else {
        var m1 = subject.match(/([A-Z0-9a-z]{8,12})[_\s]*([^\s_（(]+)[_\s]*([^\s_（(]+)[_\s]*(.+)?/);
        var m2 = subject.match(/([^\s（(]+)（([A-Z0-9]{8,12})）/);
        if (m1 && /[A-Z]/.test(m1[1]) && m1[1].length >= 8) {
          studentId = m1[1].trim(); name = m1[2].trim(); department = m1[3].trim();
          if (m1[4]) reason = m1[4].trim();
        } else if (m2) {
          name = m2[1].trim(); studentId = m2[2].trim();
        }
      }

      try {
        var rows = [];
        var tableRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        var trMatch;
        while ((trMatch = tableRe.exec(htmlBody)) !== null) {
          var cells = [];
          var cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
          var tdMatch;
          while ((tdMatch = cellRe.exec(trMatch[1])) !== null) {
            cells.push(tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim());
          }
          if (cells.length >= 2) rows.push(cells);
        }
        rows.forEach(function(cells) {
          var label = cells[0] || '', val = cells[1] || '';
          if (!studentId  && /學號/.test(label))       studentId  = val.trim();
          if (!name       && /姓名/.test(label))        name       = val.trim();
          if (!department && /系所|科系|班級/.test(label)) department = val.trim();
          if (!reason     && /原因|緣由|事由/.test(label)) reason     = val.trim();
          if (!leaveDate  && /日期|請假日/.test(label))  leaveDate  = val.trim();
          if (!course     && /課程|科目/.test(label))   course     = val.trim();
          if (!semester   && /學期/.test(label))        semester   = val.trim();
        });
        if (!studentId) {
          var sidMatch = (plainBody + htmlBody.replace(/<[^>]+>/g, '')).match(/學號[：:\s]*([A-Z0-9]{8,12})/);
          if (sidMatch) studentId = sidMatch[1].trim();
        }
        if (!name) {
          var nameMatch = plainBody.match(/姓名[：:\s]*([^\s\n\r,，、]{2,6})/);
          if (nameMatch) name = nameMatch[1].trim();
        }
        if (!reason) {
          var rMatch = plainBody.match(/(?:原因|緣由|事由)[：:\s]*([^\n\r]{2,80})/);
          if (rMatch) reason = rMatch[1].trim();
        }
      } catch(parseErr) {
        Logger.log('解析信件 body 失敗：' + msgId + ' / ' + parseErr.message);
      }

      var coursesArr = [];
      try {
        // ── 方法 1（優先）：直接解析 HTML 表格 <tr><td>×5</tr> ──
        // 校務系統信件明細為 5 欄結構：流水號 / 課程名稱 / 請假日 / 星期 / 節次
        // 以 <tr> 為單位切，每列取 5 個 <td>；標頭列 (第 1 欄非數字) 自動略過
        if (htmlBody) {
          var detailIdx = htmlBody.indexOf('請假明細');
          var scanBody  = detailIdx >= 0 ? htmlBody.slice(detailIdx) : htmlBody;
          var trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          var trM;
          while ((trM = trRe.exec(scanBody)) !== null) {
            var cells = [];
            var cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
            var cellM;
            while ((cellM = cellRe.exec(trM[1])) !== null) {
              var txt = cellM[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g,  '&')
                .replace(/&lt;/g,   '<')
                .replace(/&gt;/g,   '>')
                .replace(/\s+/g, ' ')
                .trim();
              cells.push(txt);
            }
            // 只吃「至少 5 欄且第 1 欄為 4-6 位純數字流水號」的資料列
            if (cells.length >= 5 && /^\d{4,6}$/.test(cells[0])) {
              coursesArr.push({
                name:    cells[1],
                date:    cells[2],
                weekday: cells[3],
                period:  cells[4]
              });
            }
          }
        }
        // ── 方法 2（fallback）：純文字 regex（相容早期 plain text 格式）──
        // 放寬 weekday：可接受「星期一/週一/禮拜一」等前綴；period 也接受 - 分隔
        if (!coursesArr.length) {
          var bodyText = plainBody || (htmlBody||'').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
          var fullCRe = /(\d{4,6})\s+([^\d\s\n][^\n\r]{2,40}?)\s+(\d{4}\/\d{1,2}\/\d{1,2})\s+(?:星期|週|禮拜)?([一二三四五六日])\s+([\d,、\-]+)/g, cM;
          while ((cM = fullCRe.exec(bodyText)) !== null) {
            coursesArr.push({
              name:    cM[2].trim(),
              date:    cM[3].trim(),
              weekday: cM[4].trim(),
              period:  cM[5].trim()
            });
          }
        }
        // ── 方法 3（最終 fallback）：只抓課程名稱（節次資訊缺失時） ──
        if (!coursesArr.length) {
          var bodyText2 = plainBody || (htmlBody||'').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
          var cRe2 = /\d{4,6}\s+([^\d\s\n][^\n\r]+?)\s+\d{4}\/\d{1,2}\/\d{1,2}/g, cM2;
          while ((cM2 = cRe2.exec(bodyText2)) !== null) {
            var cn = cM2[1].trim();
            if (cn) coursesArr.push({ name: cn });
          }
        }
        if (!course && coursesArr.length) {
          var seen = {}, uniq = [];
          coursesArr.forEach(function(c) { if (!seen[c.name]) { seen[c.name] = true; uniq.push(c.name); } });
          course = uniq.join('；');
        }
      } catch(e2) {
        Logger.log('解析課程明細失敗：' + msgId + ' / ' + e2.message);
      }

      if (!studentId && !name) return;

      var matchedKeywords = [];
      var maxLevel = 0;
      var fullText = subject + ' ' + reason + ' ' + plainBody;
      keywords.forEach(function(k) {
        var matchText = (k.scope === 'reason') ? reason : fullText;
        if (matchText.indexOf(k.kw) !== -1) {
          matchedKeywords.push({ kw: k.kw, level: k.level });
          if (k.level > maxLevel) maxLevel = k.level;
        }
      });

      if (!semester) {
        var rd = msg.internalDate ? new Date(parseInt(msg.internalDate)) : new Date();
        var rocY = rd.getFullYear() - 1911;
        var mon  = rd.getMonth() + 1;
        semester = mon >= 8 ? rocY + '1' : (mon === 1 ? (rocY-1) + '1' : (rocY-1) + '2');
      }

      var receivedAt = msg.internalDate ? new Date(parseInt(msg.internalDate)).toISOString() : new Date().toISOString();
      var parsedRec = {
        id: 'ml_' + msgId, emailId: msgId,
        studentId: studentId, name: name, department: department,
        reason: reason, leaveDate: leaveDate, leaveDateTo: leaveDateTo,
        course: course, courses: coursesArr,
        semester: String(semester), matchedKeywords: matchedKeywords,
        riskLevel: maxLevel,
        handlingStatus: maxLevel >= 3 ? '待處理' : '非危機',
        receivedAt: receivedAt, parsedAt: new Date().toISOString(),
      };
      // reparse 模式：merge 到既有紀錄，保留使用者管理的欄位
      if (reparse && existingByEmailId[msgId] !== undefined) {
        var idx = existingByEmailId[msgId];
        var existing = existingData.records[idx];
        // 保留使用者欄位（handlingStatus, acknowledgedBy, deleted 等）
        var preserved = {
          handlingStatus: existing.handlingStatus,
          acknowledgedBy: existing.acknowledgedBy,
          deleted: existing.deleted, deletedAt: existing.deletedAt, deletedBy: existing.deletedBy,
        };
        // 用解析結果覆蓋 existing 的其他欄位
        Object.keys(parsedRec).forEach(function(k) { existing[k] = parsedRec[k]; });
        // 還原使用者欄位
        Object.keys(preserved).forEach(function(k) { if (preserved[k] !== undefined) existing[k] = preserved[k]; });
        updatedCount++;
      } else {
        newRecords.push(parsedRec);
        existingSet[msgId] = true;
      }

      if (processedLabelId && !reparse) {
        try { gmailApi_(token, '/messages/' + msgId + '/modify', 'post', { addLabelIds: [processedLabelId] }); } catch(e) {}
      }
    } catch(msgErr) {
      Logger.log('處理信件失敗：' + msgErr.message);
    }
  });

  if (force || reparse) {
    if (searchData.nextPageToken) {
      existingData.fetchPageToken = searchData.nextPageToken;
    } else {
      delete existingData.fetchPageToken;
    }
  }

  existingData.lastFetchedAt = new Date().toISOString();
  if (newRecords.length) existingData.records = existingData.records.concat(newRecords);
  try {
    updateJson_({ path: 'mental_leaves.json', content: existingData }, ctx);
  } catch(e) {
    var parentInfo = resolvePathToParentAndName_('mental_leaves.json', ctx);
    driveUpload_('mental_leaves.json', existingData, parentInfo.parentId);
  }

  return {
    newCount: newRecords.length,
    updatedCount: updatedCount,
    totalCount: existingData.records.length,
    batchCount: messages.length,
    hasMore: !!((force || reparse) && existingData.fetchPageToken),
    nextPageToken: ((force || reparse) && existingData.fetchPageToken) || null
  };
}

function dumpNpust5Emails_(ctx) {
  var token = npust5GetAccessToken_();
  if (!token) {
    return { needsAuth: true, authUrl: npust5BuildAuthUrl_() };
  }

  var query = '(subject:請假 OR subject:身心調適 OR subject:缺課 OR subject:假單 OR subject:假條) newer_than:365d';
  var searchData = gmailApi_(token, '/messages?q=' + encodeURIComponent(query) + '&maxResults=100');
  var messages = searchData.messages || [];

  var emails = [];
  messages.forEach(function(m) {
    try {
      var msg = gmailApi_(token, '/messages/' + m.id + '?format=full');
      var subject = '', fromHdr = '', dateStr = '';
      (msg.payload.headers || []).forEach(function(h) {
        var n = h.name.toLowerCase();
        if (n === 'subject') subject = h.value;
        else if (n === 'from') fromHdr = h.value;
        else if (n === 'date') dateStr = h.value;
      });
      var bodies = gmailDecodeBody_(msg.payload);
      var plain = (bodies.text || bodies.html.replace(/<[^>]+>/g, '') || '').slice(0, 1500);
      emails.push({
        id: m.id, subject: subject, from: fromHdr,
        date: msg.internalDate ? new Date(parseInt(msg.internalDate)).toISOString() : dateStr,
        snippet: msg.snippet || '', body: plain
      });
    } catch(e) {
      emails.push({ id: m.id, error: e.message });
    }
  });

  var dump = { dumpedAt: new Date().toISOString(), count: emails.length, emails: emails };
  try {
    updateJson_({ path: 'ml_email_dump.json', content: dump }, ctx);
  } catch(e) {
    try {
      var pi = resolvePathToParentAndName_('ml_email_dump.json', ctx);
      driveUpload_('ml_email_dump.json', dump, pi.parentId);
    } catch(e2) { Logger.log('dump 寫入失敗: ' + e2.message); }
  }
  return { count: emails.length };
}

function clearMentalLeaves_(ctx) {
  var token = npust5GetAccessToken_();
  var removedLabels = 0;
  var labelName = ctx.gmailLabel || 'ml-processed-dev';
  if (token) {
    try {
      var labelData = gmailApi_(token, '/labels');
      var processed = (labelData.labels || []).filter(function(l) { return l.name === labelName; })[0];
      if (processed) {
        var tagged = gmailApi_(token, '/messages?labelIds=' + processed.id + '&maxResults=500');
        (tagged.messages || []).forEach(function(m) {
          try { gmailApi_(token, '/messages/' + m.id + '/modify', 'post', { removeLabelIds: [processed.id] }); removedLabels++; } catch(e) {}
        });
      }
    } catch(e) { Logger.log('移除 ml-processed-dev label 失敗: ' + e.message); }
  }
  try {
    updateJson_({ path: 'mental_leaves.json', content: { records: [] } }, ctx);
  } catch(e) {
    var pi = resolvePathToParentAndName_('mental_leaves.json', ctx);
    driveUpload_('mental_leaves.json', { records: [] }, pi.parentId);
  }
  return { ok: true, removedLabels: removedLabels };
}

function countMentalLeavesUnprocessed_(ctx) {
  var token = npust5GetAccessToken_();
  if (!token) return { needsAuth: true, authUrl: npust5BuildAuthUrl_() };
  var labelName = ctx.gmailLabel || 'ml-processed-dev';
  var query = 'subject:(請假 OR 身心調適假 OR 缺課) -label:' + labelName;
  var searchData = gmailApi_(token, '/messages?q=' + encodeURIComponent(query) + '&maxResults=500');
  var messages = searchData.messages || [];
  return { count: messages.length, hasMore: !!searchData.nextPageToken };
}

function listInboxEmails_(ctx) {
  var token = npust5GetAccessToken_();
  if (!token) return { needsAuth: true, authUrl: npust5BuildAuthUrl_() };

  var profile = gmailApi_(token, '/profile');
  var authedEmail = profile.emailAddress || '(unknown)';

  var inboxData = gmailApi_(token, '/messages?maxResults=50&labelIds=INBOX');
  var allData   = gmailApi_(token, '/messages?maxResults=50');

  var messages = (inboxData.messages && inboxData.messages.length)
    ? inboxData.messages
    : (allData.messages || []);

  var emails = [];
  messages.slice(0, 20).forEach(function(m) {
    try {
      var msg = gmailApi_(token, '/messages/' + m.id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date');
      var subject = '', from = '', date = '';
      (msg.payload.headers || []).forEach(function(h) {
        if (h.name === 'Subject') subject = h.value;
        else if (h.name === 'From') from = h.value;
        else if (h.name === 'Date') date = h.value;
      });
      emails.push({ id: m.id, subject: subject, from: from, date: date, snippet: msg.snippet || '' });
    } catch(e) { emails.push({ id: m.id, error: e.message }); }
  });

  var dump = {
    dumpedAt: new Date().toISOString(),
    authedEmail: authedEmail,
    inboxRaw: inboxData,
    allMailRaw: allData,
    count: emails.length,
    emails: emails
  };
  try {
    updateJson_({ path: 'ml_inbox_list.json', content: dump }, ctx);
  } catch(e) {
    var pi = resolvePathToParentAndName_('ml_inbox_list.json', ctx);
    driveUpload_('ml_inbox_list.json', dump, pi.parentId);
  }
  return { authedEmail: authedEmail, inboxCount: (inboxData.messages || []).length, allCount: (allData.messages || []).length, emails: emails };
}

function ping() { return 'pong (DEV) ' + new Date().toISOString(); }

// ══════════════════════════════════════════════
//  npust5 Gmail OAuth2（手動實作）
// ══════════════════════════════════════════════

var NPUST5_REDIR_  = 'https://npustscc.github.io/scc-infosys/dev/oauth-callback.html';

function npust5Cid_() { return PropertiesService.getScriptProperties().getProperty('NPUST5_CID') || ''; }
function npust5Cs_()  { return PropertiesService.getScriptProperties().getProperty('NPUST5_CS')  || ''; }

function npust5BuildAuthUrl_() {
  var state = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('NPUST5_OAUTH_STATE', state);
  return 'https://accounts.google.com/o/oauth2/auth?' + [
    'client_id='    + encodeURIComponent(npust5Cid_()),
    'redirect_uri=' + encodeURIComponent(NPUST5_REDIR_),
    'response_type=code',
    'scope='        + encodeURIComponent('https://www.googleapis.com/auth/gmail.modify'),
    'access_type=offline', 'prompt=select_account%20consent',
    'login_hint='   + encodeURIComponent('heartnpust5@gmail.com'),
    'state='        + state
  ].join('&');
}

function npust5HandleOAuthCallback_(e) {
  var code = e.parameter.code;
  if (!code) return HtmlService.createHtmlOutput('❌ 授權失敗：缺少 code');
  try {
    var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: { code: code, client_id: npust5Cid_(), client_secret: npust5Cs_(),
                 redirect_uri: NPUST5_REDIR_, grant_type: 'authorization_code' },
      muteHttpExceptions: true
    });
    var t = JSON.parse(r.getContentText());
    if (t.access_token) {
      var p = PropertiesService.getScriptProperties();
      p.setProperty('NPUST5_ACCESS_TOKEN', t.access_token);
      p.setProperty('NPUST5_EXPIRY', String(Date.now() + (t.expires_in || 3600) * 1000));
      if (t.refresh_token) p.setProperty('NPUST5_REFRESH_TOKEN', t.refresh_token);
      return HtmlService.createHtmlOutput('<h3 style="font-family:sans-serif;color:#059669;">✅ npust5 Gmail 授權成功，可關閉此視窗。</h3>');
    }
    return HtmlService.createHtmlOutput('❌ 授權失敗：' + JSON.stringify(t));
  } catch(err) {
    return HtmlService.createHtmlOutput('❌ 錯誤：' + err.message);
  }
}

function npust5GetAccessToken_() {
  var p = PropertiesService.getScriptProperties();
  var tok = p.getProperty('NPUST5_ACCESS_TOKEN');
  var exp = parseInt(p.getProperty('NPUST5_EXPIRY') || '0');
  if (tok && Date.now() < exp - 300000) return tok;
  var rt = p.getProperty('NPUST5_REFRESH_TOKEN');
  if (!rt) return null;
  try {
    var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: { refresh_token: rt, client_id: npust5Cid_(), client_secret: npust5Cs_(), grant_type: 'refresh_token' },
      muteHttpExceptions: true
    });
    var t = JSON.parse(r.getContentText());
    if (t.access_token) {
      p.setProperty('NPUST5_ACCESS_TOKEN', t.access_token);
      p.setProperty('NPUST5_EXPIRY', String(Date.now() + (t.expires_in || 3600) * 1000));
      return t.access_token;
    }
    p.deleteProperty('NPUST5_ACCESS_TOKEN'); p.deleteProperty('NPUST5_REFRESH_TOKEN');
    return null;
  } catch(e) { return null; }
}

function exchangeNpust5OAuthCode_(params) {
  var code = params.code;
  if (!code) return { ok: false, error: '缺少 code' };
  try {
    var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: { code: code, client_id: npust5Cid_(), client_secret: npust5Cs_(),
                 redirect_uri: NPUST5_REDIR_, grant_type: 'authorization_code' },
      muteHttpExceptions: true
    });
    var t = JSON.parse(r.getContentText());
    if (t.access_token) {
      var p = PropertiesService.getScriptProperties();
      p.setProperty('NPUST5_ACCESS_TOKEN', t.access_token);
      p.setProperty('NPUST5_EXPIRY', String(Date.now() + (t.expires_in || 3600) * 1000));
      if (t.refresh_token) p.setProperty('NPUST5_REFRESH_TOKEN', t.refresh_token);
      return { ok: true };
    }
    return { ok: false, error: t.error_description || t.error || JSON.stringify(t) };
  } catch(err) {
    return { ok: false, error: err.message };
  }
}

function getAuthUrlNpust5_() {
  if (npust5GetAccessToken_()) return { authorized: true };
  return { authorized: false, authUrl: npust5BuildAuthUrl_() };
}

// ── Gmail REST API helpers ──────────────────────────────────────────────────

function gmailApi_(token, path, method, body) {
  var opts = {
    method: method || 'get',
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (body) { opts.payload = JSON.stringify(body); opts.contentType = 'application/json'; }
  return JSON.parse(
    UrlFetchApp.fetch('https://gmail.googleapis.com/gmail/v1/users/me' + path, opts).getContentText()
  );
}

function gmailDecodeBody_(payload) {
  if (!payload) return { text: '', html: '' };
  if (payload.body && payload.body.data) {
    try {
      var d = Utilities.newBlob(Utilities.base64DecodeWebSafe(payload.body.data)).getDataAsString();
      return (payload.mimeType || '').indexOf('html') >= 0 ? { text: '', html: d } : { text: d, html: '' };
    } catch(e) { return { text: '', html: '' }; }
  }
  var result = { text: '', html: '' };
  (payload.parts || []).forEach(function(p) {
    if (p.parts) {
      var sub = gmailDecodeBody_(p);
      if (!result.text && sub.text) result.text = sub.text;
      if (!result.html && sub.html) result.html = sub.html;
    }
    if (!p.body || !p.body.data) return;
    try {
      var d = Utilities.newBlob(Utilities.base64DecodeWebSafe(p.body.data)).getDataAsString();
      if (p.mimeType === 'text/plain' && !result.text) result.text = d;
      else if (p.mimeType === 'text/html'  && !result.html) result.html = d;
    } catch(e) {}
  });
  return result;
}

function gmailGetOrCreateLabel_(token, labelName) {
  try {
    var data = gmailApi_(token, '/labels');
    var existing = (data.labels || []).filter(function(l) { return l.name === labelName; })[0];
    if (existing) return existing.id;
    return gmailApi_(token, '/labels', 'post', { name: labelName }).id || null;
  } catch(e) { return null; }
}

function loadMlKeywords_(ctx) {
  var keywords = [];
  try {
    var cfgId = ctx.configOverride || resolvePathToId_('config.json', ctx);
    var cfgRes = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + cfgId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (cfgRes.getResponseCode() === 200) {
      var cfg = JSON.parse(cfgRes.getContentText());
      if (Array.isArray(cfg.mentalLeaveKeywords) && cfg.mentalLeaveKeywords.length) keywords = cfg.mentalLeaveKeywords;
    }
  } catch(e) {}
  if (!keywords.length) {
    '死,結束生命,不想活,自傷,自殘,自殺,跳,崩潰,喘不過氣,恐慌,解離,幻覺,車禍,意外,喪,暴力,性平,性騷,家暴,輕生,消失'.split(',').forEach(function(kw) { keywords.push({ kw: kw, level: 3 }); });
    '身心科,精神科,急診,住院,看診,回診,藥物副作用,換藥,斷藥,戒斷,憂鬱,焦慮,躁鬱,失眠,厭食,暴食,哭,壓力大,情緒'.split(',').forEach(function(kw) { keywords.push({ kw: kw, level: 2 }); });
    keywords.push({ kw: '諮商', level: 2, scope: 'reason' });
    '分手,感情問題,排擠,霸凌,期中,期末,退學,休學,擋修,家庭衝突,經濟壓力,身心調適,休息調適,個人因素,照顧家人'.split(',').forEach(function(kw) { keywords.push({ kw: kw, level: 1 }); });
  }
  return keywords;
}

// ── 啟動批次讀取：以 UrlFetchApp.fetchAll 並行讀取所有啟動所需資料，減少 GAS 執行次數 ──
function startupBatch_(params, ctx) {
  var tok = tok_();
  var authHeader = { Authorization: 'Bearer ' + tok };
  var qBase = 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,modifiedTime)&pageSize=5&q=';
  var contentBase = 'https://www.googleapis.com/drive/v3/files/';

  var issuesRootId      = params.issuesRootId || ctx.root;
  var userEmail         = params.userEmail || '';
  var envSuffix         = params.envSuffix || '';
  var usersFolderIdHint = params.usersFolderIdHint || null;

  // ── Phase 1：並行解析所有 fileId ────────────────────────────────────────────
  var p1Reqs = [];
  var p1Keys = [];

  function addQuery(key, parentId, name, mime) {
    var q = "name='" + _escQ_(name) + "' and '" + parentId + "' in parents and trashed=false";
    if (mime) q += " and mimeType='" + mime + "'";
    p1Reqs.push({ url: qBase + encodeURIComponent(q), headers: authHeader, muteHttpExceptions: true });
    p1Keys.push(key);
  }

  if (!ctx.configOverride) addQuery('config', ctx.root, 'config.json');
  addQuery('pending_cases', ctx.root, 'pending_cases.json');
  addQuery('bookings',      ctx.root, 'bookings.json');
  addQuery('transfer',      ctx.root, 'transfer.json');
  addQuery('unassigned',    ctx.root, 'unassigned_records.json');
  addQuery('issues',        issuesRootId, 'issues.json');

  var todoFileName   = 'todos_' + userEmail + '_' + envSuffix + '.json';
  var legacyTodoName = 'todos_' + userEmail + '.json';

  if (usersFolderIdHint) {
    addQuery('todos_new',    usersFolderIdHint, todoFileName);
    addQuery('todos_legacy', usersFolderIdHint, legacyTodoName);
  } else {
    addQuery('users_folder', ctx.root, 'users', 'application/vnd.google-apps.folder');
  }

  var p1Results = UrlFetchApp.fetchAll(p1Reqs);

  var fileIds  = {};
  var modTimes = {};
  if (ctx.configOverride) fileIds['config'] = ctx.configOverride;

  p1Keys.forEach(function(key, i) {
    var res = p1Results[i];
    if (res.getResponseCode() !== 200) return;
    var body = JSON.parse(res.getContentText());
    var files = body.files || [];
    if (files.length > 0) {
      fileIds[key] = files[0].id;
      if (files[0].modifiedTime) modTimes[key] = files[0].modifiedTime;
    }
  });

  // ── Phase 1b（無 hint 時）：解析 todos 檔 ──────────────────────────────────
  var usersFolderId = usersFolderIdHint || fileIds['users_folder'] || null;
  var isTodoLegacy = false;

  if (!fileIds['todos_new'] && !fileIds['todos_legacy'] && usersFolderId && !usersFolderIdHint) {
    var todoPhase = [
      { url: qBase + encodeURIComponent("name='" + _escQ_(todoFileName)   + "' and '" + usersFolderId + "' in parents and trashed=false"), headers: authHeader, muteHttpExceptions: true },
      { url: qBase + encodeURIComponent("name='" + _escQ_(legacyTodoName) + "' and '" + usersFolderId + "' in parents and trashed=false"), headers: authHeader, muteHttpExceptions: true },
    ];
    var tpRes = UrlFetchApp.fetchAll(todoPhase);
    var newTodo = JSON.parse(tpRes[0].getContentText());
    var legTodo = JSON.parse(tpRes[1].getContentText());
    if (newTodo.files && newTodo.files.length) {
      fileIds['todos_new'] = newTodo.files[0].id;
    } else if (legTodo.files && legTodo.files.length) {
      fileIds['todos_legacy'] = legTodo.files[0].id;
    }
  }

  var todoFileId = fileIds['todos_new'] || fileIds['todos_legacy'] || null;
  if (!fileIds['todos_new'] && fileIds['todos_legacy']) isTodoLegacy = true;

  // ── Phase 2：並行讀取所有檔案內容 ──────────────────────────────────────────
  var p2Reqs = [];
  var p2Keys = [];

  ['config', 'pending_cases', 'bookings', 'transfer', 'unassigned', 'issues'].forEach(function(key) {
    if (fileIds[key]) {
      p2Reqs.push({ url: contentBase + fileIds[key] + '?alt=media&supportsAllDrives=true', headers: authHeader, muteHttpExceptions: true });
      p2Keys.push(key);
    }
  });
  if (todoFileId) {
    p2Reqs.push({ url: contentBase + todoFileId + '?alt=media&supportsAllDrives=true', headers: authHeader, muteHttpExceptions: true });
    p2Keys.push('todos');
  }

  var p2Results = UrlFetchApp.fetchAll(p2Reqs);

  var result = { usersFolderId: usersFolderId, todoFileId: todoFileId, isTodoLegacy: isTodoLegacy, modTimes: modTimes };
  p2Keys.forEach(function(key, i) {
    var res = p2Results[i];
    if (res.getResponseCode() === 200) {
      try { result[key] = JSON.parse(res.getContentText()); } catch(e) { result[key] = null; }
    } else {
      result[key] = null;
    }
  });
  return result;
}

// ── 帳號申請送出
// 修：無鎖 RMW 與前端管理者審核（整檔覆寫 pending_users*.json）互相競態，可能互蓋。
// 改用 LockService 包住整段讀-改-寫；讀取失敗維持寬容（檔案不存在→視為空清單），
// 但檔案存在而讀壞（HTTP≥400／內容非預期）改為 fail-closed 中止，不以空殼為基底重寫。
function submitUserApplication_(params) {
  var targetEmail   = ((params.targetEmail || '').trim().toLowerCase()) || params.submittedByEmail;
  var name          = params.name;
  var requestedRole = params.requestedRole;
  var note          = params.note || '';
  var submittedBy   = params.submittedByEmail;
  var pendingFile   = params.pendingFile;
  var ctx           = params.ctx || {};

  if (!targetEmail || !name || !requestedRole) throw new Error('缺少必要欄位');

  var filePath = (pendingFile && /^pending_users[\w-]*\.json$/.test(pendingFile))
    ? pendingFile : 'pending_users.json';

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var fileId = null;
    var data = { applications: [] };
    try { fileId = resolvePathToId_(filePath, ctx); } catch (_) { fileId = null; /* 檔不存在，稍後建立 */ }
    if (fileId) {
      var res = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
        { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
      );
      if (res.getResponseCode() >= 400) {
        throw new Error('submitUserApplication: 讀取 ' + filePath + ' 失敗（HTTP ' + res.getResponseCode() + '），已中止寫入以保護資料');
      }
      data = JSON.parse(res.getContentText());
      if (!data || !Array.isArray(data.applications)) {
        throw new Error('submitUserApplication: ' + filePath + ' 內容異常（applications 非陣列），已中止寫入以保護資料');
      }
    }

    var dup = data.applications.filter(function(a) { return a.email === targetEmail && a.status === 'pending'; });
    if (dup.length) throw new Error('此 Gmail 已有一筆待審申請，請等待管理者處理。');

    data.applications.push({
      id: 'app_' + Date.now(),
      email: targetEmail,
      submittedByEmail: submittedBy || targetEmail,
      name: name,
      requestedRole: requestedRole,
      note: note,
      submittedAt: new Date().toISOString(),
      status: 'pending',
    });

    try {
      if (fileId) {
        driveUpdateContent_(fileId, data);
      } else {
        var pn = resolvePathToParentAndName_(filePath, ctx);
        driveUpload_(pn.fileName, data, pn.parentId);
      }
    } catch (writeErr) {
      throw new Error('儲存申請失敗（' + filePath + '）：' + writeErr.message);
    }
    return { ok: true };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// ── cases-hot.json／cases-index.json／個案 chunk 檔（cases/{name}.json）共用的併發安全 upsert（LockService）──
// 前端傳 { path, upserts:[{id,...完整entry}], removes:[id...] }，GAS 在 lock 內做 RMW，path 可為任意
// cases/ 底下的 JSON 檔（index、hot、或個別 chunk）。
// 檔案結構須含 cases:[{ id, ... }] 陣列（頂層可有其他欄位，如 updatedAt——upsert 後一律補上/覆寫
// updatedAt；chunk 檔原本沒有此欄位也無妨，讀取端只用 cases，多的欄位無害）。
// 2026-07-09（v155）：saveCasesChunks 個案 chunk 寫入改走本 action，關閉「前端整檔覆寫」的併發覆蓋窗口。
function casesUpsert_({ path, upserts, removes }, ctx) {
  if (!path) throw new Error('casesUpsert: path required');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    let fileId = null;
    let data = { updatedAt: '', cases: [] };
    // 🔴 2026-07-08 事故防護（fail-closed）：檔案存在但「讀取失敗／內容非預期」時一律中止，
    // 絕不可退回空殼再重寫——那會把整份 index/hot 清成只剩本次 upserts 的幾筆。
    try { fileId = resolvePathToId_(path, ctx); } catch (_) { fileId = null; /* 檔不存在，稍後建立 */ }
    if (fileId) {
      const res = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
        { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
      );
      if (res.getResponseCode() >= 400) {
        throw new Error('casesUpsert: 讀取 ' + path + ' 失敗（HTTP ' + res.getResponseCode() + '），已中止寫入以保護資料');
      }
      data = JSON.parse(res.getContentText()); // 內容損毀 → 直接拋出，不可以空殼為基底重寫
      if (!data || !Array.isArray(data.cases)) {
        throw new Error('casesUpsert: ' + path + ' 內容異常（cases 非陣列），已中止寫入以保護資料');
      }
    }

    const pos = {};
    data.cases.forEach(function (c, i) { if (c && c.id) pos[c.id] = i; });
    (upserts || []).forEach(function (entry) {
      if (!entry || !entry.id) return;
      if (pos[entry.id] !== undefined) data.cases[pos[entry.id]] = entry;
      else { pos[entry.id] = data.cases.length; data.cases.push(entry); }
    });
    const rmSet = {};
    (removes || []).forEach(function (id) { if (id) rmSet[id] = true; });
    if (Object.keys(rmSet).length) {
      data.cases = data.cases.filter(function (c) { return c && c.id && !rmSet[c.id]; });
    }
    data.updatedAt = new Date().toISOString();

    if (fileId) {
      driveUpdateContent_(fileId, data);
    } else {
      const pn = resolvePathToParentAndName_(path, ctx);
      driveUpload_(pn.fileName, data, pn.parentId);
    }
    return { ok: true, count: data.cases.length, updatedAt: data.updatedAt };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// v168：打卡當日彙整（純函式，供 attendanceCommit_ 寄信與單元測試共用）——
// 從 records 篩出同一人同一天的 punch 紀錄，依時間排序後回傳筆數、最早/最晚 timestamp、涵蓋工時(ms)。
// 純計算、無副作用、不呼叫任何 GAS API，方便在 test/ 就地抽出單元測試。
function punchDaySummary_(records, email, date) {
  var ts = (records || [])
    .filter(function (r) { return r && r.type === 'punch' && r.email === email && r.date === date && r.timestamp; })
    .map(function (r) { return r.timestamp; })
    .sort();
  if (!ts.length) return { count: 0, first: null, last: null, spanMs: 0, timestamps: [] };
  var first = ts[0], last = ts[ts.length - 1];
  var spanMs = ts.length >= 2 ? (new Date(last).getTime() - new Date(first).getTime()) : 0;
  return { count: ts.length, first: first, last: last, spanMs: spanMs, timestamps: ts };
}

// v168：毫秒差轉「X 小時 Y 分」（不足 1 分顯示 0 分），供打卡彙整信使用。
function _fmtHoursMinutes_(spanMs) {
  var totalMin = Math.floor((spanMs || 0) / 60000);
  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  return h + ' 小時 ' + m + ' 分';
}

// v168：寄送「打卡通知」給打卡當事人——每次新增打卡（非「更新定位」等既有 id 改寫）觸發，內容含
// 當日所有打卡紀錄、標註最早/最晚、並計算涵蓋工時（定義與差勤月報 _dailyWorkHours 一致）。
// best-effort：try/catch 包住，寄信失敗只 Logger.log，絕不影響打卡主流程（由呼叫端於 lock 釋放後呼叫）。
function _sendPunchSummaryMail_(email, name, date, punchTs, records) {
  try {
    var summary = punchDaySummary_(records, email, date);
    var subject = mailEnvPrefix_() + '【屏科大學諮資訊系統】打卡通知（' + date + '）';
    var fmtT = function (iso) { return Utilities.formatDate(new Date(iso), 'Asia/Taipei', 'HH:mm:ss'); };
    var lines = [
      (name || email) + '（' + email + '）您好，系統已記錄您的一筆打卡。',
      '本次打卡時間：' + fmtT(punchTs),
      '',
      '── 當日（' + date + '）打卡紀錄 ──',
    ];
    summary.timestamps.forEach(function (t, i) {
      var mark = '';
      if (t === summary.first) mark += '　← 最早';
      if (t === summary.last) mark += '　← 最晚';
      lines.push((i + 1) + '. ' + fmtT(t) + mark);
    });
    lines.push('');
    if (summary.count >= 2) {
      lines.push('最早打卡：' + fmtT(summary.first));
      lines.push('最晚打卡：' + fmtT(summary.last));
      lines.push('涵蓋工時（最晚−最早，午休不另扣）：' + _fmtHoursMinutes_(summary.spanMs));
    } else {
      lines.push('目前僅一筆打卡紀錄，尚無法計算工時（需至少兩筆）。');
    }
    lines.push('');
    lines.push('※ 此為系統自動通知信，工時定義與差勤月報一致（滿 9 小時為正常，午休不另扣）。');
    MailApp.sendEmail(email, subject, lines.join('\n'));
  } catch (e) {
    Logger.log('_sendPunchSummaryMail_ 寄送失敗：' + e.message);
  }
}

// ── attendance.json 併發安全的打卡寫入（LockService 讀-改-寫）──
// 修 2026-07-09 事故：前端 saveAttendance() 整檔覆寫，多人同時打卡時後寫者蓋掉先寫者（A 打卡不見、B 還在）。
// 改為鎖內讀最新 → 依 id upsert（新增打卡 append、更新定位 replace）／依 id remove → 寫回，回傳合併後全部 records。
// fail-closed：檔案存在但讀取失敗／內容異常一律中止，絕不以空殼重寫。
// v168：鎖內順便記錄「新增」的 punch 紀錄（newPunches），寫回成功、releaseLock 之後才逐筆寄送當日彙整信
// ——MailApp 放鎖內會拉長鎖持有時間、拖慢並發打卡，寄信失敗也絕不可影響打卡主流程或原本回傳值。
function attendanceCommit_({ upserts, removes }, ctx) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var recordsSnapshot = null;
  var newPunches = []; // 本次新增（非既有 id 改寫，如「更新定位」）的 punch 紀錄
  var result;
  try {
    let fileId = null;
    let data = { records: [] };
    try { fileId = resolvePathToId_('attendance.json', ctx); } catch (_) { fileId = null; /* 檔不存在，稍後建立 */ }
    if (fileId) {
      const res = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
        { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
      );
      if (res.getResponseCode() >= 400) {
        throw new Error('attendanceCommit: 讀取 attendance.json 失敗（HTTP ' + res.getResponseCode() + '），已中止寫入以保護資料');
      }
      data = JSON.parse(res.getContentText());
      if (!data || !Array.isArray(data.records)) {
        throw new Error('attendanceCommit: attendance.json 內容異常（records 非陣列），已中止寫入以保護資料');
      }
    }

    const pos = {};
    data.records.forEach(function (r, i) { if (r && r.id) pos[r.id] = i; });
    (upserts || []).forEach(function (rec) {
      if (!rec || !rec.id) return;
      if (pos[rec.id] !== undefined) {
        data.records[pos[rec.id]] = rec;
      } else {
        pos[rec.id] = data.records.length;
        data.records.push(rec);
        if (rec.type === 'punch' && rec.email) newPunches.push(rec);
      }
    });
    const rmSet = {};
    (removes || []).forEach(function (id) { if (id) rmSet[id] = true; });
    if (Object.keys(rmSet).length) {
      data.records = data.records.filter(function (r) { return r && r.id && !rmSet[r.id]; });
    }

    if (fileId) {
      driveUpdateContent_(fileId, data);
    } else {
      const pn = resolvePathToParentAndName_('attendance.json', ctx);
      driveUpload_(pn.fileName, data, pn.parentId);
    }
    recordsSnapshot = data.records;
    result = { ok: true, records: data.records, count: data.records.length };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }

  // v168：鎖已釋放，逐筆寄送當日彙整信（單筆失敗不影響其他筆，也不影響本函式回傳值）。
  if (newPunches.length && recordsSnapshot) {
    newPunches.forEach(function (rec) {
      try { _sendPunchSummaryMail_(rec.email, rec.name, rec.date, rec.timestamp, recordsSnapshot); }
      catch (e) { Logger.log('attendanceCommit_ 寄送打卡彙整信失敗：' + e.message); }
    });
  }
  return result;
}

// ── 泛用「清單型 JSON 檔」併發安全寫入（LockService 讀-改-寫）──
// 修 2026-07-09 事故延伸：除 attendance.json／cases 索引外，還有多個「前端整份載入→改記憶體→整檔覆寫」
// 的資料檔存在同型併發覆蓋風險。此函式收斂這些檔案的寫入，模式比照 attendanceCommit_/casesUpsert_：
// 鎖內讀最新 → 依 id upsert／remove（或 append-only／map 模式）→ 寫回，回傳合併後完整內容。
// fail-closed：檔案存在但讀取失敗／內容非預期一律中止，絕不以空殼為基底重寫。
//
// 白名單 registry（file 必須命中，否則 throw；預設 deny——不可讓呼叫端指定任意檔名）：
//   mode 'list'  ：{ [key]: [{id,...}] }，依 id upsert/remove，保留其他頂層欄位不動（除非 meta 指定覆寫）
//   mode 'append'：{ [key]: [...] }，upserts 只允許追加到尾端（不比 id），不允許 removes
//   mode 'map'   ：整個檔案本身是 map（如 psych_test_db.json：{studentId:[...]}），
//                  upserts 為 {key:value} 物件、removes 為 key 陣列
var LIST_COMMIT_REGISTRY_ = {
  'leaves.json':             { key: 'applications', mode: 'list' },
  'transfer.json':           { key: 'records',       mode: 'list' },
  'mental_leaves.json':      { key: 'records',       mode: 'list' },
  'pending_cases.json':      { key: 'cases',         mode: 'list' },
  'unassigned_records.json': { key: 'records',       mode: 'list' },
  'issues.json':             { key: 'issues',        mode: 'list' },
  'audit_log.json':          { key: 'logs',          mode: 'append' },
  'case_access_log.json':    { key: 'entries',       mode: 'append', touchUpdatedAt: true },
  'off_hours_log.json':      { key: 'entries',       mode: 'append', touchUpdatedAt: true },
  'psych_test_db.json':      { mode: 'map' },
};

// file 命中 registry，或符合下列動態規則之一：
//   pending_users*.json（pendingFile 命名規則，同 submitUserApplication_ 的 /^pending_users[\w-]*\.json$/）
//   users/todos_*.json（每人一份的待辦事項檔）
function _listCommitResolveEntry_(file) {
  if (LIST_COMMIT_REGISTRY_[file]) return LIST_COMMIT_REGISTRY_[file];
  if (/^pending_users[\w-]*\.json$/.test(file)) return { key: 'applications', mode: 'list' };
  if (/^users\/todos_[^\/]+\.json$/.test(file)) return { key: 'todos', mode: 'list' };
  return null;
}

function listCommit_(params, ctx) {
  var file = params && params.file;
  var upserts = (params && params.upserts) || [];
  var removes = (params && params.removes) || [];
  var meta = (params && params.meta) || null;
  if (!file) throw new Error('listCommit: file required');

  var entry = _listCommitResolveEntry_(file);
  if (!entry) throw new Error('listCommit: 不支援的檔案（' + file + '）');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var fileId = null;
    var data = null;
    try { fileId = resolvePathToId_(file, ctx); } catch (_) { fileId = null; /* 檔不存在，稍後建立 */ }
    if (fileId) {
      var res = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
        { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
      );
      if (res.getResponseCode() >= 400) {
        throw new Error('listCommit: 讀取 ' + file + ' 失敗（HTTP ' + res.getResponseCode() + '），已中止寫入以保護資料');
      }
      data = JSON.parse(res.getContentText());
      if (entry.mode === 'map') {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('listCommit: ' + file + ' 內容異常（非物件），已中止寫入以保護資料');
        }
      } else {
        if (!data || !Array.isArray(data[entry.key])) {
          throw new Error('listCommit: ' + file + ' 內容異常（' + entry.key + ' 非陣列），已中止寫入以保護資料');
        }
      }
    } else {
      data = (entry.mode === 'map') ? {} : (function () { var o = {}; o[entry.key] = []; return o; })();
    }

    if (entry.mode === 'map') {
      // upserts：{ key: value }；removes：[key,...]
      if (removes && removes.length) {
        removes.forEach(function (k) { if (k) delete data[k]; });
      }
      if (upserts && typeof upserts === 'object' && !Array.isArray(upserts)) {
        Object.keys(upserts).forEach(function (k) { data[k] = upserts[k]; });
      }
    } else if (entry.mode === 'append') {
      if (removes && removes.length) {
        throw new Error('listCommit: ' + file + ' 為 append-only，不允許 removes');
      }
      (upserts || []).forEach(function (item) {
        if (item !== undefined && item !== null) data[entry.key].push(item);
      });
      if (entry.touchUpdatedAt) data.updatedAt = new Date().toISOString();
    } else {
      // list：依 id upsert/remove
      var list = data[entry.key];
      var pos = {};
      list.forEach(function (item, i) { if (item && item.id) pos[item.id] = i; });
      (upserts || []).forEach(function (item) {
        if (!item || !item.id) return;
        if (pos[item.id] !== undefined) list[pos[item.id]] = item;
        else { pos[item.id] = list.length; list.push(item); }
      });
      var rmSet = {};
      (removes || []).forEach(function (id) { if (id) rmSet[id] = true; });
      if (Object.keys(rmSet).length) {
        data[entry.key] = list.filter(function (item) { return item && item.id && !rmSet[item.id]; });
      }
    }

    // meta：呼叫端指定的其他頂層欄位覆寫（如 mental_leaves 的 lastFetchedAt、
    // todos 的 suppressedRecordIds/caseSearchPrefs/updatedAt）。只有檔案擁有者才會帶 meta。
    if (meta && typeof meta === 'object') {
      Object.keys(meta).forEach(function (k) { data[k] = meta[k]; });
    }

    if (fileId) {
      driveUpdateContent_(fileId, data);
    } else {
      var pn = resolvePathToParentAndName_(file, ctx);
      driveUpload_(pn.fileName, data, pn.parentId);
    }
    return { ok: true, data: data };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// ── 通知系統併發安全寫入（notifications.json，2026-07-09 事故延伸修復 v154）──
// 原本 notifications 存在 configData.users[email].notifications，任何使用者收/發/讀通知都會觸發
// 整份 config.json 覆寫（config 含全部使用者帳號與權限）：①兩則通知同時推播互相蓋掉
// ②管理者改權限的瞬間撞上任何人的通知寫入會被蓋回。拆成獨立 notifications.json，
// LockService 鎖內讀-改-寫，取代 config.json 作為通知的儲存位置——config.json 之後只剩低頻管理操作寫入。
//
// ops 元素（陣列，逐一套用）：
//   { op:'push', email, notif }           — 若該 email 已有同 notif.id → 先移除再 unshift（取代語義）；裁切至 100 則
//   { op:'markRead', email, id, readAt }  — 找到該則 → read=true, readAt
//   { op:'markAllRead', email, readAt }   — 該 email 全部未讀 → read=true, readAt
//   { op:'removeIds', email, ids }        — 移除指定 id 們
//
// 純函式：套用單一 op 到 users map（{ [email]: [notif,...] }），供測試就地抽出驗證。
function _notifApplyOp_(users, op) {
  if (!op || !op.email) return;
  var email = op.email;
  if (!Array.isArray(users[email])) users[email] = [];
  var arr = users[email];
  if (op.op === 'push') {
    if (!op.notif || !op.notif.id) return;
    var idx = arr.findIndex(function (n) { return n && n.id === op.notif.id; });
    if (idx >= 0) arr.splice(idx, 1);
    arr.unshift(op.notif);
    if (arr.length > 100) users[email] = arr.slice(0, 100);
  } else if (op.op === 'markRead') {
    var n = arr.find(function (x) { return x && x.id === op.id; });
    if (n) { n.read = true; n.readAt = op.readAt || new Date().toISOString(); }
  } else if (op.op === 'markAllRead') {
    arr.forEach(function (n) { if (n && !n.read) { n.read = true; n.readAt = op.readAt || new Date().toISOString(); } });
  } else if (op.op === 'removeIds') {
    var ids = {};
    (op.ids || []).forEach(function (id) { if (id) ids[id] = true; });
    users[email] = arr.filter(function (n) { return !(n && ids[n.id]); });
  }
}

function notifCommit_(params, ctx) {
  var ops = (params && params.ops) || [];
  if (!ops.length) throw new Error('notifCommit: ops required');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var file = 'notifications.json';
    var fileId = null;
    var data = null;
    try { fileId = resolvePathToId_(file, ctx); } catch (_) { fileId = null; /* 檔不存在，稍後視為首次遷移 */ }
    if (fileId) {
      var res = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
        { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
      );
      if (res.getResponseCode() >= 400) {
        throw new Error('notifCommit: 讀取 notifications.json 失敗（HTTP ' + res.getResponseCode() + '），已中止寫入以保護資料');
      }
      data = JSON.parse(res.getContentText());
      if (!data || typeof data.users !== 'object' || data.users === null || Array.isArray(data.users)) {
        throw new Error('notifCommit: notifications.json 內容異常（users 非物件），已中止寫入以保護資料');
      }
    } else {
      // 首次建檔＝一次性遷移：把 config.json 裡所有 users[email].notifications 複製進來作為初始內容，
      // 再套用本次 ops。config.json 本身不動（殘留 notifications 欄位屬無害死資料，前端之後一律忽略）。
      var users = {};
      try {
        var cfg = readJson_({ path: 'config.json' }, ctx);
        if (cfg && cfg.users && typeof cfg.users === 'object') {
          Object.keys(cfg.users).forEach(function (email) {
            var u = cfg.users[email];
            if (u && Array.isArray(u.notifications) && u.notifications.length) {
              users[email] = u.notifications;
            }
          });
        }
      } catch (e) {
        // config.json 讀取失敗不應永久卡住通知系統啟用；以空殼繼續（遺失既有通知的風險已相對次要——
        // config.json 讀不到本身就是更嚴重的系統性問題）
      }
      data = { updatedAt: new Date().toISOString(), users: users };
    }

    var touched = {};
    ops.forEach(function (op) {
      _notifApplyOp_(data.users, op);
      if (op && op.email) touched[op.email] = true;
    });
    data.updatedAt = new Date().toISOString();

    if (fileId) {
      driveUpdateContent_(fileId, data);
    } else {
      var pn = resolvePathToParentAndName_(file, ctx);
      driveUpload_(pn.fileName, data, pn.parentId);
    }

    var result = {};
    Object.keys(touched).forEach(function (email) { result[email] = data.users[email] || []; });
    return { ok: true, touched: result };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// ── config.json「SELF 類」使用者自助欄位併發安全 PATCH（P1 延伸修復）──
// 沿革：偏好設定／PIN／欄寬／個人顯示色等只影響呼叫者本人的欄位，原本走前端整檔覆寫
// config.json（configSelfPatch 部署前的舊路徑）；config.json 同時裝全部使用者的授權欄位，
// 覆寫面最大，任何人同時改權限或另一人寫偏好就會互蓋。比照 notifCommit_/listCommit_收斂為
// LockService 鎖內讀最新 config → 只 PATCH 呼叫者本人條目的白名單欄位 → 寫回，
// 回傳更新後的本人條目；呼叫者條目不存在一律拒絕、絕不新建（防未授權帳號夾帶寫入）。
//
// 白名單只放行使用者可自行寫入的偏好/PIN/顯示設定；授權欄位（role/extraRole/isAdmin/…）
// 一律拒絕——見 selfPatchKeyAllowed_ 的 deny-list（雙重保險，即使呼叫端漏檢查也不會被放行）。
function configSelfPatch_(params, ctx, userEmail) {
  var updates = (params && params.updates) || null;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('configSelfPatch: updates required');
  }
  var keys = Object.keys(updates);
  if (!keys.length) throw new Error('configSelfPatch: updates 不可為空');
  // 型別上限防護：序列化後過大一律拒絕，防塞爆 config.json（所有使用者共用同一份檔案）。
  if (JSON.stringify(updates).length > 200 * 1024) {
    throw new Error('configSelfPatch: updates 過大（上限 200KB）');
  }
  for (var i = 0; i < keys.length; i++) {
    if (!selfPatchKeyAllowed_(keys[i])) {
      throw new Error('configSelfPatch: 欄位不在白名單（' + keys[i] + '）');
    }
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var fileId = localConfigFileId_();
    if (!fileId) throw new Error('configSelfPatch: 找不到 config.json');
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() >= 400) {
      throw new Error('configSelfPatch: 讀取 config.json 失敗（HTTP ' + res.getResponseCode() + '），已中止寫入以保護資料');
    }
    var cfg = JSON.parse(res.getContentText());
    if (!cfg || typeof cfg.users !== 'object' || cfg.users === null || Array.isArray(cfg.users)) {
      throw new Error('configSelfPatch: config.json 內容異常（users 非物件），已中止寫入以保護資料');
    }
    var me = cfg.users[userEmail];
    if (!me) throw new Error('configSelfPatch: 呼叫者條目不存在，拒絕建立新條目');

    keys.forEach(function (k) {
      var v = updates[k];
      if (v === null) delete me[k];
      else me[k] = v;
    });

    // 懶清理：v154 已遷移到 notifications.json 的舊欄位，順手在本次寫入一併清除（全部使用者）。
    stripLegacyNotifications_(cfg);

    driveUpdateContent_(fileId, cfg);
    return { user: me };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// ── config.json「CASES 類」個案存取授權 PATCH（v164：非管理者整檔寫入全面收口）──
// 沿革：主責新增/移除個管員、每學期範圍切換、初談自動列管、新學期繼承、案號改名 remap、
// 本人 Gmail 遷移、轉銜窗口自填新增輔導人員（nomail_ 佔位）等七個非管理者流程，原本都是
// 「本機改 configData → 整檔覆寫 config.json」——覆寫面最大，且 P0-2 只用 diff 比對放行
// allowedCases/allowedCasesSems/extraRole 子集變動，非管理者仍可能：①自授任意案號存取權
// ②覆寫他人非授權欄位（併發互蓋）③舊快照互蓋別人讀寫之間的變更。
// 比照 configSelfPatch_：LockService 鎖內讀最新 config → 套用宣告式 ops（只認 6 種 type，
// 每種只准動 allowedCases/allowedCasesSems/extraRole 隨動/nomail_ 新增/呼叫者本人條目搬遷這些
// 明確列舉的欄位，其餘授權欄位 by construction 無法被此通道觸碰）→ 寫回。任一 op 驗證失敗
// 即整個請求 throw 拒絕（fail-closed，不做部分套用）。呼叫者只需通過既有授權閘，不需要是管理者。
function configCasesPatch_(params, ctx, userEmail) {
  var ops = (params && params.ops) || null;
  if (!Array.isArray(ops) || !ops.length) {
    throw new Error('configCasesPatch: ops 必須為非空陣列');
  }
  if (JSON.stringify(ops).length > 200 * 1024) {
    throw new Error('configCasesPatch: ops 過大（上限 200KB）');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var fileId = localConfigFileId_();
    if (!fileId) throw new Error('configCasesPatch: 找不到 config.json');
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() >= 400) {
      throw new Error('configCasesPatch: 讀取 config.json 失敗（HTTP ' + res.getResponseCode() + '），已中止寫入以保護資料');
    }
    var cfg = JSON.parse(res.getContentText());
    if (!cfg || typeof cfg.users !== 'object' || cfg.users === null || Array.isArray(cfg.users)) {
      throw new Error('configCasesPatch: config.json 內容異常（users 非物件），已中止寫入以保護資料');
    }

    applyCasesPatchOps_(cfg.users, ops, userEmail);

    // 懶清理：v154 已遷移到 notifications.json 的舊欄位，順手在本次寫入一併清除（全部使用者）。
    stripLegacyNotifications_(cfg);

    driveUpdateContent_(fileId, cfg);
    return { ok: true };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// 純函式（可單元測試）：email/nomail_ 佔位 key 格式是否 sane（供 applyCasesPatchOps_ 內各 op 的
// email 欄位驗證共用）。
function _casesPatchEmailSane_(s) {
  return typeof s === 'string' && s.length > 0 && (s.indexOf('@') !== -1 || s.indexOf('nomail_') === 0);
}

// 純函式（可單元測試）：把 ops 陣列套用到 users 物件（就地修改並回傳）。任何一步驗證失敗立即
// throw，呼叫端（configCasesPatch_）在 LockService 鎖內呼叫，失敗即整個請求中止、不寫回 Drive
// （fail-closed，不做部分套用）。callerEmail 僅 selfRename 使用（決定「本人」是誰，呼叫者
// 無法透過 op 參數偽造成搬遷別人的帳號）。
function applyCasesPatchOps_(users, ops, callerEmail) {
  if (!users || typeof users !== 'object' || Array.isArray(users)) {
    throw new Error('applyCasesPatchOps_: users 必須為物件');
  }
  if (!Array.isArray(ops) || !ops.length) {
    throw new Error('applyCasesPatchOps_: ops 必須為非空陣列');
  }

  ops.forEach(function (op) {
    if (!op || typeof op !== 'object' || typeof op.type !== 'string') {
      throw new Error('applyCasesPatchOps_: op 格式錯誤');
    }

    if (op.type === 'caseAccessUpsert') {
      if (!_casesPatchEmailSane_(op.email)) throw new Error('caseAccessUpsert: email 格式錯誤');
      if (typeof op.caseId !== 'string' || !op.caseId) throw new Error('caseAccessUpsert: caseId 必填');
      var entry1 = users[op.email];
      if (!entry1) throw new Error('caseAccessUpsert: 使用者不存在（' + op.email + '）');
      entry1.allowedCases = entry1.allowedCases || [];
      if (entry1.allowedCases.indexOf(op.caseId) === -1) entry1.allowedCases.push(op.caseId);
      if (op.sems !== undefined && op.sems !== null) {
        if (!Array.isArray(op.sems)) throw new Error('caseAccessUpsert: sems 須為陣列');
        if (!entry1.allowedCasesSems) entry1.allowedCasesSems = {};
        var union1 = (entry1.allowedCasesSems[op.caseId] || []).concat(op.sems);
        entry1.allowedCasesSems[op.caseId] = union1.filter(function (v, i) { return union1.indexOf(v) === i; });
      }
      if (!entry1.extraRole) entry1.extraRole = '個案管理員';

    } else if (op.type === 'caseAccessRemove') {
      if (!_casesPatchEmailSane_(op.email)) throw new Error('caseAccessRemove: email 格式錯誤');
      if (typeof op.caseId !== 'string' || !op.caseId) throw new Error('caseAccessRemove: caseId 必填');
      var entry2 = users[op.email];
      if (!entry2) throw new Error('caseAccessRemove: 使用者不存在（' + op.email + '）');
      entry2.allowedCases = (entry2.allowedCases || []).filter(function (id) { return id !== op.caseId; });
      if (entry2.allowedCasesSems) {
        delete entry2.allowedCasesSems[op.caseId];
        if (!Object.keys(entry2.allowedCasesSems).length) delete entry2.allowedCasesSems;
      }
      if (!entry2.allowedCases.length) {
        delete entry2.allowedCases;
        if (entry2.extraRole === '個案管理員') delete entry2.extraRole;
      }

    } else if (op.type === 'caseAccessSemsSet') {
      if (!_casesPatchEmailSane_(op.email)) throw new Error('caseAccessSemsSet: email 格式錯誤');
      if (typeof op.caseId !== 'string' || !op.caseId) throw new Error('caseAccessSemsSet: caseId 必填');
      var entry3 = users[op.email];
      if (!entry3) throw new Error('caseAccessSemsSet: 使用者不存在（' + op.email + '）');
      if ((entry3.allowedCases || []).indexOf(op.caseId) === -1) {
        throw new Error('caseAccessSemsSet: caseId 不在該使用者 allowedCases（' + op.caseId + '）');
      }
      if (Array.isArray(op.sems) && op.sems.length) {
        if (!entry3.allowedCasesSems) entry3.allowedCasesSems = {};
        var uniq3 = op.sems.filter(function (v, i) { return op.sems.indexOf(v) === i; });
        entry3.allowedCasesSems[op.caseId] = uniq3;
      } else if (entry3.allowedCasesSems) {
        delete entry3.allowedCasesSems[op.caseId];
        if (!Object.keys(entry3.allowedCasesSems).length) delete entry3.allowedCasesSems;
      }

    } else if (op.type === 'caseIdRemap') {
      if (typeof op.fromId !== 'string' || !op.fromId) throw new Error('caseIdRemap: fromId 必填');
      if (typeof op.toId !== 'string' || !op.toId) throw new Error('caseIdRemap: toId 必填');
      Object.keys(users).forEach(function (email) {
        var info = users[email];
        if (!info) return;
        if (Array.isArray(info.allowedCases) && info.allowedCases.indexOf(op.fromId) !== -1) {
          var remapped = info.allowedCases.map(function (id) { return id === op.fromId ? op.toId : id; });
          info.allowedCases = remapped.filter(function (v, i) { return remapped.indexOf(v) === i; });
        }
        if (info.allowedCasesSems && info.allowedCasesSems[op.fromId]) {
          var sems4 = info.allowedCasesSems[op.fromId];
          delete info.allowedCasesSems[op.fromId];
          var union4 = (info.allowedCasesSems[op.toId] || []).concat(sems4);
          info.allowedCasesSems[op.toId] = union4.filter(function (v, i) { return union4.indexOf(v) === i; });
        }
      });

    } else if (op.type === 'nomailAdd') {
      if (typeof op.email !== 'string' || !op.email) throw new Error('nomailAdd: email 必填');
      if (Object.prototype.hasOwnProperty.call(users, op.email)) {
        throw new Error('nomailAdd: 條目已存在（' + op.email + '）');
      }
      if (!_nomailAddOk_(op.email, op.entry)) throw new Error('nomailAdd: entry 未通過驗證');
      users[op.email] = op.entry;

    } else if (op.type === 'selfRename') {
      if (!_casesPatchEmailSane_(op.toEmail)) throw new Error('selfRename: toEmail 格式錯誤');
      if (!callerEmail) throw new Error('selfRename: callerEmail 必填');
      if (Object.prototype.hasOwnProperty.call(users, op.toEmail)) {
        throw new Error('selfRename: 目標帳號已存在（' + op.toEmail + '）');
      }
      var meEntry = users[callerEmail];
      if (!meEntry) throw new Error('selfRename: 呼叫者條目不存在');
      // 整個條目原樣搬遷（不接受 params 提供的任何內容）；previousEmails 由後端依伺服器端已知
      // 的 callerEmail 計算附加，不含任何前端可控內容，維持既有稽核追蹤功能不因改走此通道而遺失。
      var movedEntry = Object.assign({}, meEntry);
      var prevEmails = Array.isArray(movedEntry.previousEmails) ? movedEntry.previousEmails.slice() : [];
      prevEmails.push({ email: callerEmail, changedAt: new Date().toISOString(), by: callerEmail });
      movedEntry.previousEmails = prevEmails;
      users[op.toEmail] = movedEntry;
      delete users[callerEmail];

    } else {
      throw new Error('applyCasesPatchOps_: 未知 op type（' + op.type + '）');
    }
  });

  return users;
}

// 純函式（可單元測試）：SELF PATCH 欄位白名單。固定 key 集合 ＋ 動態前綴/後綴規則；
// 白名單外一律拒絕整個請求（不是靜默略過該 key）。DENY 為雙重保險——即使外層授權閘（v164 起：
// 非管理者一律不得整檔寫 config.json）漏檢查，此處仍明確擋下授權欄位，確保 SELF PATCH
// 永遠無法用來提權或改動他人授權狀態。
function selfPatchKeyAllowed_(key) {
  if (!key || typeof key !== 'string') return false;
  var DENY = { role: 1, extraRole: 1, isAdmin: 1, disabled: 1, allowedCases: 1,
    allowedCasesSems: 1, isTransferContact: 1, isMentalLeaveContact: 1, leaveQuota: 1, name: 1 };
  if (DENY[key]) return false;

  var FIXED = {
    semesterPref: 1, counselorFreqs: 1, sortStatusLocked: 1, recPageSize: 1, recSortDesc: 1,
    todosUnclosedCollapsed: 1, myAttTab: 1, auditColsHidden: 1, pin: 1, pinTmo: 1, pinSkipped: 1,
    confirmBeforeLeave: 1, bkFreqs: 1, counselorFreqMode: 1, unassignedScanDate: 1, mlTab: 1,
    bkViewMode: 1, bkDaySpan: 1, bkPageTab: 1, bkCustomRooms: 1, bkCustomOpts: 1,
    sidebarCollapsed: 1, sidebarPinned: 1, bkColor: 1, bkColorGc: 1, dismissedAlerts: 1, gcAclSynced: 1,
  };
  if (FIXED[key]) return true;

  // 側邊欄自訂排序：每個分區各自一個 key（navOrder_<sectionId>）。
  if (key.indexOf('navOrder_') === 0) return true;

  // 表格欄寬記憶：key 以 ColWidths 結尾，或 ColWidths 後接純數字（如既有的 mlColWidths2）。
  // 不用 regex 比對——harness 的括號配對器不解析 regex 字面值，含引號/斜線的正則會壞抽取，
  // 此函式需要被單元測試就地抽出，故改用字串方法。
  var idx = key.indexOf('ColWidths');
  if (idx > 0 && _selfPatchAllDigits_(key.slice(idx + 'ColWidths'.length))) return true;

  return false;
}
function _selfPatchAllDigits_(s) {
  if (s === '') return true;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

// 純函式（可單元測試）：懶清理 v154 已遷移到 notifications.json 的舊欄位
// （users[*].notifications，殘留屬無害死資料但會不必要地增大 config.json）。就地刪除，
// 回傳是否清理到任何欄位。
function stripLegacyNotifications_(cfg) {
  if (!cfg || typeof cfg.users !== 'object' || cfg.users === null || Array.isArray(cfg.users)) return false;
  var cleaned = false;
  Object.keys(cfg.users).forEach(function (email) {
    var u = cfg.users[email];
    if (u && typeof u === 'object' && Object.prototype.hasOwnProperty.call(u, 'notifications')) {
      delete u.notifications;
      cleaned = true;
    }
  });
  return cleaned;
}

// ── bookings.json 併發安全的批次寫入（LockService）＋寫入當下撞房/撞人檢查 ──
// 前端所有預約寫入路徑（新增/編輯/刪除/複製/GC 匯入/GC 同步）一律經此收斂，
// 取代「前端整檔覆寫 bookings.json」與「衝突檢查只在前端本機快取做」兩個結構性風險。
//
// ops 元素：
//   { op:'upsert', booking:{...完整預約物件}, gc:{ mode:'create'|'update'|'none', params:{...} } }
//   { op:'delete', id, gcEventId }
//
// 與前端 _bkFindConflict() 同一套規則（各自實作，行為需保持一致）。
function _bkNormalizeCounselorsGs_(b) {
  if (b && Array.isArray(b.counselors) && b.counselors.length) return b.counselors;
  if (b && (b.counselorEmail || b.counselorName)) {
    return [{ value: b.counselorEmail || b.counselorName }];
  }
  return [];
}

function _bkFindConflictGs_(existing, candidate, opts) {
  opts = opts || {};
  var cStart = String(candidate.startTime || '').slice(0, 5);
  var cEnd   = String(candidate.endTime   || '').slice(0, 5);
  var cRoom  = candidate.room === '其他' ? (candidate.customRoom || '') : (candidate.room || '');
  var cCounselorValues = (candidate.counselors || [])
    .map(function (c) { return c && c.value; })
    .filter(function (v) { return v && v !== '中心會議'; });

  for (var i = 0; i < existing.length; i++) {
    var b = existing[i];
    if (!b || !b.id) continue;
    if (b.date !== candidate.date) continue;
    var bStart = String(b.startTime || '').slice(0, 5);
    var bEnd   = String(b.endTime   || '').slice(0, 5);
    if (!(cStart < bEnd && cEnd > bStart)) continue;

    var bRoom = b.room === '其他' ? (b.customRoom || '') : (b.room || '');
    if (cRoom && bRoom && cRoom === bRoom) return { type: 'room', with: b };

    if (!opts.skipPerson && cRoom !== bRoom) {
      var bCounselorValues = _bkNormalizeCounselorsGs_(b)
        .map(function (c) { return c && c.value; })
        .filter(function (v) { return v && v !== '中心會議'; });
      if (cCounselorValues.some(function (v) { return bCounselorValues.indexOf(v) !== -1; })) {
        return { type: 'person', with: b };
      }
    }
  }
  return null;
}

// 讀 bookings.json（檔不存在則回傳空殼）；回傳 { fileId, data }
// 🔴 2026-07-08 事故防護（fail-closed）：檔案存在但讀取失敗／內容異常時一律拋出中止，
// 不可退回空殼——後續整檔重寫會把所有預約清空。
function _bkReadFile_(ctx) {
  var path = 'bookings.json';
  var fileId = null;
  var data = { bookings: [] };
  try { fileId = resolvePathToId_(path, ctx); } catch (_) { fileId = null; /* 檔不存在，稍後建立 */ }
  if (fileId) {
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() >= 400) {
      throw new Error('bookings.json 讀取失敗（HTTP ' + res.getResponseCode() + '），已中止寫入以保護資料');
    }
    data = JSON.parse(res.getContentText());
    if (!data || !Array.isArray(data.bookings)) {
      throw new Error('bookings.json 內容異常（bookings 非陣列），已中止寫入以保護資料');
    }
  }
  return { fileId: fileId, data: data };
}

function _bkWriteFile_(fileId, data, ctx) {
  if (fileId) {
    driveUpdateContent_(fileId, data);
    return fileId;
  }
  var pn = resolvePathToParentAndName_('bookings.json', ctx);
  var created = driveUpload_(pn.fileName, data, pn.parentId);
  return created.id;
}

function bookingsCommit_({ ops, checkConflicts, skipPersonConflict }, ctx) {
  if (!Array.isArray(ops) || !ops.length) throw new Error('bookingsCommit: ops required');

  const upsertOps = ops.filter(function (o) { return o && o.op === 'upsert' && o.booking && o.booking.id; });
  const deleteOps  = ops.filter(function (o) { return o && o.op === 'delete' && o.id; });

  // ── Phase 1：鎖內 RMW（衝突檢查 + 套用 upsert/delete + 寫檔）──
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  let data, fileId;
  try {
    const loaded = _bkReadFile_(ctx);
    fileId = loaded.fileId;
    data = loaded.data;

    if (checkConflicts) {
      const batchIds = {};
      upsertOps.forEach(function (o) { batchIds[o.booking.id] = true; });
      for (let i = 0; i < upsertOps.length; i++) {
        const cand = upsertOps[i].booking;
        const pool = data.bookings.filter(function (b) {
          return b && b.id && b.id !== cand.id && !batchIds[b.id];
        });
        const conflict = _bkFindConflictGs_(pool, cand, { skipPerson: !!skipPersonConflict });
        if (conflict) {
          const w = conflict.with;
          return {
            error: 'conflict',
            conflictType: conflict.type,
            with: {
              id: w.id, date: w.date, room: w.room, customRoom: w.customRoom || '',
              startTime: w.startTime, endTime: w.endTime,
              counselorName: w.counselorName || '', bkSerial: w.bkSerial
            }
          };
        }
      }
    }

    const pos = {};
    data.bookings.forEach(function (b, idx) { if (b && b.id) pos[b.id] = idx; });
    const usedSerials = {};
    data.bookings.forEach(function (b) { if (b && b.bkSerial) usedSerials[b.bkSerial] = true; });
    // GC 事件→預約 唯一性（防止前端手動同步與後端 5 分鐘 trigger 同時匯入同一新事件而重複建立）：
    // 記錄鎖內現有各 calendarEventId 對應的預約 id。
    const eventIdOwner = {};
    data.bookings.forEach(function (b) { if (b && b.id && b.calendarEventId) eventIdOwner[b.calendarEventId] = b.id; });

    upsertOps.forEach(function (o) {
      const entry = o.booking;
      const isNew = pos[entry.id] === undefined;
      // 新預約若帶已被其他預約占用的 calendarEventId → 視為重複匯入，略過（idempotent）。
      // 正常新增預約在此階段 calendarEventId 為空（事件於 Phase 2 才建立），不受影響。
      if (isNew && entry.calendarEventId && eventIdOwner[entry.calendarEventId] && eventIdOwner[entry.calendarEventId] !== entry.id) {
        return;
      }
      if (entry.calendarEventId) eventIdOwner[entry.calendarEventId] = entry.id;
      if (isNew && entry.bkSerial && usedSerials[entry.bkSerial]) {
        let maxSerial = 0;
        data.bookings.forEach(function (b) { if (b && b.bkSerial > maxSerial) maxSerial = b.bkSerial; });
        entry.bkSerial = maxSerial + 1;
      }
      if (entry.bkSerial) usedSerials[entry.bkSerial] = true;
      if (pos[entry.id] !== undefined) data.bookings[pos[entry.id]] = entry;
      else { pos[entry.id] = data.bookings.length; data.bookings.push(entry); }
    });

    const rmSet = {};
    deleteOps.forEach(function (o) { rmSet[o.id] = true; });
    if (Object.keys(rmSet).length) {
      data.bookings = data.bookings.filter(function (b) { return b && b.id && !rmSet[b.id]; });
    }

    fileId = _bkWriteFile_(fileId, data, ctx);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }

  // ── Phase 2：鎖外，GC best-effort（不影響 Phase 1 已成功寫入的資料）──
  const gcErrors = [];
  const idToNewEventId = {};
  ops.forEach(function (o) {
    try {
      if (o.op === 'upsert' && o.gc && o.gc.mode === 'create') {
        const eid = createCalendarEvent_(o.gc.params, ctx);
        if (eid) idToNewEventId[o.booking.id] = eid;
      } else if (o.op === 'upsert' && o.gc && o.gc.mode === 'update' && o.booking.calendarEventId) {
        updateCalendarEvent_(Object.assign({ eventId: o.booking.calendarEventId }, o.gc.params), ctx);
      } else if (o.op === 'delete' && o.gcEventId) {
        deleteCalendarEvent_({ eventId: o.gcEventId }, ctx);
      }
    } catch (e) {
      gcErrors.push({ id: (o.booking && o.booking.id) || o.id, message: (e && e.message) || String(e) });
    }
  });

  // ── Phase 3：僅在 Phase 2 拿到新 eventId 時，再次鎖內補寫 calendarEventId ──
  if (Object.keys(idToNewEventId).length) {
    const lock2 = LockService.getScriptLock();
    lock2.waitLock(15000);
    try {
      const loaded2 = _bkReadFile_(ctx);
      let fileId2 = loaded2.fileId;
      const data2 = loaded2.data;
      let touched = false;
      data2.bookings = data2.bookings.map(function (b) {
        if (b && idToNewEventId[b.id]) { touched = true; return Object.assign({}, b, { calendarEventId: idToNewEventId[b.id] }); }
        return b;
      });
      if (touched) _bkWriteFile_(fileId2, data2, ctx);
      data = data2;
    } finally {
      try { lock2.releaseLock(); } catch (_) {}
    }
  }

  const affectedIds = {};
  upsertOps.forEach(function (o) { affectedIds[o.booking.id] = true; });
  const finalBookings = data.bookings.filter(function (b) { return b && affectedIds[b.id]; });

  return { ok: true, bookings: finalBookings, gcErrors: gcErrors };
}

// ══════════════════════════════════════════════════════════════════════════
//  Google 日曆同步（後端定時執行版）
//  移植自 dev/index.html 的 syncFromCalendar（前端函式仍保留，供手動按鈕使用）。
//  由 runGcSyncTick()（time trigger，見 setupGcSyncTrigger()）呼叫，不透過 doPost，
//  不新增任何 action，公開攻擊面零增加。
// ══════════════════════════════════════════════════════════════════════════

// 與 dev/index.html 的 ROOMS 同步維護（該常數變動時本表也要跟著改）。
const GC_SYNC_ROOMS = ['玉山', '雪山', '中央山脈', '阿里山', '海岸山脈', '團體諮商室', '會議室', '其他'];

// 解析 GC 事件標題「{空間字首}.{人員姓名,...}」→ 對照 config.users 還原 email。
// 與前端 _parseBkGcTitle 的刻意差異：後端沒有使用者偏好可寫，無法辨識的空間字首
// 一律當成 customRoom 字串原樣保留，不會註冊到任何人的「自訂空間」清單。
function _gcSyncParseTitle_(title, users) {
  if (!title) return null;
  const dotIdx = title.indexOf('.');
  const roomPart   = dotIdx >= 0 ? title.slice(0, dotIdx) : title;
  const personPart = dotIdx >= 0 ? title.slice(dotIdx + 1) : '';

  const knownRooms = GC_SYNC_ROOMS.filter(function (r) { return r !== '其他'; });
  let room = null;
  for (let i = 0; i < knownRooms.length; i++) {
    if (knownRooms[i].charAt(0) === roomPart) { room = knownRooms[i]; break; }
  }
  if (!room && roomPart) room = roomPart; // 未知字首：原樣當 customRoom 字串保留（不做偏好註冊）

  const names = personPart ? personPart.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  const counselors = names.map(function (name) {
    let found = null;
    Object.keys(users || {}).some(function (email) {
      if (((users[email] || {}).name || '') === name) { found = [email, users[email]]; return true; }
      return false;
    });
    return found
      ? { value: found[0], label: found[1].name || name, isCustom: false }
      : { value: name, label: name, isCustom: true };
  });
  return {
    room: room || '',
    counselors: counselors,
    counselorName: counselors.map(function (c) { return c.label; }).join(','),
    counselorEmail: (counselors[0] && !counselors[0].isCustom) ? counselors[0].value : '',
  };
}

// 讀 config.json 取 users（人名→email 解析用）；讀不到則回傳空物件（不阻擋同步，只是無法還原 email）。
function _gcSyncReadUsers_(ctx) {
  try {
    const cfgId = ctx.configOverride || resolvePathToId_('config.json', ctx);
    const res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + cfgId + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() >= 400) return {};
    const cfg = JSON.parse(res.getContentText());
    return (cfg && cfg.users) || {};
  } catch (e) { return {}; }
}

// 稽核寫入：append 到 audit_log.json（read-modify-write，LockService 防與其他寫入競態）。
// entry 形如前端 auditLog() 寫入的形狀：{t, email, name, action, caseId?, detail?}。
// 去識別化：detail 只含空間/時間/人員姓名，不含學號等額外欄位（照抄前端組字）。
function _gcSyncAppendAuditLog_(entries, ctx) {
  if (!entries || !entries.length) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    let fileId = null;
    let data = { logs: [] };
    try {
      fileId = resolvePathToId_('audit_log.json', ctx);
      const res = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true',
        { headers: { Authorization: 'Bearer ' + tok_() }, muteHttpExceptions: true }
      );
      if (res.getResponseCode() < 400) {
        try { data = JSON.parse(res.getContentText()); } catch (_) { data = { logs: [] }; }
        if (!data || !Array.isArray(data.logs)) data = { logs: [] };
      }
    } catch (_) { /* 檔案不存在，稍後建立 */ }

    const now = new Date().toISOString();
    entries.forEach(function (a) {
      const entry = { t: now, email: 'system', name: '系統自動同步', action: a.action };
      if (a.caseId) entry.caseId = a.caseId;
      if (a.detail) entry.detail = a.detail;
      data.logs.push(entry);
    });

    if (fileId) {
      driveUpdateContent_(fileId, data);
    } else {
      const pn = resolvePathToParentAndName_('audit_log.json', ctx);
      driveUpload_(pn.fileName, data, pn.parentId);
    }
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// GC 同步核心：讀 bookings.json + config.json + GC 事件（-30d~+90d），逐筆比對，
// 套用變更（刪除/更新/推回 GC/流水號還原），寫回 bookings.json 並記稽核。
// 全程 try/catch：單筆 GC 推回/還原失敗 console.error 後繼續；整體失敗 console.error 不拋出（trigger 不該紅）。
function gcSyncCore_(ctx) {
  try {
    const loaded = _bkReadFile_(ctx);
    const bookings = (loaded.data && Array.isArray(loaded.data.bookings)) ? loaded.data.bookings : [];
    if (!bookings.length) return;

    const users = _gcSyncReadUsers_(ctx);

    const minus30 = new Date(); minus30.setDate(minus30.getDate() - 30);
    const plus90  = new Date(); plus90.setDate(plus90.getDate() + 90);
    const pad2 = function (n) { return String(n).padStart(2, '0'); };
    const toYmd = function (d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
    const startDate = toYmd(minus30);
    const endDate   = toYmd(plus90);

    const gcEvents = listCalendarEvents_({ startDate: startDate, endDate: endDate }, ctx);
    const gcMap = {};
    gcEvents.forEach(function (e) { gcMap[e.id] = e; });

    const deletedIds = {};
    const changedIds = {};
    const serialRestoreQueue = [];
    const gcPushBackQueue = [];
    const auditActions = [];

    const newBookings = bookings.map(function (b) {
      if (!b || !b.calendarEventId) return b;
      // 查詢範圍外的預約不納入刪除判斷（可能仍存在於 GC）
      if (b.date < startDate || b.date > endDate) return b;

      const gcE = gcMap[b.calendarEventId];
      if (!gcE) {
        // GC 上已刪除 → 同步刪除本機預約
        const rd = b.room === '其他' ? (b.customRoom || '其他') : (b.room || '');
        auditActions.push({
          action: '因系統自動同步日曆而刪除預約',
          caseId: b.caseId || null,
          detail: rd + '　' + b.date + '　' + (b.startTime || '').slice(0, 5) + '–' + (b.endTime || '').slice(0, 5) + (b.counselorName ? '　' + b.counselorName : ''),
        });
        deletedIds[b.id] = true;
        return b;
      }

      const bStart = (b.startTime || '').slice(0, 5);
      const bEnd   = (b.endTime   || '').slice(0, 5);
      // 解析 GC description：{備註}\n---\n{actor} 建立/編輯 YYYY/MM/DD HH:mm\n#{serial}
      const rawDesc = gcE.description || '';
      let gcSerial = null;
      let gcNotes = '';
      const serialMatch = rawDesc.match(/\n#(\d+)\s*$/);
      if (serialMatch) {
        gcSerial = parseInt(serialMatch[1], 10);
        let body = rawDesc.slice(0, rawDesc.length - serialMatch[0].length);
        const sepIdx = body.lastIndexOf('\n---\n');
        if (sepIdx >= 0) body = body.slice(0, sepIdx);
        gcNotes = body.trim();
      } else {
        const sepIdx = rawDesc.lastIndexOf('\n---\n');
        gcNotes = sepIdx >= 0 ? rawDesc.slice(0, sepIdx).trim() : rawDesc.trim();
      }
      // 流水號對不上 → 排入還原佇列
      if (b.bkSerial && gcSerial !== b.bkSerial) serialRestoreQueue.push(b.id);

      const expectedTitle = buildEventTitle_(b.room, b.counselorName, b.customRoom || '');
      const titleChanged = gcE.title !== expectedTitle;
      const timeChanged  = gcE.date !== b.date || gcE.startTime !== bStart || gcE.endTime !== bEnd;
      const notesChanged = gcNotes !== (b.notes || '');

      if (titleChanged || timeChanged || notesChanged) {
        const rd = b.room === '其他' ? (b.customRoom || '其他') : (b.room || '');
        // 2026-07-08：GC 端有差異一律拉進 INFOSYS（以 GC 現況為準）。先前「系統較新就推回 GC」的時間戳
        // 仲裁會把使用者在 GC 的修改覆蓋回去（使用者回報「GC 修改不反映」根因）→ 已移除。
        // INFOSYS 端自己的修改仍在儲存當下即時推到 GC（bookingsCommit），不依賴本同步的推回。
        const diffs = [];
        const update = {};

        if (titleChanged) {
          const parsed = _gcSyncParseTitle_(gcE.title, users);
          if (parsed) {
            if (parsed.room && parsed.room !== rd) {
              diffs.push('空間 ' + rd + '→' + parsed.room);
              update.room = parsed.room; update.customRoom = '';
            }
            if ((parsed.counselorName || '') !== (b.counselorName || '')) {
              diffs.push('人員 ' + (b.counselorName || '—') + '→' + (parsed.counselorName || '—'));
              update.counselors = parsed.counselors; update.counselorName = parsed.counselorName; update.counselorEmail = parsed.counselorEmail;
            }
          }
        }
        if (timeChanged) {
          diffs.push(b.date + ' ' + bStart + '–' + bEnd + '→' + gcE.date + ' ' + gcE.startTime + '–' + gcE.endTime);
          update.date = gcE.date; update.startTime = gcE.startTime; update.endTime = gcE.endTime;
        }
        if (notesChanged) {
          diffs.push('說明 ' + (b.notes || '—') + '→' + (gcNotes || '—'));
          update.notes = gcNotes;
        }

        if (Object.keys(update).length > 0) {
          changedIds[b.id] = true;
          auditActions.push({
            action: '因系統自動同步日曆而更新',
            caseId: b.caseId || null,
            detail: rd + (b.counselorName ? '　' + b.counselorName : '') + '　' + diffs.join('；'),
          });
          return Object.assign({}, b, update);
        }
      }
      return b;
    });

    // 寫回 bookings.json（走 bookingsCommit_，天然享有 LockService＋衝突檢查略過——
    // 這裡的變更全部來自 GC 現況比對，不是新的使用者操作，不需再做撞房/撞人檢查）。
    if (Object.keys(changedIds).length || Object.keys(deletedIds).length) {
      const ops = [];
      newBookings.forEach(function (b) { if (b && changedIds[b.id]) ops.push({ op: 'upsert', booking: Object.assign({}, b), gc: { mode: 'none' } }); });
      Object.keys(deletedIds).forEach(function (id) { ops.push({ op: 'delete', id: id, gcEventId: null }); });
      if (ops.length) {
        try {
          bookingsCommit_({ ops: ops, checkConflicts: false }, ctx);
        } catch (e) {
          console.error('gcSyncCore_ bookingsCommit_ 失敗: ' + ((e && e.message) || e));
        }
      }
    }
    if (auditActions.length) {
      try {
        _gcSyncAppendAuditLog_(auditActions, ctx);
      } catch (e) {
        console.error('gcSyncCore_ 稽核寫入失敗: ' + ((e && e.message) || e));
      }
    }

    // 流水號還原＋系統較新推回：重寫 GC description／標題／時間。
    // 差異：後端無使用者色彩偏好可查，不重算 colorId，沿用 GC 事件既有顏色（不影響資料正確性，僅色彩不會被動修正）。
    const restoreIds = {};
    serialRestoreQueue.concat(gcPushBackQueue).forEach(function (id) { restoreIds[id] = true; });
    Object.keys(restoreIds).forEach(function (id) {
      const bk = newBookings.find(function (b) { return b && b.id === id; });
      if (!bk || !bk.calendarEventId) return;
      try {
        const isEdit = !!(bk.updatedAt && bk.updatedAt !== bk.createdAt);
        updateCalendarEvent_({
          eventId: bk.calendarEventId, room: bk.room, customRoom: bk.customRoom || '',
          date: bk.date, startTime: bk.startTime, endTime: bk.endTime,
          counselorName: bk.counselorName || '', notes: bk.notes || '',
          creatorName: bk.creatorName || bk.counselorName || '',
          createdAt: bk.createdAt, updatedAt: bk.updatedAt || bk.createdAt,
          isEdit: isEdit, bkSerial: bk.bkSerial,
        }, ctx);
      } catch (e) {
        console.error('gcSyncCore_ 還原/推回 GC 失敗 [' + id + ']: ' + ((e && e.message) || e));
      }
    });

    // GC 新增、可解析為已知空間的事件 → 自動匯入為系統預約（解析不出者略過，留待前端待確認清單人工匯入）。
    try {
      gcAutoImportKnownRoom_(gcEvents, startDate, endDate, users, ctx);
    } catch (e) {
      console.error('gcSyncCore_ 自動匯入失敗: ' + ((e && e.message) || e));
    }
  } catch (e) {
    console.error('gcSyncCore_ 失敗: ' + ((e && e.message) || e));
  }
}

// 判斷 GC 標題是否解析得出「已知空間．人員」——只認 GC_SYNC_ROOMS（排除「其他」）首字＋有人員。
// 未知/自訂空間回 null（後端不自動建立，留給前端待確認清單）。
function _gcKnownRoomOfTitleGs_(title) {
  var m = String(title || '').match(/^([^.]+)\.(.+)$/);
  if (!m) return null;
  var roomChar = m[1];
  var person = String(m[2] || '').trim();
  if (!person) return null;
  var known = GC_SYNC_ROOMS.filter(function (r) { return r !== '其他'; });
  for (var i = 0; i < known.length; i++) { if (known[i].charAt(0) === roomChar) return known[i]; }
  return null;
}

// 後端自動匯入：重讀 bookings.json 取最新占用與最大流水號，逐一為「未對應且標題為已知空間」的 GC 事件
// 建立預約（bookingsCommit_ upsert，gc:'none' 不重建事件），再回寫 GC serial/creator＋記稽核。
function gcAutoImportKnownRoom_(gcEvents, startDate, endDate, users, ctx) {
  var loaded = _bkReadFile_(ctx);
  var bookings = (loaded.data && Array.isArray(loaded.data.bookings)) ? loaded.data.bookings : [];
  var matched = {};
  var maxSerial = 0;
  bookings.forEach(function (b) {
    if (b && b.calendarEventId) matched[b.calendarEventId] = true;
    if (b && b.bkSerial > maxSerial) maxSerial = b.bkSerial;
  });
  var toImport = (gcEvents || []).filter(function (ev) {
    return ev && ev.id && !matched[ev.id] && ev.date >= startDate && ev.date <= endDate && _gcKnownRoomOfTitleGs_(ev.title);
  });
  if (!toImport.length) return;

  var ops = [];
  var created = [];
  var auditActions = [];
  toImport.forEach(function (ev, idx) {
    var parsed = _gcSyncParseTitle_(ev.title, users) || { room: '', counselors: [], counselorName: '', counselorEmail: '' };
    var raw = ev.description || '';
    var notes = '';
    var sm = raw.match(/\n#(\d+)\s*$/);
    if (sm) { var body = raw.slice(0, raw.length - sm[0].length); var si = body.lastIndexOf('\n---\n'); if (si >= 0) body = body.slice(0, si); notes = body.trim(); }
    else { var si2 = raw.lastIndexOf('\n---\n'); notes = (si2 >= 0 ? raw.slice(0, si2) : raw).trim(); }
    var now = new Date().toISOString();
    var bk = {
      id: 'bk_gc_' + Date.now() + '_' + idx,
      bkSerial: maxSerial + 1 + idx,
      room: parsed.room || '', customRoom: '',
      date: ev.date, startTime: ev.startTime, endTime: ev.endTime,
      counselors: parsed.counselors || [], counselorEmail: parsed.counselorEmail || '', counselorName: parsed.counselorName || '',
      caseId: '', caseName: '', notes: notes,
      createdAt: now, updatedAt: now, creatorName: '系統自動同步',
      calendarEventId: ev.id,
    };
    created.push(bk);
    ops.push({ op: 'upsert', booking: bk, gc: { mode: 'none' } });
    auditActions.push({
      action: '因系統自動同步日曆而匯入預約',
      caseId: null,
      detail: (bk.room || '') + '　' + bk.date + '　' + (bk.startTime || '').slice(0, 5) + '–' + (bk.endTime || '').slice(0, 5) + (bk.counselorName ? '　' + bk.counselorName : ''),
    });
  });

  try { bookingsCommit_({ ops: ops, checkConflicts: false }, ctx); }
  catch (e) { console.error('gcAutoImportKnownRoom_ bookingsCommit_ 失敗: ' + ((e && e.message) || e)); return; }

  created.forEach(function (bk) {
    try {
      updateCalendarEvent_({
        eventId: bk.calendarEventId, room: bk.room, customRoom: '',
        date: bk.date, startTime: bk.startTime, endTime: bk.endTime,
        counselorName: bk.counselorName || '', notes: bk.notes || '',
        creatorName: bk.creatorName, createdAt: bk.createdAt, updatedAt: bk.updatedAt,
        isEdit: false, bkSerial: bk.bkSerial,
      }, ctx);
    } catch (e) { console.error('gcAutoImportKnownRoom_ 回寫 GC 失敗: ' + ((e && e.message) || e)); }
  });
  try { _gcSyncAppendAuditLog_(auditActions, ctx); } catch (e) { console.error('gcAutoImportKnownRoom_ 稽核失敗: ' + ((e && e.message) || e)); }
}

// 純函式：判斷此刻是否該跑 GC 同步。weekday: 1=週一…7=週日（Utilities.formatDate 'u' 格式）。
// 上班時段（一、四 08:00-21:00；二、三、五 08:00-18:00）→ 每次 trigger（5 分鐘）都跑；
// 其餘時段（含週末、收班後）→ 只在整點附近（分鐘 < 5）跑，等效每小時一次。
function _gcSyncShouldRun(weekday, hour, minute) {
  let isWorkHour = false;
  if (weekday === 1 || weekday === 4) {
    isWorkHour = hour >= 8 && hour < 21;
  } else if (weekday === 2 || weekday === 3 || weekday === 5) {
    isWorkHour = hour >= 8 && hour < 18;
  }
  if (isWorkHour) return true;
  return minute < 5;
}

// Time trigger handler（見 setupGcSyncTrigger()，每 5 分鐘跑一次）。
function runGcSyncTick() {
  const weekday = Number(Utilities.formatDate(new Date(), 'Asia/Taipei', 'u'));
  const hour    = Number(Utilities.formatDate(new Date(), 'Asia/Taipei', 'H'));
  const minute  = Number(Utilities.formatDate(new Date(), 'Asia/Taipei', 'm'));
  if (!_gcSyncShouldRun(weekday, hour, minute)) return;

  // gmailLabel 依本環境 ALLOWED_ROOTS 取（dev＝ml-processed-dev、prod＝ml-processed）——先前硬寫
  // 'ml-processed-dev'，推正式版 Copy-Item 後仍是 dev label，會與 dev 共用同一 npust.scc 信箱互相汙染
  // 已處理信件的標記；改為從本環境設定推導，缺才 fallback。
  const _root = ALLOWED_ROOTS[ROOT_FOLDER_ID];
  const ctx = { root: ROOT_FOLDER_ID, configOverride: CONFIG_FILE_ID_OVERRIDE, calendarName: CALENDAR_NAME,
    gmailLabel: (_root && _root.gmailLabel) || 'ml-processed-dev' };
  gcSyncCore_(ctx);
}

// 一次性設定：刪除既有同 handler 的 trigger 後，建立每 5 分鐘一次的 time trigger。
// 於 GAS 編輯器手動執行一次即可（dev/prod 各自的專案都要各跑一次）。
function setupGcSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runGcSyncTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runGcSyncTick').timeBased().everyMinutes(5).create();
  console.log('setupGcSyncTrigger: runGcSyncTick 已設定為每 5 分鐘執行一次');
}
