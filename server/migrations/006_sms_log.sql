-- server/migrations/006_sms_log.sql
-- 簡訊發送（三竹 Mitake／Every8D，見 src/sms/）紀錄表。帳密只在 server .env（sms/actions.js
-- getMitakeConfig/getE8dConfig 讀取，不落地任何 DB 欄位）；本表只存「發送了什麼、發給誰、
-- 業者回傳什麼狀態」的營運紀錄，供 smsListLog／smsQueryStatus／smsCancel 使用。
--
-- created_at 沿用既有 migration 慣例（001_init.sql users/audit_log 等），以 SQL 層 DEFAULT
-- 產生台北無關的 UTC ISO 字串，寫入端（sms/actions.js insertBatchWithRecipients）不需自行組時間戳。
--
-- sms_batches：一次 smsSend 呼叫＝一筆（多收件人共用同一則內容／同一次預約時間，逐人狀態在
--   sms_recipients）。
--   provider            — 'mitake' | 'every8d'。
--   scheduled_at        — 14 碼 YYYYMMDDHHMMSS 台北時間字串；NULL＝即時發送（未預約）。
--   status              — 'sent'（已送出）｜'scheduled'（預約中，尚未送達時刻）｜'canceled'（預約
--                          已取消）｜'failed'（全部收件人皆發送失敗，見 sms/actions.js sendViaMitake／
--                          sendViaEvery8d 的「至少一筆成功才算整批非 failed」判斷）。
--   provider_batch_id   — Every8D 的 BATCHID（整批一次呼叫，取消/查狀態皆用此欄）；三竹為 NULL
--                          （逐一呼叫 SmSend，沒有整批批次概念，查狀態/取消改用 sms_recipients 逐筆
--                          的 provider_msgid）。
--   cost / balance_after — 業者回應提供的話才填（三竹 SmSend 不回傳單次扣點金額，恆為 NULL；
--                          Every8D sendSMS 回應含 COST/CREDIT，可直接填入）。
--
-- sms_recipients：批次內逐一收件人的狀態，供 smsQueryStatus 回寫最新送達狀態、smsCancel 標記
--   已取消筆數。
--   provider_msgid      — 三竹每人一個 msgid（逐一 SmSend 取得）；Every8D 為 NULL（Every8D 沒有
--                          逐人層級的訊息編號，送達狀態改以「手機門號」比對 getDeliveryStatus 的
--                          DATA 陣列，見 sms/actions.js smsQueryStatus）。
--   status_code/text/time — 初次發送時三竹已知即時 statuscode（Every8D 初次發送無逐人狀態，皆為
--                          NULL，等 smsQueryStatus 呼叫 getDeliveryStatus 後才回填）；之後每次
--                          smsQueryStatus 呼叫皆會覆寫成最新查詢結果。
CREATE TABLE IF NOT EXISTS sms_batches (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  provider            TEXT NOT NULL,              -- 'mitake' | 'every8d'
  sender_email        TEXT NOT NULL,
  message             TEXT NOT NULL,
  scheduled_at        TEXT,                       -- YYYYMMDDHHMMSS（台北時間）；NULL＝即時發送
  status              TEXT NOT NULL,               -- 'sent' | 'scheduled' | 'canceled' | 'failed'
  provider_batch_id   TEXT,                        -- every8d BATCHID；mitake 為 NULL
  cost                REAL,
  balance_after       REAL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sms_batches_created ON sms_batches(created_at);

CREATE TABLE IF NOT EXISTS sms_recipients (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id        INTEGER NOT NULL,
  phone           TEXT NOT NULL,
  name            TEXT,
  case_id         TEXT,
  provider_msgid  TEXT,                            -- mitake 每人一個 msgid；every8d 為 NULL
  status_code     TEXT,
  status_text     TEXT,
  status_time     TEXT,
  cost            REAL
);
CREATE INDEX IF NOT EXISTS idx_sms_recipients_batch ON sms_recipients(batch_id);
