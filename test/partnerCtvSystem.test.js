import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import { db, initDatabase } from '../src/database/db.js';
import { buildCtvPricePages } from '../src/services/ctvPriceService.js';
import {
  consumePartnerMentionQuota,
  getPartnerMentionQuota,
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
