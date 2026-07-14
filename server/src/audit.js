// server/src/audit.js — 稽核紀錄（append-only）。CLAUDE.md 資安原則：content 類參數只記長度，
// 不記內容；本模組刻意不接受任意 params 物件寫入 detail，呼叫端須自行摘要成短字串再傳入，
// 避免不小心把個資內容（如 content: JSON.stringify(整份個案）帶進 audit_log。
'use strict';

function appendAuditLog(db, { email, action, target, outcome, latencyMs, detail }) {
  db.prepare(
    `INSERT INTO audit_log (email, action, target, outcome, latency_ms, detail) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(email || null, action, target || null, outcome, latencyMs == null ? null : Math.round(latencyMs), detail || null);
}

// 常見用法：把 params 內容摘要為「只記長度」的字串，不記內容本身。
function summarizeParams(params) {
  if (!params || typeof params !== 'object') return '';
  return Object.keys(params).map((k) => {
    const v = params[k];
    const len = typeof v === 'string' ? v.length : (v && typeof v === 'object' ? JSON.stringify(v).length : String(v).length);
    return `${k}_len=${len}`;
  }).join(',');
}

module.exports = { appendAuditLog, summarizeParams };
