-- server/migrations/002_totp_enrollment.sql
-- Phase 3a：TOTP 正式註冊流程所需欄位。
--   totp_enrolled       — 是否已完成註冊（別於「totp_secret 是否為 NULL」：註冊中途的暫存密鑰
--                          不代表已啟用，見 totp_pending_secret）。
--   totp_enrolled_at    — 完成註冊（confirm 通過）的時間戳，稽核用。
--   totp_pending_secret — totpSetupStart 產生、尚未經 totpSetupConfirm 驗證通過的暫存密鑰；
--                          confirm 成功後搬進 totp_secret 並清空本欄。與 totp_secret 一樣屬機密，
--                          只在本地 SQLite，絕不進 vdrive/config.json。
-- 既有資料回填：totp_secret 已有值（Phase 1 骨架時期用 upsertUser 直接灌入）者視為已註冊。
ALTER TABLE users ADD COLUMN totp_enrolled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_enrolled_at TEXT;
ALTER TABLE users ADD COLUMN totp_pending_secret TEXT;

UPDATE users SET totp_enrolled = 1, totp_enrolled_at = updated_at
WHERE totp_secret IS NOT NULL AND totp_enrolled = 0;
