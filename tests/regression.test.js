import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveWarrantyTimeline } from '../src/services/warrantyService.js';
import { getCustomerMembershipProgress } from '../src/services/roleService.js';
import { cleanupExpiredTranscripts, exportTicketTranscript } from '../src/services/transcriptService.js';

describe('YouTube warranty dates', () => {
  test('derives purchase and expiry from order metadata instead of N/A', () => {
    const timeline = resolveWarrantyTimeline({
      created_at: '2026-08-01 00:00:00',
      paid_at: '2026-08-02 00:00:00',
      delivered_at: '2026-08-03 00:00:00',
      duration_months: 2,
    }, {
      purchaseDate: 'N/A',
      dateExpired: 'N/A',
    });

    expect(timeline.purchaseDate).toContain(`<t:${Date.UTC(2026, 7, 2) / 1000}:D>`);
    expect(timeline.dateExpired).toContain(`<t:${Date.UTC(2026, 9, 3) / 1000}:D>`);
    expect(timeline.purchaseDate).not.toContain('N/A');
    expect(timeline.dateExpired).not.toContain('N/A');
  });

  test('prefers persisted expiry_at when it exists', () => {
    const timeline = resolveWarrantyTimeline({
      created_at: '2026-08-01 00:00:00',
      expiry_at: '2026-12-24 00:00:00',
      duration_months: 1,
    });
    expect(timeline.dateExpired).toContain(`<t:${Date.UTC(2026, 11, 24) / 1000}:D>`);
  });
});

describe('compact transcript storage', () => {
  test('exports one HTML archive without Discord attachment buffers', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-transcript-'));
    try {
      const result = await exportTicketTranscript({
        name: 'bao-hanh-880006',
        guild: { name: 'Cenar Store', iconURL: () => null },
        messages: { fetch: async () => new Map() },
      }, { directory: tempRoot });

      expect(result.savedToDisk).toBe(true);
      expect(result.htmlFileName).toMatch(/^transcript_bao-hanh-880006_[a-f0-9]{24}\.html$/);
      expect(result).not.toHaveProperty('htmlBuffer');
      expect(result).not.toHaveProperty('textBuffer');
      expect(result).not.toHaveProperty('textFileName');
      expect(fs.existsSync(result.savedHtmlPath)).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('removes only expired HTML archives', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-retention-'));
    try {
      const expired = path.join(directory, 'old.html');
      const recent = path.join(directory, 'new.html');
      const unrelated = path.join(directory, 'keep.txt');
      fs.writeFileSync(expired, 'old');
      fs.writeFileSync(recent, 'new');
      fs.writeFileSync(unrelated, 'keep');
      const now = Date.UTC(2026, 7, 8);
      fs.utimesSync(expired, new Date(now - 40 * 86_400_000), new Date(now - 40 * 86_400_000));
      fs.utimesSync(recent, new Date(now - 2 * 86_400_000), new Date(now - 2 * 86_400_000));

      const result = cleanupExpiredTranscripts({ directory, retentionDays: 30, now });
      expect(result).toEqual({ scanned: 2, removed: 1 });
      expect(fs.existsSync(expired)).toBe(false);
      expect(fs.existsSync(recent)).toBe(true);
      expect(fs.existsSync(unrelated)).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('Cenar Patron membership', () => {
  test('automatic service activity unlocks Patron without a normal order', () => {
    const progress = getCustomerMembershipProgress({
      total_spent: 0,
      total_completed_orders: 0,
      service_activity_count: 1,
      service_spent: 0,
    });
    expect(progress.current.key).toBe('active');
    expect(progress.serviceActivityCount).toBe(1);
  });

  test('service spend contributes to higher membership tiers', () => {
    const progress = getCustomerMembershipProgress({
      total_spent: 700_000,
      total_completed_orders: 1,
      service_activity_count: 2,
      service_spent: 400_000,
    });
    expect(progress.totalSpent).toBe(1_100_000);
    expect(progress.current.key).toBe('vip');
  });
});
