#!/usr/bin/env node
// server/scripts/create-user.js — 建立/更新本地帳密＋TOTP 測試帳號（僅認證用；授權仍讀 vdrive
// 內 config.json 的 users，須另外用 readJson/updateJson 或直接匯入資料把該 email 加進去）。
//
// 用法：
//   node scripts/create-user.js <email> <password>              # 不啟用 TOTP
//   node scripts/create-user.js <email> <password> --totp        # 產生新 TOTP 密鑰並印出 otpauth URI
//   node scripts/create-user.js <email> <password> --disabled    # 建立但停用
'use strict';

const config = require('../src/config');
const { openDb } = require('../src/db');
const local = require('../src/auth/local');

async function main() {
  const [, , email, password, ...flags] = process.argv;
  if (!email || !password) {
    console.error('用法：node scripts/create-user.js <email> <password> [--totp] [--disabled]');
    process.exit(1);
  }
  const wantTotp = flags.includes('--totp');
  const disabled = flags.includes('--disabled');

  const db = openDb(config.DB_PATH);
  let totpSecret = null;
  if (wantTotp) {
    totpSecret = local.generateTotpSecret();
  }
  await local.upsertUser(db, email, password, { totpSecret, disabled });
  console.log(`帳號已建立/更新：${email}${disabled ? '（停用）' : ''}`);
  if (totpSecret) {
    console.log(`TOTP secret：${totpSecret}`);
    console.log(`otpauth URI：${local.totpKeyUri(email, totpSecret)}`);
    console.log('（可用 otplib/authenticator app 掃描或手動輸入密鑰產生驗證碼）');
  }
  db.close();
}

main().catch((e) => { console.error('失敗：' + e.message); process.exit(1); });
