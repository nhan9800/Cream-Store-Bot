import { db, nowIso } from '../database/db.js';
import { AUTOMATIC_MARKETING_PAUSED, PAUSED_MARKETING_CHANNEL_IDS } from '../config/marketingAutomationPolicy.js';

export function pauseAutomaticMarketing(database = db) {
  if (!AUTOMATIC_MARKETING_PAUSED) return { paused: false };
  return database.transaction(() => {
    const giveaways = database.prepare(`UPDATE giveaways SET status = 'CANCELLED'
      WHERE guild_id = ? AND status = 'ACTIVE' AND channel_id IN (?, ?, ?)`)
      .run('1282637033340403754', ...PAUSED_MARKETING_CHANNEL_IDS).changes;
    const invites = database.prepare(`UPDATE invite_campaigns SET status = 'PAUSED', updated_at = ?
      WHERE event_key = ? AND guild_id = ? AND status != 'PAUSED'`)
      .run(nowIso(), 'store1-decor-invite-2026-08', '1282637033340403754').changes;
    return { paused: true, cancelledGiveaways: giveaways, pausedInviteCampaigns: invites };
  })();
}

export function getMarketingPauseStatus() {
  return {
    paused: AUTOMATIC_MARKETING_PAUSED, promotionPings: false,
    protectedChannels: PAUSED_MARKETING_CHANNEL_IDS,
    activeGiveawaysInPausedChannels: db.prepare(`SELECT COUNT(*) AS n FROM giveaways
      WHERE guild_id = ? AND status = 'ACTIVE' AND channel_id IN (?, ?, ?)`)
      .get('1282637033340403754', ...PAUSED_MARKETING_CHANNEL_IDS).n,
    activeInviteCampaigns: db.prepare(`SELECT COUNT(*) AS n FROM invite_campaigns
      WHERE event_key = ? AND guild_id = ? AND status = 'ACTIVE'`)
      .get('store1-decor-invite-2026-08', '1282637033340403754').n,
  };
}
