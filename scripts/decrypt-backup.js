#!/usr/bin/env node
// Giải mã bản sao lưu *.sqlite.gz.cenc tải về từ Telegram/Google Drive.
// Cách dùng (khóa lấy từ biến môi trường, không truyền qua tham số dòng lệnh):
//   BACKUP_ENCRYPTION_KEY=... node scripts/decrypt-backup.js <file.cenc> <output.sqlite>
// Sau khi giải mã, script chạy PRAGMA integrity_check trên bản sao vừa tạo.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { decryptBackupBuffer, getBackupEncryptionKey } from '../src/services/backupEncryption.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: BACKUP_ENCRYPTION_KEY=... node scripts/decrypt-backup.js <file.cenc> <output.sqlite>');
  process.exit(2);
}
const key = getBackupEncryptionKey();
if (key.status !== 'ok') {
  console.error('BACKUP_ENCRYPTION_KEY is missing or shorter than 32 characters.');
  process.exit(2);
}
if (fs.existsSync(output)) {
  console.error(`Refusing to overwrite existing file: ${output}`);
  process.exit(2);
}
const plain = decryptBackupBuffer(fs.readFileSync(input), key.value);
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, plain, { mode: 0o600 });
const database = new Database(output, { readonly: true, fileMustExist: true });
try {
  const integrity = database.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`integrity_check=${integrity}`);
  console.log(`Decrypted ${input} -> ${output} (${plain.length} bytes), integrity=ok`);
} finally {
  database.close();
}
