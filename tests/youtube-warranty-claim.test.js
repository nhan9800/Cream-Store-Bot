import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MessageFlags } from 'discord.js';

let tempRoot;
let db;
let service;
const previousEnv = {
  ENV_FILE: process.env.ENV_FILE,
  DATABASE_PATH: process.env.DATABASE_PATH,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  STORE_WEBSITE_URL: process.env.STORE_WEBSITE_URL,
};

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-youtube-warranty-'));
  process.env.ENV_FILE = path.join(tempRoot, '.env.test');
  process.env.DATABASE_PATH = path.join(tempRoot, 'youtube-warranty.sqlite');
  process.env.ENCRYPTION_KEY = 'youtube-warranty-service-test-key';
  process.env.STORE_WEBSITE_URL = 'https://cenarstore.xyz';
  const database = await import('../src/database/db.js');
  db = database.db;
  database.initDatabase();
  service = await import('../src/services/youtubeWarrantyClaimService.js');

  db.prepare(`
    INSERT INTO tickets (
      id, ticket_code, guild_id, channel_id, customer_id, opened_by_id,
      ticket_type, related_order_code, status
    ) VALUES (701, 'TKT_701001', 'TEST_GUILD', '701000000000000001',
      '701000000000000002', '701000000000000002', 'WARRANTY', 'CN_701001', 'OPEN')
  `).run();
  db.prepare(`
    INSERT INTO orders (
      order_code, guild_id, ticket_id, ticket_channel_id, customer_id,
      product_name, status, order_log_channel_id, created_by_id, service_type
    ) VALUES ('CN_701001', 'TEST_GUILD', 701, '701000000000000001',
      '701000000000000002', 'YouTube Premium 12 Tháng', 'WARRANTY_OPEN',
      '701000000000000003', '701000000000000002', 'youtube')
  `).run();
});

afterAll(() => {
  if (db?.open) db.close();
  if (tempRoot && tempRoot.startsWith(os.tmpdir())) fs.rmSync(tempRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('YouTube warranty claim service', () => {
  test('creates one secure form per warranty ticket and never exposes full Gmail publicly', () => {
    const order = db.prepare("SELECT * FROM orders WHERE order_code = 'CN_701001'").get();
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = 701').get();
    const created = service.ensureYoutubeWarrantyClaim({ order, ticket });
    const duplicate = service.ensureYoutubeWarrantyClaim({ order, ticket });

    expect(created.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.claim.id).toBe(created.claim.id);
    expect(created.claim.formUrl).toMatch(/^https:\/\/cenarstore\.xyz\/youtube-warranty\/[A-Za-z0-9_-]{40,100}$/);

    const row = db.prepare('SELECT * FROM youtube_warranty_claims WHERE id = ?').get(created.claim.id);
    const rawToken = created.claim.formUrl.split('/').at(-1);
    expect(row.access_token_hash).not.toBe(rawToken);
    expect(row.access_token_encrypted).not.toContain(rawToken);

    const submitted = service.submitYoutubeWarrantyGmail(rawToken, 'Customer.Name@gmail.com');
    expect(submitted).toMatchObject({ status: 'SUBMITTED', customerGmail: 'customer.name@gmail.com' });
    const stored = db.prepare('SELECT customer_gmail FROM youtube_warranty_claims WHERE id = ?').get(created.claim.id);
    expect(stored.customer_gmail).not.toContain('customer.name@gmail.com');

    const publicClaim = service.getPublicYoutubeWarrantyClaim(rawToken);
    expect(publicClaim.customerGmailMasked).toMatch(/@gmail\.com$/);
    expect(JSON.stringify(publicClaim)).not.toContain('customer.name@gmail.com');
    expect(publicClaim).not.toHaveProperty('customerId');
    expect(publicClaim.guideUrl).toContain(service.YOUTUBE_GUIDE_CHANNEL_ID);
  });

  test('builds Components V2 panels with both form and mandatory guide actions', () => {
    const claim = service.getYoutubeWarrantyClaimByTicket(701, { includeEmail: true, includeToken: true });
    const payload = service.buildYoutubeWarrantyRequestPanel(claim);
    const json = payload.components.map((component) => component.toJSON());
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(JSON.stringify(json)).toContain('BẢO HÀNH YOUTUBE');
    expect(JSON.stringify(json)).toContain(service.YOUTUBE_GUIDE_CHANNEL_ID);
    expect(json[1].components).toHaveLength(2);
  });

  test('atomically completes a submitted claim and restores the order to completed', async () => {
    const claim = service.getYoutubeWarrantyClaimByTicket(701, { includeEmail: true });
    const result = await service.completeYoutubeWarrantyClaim(null, claim.id, {
      actorId: 'WEB_ADMIN',
      note: 'Đã gửi lời mời.',
    });
    const duplicate = await service.completeYoutubeWarrantyClaim(null, claim.id, { actorId: 'WEB_ADMIN' });
    const order = db.prepare("SELECT status, warranty_count FROM orders WHERE order_code = 'CN_701001'").get();

    expect(result.completed).toBe(true);
    expect(result.claim).toMatchObject({ status: 'COMPLETED', completionNote: 'Đã gửi lời mời.' });
    expect(duplicate).toMatchObject({ completed: false, alreadyCompleted: true });
    expect(order).toMatchObject({ status: 'COMPLETED', warranty_count: 1 });
  });
});

