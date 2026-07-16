# 打卡紀錄 Drive 拉取器／身心調適假信箱解析拉取器 — systemd 安裝說明

`scc-attendance-pull@.service` / `.timer` 是 templated unit：實例名（`%i`）對應環境代號
（`dev` / `prod`），每個實例各自對打 `/home/scc-s-admin/scc-<實例>/server` 底下獨立的
`.env` 與 SQLite 資料庫，彼此不共用狀態。

## 安裝

```bash
sudo cp scc-attendance-pull@.service scc-attendance-pull@.timer /etc/systemd/system/
sudo systemctl daemon-reload

# dev 環境：安裝並立即啟用
sudo systemctl enable --now scc-attendance-pull@dev.timer

# prod 環境：先裝著，等 cutover 時機到了再 enable --now
sudo systemctl enable scc-attendance-pull@prod.timer
```

## 各實例 `.env` 前置設定

每個實例的 `server/.env` 需額外加一行，指向該實例專屬的唯讀 OAuth 憑證檔：

```
DRIVE_SYNC_CREDS=/home/scc-s-admin/.scc-drive-sync.json
```

憑證檔內容格式：

```json
{
  "client_id": "...",
  "client_secret": "...",
  "refresh_token": "..."
}
```

- `refresh_token` 的授權 scope 需為 `https://www.googleapis.com/auth/drive.readonly`
  （唯讀即可，拉取器只讀不寫 Drive）。
- 憑證檔權限務必收緊，只有 `scc-s-admin` 可讀：

  ```bash
  chmod 600 /home/scc-s-admin/.scc-drive-sync.json
  chown scc-s-admin: /home/scc-s-admin/.scc-drive-sync.json
  ```

- 憑證與 access token **絕不可**出現在 systemd journal（`journalctl -u scc-attendance-pull@dev`）
  ——`scripts/pull-attendance.js` 已刻意避免把任何憑證/token 內容印到 stdout/stderr，若未來修改
  此腳本，務必維持這個限制。

## 驗證

```bash
# 手動跑一次，確認 log 正常（無新紀錄／新增 N 筆二選一）
sudo systemctl start scc-attendance-pull@dev.service
journalctl -u scc-attendance-pull@dev.service -n 20 --no-pager

# 確認 timer 已排程
systemctl list-timers scc-attendance-pull@dev.timer
```

## 行為備忘

- 單向、add-only：只把 Drive 版 `attendance.json` 裡「本地沒有的 id」併入本地，絕不修改／刪除
  本地既有紀錄（本地可能有手動補登/管理者修正）。
- Drive 尚無 `attendance.json`、或本次沒有新紀錄，都是正常結束（exit 0），只有讀取/驗證/寫入
  失敗才會是非零 exit（讓 journal 可判定失敗）。
- 每 10 分鐘一次、`RandomizedDelaySec=60` 錯開多實例同時觸發、`Persistent=true` 補跑錯過的執行。

---

# 身心調適假信箱解析拉取器（`scc-mental-leaves-pull@`）

`scc-mental-leaves-pull@.service` / `.timer` 同樣是 templated unit，安裝/實例慣例與上方打卡紀錄
拉取器完全一致（`%i` = `dev`/`prod`，各自對打獨立的 `server/.env` 與 SQLite 資料庫）。

對映 dev/Code.gs `runFetchMentalLeaves`（原本掛在 GAS 的 time-driven trigger）；Node 版核心邏輯
（信件解析＋合併寫入 `mental_leaves.json`）見 `server/src/mail/mentalLeaves.js`，與 dispatch 的
`fetchMentalLeaves` action（授權使用者手動觸發用）共用同一支函式，不重複實作。

## 安裝

```bash
sudo cp scc-mental-leaves-pull@.service scc-mental-leaves-pull@.timer /etc/systemd/system/
sudo systemctl daemon-reload

# dev 環境：安裝並立即啟用
sudo systemctl enable --now scc-mental-leaves-pull@dev.timer

# prod 環境：先裝著，等 cutover 時機到了再 enable --now
sudo systemctl enable scc-mental-leaves-pull@prod.timer
```

## 各實例 `.env` 前置設定

```
# 憑證檔路徑（scope 需含 gmail.modify——比打卡拉取器用的 drive.readonly 權限更大，務必是
# 專屬於此用途、只給 npust5 信箱的憑證，不可與 DRIVE_SYNC_CREDS 共用同一份）。
GMAIL_SYNC_CREDS=/home/scc-s-admin/.scc-gmail-sync.json

# 已處理信件 label 名稱：dev/prod 務必不同（避免共用同一個 npust5 信箱時互相汙染彼此的已處理狀態）。
ML_GMAIL_LABEL=ml-processed-dev
```

憑證檔內容格式與權限收緊方式同打卡拉取器（`{client_id, client_secret, refresh_token}`、
`chmod 600`、`chown scc-s-admin:`），差別只在 OAuth scope：

- `refresh_token` 的授權 scope 需為 `https://www.googleapis.com/auth/gmail.modify`
  （需要讀信＋加標籤，唯讀 scope 不夠用）。

## 驗證

```bash
sudo systemctl start scc-mental-leaves-pull@dev.service
journalctl -u scc-mental-leaves-pull@dev.service -n 20 --no-pager

systemctl list-timers scc-mental-leaves-pull@dev.timer
```

## 行為備忘

- 冪等、add-only：以 `emailId`（Gmail 訊息 id）去重，只把「本地沒有的信」解析後併入
  `mental_leaves.json`，絕不覆寫既有紀錄——含使用者手動編輯過的 `handlingStatus`/
  `acknowledgedBy`/`deleted` 等欄位（因為根本不會去動已存在的紀錄）。
- 只支援 GAS 版的「normal（增量）」模式：查詢 `-label:<labelName>` 未處理過的信件、逐封解析、
  成功抽出關鍵欄位者才貼標。GAS 版另有 force/reparse 批次重跑模式（人工維運工具，未移植）。
- 單封信解析失敗、貼標失敗都只計數記錄，不中斷整批；只有憑證讀取/token 交換/本地 DB 開啟失敗
  才是非零 exit。
- 憑證與 access token **絕不可**出現在 systemd journal，`scripts/pull-mental-leaves.js` 已刻意
  避免把任何憑證/token 內容印到 stdout/stderr，修改此腳本務必維持這個限制。
