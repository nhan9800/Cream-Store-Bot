import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

let tempRoot;
let db;
let orderLinks;
let spotify;
let youtube;
const previousEnv = {
  ENV_FILE: process.env.ENV_FILE,
  DATABASE_PATH: process.env.DATABASE_PATH,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
};

function insertOrder({ code, channel, product, customerId, customerName = null, customerGmail = null, months, amount }) {
  const expiryAt = new Date(Date.UTC(2026, 7 + months, 1)).toISOString();
  const ticket = db.prepare(`
    INSERT INTO tickets (ticket_code, guild_id, channel_id, customer_id, opened_by_id, created_at)
    VALUES (?, 'TEST_GUILD', ?, ?, ?, ?)
  `).run(`T-${code}`, `ticket-${channel}`, customerId, customerId, '2026-08-01T00:00:00.000Z');
  db.prepare(`
    INSERT INTO orders (
      order_code, guild_id, ticket_id, ticket_channel_id, customer_id,
      product_name, customer_name, customer_gmail, quantity,
      total_amount, amount_paid, payment_status, status,
      duration_months, order_log_channel_id, created_by_id,
      paid_at, completed_at, expiry_at, created_at, updated_at,
      credential_email, credential_password
    ) VALUES (
      ?, 'TEST_GUILD', ?, ?, ?,
      ?, ?, ?, 1,
      ?, ?, 'PAID', 'COMPLETED',
      ?, 'ORDER_LOG', 'ADMIN',
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:10:00.000Z', ?,
      '2026-08-01T00:00:00.000Z', '2026-08-01T00:10:00.000Z',
      'encrypted-delivery-email', 'encrypted-delivery-password'
    )
  `).run(code, Number(ticket.lastInsertRowid), `order-${channel}`, customerId, product, customerName, customerGmail, amount, amount, months, expiryAt);
}

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-order-link-'));
  process.env.ENV_FILE = path.join(tempRoot, '.env.test');
  process.env.DATABASE_PATH = path.join(tempRoot, 'order-link.sqlite');
  process.env.ENCRYPTION_KEY = 'order-link-service-test-key';
  const database = await import('../src/database/db.js');
  db = database.db;
  database.initDatabase();
  orderLinks = await import('../src/services/orderLinkService.js');
  spotify = await import('../src/services/spotifyFamilyService.js');
  youtube = await import('../src/services/youtubeRenewalService.js');

  db.prepare(`
    INSERT INTO web_users (id, email, display_name, discord_id, discord_username, google_email, role)
    VALUES ('web-1', 'login@example.com', 'Web Customer', '123456789012345678', 'discord.customer', 'spotify@gmail.com', 'member')
  `).run();
  insertOrder({
    code: 'CN_SPOTIFY_01',
    channel: 'spotify',
    product: 'Spotify Premium 3 Tháng',
    customerId: '123456789012345678',
    months: 3,
    amount: 150_000,
  });
  insertOrder({
    code: 'CN_YOUTUBE_01',
    channel: 'youtube',
    product: 'YouTube Premium 6 Tháng (Đổi Family Mỗi Tháng)',
    customerId: '987654321098765432',
    customerName: 'Khách YouTube',
    customerGmail: 'youtube@gmail.com',
    months: 6,
    amount: 300_000,
  });
});

afterAll(() => {
  if (db?.open) db.close();
  if (tempRoot && tempRoot.startsWith(os.tmpdir())) fs.rmSync(tempRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Order link service', () => {
  test('returns a safe normalized bot order and resolves customer identity', () => {
    const order = orderLinks.resolveOrderLink(' cn_spotify_01 ', {
      expectedService: 'SPOTIFY',
      guildId: 'TEST_GUILD',
    });
    expect(order).toMatchObject({
      orderCode: 'CN_SPOTIFY_01',
      serviceFamily: 'SPOTIFY',
      customerName: 'discord.customer',
      discordId: '123456789012345678',
      customerEmail: 'spotify@gmail.com',
      durationMonths: 3,
      totalAmount: 150_000,
    });
    expect(order).not.toHaveProperty('credentialEmail');
    expect(order).not.toHaveProperty('credentialPassword');
  });

  test('autofills Spotify member fields from the linked order', () => {
    const family = spotify.createSpotifyFamily({
      guildId: 'TEST_GUILD',
      name: 'Spotify Test Family',
      loginEmail: 'owner@spotify.test',
      loginPassword: 'secret',
      cycleStartedAt: '2026-08-01T00:00:00.000Z',
      nextRenewalAt: '2026-09-01T00:00:00.000Z',
    });
    const member = spotify.createSpotifyFamilyMember(family.id, {
      spotifyUsername: 'student-profile',
      relatedOrderCode: 'cn_spotify_01',
    });
    expect(member).toMatchObject({
      relatedOrderCode: 'CN_SPOTIFY_01',
      spotifyEmail: 'spotify@gmail.com',
      customerName: 'discord.customer',
      discordId: '123456789012345678',
      purchasedMonths: 3,
    });
  });

  test('autofills YouTube commitment data and rejects a wrong product link', () => {
    const source = youtube.createYoutubeSource({ guildId: 'TEST_GUILD', name: 'Nguồn YouTube Test', defaultCycleCost: 30_000 });
    const membership = youtube.createYoutubeMembership({
      guildId: 'TEST_GUILD',
      sourceId: source.id,
      relatedOrderCode: 'CN_YOUTUBE_01',
      paidCycles: 1,
    });
    expect(membership).toMatchObject({
      relatedOrderCode: 'CN_YOUTUBE_01',
      customerGmail: 'youtube@gmail.com',
      customerName: 'Khách YouTube',
      customerDiscordId: '987654321098765432',
      planType: 'ROTATING_FAMILY',
      totalMonths: 6,
      salePrice: 300_000,
    });
    expect(() => orderLinks.resolveOrderLink('CN_SPOTIFY_01', { expectedService: 'YOUTUBE' }))
      .toThrow(/không phải đơn YouTube/i);
  });
});
