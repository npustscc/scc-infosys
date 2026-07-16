// server/test/db-migrations.test.js — 遷移器原子性回歸測試（事故 2026-07-16：無交易的 migrations
// 被兩進程並發執行後留下「欄位已加、紀錄沒寫」半套用狀態，服務 duplicate column 崩潰循環）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../src/db');

function tmpMigrationsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scc-mig-test-'));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

test('migration 檔中途失敗 → 整檔回滾（不留半套用狀態），修正後重跑可乾淨套用', () => {
  const db = new Database(':memory:');
  const dir = tmpMigrationsDir({
    '001_ok.sql': 'CREATE TABLE IF NOT EXISTS t1 (id INTEGER PRIMARY KEY);',
    '002_bad.sql': 'ALTER TABLE t1 ADD COLUMN extra TEXT;\nUPDATE no_such_table SET x = 1;',
  });

  assert.throws(() => runMigrations(db, dir), /no such table/);
  // 002 的 ALTER 必須已回滾：t1 不得有 extra 欄位、schema_migrations 只記 001
  assert.deepEqual(db.prepare('PRAGMA table_info(t1)').all().map((c) => c.name), ['id']);
  assert.deepEqual(db.prepare('SELECT filename FROM schema_migrations').all().map((r) => r.filename), ['001_ok.sql']);

  // 修正 002 後重跑：乾淨套用、不撞 duplicate column
  fs.writeFileSync(path.join(dir, '002_bad.sql'), 'ALTER TABLE t1 ADD COLUMN extra TEXT;');
  runMigrations(db, dir);
  assert.deepEqual(db.prepare('PRAGMA table_info(t1)').all().map((c) => c.name), ['id', 'extra']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 2);
});

test('已套用的 migration 重跑會跳過（同一 DB 開兩次不重複執行 ALTER）', () => {
  const dir = tmpMigrationsDir({
    '001_init.sql': 'CREATE TABLE IF NOT EXISTS t1 (id INTEGER PRIMARY KEY);',
    '002_add.sql': 'ALTER TABLE t1 ADD COLUMN extra TEXT;',
  });
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scc-mig-db-')), 'x.sqlite');
  const db1 = new Database(dbFile);
  runMigrations(db1, dir);
  db1.close();
  const db2 = new Database(dbFile);
  runMigrations(db2, dir); // 半套用事故情境下這裡會 duplicate column；正常應為 no-op
  assert.deepEqual(db2.prepare('PRAGMA table_info(t1)').all().map((c) => c.name), ['id', 'extra']);
  db2.close();
});
