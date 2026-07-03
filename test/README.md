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
年度視窗計算、系所→學院對照。共 13 個測試。
