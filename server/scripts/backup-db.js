#!/usr/bin/env node
// server/scripts/backup-db.js — better-sqlite3 線上備份（backup API＝一致性快照，WAL 開著也安全，
// 不可用 cp 直接複製活體 DB 檔）。供「PC 端每日拉取的臨時異地備份」與日後 NAS 排程共用。
// 用法：node scripts/backup-db.js <輸出檔路徑>
'use strict';

const config = require('../src/config');
const { openDb } = require('../src/db');

const dest = process.argv[2];
if (!dest) {
  console.error('用法：node scripts/backup-db.js <輸出檔路徑>');
  process.exit(1);
}

openDb(config.DB_PATH).backup(dest)
  .then(() => console.log('備份完成：' + dest))
  .catch((e) => { console.error('備份失敗：' + e.message); process.exit(1); });
