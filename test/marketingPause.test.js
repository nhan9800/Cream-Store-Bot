import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const databasePath = vi.hoisted(() => {
  process.env.ENV_FILE = '.env.test-marketing-paused-not-present';
  process.env.DATABASE_PATH = `./data/test-marketing-paused-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENCRYPTION_KEY = 'test-marketing-pause';
  return process.env.DATABASE_PATH;
});
import { db, initDatabase } from '../src/database/db.js';
import { AUTOMATIC_MARKETING_PAUSED, isMarketingWritePaused } from '../src/config/marketingAutomationPolicy.js';
import { pauseAutomaticMarketing, getMarketingPauseStatus } from '../src/services/marketingPauseService.js';
import { publishDailyColorSale, publishDailyFlashSale } from '../src/campaigns/dailyColorSale2026.js';
import { publishPromotionBoard, PROMOTION_BOARD } from '../src/campaigns/promotionBoard2026.js';
import { publishProfileEffectGiveaway } from '../src/campaigns/profileEffectGiveaway2026.js';
import { ensureInviteCampaignDiscordSetup, processInviteDecorCampaign, registerInviteCampaignJoin } from '../src/services/inviteCampaignService.js';

beforeAll(() => initDatabase());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.resolve(databasePath + suffix), { force: true });
});

describe('owner-revoked automatic marketing', () => {
  it('defaults closed even when force and mention options are requested', async () => {
    expect(AUTOMATIC_MARKETING_PAUSED).toBe(true);
    expect(PROMOTION_BOARD.status).toBe('PAUSED');
    const client = new Proxy({}, { get() { throw new Error('Unexpected Discord access'); } });
    for (const publish of [publishDailyColorSale, publishDailyFlashSale, publishPromotionBoard]) {
      expect(await publish(client, { force: true, tagEveryone: true, tagMember: true })).toMatchObject({ status: 'paused' });
    }
    expect(await publishProfileEffectGiveaway(client)).toMatchObject({ action: 'paused' });
    expect(await ensureInviteCampaignDiscordSetup(client)).toBeNull();
    expect(await processInviteDecorCampaign(client)).toMatchObject({ status: 'paused', rewards: 0 });
    expect(await registerInviteCampaignJoin({ member: client })).toBeNull();
  });
  it('cancels only giveaways in paused channels and preserves entry/history and other manual events', () => {
    const insert = db.prepare(`INSERT INTO giveaways(message_id,channel_id,guild_id,host_id,prize,winners_count,end_time,status) VALUES(?,?,?,?,?,1,?,'ACTIVE')`);
    insert.run('paused-event', '1514606987839672563', '1282637033340403754', 'human-host', 'Decor', '2027-01-01');
    insert.run('paused-profile', '1531206050383134842', '1282637033340403754', 'human-host', 'Decor', '2027-01-01');
    insert.run('manual-event', 'another-channel', '1282637033340403754', 'human-host', 'Other', '2027-01-01');
    insert.run('other-guild', '1514606987839672563', 'another-guild', 'human-host', 'Other', '2027-01-01');
    db.prepare('INSERT INTO giveaway_entries(message_id,user_id) VALUES(?,?)').run('paused-event','participant');
    db.prepare(`INSERT INTO invite_campaigns(event_key,guild_id,name,starts_at,ends_at,required_valid_invites,min_stay_hours,min_account_age_days,reward_name,reward_value,announcement_channel_id,status,created_at,updated_at)
      VALUES('store1-decor-invite-2026-08','1282637033340403754','Invite','2026-08-01','2026-08-31',5,48,30,'Decor',66000,'1514606987839672563','ACTIVE','2026-08-01','2026-08-01')`).run();
    expect(pauseAutomaticMarketing()).toEqual({ paused: true, cancelledGiveaways: 2, pausedInviteCampaigns: 1 });
    expect(pauseAutomaticMarketing()).toEqual({ paused: true, cancelledGiveaways: 0, pausedInviteCampaigns: 0 });
    expect(db.prepare('SELECT status FROM giveaways WHERE message_id=?').get('manual-event').status).toBe('ACTIVE');
    expect(db.prepare('SELECT status FROM giveaways WHERE message_id=?').get('other-guild').status).toBe('ACTIVE');
    expect(db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries').get().n).toBe(1);
    expect(getMarketingPauseStatus()).toMatchObject({ paused: true, promotionPings: false, activeGiveawaysInPausedChannels: 0, activeInviteCampaigns: 0 });
  });
  it('limits the write stop to the exact campaign channels', () => {
    expect(isMarketingWritePaused('1514606987839672563')).toBe(true);
    expect(isMarketingWritePaused('1515008584549797979')).toBe(true);
    expect(isMarketingWritePaused('ordinary-order-ticket')).toBe(false);
  });
});
