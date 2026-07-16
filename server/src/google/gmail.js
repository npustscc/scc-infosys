// server/src/google/gmail.js — Gmail REST API 薄封裝層。對映 dev/Code.gs gmailApi_/
// gmailGetOrCreateLabel_（L2574-2618）。全域 fetch（Node >=18 內建，零新 npm 依賴）。
//
// 測試友善設計：跟 google/auth.js 同慣例，內部一律透過 `exports.xxx(...)` 呼叫自身其他函式，
// 使測試可用整包物件替換（monkey-patch）掉個別方法而不需真的打網路。
'use strict';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// 泛用底層呼叫：回傳解析後的 JSON；非 2xx 或非 JSON 回應一律 throw（GAS 版 gmailApi_ 用
// muteHttpExceptions 靜默吞錯、由呼叫端各自 try/catch 略過——Node 版改為明確拋錯，呼叫端
// （src/mail/mentalLeaves.js 的 fetchAndMergeMentalLeaves）逐信 try/catch 達成同等的「單封信失敗
// 不中斷整批」效果）。
async function gmailFetch(accessToken, path, opts) {
  opts = opts || {};
  const fetchOpts = {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + accessToken },
  };
  if (opts.body !== undefined) {
    fetchOpts.headers['Content-Type'] = 'application/json';
    fetchOpts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(GMAIL_API_BASE + path, fetchOpts);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_e) {
    throw new Error('Gmail API 回應不是合法 JSON（HTTP ' + res.status + '）：' + path.split('?')[0]);
  }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || ('HTTP ' + res.status);
    throw new Error('Gmail API 呼叫失敗：' + path.split('?')[0] + '（' + msg + '）');
  }
  return json;
}

async function listMessages(accessToken, q, opts) {
  opts = opts || {};
  let path = '/messages?q=' + encodeURIComponent(q || '');
  if (opts.maxResults) path += '&maxResults=' + encodeURIComponent(opts.maxResults);
  if (opts.pageToken) path += '&pageToken=' + encodeURIComponent(opts.pageToken);
  return exports.gmailFetch(accessToken, path);
}

async function getMessage(accessToken, id) {
  return exports.gmailFetch(accessToken, '/messages/' + encodeURIComponent(id) + '?format=full');
}

async function modifyLabels(accessToken, id, opts) {
  opts = opts || {};
  const body = {};
  if (opts.addLabelIds && opts.addLabelIds.length) body.addLabelIds = opts.addLabelIds;
  if (opts.removeLabelIds && opts.removeLabelIds.length) body.removeLabelIds = opts.removeLabelIds;
  return exports.gmailFetch(accessToken, '/messages/' + encodeURIComponent(id) + '/modify', { method: 'POST', body });
}

async function listLabels(accessToken) {
  return exports.gmailFetch(accessToken, '/labels');
}

// 對映 gmailGetOrCreateLabel_：找不到既有同名 label 才建立新的；回傳 labelId。
async function getOrCreateLabel(accessToken, labelName) {
  const data = await exports.listLabels(accessToken);
  const existing = (data.labels || []).find((l) => l.name === labelName);
  if (existing) return existing.id;
  const created = await exports.gmailFetch(accessToken, '/labels', { method: 'POST', body: { name: labelName } });
  return created.id || null;
}

exports.gmailFetch = gmailFetch;
exports.listMessages = listMessages;
exports.getMessage = getMessage;
exports.modifyLabels = modifyLabels;
exports.listLabels = listLabels;
exports.getOrCreateLabel = getOrCreateLabel;
exports.GMAIL_API_BASE = GMAIL_API_BASE;
