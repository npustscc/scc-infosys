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
// 信任裝置憑證效期（天，Phase 3b，見 auth/deviceTrust.js）：非機密設定值，缺值用預設 30 即可
// 安全啟動，不用 required()。
const TRUSTED_DEVICE_DAYS = Number(process.env.TRUSTED_DEVICE_DAYS || 30);
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
  TRUSTED_DEVICE_DAYS,
  NODE_ENV,
  PUBLIC_DIR,
};
