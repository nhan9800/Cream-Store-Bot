import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';

// Định dạng bản sao lưu gửi ra ngoài host:
//   MAGIC(8) | salt(16) | iv(12) | ciphertext | authTag(16)
// Nội dung trước khi mã hóa là file SQLite đã nén gzip. Khóa được dẫn xuất bằng
// scrypt từ BACKUP_ENCRYPTION_KEY, nên bản sao trên Telegram/Google Drive không
// đọc được nếu không có khóa này (khóa không bao giờ được gửi kèm file).
export const BACKUP_MAGIC = Buffer.from('CENARBK1', 'ascii');
export const MIN_BACKUP_KEY_LENGTH = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function getBackupEncryptionKey(env = process.env) {
  const value = String(env.BACKUP_ENCRYPTION_KEY || '');
  if (!value) return { status: 'missing' };
  if (value.length < MIN_BACKUP_KEY_LENGTH) return { status: 'too_short' };
  return { status: 'ok', value };
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT_OPTIONS);
}

export function encryptBackupBuffer(plain, passphrase) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  cipher.setAAD(BACKUP_MAGIC);
  const compressed = zlib.gzipSync(plain, { level: 9 });
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return Buffer.concat([BACKUP_MAGIC, salt, iv, ciphertext, cipher.getAuthTag()]);
}

export function decryptBackupBuffer(payload, passphrase) {
  const minimum = BACKUP_MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;
  if (!Buffer.isBuffer(payload) || payload.length <= minimum) throw new Error('Encrypted backup is truncated');
  if (!payload.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) throw new Error('Not a Cenar encrypted backup');
  let offset = BACKUP_MAGIC.length;
  const salt = payload.subarray(offset, offset += SALT_BYTES);
  const iv = payload.subarray(offset, offset += IV_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const ciphertext = payload.subarray(offset, payload.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAAD(BACKUP_MAGIC);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return zlib.gunzipSync(compressed);
}

export function encryptBackupFile(sourcePath, targetPath, passphrase) {
  const payload = encryptBackupBuffer(fs.readFileSync(sourcePath), passphrase);
  fs.writeFileSync(targetPath, payload, { mode: 0o600 });
  return { bytes: payload.length, sha256: crypto.createHash('sha256').update(payload).digest('hex') };
}
