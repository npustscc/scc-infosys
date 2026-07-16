-- server/migrations/005_login_name.sql
-- 帳號發放與管理：登入帳號（login_name）別名層，與內部身分 email 脫鉤（見任務背景）。
-- 內部一切資料（config.users、session token 的 e、個案/預約引用）仍以既有 email 為鍵，完全不動；
-- 本欄只是「使用者拿什麼字串登入」的別名，解析出 users.email（主鍵）後，後續授權閘／session／
-- 裝置憑證／寄信全部沿用內部 email，與本欄脫鉤（見 auth/local.js getUserByLogin／
-- verifyLocalCredentialsDetailed、actions/session.js sessionStart 檔頭註解）。
--   login_name           — 大小寫不敏感（一律存小寫，見 getUserByLogin／adminCreateLocalAccount／
--                           adminUpdateLocalAccount 一律先 toLowerCase 再寫入或查詢）。三種身分發放
--                           規則不同：專任＝校內帳號（可當預設收碼信箱 帳號@mail.npust.edu.tw）、
--                           實習生＝自設帳號、兼任＝管理者指定帳號——皆可能不是 email 格式，故本欄
--                           型別為自由文字，不加 email 格式檢查（唯一性靠下方 UNIQUE index）。
--   must_change_password — 初始密碼固定 123456789（見 auth/local.js DEFAULT_INITIAL_PASSWORD）；
--                           本欄為 1 時，密碼即使驗證正確也還差一步（見 verifyLocalCredentialsDetailed
--                           的 kind:'password_change_required'），逼首登必須改密碼才能繼續往下走
--                           第二因素／核發 session。
-- 既有資料回填：login_name = 小寫 email——既有帳號的登入帳號本來就是 email，backfill 後語意不變，
-- 既有測試／既有使用者登入方式不受影響（不強迫既有帳號補改密碼，must_change_password 預設 0）。
ALTER TABLE users ADD COLUMN login_name TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

UPDATE users SET login_name = lower(email) WHERE login_name IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_name ON users(login_name);
