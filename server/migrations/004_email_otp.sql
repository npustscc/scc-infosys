-- server/migrations/004_email_otp.sql
-- Email 驗證碼後備第二因素：每位使用者可選 TOTP 或 Email 驗證碼其中一種（twofa_method），有信任
-- 裝置 30 天在前，第二因素平均一個月才觸發一次，故 Email 驗證碼「多一封信」的成本可接受，換來的
-- 好處是不逼所有人都要有驗證器 App（見 auth/local.js／actions/session.js 的 sessionStart 分支）。
--   twofa_method         — 'totp' | 'email' | NULL（尚未選）。NULL 且 totp_enrolled 為真時，行為
--                           等同 'totp'（既有帳號在本 migration 上線前就已註冊 TOTP，不強迫重選一次，
--                           見 actions/session.js 的判斷順序）。
--   email_otp_hash        — sha256(6 位數碼) hex。明文只出現在寄出的信件內文（機密紀律，見 CLAUDE.md）；
--                           不用 argon2 等慢雜湊——同 auth/deviceTrust.js 對 token 雜湊的理由：6 位數碼
--                           雖然熵不算高，但搭配下方 email_otp_attempts 限制次數＋10 分鐘效期＋沿用既有
--                           帳號鎖定機制，已足以擋線上暴力破解；雜湊目的只是「DB 外洩不直接洩漏當下
--                           有效驗證碼」，不是抵抗離線暴力破解自訂密碼。
--   email_otp_expires_at   — ISO timestamp，10 分鐘效期，過期即拒絕（即使碼正確）。
--   email_otp_attempts     — 本輪驗證碼已嘗試次數；驗證通過或重新寄送新碼時歸零。與 users.failed_attempts
--                           是兩個獨立欄位（本欄只是「這輪碼試了幾次」的細節），但驗證失敗仍會同時呼叫
--                           既有的 registerFailure（failed_attempts/locked_until），共用同一套帳號鎖定
--                           政策（5 次鎖 15 分鐘）——不另開一組獨立鎖定計時器，避免使用者要記兩套鎖定
--                           狀態、也避免用 email OTP 這條路繞過既有的暴力破解防護。
--   email_otp_sent_at      — ISO timestamp，供 60 秒防重寄判斷（sessionStart 重複請求且未附 emailOtp
--                           時，60 秒內不重寄，見 actions/session.js）。
--   otp_emails              — JSON 陣列字串，1~3 個收驗證碼用的 email（見 actions/twofa.js／
--                           auth/local.js 的 normalizeOtpEmails）。刻意存在本地 auth DB 的 users 表
--                           而非 vdrive config.json——OTP 寄送位址是第二因素的命脈，不該進「所有
--                           已授權使用者都讀得到」的 config.json（config.json 的 users 物件本來就是
--                           給前端顯示名冊用的，任何登入者皆可讀取）。NULL／空陣列視為「尚未設定」，
--                           寄送時防禦性 fallback 回帳號本身 email（見 auth/local.js
--                           emailOtpRecipients，理論上不會發生——twofaSetMethod('email', emails)
--                           已強制至少 1 個才會生效）。
ALTER TABLE users ADD COLUMN twofa_method TEXT;
ALTER TABLE users ADD COLUMN email_otp_hash TEXT;
ALTER TABLE users ADD COLUMN email_otp_expires_at TEXT;
ALTER TABLE users ADD COLUMN email_otp_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_otp_sent_at TEXT;
ALTER TABLE users ADD COLUMN otp_emails TEXT;
