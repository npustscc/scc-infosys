#!/usr/bin/env node
// seed-dev.cjs — VM 冒煙測試用最小資料種子（放在 server/ 目錄下執行）。
// 建立：config.json（授權 dev@scc.local）、users 資料夾、bookings.json、root 外檔案（Forbidden 測試用）。
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { openDb } = require('../src/db');
const vdrive = require('../src/storage/vdrive');

const db = openDb(config.DB_PATH);
const ROOT = config.ROOT_FOLDER_ID;

const cfg = vdrive.createJson(db, {
  name: 'config.json',
  parentId: ROOT,
  content: { users: { 'dev@scc.local': { role: '專任諮商心理師' } } },
});
const usersFolder = vdrive.createFolder(db, { name: 'users', parentId: ROOT });
// bookings.json 形狀須符合 bookingsCommit（actions/commit.js）的契約（{ bookings:[...] }），
// 否則 fail-closed 會正確地拒絕寫入既有的（形狀錯誤的）檔案——這不是 bug，是 2026-07-08/09
// 事故防護在起作用；種子資料本身必須符合真實契約才不會誤觸這道防線。
const bookings = vdrive.createJson(db, { name: 'bookings.json', parentId: ROOT, content: { bookings: [] } });
const outside = vdrive.createJson(db, {
  name: 'outside-secret.json',
  parentId: 'OTHER_ROOT_NOT_OURS_000000000000',
  content: { top: 'secret' },
});

const info = { configId: cfg.id, usersFolderId: usersFolder.id, bookingsId: bookings.id, outsideId: outside.id };
fs.writeFileSync(path.join(__dirname, '../data/seed-info.json'), JSON.stringify(info, null, 2));
console.log('seed 完成：', JSON.stringify(info));
db.close();
