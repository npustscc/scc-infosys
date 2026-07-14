// server/src/config.js — dotenv 載入＋fail-fast 檢查。
// SESSION_SECRET 是 session token 的 HMAC 簽章密鑰：缺少此值代表任何人都無法安全簽發/驗證 token，
// 寧可拒絕啟動，也不要用預設值/空字串悄悄跑起來（那等於門沒鎖）。
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function required(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`[config] 缺少必要環境變數 ${name}（請參考 server/.env.example 建立 server/.env）`);
  }
  return v;
}

const SESSION_SECRET = required('SESSION_SECRET');
const PORT = Number(process.env.PORT || 8787);
const DB_PATH = path.isAbsolute(process.env.DB_PATH || '')
  ? process.env.DB_PATH
  : path.join(__dirname, '..', process.env.DB_PATH || './data/dev.sqlite');
const ROOT_FOLDER_ID = required('ROOT_FOLDER_ID');
const GAS_PROXY_URL = process.env.GAS_PROXY_URL || '';
const CASE_AUTHZ_MODE = process.env.CASE_AUTHZ_MODE || 'shadow';
const NODE_ENV = process.env.NODE_ENV || 'development';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

module.exports = {
  SESSION_SECRET,
  PORT,
  DB_PATH,
  ROOT_FOLDER_ID,
  GAS_PROXY_URL,
  CASE_AUTHZ_MODE,
  NODE_ENV,
  PUBLIC_DIR,
};
