# scc-infosys — Claude 工作規則

## 專案簡介

國立屏東科技大學學生諮商中心資訊系統。  
單一 `index.html`，純前端，後端為 Google Drive API（JSON 檔案儲存）。

## 正式版 vs 測試版

| | 檔案 | URL | Drive 資料夾 ID |
|---|---|---|---|
| **正式版** | `index.html` | `https://npustscc.github.io/scc-infosys/` | `1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP` |
| **測試版** | `dev/index.html` | `https://npustscc.github.io/scc-infosys/dev/` | `1rZuVUhpHwrSYc2E0yJRvf7NaqS1lGcdx` |

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

注意：推行時 `index.html` 的 `DRIVE_FOLDER_ID` 必須維持正式版 ID `1IlqLzSewVYj-qXb6Cg65YFUiMpT22WhP`，不能帶入測試版 ID。推行後立即用 grep 確認。

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
