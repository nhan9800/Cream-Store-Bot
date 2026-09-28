import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { resolveWarrantyTimeline } from '../src/services/warrantyService.js';
import { getCustomerMembershipProgress } from '../src/services/roleService.js';
import { db } from '../src/database/db.js';
import {
  cleanupExpiredTranscripts,
  exportTicketTranscript,
  getLatestTicketTranscriptMetadata,
  hashTranscriptAccessToken,
  migrateLegacyTranscriptsToGzip,
  readLatestTicketTranscript,
  readTranscriptArchive,
} from '../src/services/transcriptService.js';
import { archiveTicketConversation } from '../src/services/ticketClosureService.js';

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
  test('archives a persisted ticket once and can replay it after the Discord channel is gone', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-ticket-close-'));
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
    const ticketCode = `TKT_TEST_${suffix}`;
    const channelId = `88${suffix}`;
    let ticketId = null;
    try {
      const ticketInsert = db.prepare(`INSERT INTO tickets (
        ticket_code, guild_id, channel_id, customer_id, opened_by_id, ticket_type,
        support_source, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'SUPPORT', 'WEBSITE_AI', 'CLOSED', CURRENT_TIMESTAMP)`).run(
        ticketCode,
        '100000000000000001',
        channelId,
        '200000000000000002',
        '200000000000000002',
      );
      ticketId = Number(ticketInsert.lastInsertRowid);
      const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
      const message = {
        id: '300000000000000003',
        type: 0,
        createdTimestamp: Date.now(),
        content: '**[Khách từ Web]**: Tôi cần hỗ trợ đơn hàng',
        author: {
          id: '400000000000000004',
          username: 'Cenar Store',
          globalName: 'Cenar Store',
          bot: true,
          displayAvatarURL: () => null,
        },
        member: null,
        attachments: new Map(),
        embeds: [],
        components: [],
        stickers: new Map(),
        reactions: { cache: new Map() },
        mentions: { users: new Map(), roles: new Map(), channels: new Map() },
      };
      const channel = {
        id: channelId,
        name: 'ticket-test',
        guild: { id: ticket.guild_id, name: 'Cenar Store', iconURL: () => null },
        messages: { fetch: async () => new Map([[message.id, message]]) },
      };
      const deliver = vi.fn(async () => ({ delivered: true }));

      const first = await archiveTicketConversation({
        guild: channel.guild,
        ticket,
        channel,
        closedById: '500000000000000005',
        exportOptions: { directory: tempRoot },
        deliver,
      });
      expect(first.archived).toBe(true);
      expect(first.reused).toBe(false);
      expect(first.transcript.messageCount).toBe(1);
      expect(deliver).toHaveBeenCalledTimes(1);

      const second = await archiveTicketConversation({
        guild: channel.guild,
        ticket,
        channel: null,
        closedById: '500000000000000005',
        exportOptions: { directory: tempRoot },
        deliver,
      });
      expect(second).toMatchObject({ archived: true, reused: true });
      expect(deliver).toHaveBeenCalledTimes(1);

      const metadata = getLatestTicketTranscriptMetadata({ ticketId, ticketCode });
      expect(metadata).toMatchObject({ ticketId, ticketCode, messageCount: 1 });
      const replay = await readLatestTicketTranscript({ ticketId, ticketCode }, { directory: tempRoot });
      expect(replay.messages).toHaveLength(1);
      expect(replay.messages[0].content).toContain('Tôi cần hỗ trợ đơn hàng');
      expect(db.prepare('SELECT COUNT(*) AS count FROM ticket_transcript_archives WHERE ticket_id = ?').get(ticketId).count).toBe(1);
    } finally {
      if (ticketId) {
        db.prepare('DELETE FROM ticket_transcript_archives WHERE ticket_id = ?').run(ticketId);
        db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);
      }
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('exports a compressed archive with a hashed 192-bit access token', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-transcript-'));
    let archiveId = null;
    try {
      const result = await exportTicketTranscript({
        id: '880006',
        name: 'bao-hanh-880006',
        guild: { id: '100000000000000001', name: 'Cenar Store', iconURL: () => null },
        messages: { fetch: async () => new Map() },
      }, { directory: tempRoot });
      archiveId = result.archiveId;

      expect(result.savedToDisk).toBe(true);
      expect(result.accessToken).toMatch(/^[a-f0-9]{48}$/);
      expect(result.archiveFileName).toMatch(/^transcript_ta_[a-z0-9_]+\.json\.gz$/);
      expect(result).not.toHaveProperty('htmlBuffer');
      expect(result).not.toHaveProperty('textBuffer');
      expect(fs.existsSync(result.savedArchivePath)).toBe(true);
      expect(fs.readFileSync(result.savedArchivePath).includes(Buffer.from(result.accessToken))).toBe(false);

      const row = db.prepare('SELECT token_hash, original_bytes, compressed_bytes FROM ticket_transcript_archives WHERE id = ?').get(result.archiveId);
      expect(row.token_hash).toBe(hashTranscriptAccessToken(result.accessToken));
      expect(row.token_hash).not.toBe(result.accessToken);
      expect(row.compressed_bytes).toBeLessThan(row.original_bytes);

      const archive = await readTranscriptArchive(result.accessToken, { directory: tempRoot });
      expect(archive.archive.code).toBe(result.archiveCode);
      expect(archive.messages).toEqual([]);
      expect(await readTranscriptArchive('not-a-valid-token', { directory: tempRoot })).toBeNull();

      const mirrorBytes = fs.readFileSync(result.savedArchivePath);
      db.prepare(`UPDATE ticket_transcript_archives SET discord_channel_id = '10', discord_message_id = '20',
        discord_attachment_id = '30', discord_attachment_url = 'https://cdn.discordapp.com/archive.json.gz'
        WHERE id = ?`).run(result.archiveId);
      fs.rmSync(result.savedArchivePath);
      let mirrorFetches = 0;
      const restored = await readTranscriptArchive(result.accessToken, {
        directory: tempRoot,
        fetchImpl: async () => {
          mirrorFetches++;
          return new Response(mirrorBytes, { status: 200, headers: { 'content-length': String(mirrorBytes.length) } });
        },
      });
      expect(restored.storage.mirrored).toBe(true);
      expect(mirrorFetches).toBe(1);
      expect(fs.existsSync(result.savedArchivePath)).toBe(true);
    } finally {
      if (archiveId) db.prepare('DELETE FROM ticket_transcript_archives WHERE id = ?').run(archiveId);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('compresses legacy HTML in-place while preserving the original URL name', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-legacy-gzip-'));
    try {
      const source = path.join(directory, 'transcript_ticket-123_abcdef.html');
      fs.writeFileSync(source, '<html><style>same-style</style>'.repeat(500));
      const result = migrateLegacyTranscriptsToGzip({ directory });
      expect(result.migrated).toBe(1);
      expect(fs.existsSync(source)).toBe(false);
      expect(fs.existsSync(`${source}.gz`)).toBe(true);
      expect(result.bytesSaved).toBeGreaterThan(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
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

  test('does not crash when another process deletes a transcript during cleanup', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-retention-race-'));
    const transcript = path.join(directory, 'transcript_ticket-460322_1784645598452.html');
    fs.writeFileSync(transcript, 'race');
    const originalStatSync = fs.statSync;
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementationOnce((filePath, options) => {
      fs.rmSync(filePath, { force: true });
      return originalStatSync(filePath, options);
    });

    try {
      let result;
      expect(() => {
        result = cleanupExpiredTranscripts({
          directory,
          retentionDays: 30,
          now: Date.UTC(2026, 7, 20),
        });
      }).not.toThrow();
      expect(result).toEqual({ scanned: 1, removed: 0 });
      expect(cleanupExpiredTranscripts({
        directory,
        retentionDays: 30,
        now: Date.UTC(2026, 7, 20),
      })).toEqual({ scanned: 0, removed: 0 });
    } finally {
      statSpy.mockRestore();
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
