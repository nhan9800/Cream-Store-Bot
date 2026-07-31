import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config, environmentInfo } from '../src/config.js';

const projectRoot = path.resolve(environmentInfo.projectRoot);
const requestedPath = process.argv[2];
const databasePath = requestedPath
  ? path.resolve(projectRoot, requestedPath)
  : path.resolve(projectRoot, config.databasePath);

if (!fs.existsSync(databasePath)) {
  throw new Error(`Database does not exist: ${databasePath}`);
}

const database = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  const integrity = database.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') {
    throw new Error(`SQLite integrity check failed: ${integrity}`);
  }
} finally {
  database.close();
}

console.log(`[backup] Integrity check passed: ${databasePath}`);
