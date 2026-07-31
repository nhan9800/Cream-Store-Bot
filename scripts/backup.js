import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
const dbPath = path.join(dataDir, 'database.sqlite');
const backupPath = path.join(dataDir, `backup_${Date.now()}.sqlite`);

if (!fs.existsSync(dbPath)) {
  console.log('Không tìm thấy database.sqlite, bỏ qua backup.');
  process.exit(0);
}

try {
  fs.copyFileSync(dbPath, backupPath);
  console.log(`✅ Đã backup database sang ${backupPath}`);
} catch (error) {
  console.error('❌ Lỗi backup database:', error.message);
  process.exit(1);
}
