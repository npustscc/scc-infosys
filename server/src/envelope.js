// server/src/envelope.js — GAS doPost 的三態回應 envelope，bug-for-bug 相容（前端 proxyCall 依此判讀）。
//   成功：           { success: true, data }
//   業務錯誤（bizError）：{ success: true, data: { error, ...extra } }   ← 注意 success 仍是 true！
//   例外（fail）：      { success: false, error }
// 前端 proxyCall（dev/index.html:24947）行為依據：
//   - data.data.error === 'Session expired' | 'Unauthorized' → 視為憑證問題，自動重新登入後重試一次
//   - 其餘 data.data.error（且 !data.data.ok）→ 直接 throw new Error(該字串)
//   - data.success === false → !data.success 分支同樣會被當一般錯誤處理（data.data 是 undefined）
// 因此 bizError 與 fail 對前端呈現的差異只在「是否觸發自動重試」，字串本身才是關鍵語意。
'use strict';

function ok(data) {
  return { success: true, data: data === undefined ? null : data };
}

function bizError(error, extra) {
  return { success: true, data: Object.assign({ error }, extra || {}) };
}

function fail(err) {
  const message = err && err.message ? err.message : String(err);
  return { success: false, error: message };
}

module.exports = { ok, bizError, fail };
