// server/src/config.js — dotenv 載入＋fail-fast 檢查。
// SESSION_SECRET 是 session token 的 HMAC 簽章密鑰：缺少此值代表任何人都無法安全簽發/驗證 token，
// 寧可拒絕啟動，也不要用預設值/空字串悄悄跑起來（那等於門沒鎖）。
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function required(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`[config] 缺少必要環境變數 ${name}（請參考 server/.env.example 建立 server/.env）`);
  }
  return v;
}

const SESSION_SECRET = required('SESSION_SECRET');
const PORT = Number(process.env.PORT || 8787);
const DB_PATH = path.isAbsolute(process.env.DB_PATH || '')
  ? process.env.DB_PATH
  : path.join(__dirname, '..', process.env.DB_PATH || './data/dev.sqlite');
const ROOT_FOLDER_ID = required('ROOT_FOLDER_ID');
const GAS_PROXY_URL = process.env.GAS_PROXY_URL || '';
// 打卡紀錄 Drive 拉取器（scripts/pull-attendance.js）專用：指向 OAuth 憑證 JSON 檔路徑
// （{client_id, client_secret, refresh_token}，scope 為 drive.readonly）。選填——server 主程式
// 不需要它，故不可用 required()，缺值時交由呼叫端（pull-attendance.js）自行 fail-fast。
const DRIVE_SYNC_CREDS = process.env.DRIVE_SYNC_CREDS || '';
// 身心調適假信箱解析（scripts/pull-mental-leaves.js＋dispatch fetchMentalLeaves/clearMentalLeaves
// action）專用：指向 OAuth 憑證 JSON 檔路徑（{client_id, client_secret, refresh_token}，scope 為
// gmail.modify）。選填——server 主程式不需要它，缺值時交由呼叫端（scripts/pull-mental-leaves.js／
// src/actions/mail.js）自行 fail-fast/回業務錯誤，故不可用 required()。
const GMAIL_SYNC_CREDS = process.env.GMAIL_SYNC_CREDS || '';
// Gmail 已處理信件 label 名稱：對映 dev/Code.gs ALLOWED_ROOTS[root].gmailLabel（dev＝
// ml-processed-dev、prod＝ml-processed）。Node 版單一 root，故用環境變數直接指定，不比照 GAS
// 用 rootFolderId 查表。
const ML_GMAIL_LABEL = process.env.ML_GMAIL_LABEL || 'ml-processed-dev';
// 日曆同步（scripts/gc-sync-tick.js＋dispatch 7 個日曆 action＋bookingsCommit 的 gc 參數）專用：
// 指向 OAuth 憑證 JSON 檔路徑（{client_id, client_secret, refresh_token}，refresh_token 的 scope
// 需含 https://www.googleapis.com/auth/calendar，npust.scc 帳號）。選填——server 主程式不需要它，
// 缺值時交由呼叫端（src/sync/gcSync.js 的 requireCalendarClient／bookingsCommitWithGc）自行
// fail-fast/回業務錯誤或靜默維持 Phase 1.5 行為，故不可用 required()。
const CALENDAR_SYNC_CREDS = process.env.CALENDAR_SYNC_CREDS || '';
// 寄信（登入通知信／打卡彙整信，見 src/mail/mailer.js）專用：指向 OAuth 憑證 JSON 檔路徑
// （{client_id, client_secret, refresh_token}，refresh_token 的 scope 需含
// https://www.googleapis.com/auth/gmail.send，npust.scc 帳號）。可與 CALENDAR_SYNC_CREDS 指向
// 同一檔——npust.scc 憑證可同時含 calendar 與 gmail.send scope，不需為每種用途各辦一份憑證。
// 選填——server 主程式不需要它，缺值時 mailer.sendMail 降級為 audit-only（記稽核、mailSent:false，
// 不寄信、不阻斷呼叫端主流程），故不可用 required()。
const MAIL_SEND_CREDS = process.env.MAIL_SEND_CREDS || '';
// 日曆名稱：對映 dev/Code.gs CALENDAR_NAME（dev='[DEV] SCC 空間預約'／prod='SCC 空間預約'）。
const GC_CALENDAR_NAME = process.env.GC_CALENDAR_NAME || 'SCC 空間預約';
// 打卡權杖管理橋接（actions/clockBridge.js）：GAS_BRIDGE_URL＝對應環境 GAS 部署的 /exec 網址
// （dev 對 dev、prod 對 prod，不可交叉），GAS_BRIDGE_KEY＝GAS setupBridgeKey() 產生的共享密鑰
// （Script Properties BRIDGE_KEY）。選填——缺值時 clockTokenIssue/Revoke/List 回業務錯誤，
// 其餘功能不受影響。
const GAS_BRIDGE_URL = process.env.GAS_BRIDGE_URL || '';
const GAS_BRIDGE_KEY = process.env.GAS_BRIDGE_KEY || '';
const CASE_AUTHZ_MODE = process.env.CASE_AUTHZ_MODE || 'shadow';
// issues.json dev/prod 共用（v198，見 storage/sharedIssuesDb.js＋dispatch.js「issues.json 特例
// 正規化」一帶）：指向共用 sqlite 檔絕對路徑，dev/prod 兩實例須設為同一個值，才能共用同一份
// 問題回報清單（比照 GAS 時代固定 ISSUES_FOLDER_ID 的效果，但改用獨立資料庫檔而非資料夾 id，
// 因為 Node 版 vdrive 是單一 root 骨架，沒有 GAS 版 ALLOWED_ROOTS 多環境切換機制）。留空
// （預設）＝完全不啟用，issues.json 照舊落在各自環境自己的主庫（現行行為不變、不影響任何
// 既有測試）。選填——不可用 required()，多數部署情境（單機開發、CI）不需要它。
const SHARED_ISSUES_DB = process.env.SHARED_ISSUES_DB || '';
// v200：附件跨環境唯讀 fallback（見 actions/attachments.js downloadFileBase64 Tier 2）——
// 指向「對方環境」（dev 設 prod 的、prod 設 dev 的）主庫 DB_PATH 絕對路徑，Node 版以唯讀連線
// （src/db.js openDb(path,{readonly:true})）開啟。只有在 fileId 先通過 SHARED_ISSUES_DB
// issues.json 的附件白名單比對後才會被拿來查找，不是「本庫查無就任意翻對方整個資料庫」——
// 兩個環境變數須搭配設定才會生效，任一留空（預設）＝此 fallback 不啟用，行為與改動前一致。
// 選填——不可用 required()，多數部署情境（單機開發、CI、尚未啟用共用問題回報）不需要它。
const PEER_DB = process.env.PEER_DB || '';
// v200：附件 Drive 舊資料唯讀 fallback（見 actions/attachments.js downloadFileBase64 Tier 3）——
// cutover 前（GAS+Drive 時代）上傳的附件，fileId 是真實 Google Drive file id，vdrive/PEER_DB
// 皆查無屬正常。逗號分隔的允許系統根資料夾 id 清單（建議同時列入 dev／prod 兩個環境的
// ROOT_FOLDER_ID，讓任一環境的伺服器都能唯讀開啟兩邊 cutover 前的舊附件，不受目前部署在哪個
// 環境限制）；只有當 fileId 沿 Drive parents 鏈上溯確實能到達清單中的某個根，才會被下載，
// 防止此 fallback 被濫用成任意 Drive 檔案 id 的探測器。搭配 DRIVE_SYNC_CREDS（唯讀 OAuth 憑證，
// 與 scripts/pull-attendance.js 共用同一憑證檔機制）使用，兩者皆須設定才會啟用；任一留空
// （預設）＝此 fallback 不啟用。
const DRIVE_LEGACY_ROOTS = process.env.DRIVE_LEGACY_ROOTS || '';
// #035 個管派任物件級授權（configCasesPatch 各 op 的呼叫者資格驗證，見 actions/config.js
// casesPatchOpAuthz）：'off'＝不判定；'shadow'（預設）＝判定只記稽核不阻擋，供觀察誤傷；
// 'enforce'＝違規整批拒絕。比照 CASE_AUTHZ_MODE 的 shadow→enforce 推進模式。
const CASES_PATCH_AUTHZ_MODE = process.env.CASES_PATCH_AUTHZ_MODE || 'shadow';
// 信任裝置憑證效期（天，Phase 3b，見 auth/deviceTrust.js）：非機密設定值，缺值用預設 30 即可
// 安全啟動，不用 required()。
const TRUSTED_DEVICE_DAYS = Number(process.env.TRUSTED_DEVICE_DAYS || 30);
// v202：校內 openmail 收發信（Openfind Mail2000 V8.00，見 openmail/client.js）連線設定——使用者
// 自行輸入自己的 openmail 帳密，密碼只存記憶體（openmail/credStore.js），此處只設定主機/port，
// 皆為選填、缺值採實測可用的預設值（mail.npust.edu.tw，IMAPS 993／SMTPS 465）。
const OPENMAIL_IMAP_HOST = process.env.OPENMAIL_IMAP_HOST || 'mail.npust.edu.tw';
const OPENMAIL_IMAP_PORT = Number(process.env.OPENMAIL_IMAP_PORT || 993);
const OPENMAIL_SMTP_HOST = process.env.OPENMAIL_SMTP_HOST || 'mail.npust.edu.tw';
const OPENMAIL_SMTP_PORT = Number(process.env.OPENMAIL_SMTP_PORT || 465);
// v235：信箱「記住密碼（自動登入）」opt-in 加密落地（見 openmail/credPersist.js 檔頭）——
// AES-256 金鑰，64 hex chars（32 bytes，openssl rand -hex 32 產生）。留空（預設）＝功能整個
// fail-closed（credPersist.keyFromConfig 回 null，不落地、不 hydrate，前端不顯示「記住密碼」
// 勾選框），故不可用 required()，多數部署情境不需要啟用此 opt-in 例外。
const OPENMAIL_CRED_KEY = process.env.OPENMAIL_CRED_KEY || '';
// v236：學諮系統資料夾（openmail archive）離職清理寬限天數，見 openmail/offboardSweep.js 檔頭與
// migrations/010_omsv_offboard_grace.sql。非機密設定值，缺值用預設 90 即可安全啟動，不用 required()。
const OMSV_OFFBOARD_GRACE_DAYS = Number(process.env.OMSV_OFFBOARD_GRACE_DAYS || 90);
// 簡訊發送（三竹 Mitake／Every8D，見 src/sms/）連線設定——帳密只在 server .env，前端永不經手
// （見 src/sms/actions.js getMitakeConfig/getE8dConfig，比照 openmail 帳密的「機密永不進 repo」
// 資安原則）。全部選填：任一平台缺帳密即視為「未設定此平台」（smsStatus 據此回報，smsSend/
// smsBalance 對該平台一律回業務錯誤 sms_not_configured，不 fail-fast、不影響其他平台或其餘功能）。
const SMS_MITAKE_HOST = process.env.SMS_MITAKE_HOST || '';
// 依三竹核發帳號而異：一般帳號 /api/mtk，B2C 帳號可能是 /b2c/mtk，缺值採前者。
const SMS_MITAKE_BASE_PATH = process.env.SMS_MITAKE_BASE_PATH || '/api/mtk';
const SMS_MITAKE_USERNAME = process.env.SMS_MITAKE_USERNAME || '';
const SMS_MITAKE_PASSWORD = process.env.SMS_MITAKE_PASSWORD || '';
// 設 '1' 表示帳號已開通長簡訊權限；未設時 sms/actions.js smsSend 會擋下超過單則長度（GSM 160/
// UCS2 70 字）的內容——三竹對未開通長簡訊的帳號會靜默截斷超長簡訊，這是資料正確性風險，寧可
// 送出前擋下並回業務錯誤，也不要讓使用者以為完整內容已送達。
const SMS_MITAKE_LONG = process.env.SMS_MITAKE_LONG === '1';
const SMS_E8D_HOST = process.env.SMS_E8D_HOST || 'api.e8d.tw';
const SMS_E8D_UID = process.env.SMS_E8D_UID || '';
const SMS_E8D_PWD = process.env.SMS_E8D_PWD || '';
// v209：新生心理測驗「導師名冊」與 tutorsys 同步（見 freshmanTest/tutorsysSync.js）——指向同機
// scc-tutorsys 該環境的 store 目錄絕對路徑（dev 對 dev、prod 對 prod，不可交叉；例：
// /home/scc-s-admin/scc-tutor-dev/server/data/store）。唯讀，且只允許讀取白名單內的
// classes.json／departments.json 兩檔（見 tutorsysSync.js ALLOWED_FILES，exact-match，非
// pattern）。留空（預設）＝ftTutorSyncFetch 回業務錯誤，前端「與導師系統同步」按鈕顯示「未設定」，
// 其餘新生心理測驗功能不受影響，故不可用 required()。
const TUTORSYS_STORE_DIR = process.env.TUTORSYS_STORE_DIR || '';
// v221：磁碟健康度（見 actions/systemHealth.js adminGetDiskHealth＋root systemd timer 執行的
// scripts/smart-poll.js，本檔不動）——指向該 timer 寫出的 SMART 摘要 JSON 絕對路徑
// （預設 /var/lib/scc-smart/smart.json，兩實例共用同一份，因為硬體本身是同機共用）。唯讀，
// 選填——缺值時 adminGetDiskHealth 回業務錯誤 smart_not_configured，其餘功能不受影響，
// 故不可用 required()。
const SMART_STATUS_PATH = process.env.SMART_STATUS_PATH || '';
const NODE_ENV = process.env.NODE_ENV || 'development';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

module.exports = {
  SESSION_SECRET,
  PORT,
  DB_PATH,
  ROOT_FOLDER_ID,
  GAS_PROXY_URL,
  DRIVE_SYNC_CREDS,
  GMAIL_SYNC_CREDS,
  ML_GMAIL_LABEL,
  CALENDAR_SYNC_CREDS,
  MAIL_SEND_CREDS,
  GC_CALENDAR_NAME,
  GAS_BRIDGE_URL,
  GAS_BRIDGE_KEY,
  CASE_AUTHZ_MODE,
  CASES_PATCH_AUTHZ_MODE,
  SHARED_ISSUES_DB,
  PEER_DB,
  DRIVE_LEGACY_ROOTS,
  TRUSTED_DEVICE_DAYS,
  OPENMAIL_IMAP_HOST,
  OPENMAIL_IMAP_PORT,
  OPENMAIL_SMTP_HOST,
  OPENMAIL_SMTP_PORT,
  OPENMAIL_CRED_KEY,
  OMSV_OFFBOARD_GRACE_DAYS,
  SMS_MITAKE_HOST,
  SMS_MITAKE_BASE_PATH,
  SMS_MITAKE_USERNAME,
  SMS_MITAKE_PASSWORD,
  SMS_MITAKE_LONG,
  SMS_E8D_HOST,
  SMS_E8D_UID,
  SMS_E8D_PWD,
  TUTORSYS_STORE_DIR,
  SMART_STATUS_PATH,
  NODE_ENV,
  PUBLIC_DIR,
};
