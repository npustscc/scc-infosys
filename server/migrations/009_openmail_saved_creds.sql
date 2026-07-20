-- server/migrations/009_openmail_saved_creds.sql
-- v235：信箱「記住密碼（自動登入）」——openmail 帳密選擇性（opt-in，預設關）落地儲存。
--
-- 背景：openmail/credStore.js 的既有最高資安要求是「密碼只存記憶體、永不落地」（每週日 00:00
-- 台北時間統一過期，或伺服器重啟即全部清空）。本表是使用者裁決的**唯一例外**（2026-07-20 裁決）：
-- 使用者在連結信箱時主動勾選「記住密碼」，才把密碼以 AES-256-GCM 加密後存進本表，換取效期到期／
-- 伺服器重啟／登出再登入後仍能自動重連、不必重新輸入密碼。不勾（預設）＝行為與改動前完全一致，
-- 密碼只在記憶體、本表不會有該使用者的任何列。
--
-- 欄位：
--   owner_email — 拿到密碼的使用者（來自已驗證 session，非 params，見 openmail/credPersist.js）。
--   enc         — 密文，格式 `base64(iv).base64(authTag).base64(ciphertext)`（見 credPersist.js
--                 encryptCreds/decryptCreds）。明文為 JSON {u: mailUser, p: mailPass}；
--                 AES-256-GCM，AAD 綁定 owner_email（防止密文被搬到別的 owner 列冒用）。
--
-- 金鑰：AES-256 金鑰只存在 server/.env 的 OPENMAIL_CRED_KEY（64 hex chars＝32 bytes，
-- openssl rand -hex 32 產生），不進 repo、不進 sqlite。金鑰未設定時 credPersist.keyFromConfig
-- 回 null，整個「記住密碼」功能 fail-closed：不落地、不 hydrate、前端拿不到 rememberAvailable:true
-- 因此不會顯示勾選框。
--
-- 資安取捨（已與使用者確認，2026-07-20）：金鑰與本表同機存放，若攻擊者同時取得 sqlite 檔與
-- server/.env（等同已取得完整伺服器存取權），此加密無法再提供保護——這與「金鑰、密文同機」的
-- 任何伺服器端對稱加密方案有相同侷限，不是本設計獨有的缺陷。真正的防線仍是伺服器本身的存取控制
-- （CLAUDE.md 資安原則 1：後端才是安全邊界）；本機制的目的是防禦「只拿到 sqlite 檔（如備份外洩、
-- 資料庫層級的讀取漏洞）但沒有 .env」的情境，而非防禦已取得伺服器完整權限的攻擊者。
CREATE TABLE IF NOT EXISTS openmail_saved_creds (
  owner_email TEXT PRIMARY KEY,
  enc         TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
