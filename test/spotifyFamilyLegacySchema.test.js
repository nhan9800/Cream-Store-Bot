import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

describe('Spotify Family legacy schema migration', () => {
  test('adds missing columns before creating the new indexes', () => {
    const projectRoot = process.cwd();
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'cenar-spotify-legacy-'));
    const databasePath = path.join(tempRoot, 'legacy.sqlite');
    const envPath = path.join(tempRoot, 'legacy.env');
    const legacyDb = new Database(databasePath);

    try {
      legacyDb.exec(`
        CREATE TABLE spotify_families (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT
        );
        INSERT INTO spotify_families (name) VALUES ('Fam dữ liệu cũ');

        CREATE TABLE spotify_family_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          family_id INTEGER,
          spotify_username TEXT
        );
        INSERT INTO spotify_family_members (family_id, spotify_username)
        VALUES (1, 'legacy.profile');
      `);
      legacyDb.close();

      writeFileSync(envPath, [
        `DATABASE_PATH=${databasePath.replace(/\\/g, '/')}`,
        'GUILD_ID=legacy-guild',
        'ENCRYPTION_KEY=legacy-schema-test-key',
        'NODE_ENV=test',
      ].join('\n'));

      const databaseModuleUrl = pathToFileURL(path.join(projectRoot, 'src', 'database', 'db.js')).href;
      const probe = `
        const { db, initDatabase } = await import(${JSON.stringify(databaseModuleUrl)});
        initDatabase();
        const familyColumns = db.prepare('PRAGMA table_info(spotify_families)').all().map((row) => row.name);
        const memberColumns = db.prepare('PRAGMA table_info(spotify_family_members)').all().map((row) => row.name);
        const indexes = db.prepare(\"SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_spotify_%' ORDER BY name\").all().map((row) => row.name);
        const family = db.prepare('SELECT guild_id, name, cycle_started_at, next_renewal_at FROM spotify_families WHERE id = 1').get();
        console.log('__SPOTIFY_MIGRATION__' + JSON.stringify({ familyColumns, memberColumns, indexes, family }));
        db.close();
      `;
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd: projectRoot,
        env: { ...process.env, ENV_FILE: envPath, NODE_ENV: 'test' },
        encoding: 'utf8',
      });
      const resultLine = output.split(/\r?\n/).find((line) => line.startsWith('__SPOTIFY_MIGRATION__'));
      const result = JSON.parse(resultLine.slice('__SPOTIFY_MIGRATION__'.length));

      expect(result.familyColumns).toEqual(expect.arrayContaining([
        'guild_id',
        'login_email',
        'next_renewal_at',
        'snoozed_until',
      ]));
      expect(result.memberColumns).toEqual(expect.arrayContaining([
        'joined_at',
        'purchased_months',
        'member_expiry_at',
        'status',
      ]));
      expect(result.indexes).toEqual([
        'idx_spotify_families_due',
        'idx_spotify_family_members_family',
      ]);
      expect(result.family.guild_id).toBe('legacy-guild');
      expect(result.family.name).toBe('Fam dữ liệu cũ');
      expect(result.family.cycle_started_at).toBeTruthy();
      expect(result.family.next_renewal_at).toBeTruthy();
    } finally {
      if (legacyDb.open) legacyDb.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
