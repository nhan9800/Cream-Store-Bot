import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Check the actual installation, including transitive and native dependencies.
// Directory existence alone does not prove npm ci finished successfully.
const root = path.resolve(process.argv[2] || '.');
const requireFromRoot = createRequire(path.join(root, 'package.json'));
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const name of Object.keys(manifest.dependencies || {})) requireFromRoot.resolve(name);
  for (const name of ['discord.js', '@google/genai', 'express', 'dotenv', 'sharp']) {
    await import(pathToFileURL(requireFromRoot.resolve(name)).href);
  }
  const Database = requireFromRoot('better-sqlite3');
  const db = new Database(':memory:');
  try { db.prepare('SELECT 1').get(); } finally { db.close(); }
  console.log('[runtime-deps] verified');
} catch (error) {
  console.error(`[runtime-deps] invalid code=${error?.code || error?.name || 'UNKNOWN'}`);
  process.exitCode = 1;
}
