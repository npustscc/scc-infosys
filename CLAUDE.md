# scc-infosys — Claude 工作規則

## 專案簡介

國立屏東科技大學學生諮商中心資訊系統。  
單一 `index.html`，純前端，後端為 Google Drive API（JSON 檔案儲存）。

## 固定工作流程

每次完成功能或修復後，**直接** `git add`、`git commit`、`git push origin master`，不需詢問使用者是否要推。

**理由：** 使用者靠 GitHub Pages 測試，push 是每次完成後的標準動作。不需要 pull request，直接推 master。

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
