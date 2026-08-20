import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

let tempRoot;
let db;
let service;
let reminder;
let command;
const previousEnv = {
  ENV_FILE: process.env.ENV_FILE,
  DATABASE_PATH: process.env.DATABASE_PATH,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
};

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-youtube-renewal-'));
  process.env.ENV_FILE = path.join(tempRoot, '.env.test');
  process.env.DATABASE_PATH = path.join(tempRoot, 'youtube-renewal.sqlite');
  process.env.ENCRYPTION_KEY = 'youtube-renewal-service-test-key';
  const database = await import('../src/database/db.js');
  db = database.db;
  database.initDatabase();
  service = await import('../src/services/youtubeRenewalService.js');
  reminder = await import('../src/services/youtubeRenewalReminderService.js');
  command = await import('../src/commands/youtube-renewal.js');
});

afterAll(() => {
  if (db?.open) db.close();
  if (tempRoot && tempRoot.startsWith(os.tmpdir())) fs.rmSync(tempRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('YouTube renewal service', () => {
  test('persists supplier, customer commitment and every monthly source payment', () => {
    const source = service.createYoutubeSource({
      guildId: 'TEST_GUILD',
      name: 'Nguồn YouTube A',
      paymentMethod: 'MB Bank',
      paymentAccount: '123456789',
      defaultCycleCost: 40_000,
    });
    const membership = service.createYoutubeMembership({
      guildId: 'TEST_GUILD',
      sourceId: source.id,
      customerGmail: 'student@gmail.com',
      customerName: 'Student',
      totalMonths: 3,
      paidCycles: 1,
      salePrice: 185_000,
      startedAt: '2026-08-20T12:00:00.000Z',
    });

    expect(membership).toMatchObject({
      paidCycles: 1,
      remainingCycles: 2,
      remainingSourceCost: 80_000,
      expectedMargin: 65_000,
    });
    expect(membership.history).toHaveLength(1);
    expect(membership.history[0].eventType).toBe('INITIAL_IMPORT');

    const renewed = service.markYoutubeCyclePaid(membership.id, {
      amountPaid: 39_000,
      paymentReference: 'TX-001',
      actorId: 'ADMIN',
    });
    expect(renewed.paidCycles).toBe(2);
    expect(renewed.remainingCycles).toBe(1);
    expect(renewed.history).toHaveLength(2);
    expect(renewed.history[0]).toMatchObject({ eventType: 'PAYMENT', amountPaid: 39_000, paymentReference: 'TX-001' });

    expect(service.getYoutubeRenewalStats('TEST_GUILD')).toMatchObject({
      activeMemberships: 1,
      remainingLiability: 40_000,
    });

    const payload = reminder.buildYoutubeRenewalPanel(renewed, { ping: false });
    const rendered = JSON.stringify(payload.components.map((component) => component.toJSON()));
    expect(rendered).toContain('YOUTUBE');
    expect(rendered).toContain('st•••••@gmail.com');
    expect(rendered).not.toContain('student@gmail.com');
    expect(rendered).not.toContain('123456789');
    expect(rendered).toContain(`ytrenew:paid:${membership.id}`);

    const definition = command.data.toJSON();
    expect(definition.name).toBe('youtube-renewal');
    expect(definition.options.map((option) => option.name)).toEqual(['overview', 'view', 'paid', 'history']);
  });

  test('keeps an audit event when an imported paid-cycle count is corrected', () => {
    const source = service.createYoutubeSource({ guildId: 'TEST_ADJUST', name: 'Nguồn hiệu chỉnh', defaultCycleCost: 30_000 });
    const membership = service.createYoutubeMembership({
      guildId: 'TEST_ADJUST',
      sourceId: source.id,
      customerGmail: 'legacy@gmail.com',
      totalMonths: 6,
      paidCycles: 0,
      startedAt: '2026-01-20T12:00:00.000Z',
    });
    const adjusted = service.updateYoutubeMembership(membership.id, {
      paidCycles: 2,
      adjustmentNote: 'Khôi phục từ sao kê cũ.',
      actorId: 'ADMIN',
    });
    expect(adjusted).toMatchObject({ paidCycles: 2, remainingCycles: 4 });
    expect(adjusted.history[0]).toMatchObject({
      eventType: 'ADJUSTMENT',
      cyclesAdded: 2,
      note: 'Khôi phục từ sao kê cũ.',
    });
  });
});
