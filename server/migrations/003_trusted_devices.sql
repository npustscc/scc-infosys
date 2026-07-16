-- server/migrations/003_trusted_devices.sql
-- Phase 3b：信任裝置制登入——已註冊 TOTP 的帳號，帶有效裝置憑證時每日登入只需密碼，
-- TOTP 只在新裝置/無痕首登、裝置信任過期、登出全部裝置後才要求（見 auth/deviceTrust.js）。
--
-- token 本身不落地：DB 只存 sha256(token) 雜湊，cookie 值＝`${id}.${token}`；token 為
-- crypto.randomBytes(32) 高熵隨機值，不需要 argon2 等慢雜湊（雜湊目的是「DB 外洩不直接
-- 洩漏可用憑證」，不是抵抗離線暴力破解弱密碼，與 users.password_hash 的雜湊動機不同）。
--
-- revoked：使用者於「信任裝置清單」逐台手動撤銷（見 actions/trustedDevices.js revokeDevice）。
-- 「登出全部裝置」不需要另外遍歷本表逐筆標記撤銷——刻意重用既有 session_revocation 表
-- （auth/session.js revokeAllDevices）：verifyDeviceToken 比對裝置 created_at 是否早於該帳號
-- revoked_before，效果等同「登出全部裝置時，當下已簽發的裝置憑證全部失效」，見
-- auth/deviceTrust.js 檔頭註解。
--
-- 效期（TRUSTED_DEVICE_DAYS，預設 30 天）刻意不落成 expires_at 欄位，改為每次驗證時用
-- created_at + 當下設定值動態計算——換來的取捨是：管理者調整 TRUSTED_DEVICE_DAYS 後，
-- 既有裝置的「剩餘可用天數」會一併套用新設定值（而非沿用簽發當下的舊設定值），此為刻意
-- 選擇的簡化（單一設定值來源、不需另外遷移既有列的 expires_at）。
CREATE TABLE IF NOT EXISTS trusted_devices (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  token_hash    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ua            TEXT,
  revoked       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_email ON trusted_devices(email);
