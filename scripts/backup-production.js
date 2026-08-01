import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config, environmentInfo } from '../src/config.js';
import { backupTagForEnvironment } from '../src/utils/backupNaming.js';

const projectRoot = path.resolve(environmentInfo.projectRoot);
const databasePath = path.resolve(projectRoot, config.databasePath);
const backupRoot = path.resolve(projectRoot, 'backups', 'deploy');
const backupRetention = Math.max(1, Number(process.env.BACKUP_RETENTION ?? 1));
const envTag = backupTagForEnvironment(process.env.ENV_FILE);
const revision = String(process.env.DEPLOY_REVISION || 'manual')
  .toLowerCase()
  .replace(/[^a-f0-9]+/g, '')
  .slice(0, 40) || 'manual';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupRoot, `${envTag}-${timestamp}-${revision}.sqlite`);

if (!fs.existsSync(databasePath)) {
  throw new Error(`Database does not exist: ${databasePath}`);
}

fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  const integrity = database.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);
  await database.backup(backupPath);
} finally {
  database.close();
}
fs.chmodSync(backupPath, 0o600);

const prefix = `${envTag}-`;
const oldBackups = fs.readdirSync(backupRoot)
  .filter((name) => name.startsWith(prefix) && name.endsWith('.sqlite'))
  .sort()
  .reverse()
  .slice(backupRetention);
for (const name of oldBackups) {
  fs.unlinkSync(path.join(backupRoot, name));
}

console.log(`[backup] Verified and created ${backupPath}`);
