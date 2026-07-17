# scc-infosys — Claude 工作規則

## 專案簡介

國立屏東科技大學學生諮商中心資訊系統。  
單一 `index.html`，純前端，後端為 Google Drive API（JSON 檔案儲存）。

## 資安原則（最高優先，凌駕功能）

本系統承辦大學生（皆 18 歲以上）心理諮商個資，且 **GitHub repo 為公開**。因此：

1. **後端 GAS `doPost` 才是真正的安全邊界，前端只是 UI 閘門。** 任何人都能取得公開的 `CLIENT_ID` / `APPS_SCRIPT_URL` / `DRIVE_FOLDER_ID` 直接呼叫後端。因此**每個需要授權的 action 一律經 `isAuthorizedUser_` 授權閘**（email 須在 `config.users` 且未停用），預設 deny；要放行的例外（如 `ping`、`submitUserApplication`）必須明列並寫清楚理由。新增 action 時預設它是「需要授權」的。
2. **機密與個資永不進 repo。** `creds.json`（含 OAuth client secret）、`*.csv`（個案清單）、`*.docx`/`*.xlsx`、`forsystems/` 已列入 `.gitignore`；新增這類檔案前先確認被 ignore。絕不 `git add -A` 一把梭。
3. **去識別化**：稽核、問題回報、commit message、公開 changelog 涉及個案時，除案號外不得出現姓名/學號/身分證等（見 [[feedback_issue_deidentify]]）。修補中的漏洞在正式版尚未修好前，不在對外 changelog 描述細節。

## 正式版 vs 測試版（2026-07-17 cutover 後：區網 server）

| | 前端來源 | URL | 後端 |
|---|---|---|---|
| **正式版** | `dev/index.html`（deploy 時自動置換環境常數） | `http://192.168.100.123:8787/` | `~/scc-prod/server`（Node＋sqlite，systemd `scc-prod`） |
| **測試版** | `dev/index.html` | `http://192.168.100.123:8788/` | `~/scc-dev/server`（systemd `scc-dev`） |

- 兩實例各自獨立的 sqlite 資料庫與 `.env`；GAS 僅殘留打卡橋接等用途（軟凍結只修 bug）。舊 GitHub Pages 網址已改掛遷移公告，不再服務 app。
- repo 根 `index.html` 現為 Pages 公告頁，**不再是正式版前端來源**；prod 前端由 `deploy.sh prod` 從 `dev/index.html` 以 `build-public.js --prod-from-dev` 自動建置（環境常數自動換），不再需要 `Copy-Item` 手動 promote。

## 固定工作流程（cutover 後）

**所有新功能、修改、Bug 修復 → 預設只改 `dev/index.html`（前端）與 `server/`（後端）。**

1. 動到有測試覆蓋的純邏輯 → 先跑 `node --test test/*.test.js`；動到 server → `node --test server/test/*.test.js`。綠燈才 commit。
2. `git commit`、`git push origin master`。
3. **Claude 直接部署 dev（不需使用者動手）**：`ssh scc-server 'cd ~/scc-dev/server && ./scripts/deploy.sh dev'`——腳本會 pull → 跑測試（紅燈自動中止，服務不動）→ 重建前端 → 重啟 → 冒煙。
4. 使用者在測試版 URL 眼驗。

**推行到正式版（使用者明確說「推行到正式版」／「promote」／眼驗 OK 指示上 prod）：**

1. 依 [[feedback_changelog_workflow]] 把該版 changelog 翻 `isProd:true`，commit＋push。
2. `ssh scc-server 'cd ~/scc-prod/server && ./scripts/deploy.sh prod'`——prod 模式會先做 sqlite 線上備份再更新，其餘同 dev（測試紅燈自動中止）。
3. 部署輸出確認「部署完成：scc-prod 存活、API 回應正常」。

舊 Pages 時代的 `Copy-Item` promote、`check-env-constants.mjs` 守門員、Pages check-runs 確認，僅在需要動 Pages 公告頁或 GAS 殘留用途時才相關。

**事故紀錄（2026-07-03，Pages 時代，留作教訓）**：promote 只改了 `DRIVE_FOLDER_ID`、漏改 `APPS_SCRIPT_URL`，正式版全面 `Unauthorized rootFolderId` 無法登入。現行 `build-public.js` 自動置換常數即為此教訓的制度化。

## Git 設定

- Branch: `master`
- Remote: `origin` → `https://github.com/npustscc/scc-infosys.git`
- 使用者 email: `linkinlol528101@gmail.com`

## 回應格式

使用者說「what now」或「接下來要做什麼」時，固定回覆三個項目：
1. **Progress**（已完成功能）
2. **Pending Verification**（待驗證）
3. **TODO**（待辦）

內容以最新 project_status.md 記憶為準。
