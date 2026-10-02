import { execFile } from 'node:child_process';
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import http from 'node:http';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('encrypts incident output for the operator instead of publishing payment data in Actions logs', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const evidence = { order: { totalAmount: 150_000, recordedPaidAmount: 90_000 },
    findings: { providerShowsShortfall: true } };
  const server = http.createServer((request, response) => {
    if (request.headers['x-bot-api-key'] !== 'test-only-key') {
      response.writeHead(401).end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true, data: evidence }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await promisify(execFile)(process.execPath, ['scripts/payment-incident-audit.js'], {
      env: { ...process.env, AUDIT_ORDER_CODE: 'CN_940001', BOT_API_KEY: 'test-only-key',
        BOT_API_URL: `http://127.0.0.1:${server.address().port}/api/bot`,
        AUDIT_PUBLIC_KEY: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') },
      timeout: 10_000,
    });
    expect(result.stdout).not.toContain('totalAmount');
    expect(result.stdout).not.toContain('test-only-key');
    const envelope = JSON.parse(Buffer.from(result.stdout.trim().replace(/^ENCRYPTED_AUDIT=/, ''), 'base64').toString());
    const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(envelope.key, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const decoded = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
    expect(JSON.parse(decoded.toString())).toEqual(evidence);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
