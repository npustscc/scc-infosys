# 純函式單元測試

零依賴（用 Node 內建 `node:test` / `node:assert` / `node:vm`），**不修改 `dev/index.html`**。
`harness.js` 會就地從 `dev/index.html` 抽出指定函式，在隔離的 vm context 執行——測試讀的是同一份正式碼，改壞邏輯即紅燈。

## 執行

```bash
node --test test/*.test.js
```

（注意：Windows 上 `node --test test/` 目錄形式可能失敗，用上面的 glob 形式最穩。）

## 加新測試

1. 在 `pure-functions.test.js`（或新 `*.test.js`）裡 `load([...函式名], {...被依賴的全域})`。
2. `load` 的第二個參數注入函式依賴的全域：常數（如 `CHUNK_SIZE: 20`）、資料（如 `casesData: [...]`）、
   或被 stub 的 helper（如 `_getDeptToCollege: () => ({...})`）。
3. 若函式依賴其他函式，把它們一起列進 `load([...])`（例：`_dateInLeavePeriod` 需連 `_isValidMMDD`）。
4. 日期相依函式（如 `currentSemesterPrefix`）用 `makeFixedDate('2026-06-15T00:00:00')` 注入 `Date` 固定「今天」。

## 只適用純函式

harness 適合無 DOM／無網路依賴的純邏輯（案號、學期、請假期間、對照表等）。
碰 `document`、`fetch`、`proxyCall` 的函式不在此範圍——那類請在 dev URL 端到端驗證。

## 目前涵蓋

學期前綴換算、學期標籤/月份、案號產生與分塊（含邊界）、請假期間判斷（含跨年區間）、
年度視窗計算、系所→學院對照、個案可見範圍、假別額度計算、系所核心簡寫對照與撞號檢查、
主責快照函式群（`counselor-snapshots.test.js`：最新主責 email 推導、轉派前置定格、
轉派共用寫入、學期主責顯示——含 #023「先 stamp 再改單一學期，其他學期顯示不變」情境）、
結案狀態函式群（`case-status.test.js`：整案狀態推導、`_isSemesterUnclosed` 多重證據判斷
每個分支、跨學期未結案彙總）、一學生一案號 sem key 群（`sem-key.test.js`：`_semKeyBase`/
`_caseSems`/`_caseHasSem`/`_nextSemOpenKey`、`semesterLabel`/`semesterMonths`/`nextSemesterPrefix`/
`_semPrefixToApproxDate`/`_semPrefixToEndDate` 對 `#N` 後綴 sem key 的處理）、系列預約編輯調整
頻率／次數（`booking-series-replan.test.js`：`_bkSeriesReplan` 只改頻率／只加次數／只減次數／
頻率次數同改／被編輯筆為系列最後一筆／日期平移與重排疊加等情境；#24 擴充每三週固定 21 天與
每月 `'monthly'` 頻率——`_bkAddMonths` 月底邊界（含跨月不因中間月被裁切而漂移）、`_bkAddFreq`
天數／monthly 統一入口、`_bkDetectSeriesFreq` 由既有系列日期反推頻率）、一學生一案號遷移引擎
（`merge-engine.test.js`：`_buildMergePlan` 分組／選主號／同學期衝突與姓名不一致偵測、
`_mergeCaseGroup` 學期聯集／per-sem map 折入／同學期衝突 #N remap／psychTestResults 去重／
root 欄位補缺不覆蓋、`_swapFormerId` 主號↔曾用號對調往返一致）。共 163 個測試。
