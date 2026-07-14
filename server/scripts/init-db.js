#!/usr/bin/env node
// server/scripts/init-db.js — 建立/升級 SQLite 資料庫（跑 migrations/*.sql）。
// 用法：node scripts/init-db.js
'use strict';

const config = require('../src/config');
const { openDb } = require('../src/db');

const db = openDb(config.DB_PATH);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log(`資料庫已就緒：${config.DB_PATH}`);
console.log('資料表：' + tables.map((t) => t.name).join(', '));
db.close();
