# scc-infosys — Claude 工作規則

## 專案簡介

國立屏東科技大學學生諮商中心資訊系統。  
單一 `index.html`，純前端，後端為 Google Drive API（JSON 檔案儲存）。

## 正式版 vs 測試版

| | 檔案 | URL | Drive 資料夾 ID | Apps Script URL（`APPS_SCRIPT_URL`） |
|---|---|---|---|---|
| **正式版** | `index.html` | `https://npustscc.github.io/scc-infosys/` | `1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP` | `https://script.google.com/macros/s/AKfycby9ZDT7NO7Jso3mbzbMaOzN0mdfgREbxoHRLC3NEbulGtKwp9eTibpD0XwKJCeC9wlh/exec` |
| **測試版** | `dev/index.html` | `https://npustscc.github.io/scc-infosys/dev/` | `1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx` | `https://script.google.com/macros/s/AKfycbwQjkuKkKn33XlMCNtt-Al3x1jkkxk1fdawb64lozIZ6rwSeGZUGhQ1gujXN8k9hPlDlw/exec` |

正式版與測試版是**兩個完全獨立的 Apps Script 後端部署**（各自的 `ALLOWED_ROOTS` 白名單只認自己的 Drive 資料夾 ID）。兩個環境專屬常數（`DRIVE_FOLDER_ID` 與 `APPS_SCRIPT_URL`）必須成對正確，帶錯任一個都會導致該版本完全無法登入（`Unauthorized` / `Unauthorized rootFolderId`）。

## 固定工作流程

**所有新功能、修改、Bug 修復 → 預設只改 `dev/index.html`。**

- 完成後直接 `git add dev/index.html`、`git commit`、`git push origin master`
- 使用者在 `dev/` URL 驗證

**推行到正式版（使用者明確說「推行到正式版」或「promote」）：**

```powershell
Copy-Item dev\index.html index.html
git add index.html dev/index.html
git commit -m "推行到正式版：[功能說明]"
git push origin master
```

注意：`Copy-Item` 會把 dev 版的兩個環境專屬常數一起帶進來，兩個都必須改回正式版的值，缺一都會讓正式版整個無法登入：

- `DRIVE_FOLDER_ID` → 正式版 ID `1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP`
- `APPS_SCRIPT_URL` → 正式版網址 `https://script.google.com/macros/s/AKfycby9ZDT7NO7Jso3mbzbMaOzN0mdfgREbxoHRLC3NEbulGtKwp9eTibpD0XwKJCeC9wlh/exec`

推行後立即用 grep 兩者一起確認（`grep -n "^const DRIVE_FOLDER_ID\|^const APPS_SCRIPT_URL" index.html`），確認 push 後也要用 check-runs API 確認 Pages 部署成功（見既有 memory）。

**事故紀錄（2026-07-03）**：曾經只改了 `DRIVE_FOLDER_ID`、漏改 `APPS_SCRIPT_URL`，導致正式版請求打到測試版的 Apps Script 後端，因 `rootFolderId` 不在白名單而全面回傳 `Unauthorized rootFolderId`，正式版完全無法登入，直到下一次 hotfix 才修復。

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
