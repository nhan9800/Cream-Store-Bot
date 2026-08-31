import { describe, expect, it } from 'vitest';
import { data, buildYoutubeWarrantyAdminPayload } from '../src/commands/ytbaohanh.js';
import fs from 'node:fs';

describe('YouTube warranty admin command', () => {
  it('publishes a staff-only inbox command', () => {
    expect(data.name).toBe('ytbaohanh');
    expect(data.default_member_permissions).toBe('32');
  });

  it('renders tick and reminder actions for the right claim states', () => {
    const payload = buildYoutubeWarrantyAdminPayload({
      guildId: 'TEST_GUILD',
      stats: { total: 2, awaitingCustomer: 1, submitted: 1, completed: 0 },
      syncResult: { scanned: 2, created: 1, published: 1, failed: 0 },
      claims: [
        { id: 11, orderCode: 'CN_11', claimCode: 'YW_11', productName: 'YouTube Premium', status: 'SUBMITTED', customerId: '100000000000000001', customerGmail: 'user@gmail.com', customerGmailMasked: 'us••••@gmail.com', ticketChannelId: '200000000000000001', guidanceAcceptedAt: '2026-08-31T00:00:00.000Z' },
        { id: 12, orderCode: 'CN_12', claimCode: 'YW_12', productName: 'YouTube Premium', status: 'AWAITING_CUSTOMER', customerId: '100000000000000002', customerGmail: null, customerGmailMasked: null, ticketChannelId: '200000000000000002', guidanceAcceptedAt: null },
      ],
    });
    const serialized = JSON.stringify(payload.components.map((row) => row.toJSON()));
    expect(payload.embeds[0].data.description).toContain('ngừng bảo hành');
    expect(serialized).toContain('ytw:complete:11');
    expect(serialized).toContain('ytw:resend:12');
    expect(payload.ephemeral).toBe(true);
  });

  it('reconciles open warranty tickets from the scheduler', () => {
    const source = fs.readFileSync(new URL('../src/services/schedulerService.js', import.meta.url), 'utf8');
    expect(source).toContain('syncYoutubeWarrantyClaims');
    expect(source).toContain('5 * 60 * 1000');
    expect(source).toContain('SCHEDULER-YOUTUBE-WARRANTY');
  });
});
