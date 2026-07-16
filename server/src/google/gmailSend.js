// server/src/google/gmailSend.js — Gmail REST API 寄信薄封裝層（users.messages.send）。對映
// dev/Code.gs 各處 `MailApp.sendEmail(to, subject, body)` 呼叫點的底層動作。全域 fetch（Node >=18
// 內建，零新 npm 依賴）；不含任何業務邏輯（決定寄不寄、主旨/內文組字皆在 src/mail/ 各模組），本檔
// 只管「怎麼把一封信透過 Gmail API 送出去」。
//
// 測試友善設計：跟 google/gmail.js／google/calendar.js 同慣例，內部一律透過 `exports.xxx(...)`
// 呼叫自身其他函式，使測試可用整包物件替換（monkey-patch）掉個別方法而不需真的打網路。
'use strict';

const gmail = require('./gmail');

// 標頭值消毒：移除 CR/LF，避免呼叫端把使用者可控字串（如 UA/geo，理論上不會被組進標頭，但仍保守
// 處理）直接串進標頭時造成 header injection。
function sanitizeHeaderValue(v) {
  return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim();
}

// RFC 2047 編碼（B 編碼，UTF-8）：主旨含中文時 Gmail/多數郵件客戶端須靠此編碼才能正確顯示，
// 純 ASCII 主旨編碼後仍合法（=?UTF-8?B?...?=），故一律編碼、不特判語言，邏輯更單純。
function encodeMimeWord(str) {
  return '=?UTF-8?B?' + Buffer.from(sanitizeHeaderValue(str), 'utf8').toString('base64') + '?=';
}

// base64 內容每 76 字元換行（RFC 2045 對 base64 編碼內文的行長限制）。
function foldBase64(b64) {
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

// 組出完整 RFC 822 原文，回傳 base64url 編碼字串（Gmail API messages.send 要求的 `raw` 欄位格式）。
// htmlBody 優先於 textBody（兩者皆未提供則內文為空字串，仍組出合法信件）。
function buildRawMessage({ to, subject, textBody, htmlBody, cc, from }) {
  if (!to) throw new Error('gmailSend: to is required');
  const useHtml = htmlBody != null && htmlBody !== '';
  const bodyText = useHtml ? htmlBody : (textBody || '');
  const contentType = useHtml ? 'text/html; charset="UTF-8"' : 'text/plain; charset="UTF-8"';

  const headers = [];
  if (from) headers.push('From: ' + sanitizeHeaderValue(from));
  headers.push('To: ' + sanitizeHeaderValue(to));
  if (cc) headers.push('Cc: ' + sanitizeHeaderValue(cc));
  headers.push('Subject: ' + encodeMimeWord(subject));
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: ' + contentType);
  headers.push('Content-Transfer-Encoding: base64');

  const bodyB64 = foldBase64(Buffer.from(String(bodyText), 'utf8').toString('base64'));
  const raw = headers.join('\r\n') + '\r\n\r\n' + bodyB64;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

// 寄信：POST users.messages.send。accessToken 需含 gmail.send scope。失敗（非 2xx／回應非 JSON）
// 一律 throw（沿用 gmail.gmailFetch 的錯誤語意），呼叫端（src/mail/mailer.js）負責 try/catch 降級。
async function sendMail(accessToken, { to, subject, textBody, htmlBody, cc, from }) {
  const raw = exports.buildRawMessage({ to, subject, textBody, htmlBody, cc, from });
  return gmail.gmailFetch(accessToken, '/messages/send', { method: 'POST', body: { raw } });
}

exports.sanitizeHeaderValue = sanitizeHeaderValue;
exports.encodeMimeWord = encodeMimeWord;
exports.foldBase64 = foldBase64;
exports.buildRawMessage = buildRawMessage;
exports.sendMail = sendMail;
