# 打卡紀錄 Drive 拉取器 — systemd 安裝說明

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
