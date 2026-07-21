-- server/migrations/010_omsv_offboard_grace.sql
-- v236：學諮系統資料夾（openmail archive，見 migrations/007/008）離職清理——寬限鐘。
--
-- 定位：學諮系統資料夾是「個人工作副本」，不是正式個案紀錄的權威存放處（個案信件應另外歸入
-- 個案紀錄，見 dev/index.html v236 前端提醒）。使用者帳號停用（離職／異動）後，其封存不該無限期
-- 留存：帳號停用滿 OMSV_OFFBOARD_GRACE_DAYS（預設 90）天，由 openmail/offboardSweep.js 的排程
-- 自動整批刪除該 owner 的 openmail_archive_folders/messages；v235 的「記住密碼」（見
-- openmail_saved_creds、credPersist.js）則在發現停用當下就立即刪，不等寬限（密碼是活體憑證，沒有
-- 「保留寬限期」的正當理由，及早清除才是正確方向）。
--
-- 本表只做一件事：記「這個 owner 第一次被 sweep 發現是停用狀態」的時間點。
--   - 「首次發現才起算」是刻意的保守設計：config.json 的 users 表本身不記錄「何時被停用」，
--     sweep 只能觀察到「當下是不是停用」。若改用其他時間來源（例如帳號建立時間、上次登入時間）
--     推算停用時刻，可能因為系統沒抓到某次短暫停用而誤判、或抓到比真實停用時刻更早的時間，導致
--     寬限期被提前消耗、東西刪得比預期早——這正是 CLAUDE.md 資安原則「fail-safe 優先」要避免的
--     方向。「首次發現才起算」保證寬限鐘只會比真實停用時刻晚（或相等），寧可多留、不可少留。
--   - 重新啟用（下次 sweep 發現該 owner 又是未停用狀態）＝立即刪除本表對應列，鐘歸零；之後若
--     再次停用，寬限期重新從頭計算，不會延續之前累積的天數。
CREATE TABLE IF NOT EXISTS openmail_offboard_grace (
  owner_email            TEXT PRIMARY KEY,
  first_seen_disabled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
