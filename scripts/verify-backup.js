import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
const dbPath = path.join(dataDir, 'database.sqlite');

if (!fs.existsSync(dbPath)) {
  console.log('Không tìm thấy database.sqlite, bỏ qua verify.');
  process.exit(0);
}

try {
  const db = new Database(dbPath, { readonly: true });
  const result = db.pragma('integrity_check');
  
  if (result.length > 0 && result[0].integrity_check === 'ok') {
    console.log('✅ Integrity check passed: Database is healthy.');
    process.exit(0);
  } else {
    console.error('❌ Integrity check failed:', result);
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Lỗi kiểm tra database:', error.message);
  process.exit(1);
}
