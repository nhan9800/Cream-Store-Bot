import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.claude-terms-test-absent',
  DATABASE_PATH: `./data/test-claude-terms-${process.pid}.sqlite`,
  ENCRYPTION_KEY: 'synthetic-claude-terms-key',
}));
import { db, initDatabase } from '../src/database/db.js';
import {
  CLAUDE_PRO_PRODUCT_KEY,
  CLAUDE_PRO_TERMS_VERSION,
  acceptClaudeProTerms,
  claudeProTermsText,
  clearClaudeProTermsAcceptance,
  hasAcceptedClaudeProTerms,
  isClaudeProProduct,
} from '../src/config/claudeProTerms202611.js';

const NOW = Date.parse('2026-11-11T10:00:00Z');
const context = { guildId: '1282637033340403754', customerId: '1138315103821889566', productKey: CLAUDE_PRO_PRODUCT_KEY };

beforeAll(() => initDatabase());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${process.env.DATABASE_PATH}${suffix}`, { force: true });
});

describe('Claude Pro CDK iOS purchase terms', () => {
  it('is scoped to the exact current manual SKU and renders the refund rules', () => {
    expect(isClaudeProProduct({ product_key: CLAUDE_PRO_PRODUCT_KEY })).toBe(true);
    expect(isClaudeProProduct({ product_key: 'claude-pro-api-100' })).toBe(false);
    const text = claudeProTermsText({ emoji: slot => `:${slot}:` });
    expect(text).toContain('15/09/2026');
    expect(text).toContain('KYC');
    expect(text).toContain('7%');
    expect(text).toContain('93%');
    expect(text).toContain('525.000đ');
  });

  it('requires a fresh versioned acceptance and expires it without trusting another SKU', () => {
    clearClaudeProTermsAcceptance(context);
    expect(hasAcceptedClaudeProTerms({ ...context, now: () => NOW })).toBe(false);
    expect(acceptClaudeProTerms({ ...context, now: () => NOW })).toBe(true);
    expect(hasAcceptedClaudeProTerms({ ...context, now: () => NOW + 60_000 })).toBe(true);
    expect(hasAcceptedClaudeProTerms({ ...context, now: () => NOW + 15 * 60_000 + 1 })).toBe(false);
    expect(hasAcceptedClaudeProTerms({ ...context, productKey: 'claude-pro-api-100', now: () => NOW })).toBe(false);
    expect(CLAUDE_PRO_TERMS_VERSION).toBe('claude-pro-ios-cdk-2026-11-11-v1');
  });
});
