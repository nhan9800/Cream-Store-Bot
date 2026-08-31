import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

describe('legacy timestamp schema migration', () => {
  test('adds updated_at before creating warranty and quest indexes', () => {
    const projectRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'cenar-legacy-timestamp-'));
    const databasePath = path.join(tempRoot, 'legacy.sqlite');
    const envPath = path.join(tempRoot, 'legacy.env');
    const legacyDb = new Database(databasePath);

    try {
      legacyDb.exec(`
        CREATE TABLE youtube_warranty_claims (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT,
          order_code TEXT,
          status TEXT,
          created_at TEXT
        );
        CREATE TABLE quest_service_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_id TEXT,
          status TEXT,
          created_at TEXT
        );
      `);
      legacyDb.close();

      writeFileSync(envPath, [
        `DATABASE_PATH=${databasePath.replace(/\\/g, '/')}`,
        'GUILD_ID=legacy-guild',
        'ENCRYPTION_KEY=legacy-timestamp-test-key',
        'NODE_ENV=test',
      ].join('\n'));

      const databaseModuleUrl = pathToFileURL(path.join(projectRoot, 'src', 'database', 'db.js')).href;
      const probe = `
        const { db, initDatabase } = await import(${JSON.stringify(databaseModuleUrl)});
        initDatabase();
        const tableColumns = (table) => db.prepare('PRAGMA table_info(' + table + ')').all().map((row) => row.name);
        const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_youtube_warranty_claims_status', 'idx_quest_service_requests_queue') ORDER BY name").all().map((row) => row.name);
        console.log('__LEGACY_TIMESTAMP__' + JSON.stringify({
          warranty: tableColumns('youtube_warranty_claims'),
          quest: tableColumns('quest_service_requests'),
          indexes,
        }));
        db.close();
      `;
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd: projectRoot,
        env: { ...process.env, ENV_FILE: envPath, NODE_ENV: 'test' },
        encoding: 'utf8',
      });
      const resultLine = output.split(/\r?\n/).find((line) => line.startsWith('__LEGACY_TIMESTAMP__'));
      const result = JSON.parse(resultLine.slice('__LEGACY_TIMESTAMP__'.length));

      expect(result.warranty).toContain('updated_at');
      expect(result.warranty).toContain('revision');
      expect(result.quest).toContain('updated_at');
      expect(result.indexes).toEqual([
        'idx_quest_service_requests_queue',
        'idx_youtube_warranty_claims_status',
      ]);
    } finally {
      if (legacyDb.open) legacyDb.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
