import { describe, expect, it } from 'vitest';
import {
  decryptBackupBuffer,
  encryptBackupBuffer,
  getBackupEncryptionKey,
} from '../src/services/backupEncryption.js';

const key = 'a-very-long-backup-passphrase-for-tests-only';

describe('off-host backup encryption', () => {
  it('round-trips data and never exposes the plaintext', () => {
    const plain = Buffer.from('SQLite format 3\u0000 customer wallet data '.repeat(200));
    const encrypted = encryptBackupBuffer(plain, key);
    expect(encrypted.subarray(0, 8).toString('ascii')).toBe('CENARBK1');
    expect(encrypted.includes(Buffer.from('SQLite format 3'))).toBe(false);
    expect(decryptBackupBuffer(encrypted, key).equals(plain)).toBe(true);
  });

  it('uses a fresh salt and IV for each backup', () => {
    const plain = Buffer.from('same input');
    expect(encryptBackupBuffer(plain, key).equals(encryptBackupBuffer(plain, key))).toBe(false);
  });

  it('rejects a wrong key, tampering and foreign files', () => {
    const encrypted = encryptBackupBuffer(Buffer.from('payload'), key);
    expect(() => decryptBackupBuffer(encrypted, `${key}-wrong`)).toThrow();
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 20] ^= 0xff;
    expect(() => decryptBackupBuffer(tampered, key)).toThrow();
    expect(() => decryptBackupBuffer(Buffer.from('SQLite format 3 plain file content'), key)).toThrow();
  });

  it('requires a key of at least 32 characters', () => {
    expect(getBackupEncryptionKey({})).toEqual({ status: 'missing' });
    expect(getBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: 'short' })).toEqual({ status: 'too_short' });
    expect(getBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: key })).toEqual({ status: 'ok', value: key });
  });
});
