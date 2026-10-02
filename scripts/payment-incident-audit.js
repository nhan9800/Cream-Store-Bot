import { constants, createCipheriv, createPublicKey, publicEncrypt, randomBytes } from 'node:crypto';

// Read-only diagnostic. Encrypt even the minimal projection before logging it
// because this repository and its Actions logs are public.
const code = String(process.env.AUDIT_ORDER_CODE || '').trim().toUpperCase();
if (!/^CN_[A-Z0-9_-]{4,40}$/.test(code)) throw new Error('INVALID_ORDER_CODE');
const key = process.env.BOT_API_KEY;
if (!key) throw new Error('BOT_API_KEY_UNAVAILABLE');
const publicKey = createPublicKey({ key: Buffer.from(process.env.AUDIT_PUBLIC_KEY || '', 'base64'),
  format: 'der', type: 'spki' });
if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails.modulusLength < 2048) {
  throw new Error('INVALID_AUDIT_PUBLIC_KEY');
}
const base = String(process.env.BOT_API_URL || '').replace(/\/$/, '').replace(/\/api\/bot$/, '');
if (!/^https?:\/\//.test(base)) throw new Error('BOT_API_URL_UNAVAILABLE');
const response = await fetch(`${base}/api/bot/payment-audit/${encodeURIComponent(code)}`, {
  headers: { 'x-bot-api-key': key }, signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`AUDIT_HTTP_${response.status}`);
const payload = await response.json();
if (!payload.ok || !payload.data?.order || !payload.data?.findings) throw new Error('INVALID_AUDIT_RESPONSE');
const encryptionKey = randomBytes(32);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload.data), 'utf8'), cipher.final()]);
const envelope = {
  key: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, encryptionKey).toString('base64'),
  iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ciphertext.toString('base64'),
};
console.log(`ENCRYPTED_AUDIT=${Buffer.from(JSON.stringify(envelope)).toString('base64')}`);
