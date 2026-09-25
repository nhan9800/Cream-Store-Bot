import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-payment-signature-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-payment-signature-not-present';
  process.env.DATABASE_PATH = relativePath;
  process.env.ENCRYPTION_KEY = 'payment-signature-test-encryption-key';
  process.env.PAYOS_CHECKSUM_KEY = 'payment-signature-checksum-key';
  return relativePath;
});

import { db } from '../src/database/db.js';
import { verifyPayOSWebhookSignature } from '../src/services/paymentService.js';
import { extractOrderCodesFromText, normalizeOrderCode } from '../src/services/paymentOrderMatcher.js';

const payload = {
  amount: 125_000,
  cancelUrl: 'https://shop.example/payments/cancel',
  description: 'CN_123456',
  orderCode: 123456,
  returnUrl: 'https://shop.example/payments/return',
};

function expectedSignature() {
  const queryString = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('&');
  return crypto.createHmac('sha256', process.env.PAYOS_CHECKSUM_KEY)
    .update(queryString)
    .digest('hex');
}

afterAll(() => {
  if (!db.open) return;
  db.close();
  const absolutePath = path.resolve(process.cwd(), testDatabasePath);
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${absolutePath}${suffix}`, { force: true });
});

describe('PayOS webhook signature verification', () => {
  it('normalizes bank descriptions that remove the underscore from an order code', () => {
    expect(normalizeOrderCode('CN876896')).toBe('CN_876896');
    expect(extractOrderCodesFromText('[bank] transfer CN876896 complete')).toContain('CN_876896');
  });

  it('accepts a valid HMAC in either hex case', () => {
    const signature = expectedSignature();
    expect(verifyPayOSWebhookSignature(payload, signature)).toBe(true);
    expect(verifyPayOSWebhookSignature(payload, signature.toUpperCase())).toBe(true);
  });

  it('rejects altered or malformed signatures without logging signature material', () => {
    const signature = expectedSignature();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(verifyPayOSWebhookSignature(payload, `${signature.slice(0, -1)}0`)).toBe(false);
    expect(verifyPayOSWebhookSignature(payload, 'not-a-signature')).toBe(false);

    const logged = errorSpy.mock.calls.flat().map((value) => String(value)).join(' ');
    expect(logged).not.toContain(signature);
    expect(logged).not.toContain(process.env.PAYOS_CHECKSUM_KEY);
    expect(logged).not.toContain('amount=125000');
    errorSpy.mockRestore();
  });
});
