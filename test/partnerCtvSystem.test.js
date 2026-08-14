import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import { db, initDatabase } from '../src/database/db.js';
import { buildCtvPricePages } from '../src/services/ctvPriceService.js';
import {
  buildPartnerBroadcastGuidePayload,
  buildPartnerRecruitmentPayload,
} from '../src/services/autoSetupService.js';
import { handlePartnerApprove } from '../src/services/partnerAndCtvHandlers.js';
import {
  addPartnerApplication,
  consumePartnerMentionQuota,
  evaluatePartnerEligibility,
  getPartnerMentionQuota,
  hasAcceptedPartnerTerms,
  normalizeDiscordInviteUrl,
  PARTNER_PROGRAM,
  rollbackPartnerMentionQuota,
} from '../src/services/partnerService.js';

const GUILD_ID = 'test_partner_ctv_system';
const USER_ID = `test_${Date.now()}`;
const DEFAULT_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

function displayText(payload) {
  return payload.components[0].toJSON().components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('');
}

function allDisplayText(payload) {
  return payload.components
    .flatMap((component) => component.toJSON().components || [])
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');
}

describe('Partner and CTV system', () => {
  beforeAll(() => {
    initDatabase();
    db.prepare('DELETE FROM partner_mention_usage WHERE guild_id = ? AND user_id = ?').run(GUILD_ID, USER_ID);
  });

  afterAll(() => {
    db.prepare('DELETE FROM partner_mention_usage WHERE guild_id = ? AND user_id = ?').run(GUILD_ID, USER_ID);
  });

  it('enforces two Partner pings and one everyone ping per rolling 24 hours', () => {
    expect(consumePartnerMentionQuota(GUILD_ID, USER_ID, { partnerMentions: 1 }).allowed).toBe(true);
    expect(consumePartnerMentionQuota(GUILD_ID, USER_ID, { partnerMentions: 1 }).allowed).toBe(true);
    expect(consumePartnerMentionQuota(GUILD_ID, USER_ID, { partnerMentions: 1 }).allowed).toBe(false);
    expect(consumePartnerMentionQuota(GUILD_ID, USER_ID, { everyoneMentions: 1 }).allowed).toBe(true);
    expect(consumePartnerMentionQuota(GUILD_ID, USER_ID, { everyoneMentions: 1 }).allowed).toBe(false);

    const quota = getPartnerMentionQuota(GUILD_ID, USER_ID);
    expect(quota.partnerRemaining).toBe(0);
    expect(quota.everyoneRemaining).toBe(0);
    expect(quota.resetAt).toBeGreaterThan(Date.now());
  });

  it('rolls quota back when Discord fails to publish the post', () => {
    const quota = rollbackPartnerMentionQuota(GUILD_ID, USER_ID, { partnerMentions: 1, everyoneMentions: 1 });
    expect(quota.partnerRemaining).toBe(1);
    expect(quota.everyoneRemaining).toBe(1);
  });

  it('normalizes every supported Discord invite form into a clickable HTTPS URL', () => {
    expect(normalizeDiscordInviteUrl('discord.gg/oneshield')).toBe('https://discord.gg/oneshield');
    expect(normalizeDiscordInviteUrl('https://discord.com/invite/One-Shield')).toBe('https://discord.gg/One-Shield');
    expect(normalizeDiscordInviteUrl('rawCode123')).toBe('https://discord.gg/rawCode123');
    expect(normalizeDiscordInviteUrl('[fake](javascript:alert(1))')).toBeNull();
  });

  it('enforces the Partner 3K member threshold and flags very new servers for review', () => {
    const now = Date.UTC(2026, 7, 14);
    const recentCreatedAt = Date.UTC(2026, 7, 1);
    const recentGuildId = ((BigInt(recentCreatedAt - 1420070400000) << 22n) + 1n).toString();

    const tooSmall = evaluatePartnerEligibility({ memberCount: 2999, partnerGuildId: recentGuildId, now });
    expect(tooSmall.eligible).toBe(false);
    expect(tooSmall.blockers[0]).toContain(PARTNER_PROGRAM.minimumMembers.toLocaleString('vi-VN'));

    const qualified = evaluatePartnerEligibility({ memberCount: 3000, partnerGuildId: recentGuildId, now });
    expect(qualified.eligible).toBe(true);
    expect(qualified.serverAgeDays).toBe(13);
    expect(qualified.reviewFlags).toHaveLength(1);
  });

  it('accepts the explicit Vietnamese or ASCII Partner agreement', () => {
    expect(hasAcceptedPartnerTerms('DONG Y')).toBe(true);
    expect(hasAcceptedPartnerTerms('ĐỒNG Ý')).toBe(true);
    expect(hasAcceptedPartnerTerms('dong y ')).toBe(true);
    expect(hasAcceptedPartnerTerms('OK')).toBe(false);
  });

  it('builds a polished Partner recruitment event with business safeguards', () => {
    const payload = buildPartnerRecruitmentPayload('1282637033340403754', {
      partnerBroadcast: '1535669776628584449',
      partnerDirectory: '1522844534470348810',
    });
    const text = allDisplayText(payload);
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.components).toHaveLength(3);
    expect(text).toContain('3.000 thành viên thực');
    expect(text).toContain('giveaway mỗi tuần');
    expect(text).toContain('Không hợp tác');
    expect(text).toContain('thử nghiệm 30 ngày');
    expect(text).not.toMatch(DEFAULT_EMOJI);
    expect(text).toMatch(/<a?:cenar_[a-zA-Z0-9_]+:\d+>/);
  });

  it('builds a compact Components V2 Partner guide using only custom emojis', () => {
    const payload = buildPartnerBroadcastGuidePayload(GUILD_ID, { partnerRoleId: '1522844528237740066' });
    const text = allDisplayText(payload);
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.components).toHaveLength(2);
    expect(text).toContain('/partner-post send');
    expect(text).toContain('/partner-post quota');
    expect(text).not.toMatch(DEFAULT_EMOJI);
    expect(text).toMatch(/<a?:cenar_[a-zA-Z0-9_]+:\d+>/);
  });

  it('updates the review panel before waiting for Discord role and channel APIs', async () => {
    const guildId = `test_partner_approval_${Date.now()}`;
    db.prepare(`
      INSERT INTO partner_settings (guild_id, partner_role_id, directory_channel_id)
      VALUES (?, ?, ?)
    `).run(guildId, 'role_partner', 'channel_directory');
    const appId = addPartnerApplication(
      guildId,
      'partner_guild',
      'Partner Test',
      'discord.gg/partner-test',
      120,
      'owner',
      'applicant',
      'MANUAL_SUPPORT',
    );

    let releaseDiscordCalls;
    const discordGate = new Promise((resolve) => { releaseDiscordCalls = resolve; });
    const interaction = {
      guildId,
      user: { id: 'reviewer' },
      memberPermissions: { has: () => true },
      guild: {
        members: { fetch: vi.fn(() => discordGate.then(() => null)) },
        channels: { fetch: vi.fn(() => discordGate.then(() => null)) },
      },
      client: { users: { fetch: vi.fn().mockResolvedValue(null) } },
      update: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    };

    const approval = handlePartnerApprove(interaction, appId);
    await vi.waitFor(() => expect(interaction.update).toHaveBeenCalledTimes(1));
    expect(interaction.editReply).not.toHaveBeenCalled();
    releaseDiscordCalls();
    await approval;
    expect(interaction.editReply).toHaveBeenCalledTimes(1);

    db.prepare('DELETE FROM partners WHERE id = ?').run(appId);
    db.prepare('DELETE FROM partner_settings WHERE guild_id = ?').run(guildId);
  });

  it('paginates the CTV catalog below the Discord 4000-character limit', () => {
    const pages = buildCtvPricePages('1282637033340403754');
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const text = displayText(page);
      expect(page.flags & MessageFlags.IsComponentsV2).toBeTruthy();
      expect(text.length).toBeLessThanOrEqual(4000);
      expect(text).not.toMatch(DEFAULT_EMOJI);
    }
  });
});
