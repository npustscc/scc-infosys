// server/src/util/cookies.js — 極簡 Cookie header 解析／Set-Cookie 組字串，零新 npm 依賴。
// 抽成純函式（不碰 req/res）方便單元測試，見 test/util-cookies.test.js。
'use strict';

// 'a=1; b=2' → {a:'1', b:'2'}。只做 trim＋split，不處理引號跳脫——本專案唯一會用到的
// cookie 值是信任裝置憑證（auth/deviceTrust.js buildCookieValue 產出的 base64url.base64url），
// 值本身不含分號/等號以外的保留字元，無跳脫需求。
function parseCookieHeader(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

// 組 Set-Cookie 字串：HttpOnly + SameSite=Strict + Max-Age + Path=/，刻意不加 Secure——
// 本系統目前為區網 http 部署（無 TLS）；加 Secure 會讓瀏覽器直接丟棄整個 cookie（Secure
// cookie 只能經 https 設定/傳送），等於信任裝置機制完全失效。日後若上 TLS，務必補回 Secure。
function buildSetCookieHeader(name, value, maxAgeSec) {
  return `${name}=${value}; HttpOnly; SameSite=Strict; Max-Age=${Math.round(maxAgeSec)}; Path=/`;
}

module.exports = { parseCookieHeader, buildSetCookieHeader };
