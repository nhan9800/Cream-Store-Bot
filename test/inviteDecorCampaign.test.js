import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db, initDatabase, nowIso } from '../src/database/db.js';
import {
  INVITE_DECOR_CAMPAIGN,
  buildInviteCampaignAnnouncementPayload,
  buildInviteCheckPayload,
  classifyInviteCampaignJoin,
  ensureInviteDecorCampaign,
  getInviteCampaignStats,
  inviteCampaignInternals,
  markInviteCampaignMemberLeft,
  processInviteDecorCampaign,
} from '../src/services/inviteCampaignService.js';
import { inviteTrackerInternals } from '../src/services/inviteTrackerService.js';

const INVITER_ID = '990000000000000001';
const INVITED_IDS = [
  '990000000000000011',
  '990000000000000012',
  '990000000000000013',
  '990000000000000014',
];

function insertEntry({ invitedId, status, qualifiesAt = null }) {
  const timestamp = nowIso();
  db.prepare(`
    INSERT OR REPLACE INTO invite_campaign_entries (
      event_key, guild_id, inviter_id, invited_id, status, account_age_days,
      joined_at, qualifies_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 120, ?, ?, ?, ?)
  `).run(
    INVITE_DECOR_CAMPAIGN.eventKey,
    INVITE_DECOR_CAMPAIGN.guildId,
    INVITER_ID,
    invitedId,
    status,
    timestamp,
    qualifiesAt,
    timestamp,
    timestamp,
  );
}

beforeAll(() => {
  initDatabase();
  ensureInviteDecorCampaign();
});

afterEach(() => {
  db.prepare(`DELETE FROM invite_campaign_rewards WHERE event_key = ? AND inviter_id = ?`)
    .run(INVITE_DECOR_CAMPAIGN.eventKey, INVITER_ID);
  for (const invitedId of INVITED_IDS) {
    db.prepare(`DELETE FROM invite_campaign_entries WHERE event_key = ? AND invited_id = ?`)
      .run(INVITE_DECOR_CAMPAIGN.eventKey, invitedId);
  }
});

describe('Store 1 invite Decor campaign validation', () => {
  it('publishes the invite event in the dedicated event channel, not promotions', () => {
    expect(INVITE_DECOR_CAMPAIGN.announcementChannelId).toBe('1514606987839672563');
    expect(INVITE_DECOR_CAMPAIGN.announcementChannelId).not.toBe('1515008584549797979');
  });

  it('uses immutable invite-use snapshots so Discord cache mutation cannot hide a join', () => {
    const liveInvite = {
      code: 'event-test',
      uses: 0,
      maxUses: 0,
      inviter: { id: INVITER_ID },
    };
    const cached = inviteTrackerInternals.snapshotInviteCollection(new Map([[liveInvite.code, liveInvite]]));
    liveInvite.uses = 1;
    const current = new Map([[liveInvite.code, liveInvite]]);

    expect(cached.get(liveInvite.code).uses).toBe(0);
    expect(inviteTrackerInternals.detectUsedInvite(cached, current)?.code).toBe(liveInvite.code);
  });

  it('rejects clone-like new accounts and prior/rejoined members', () => {
    expect(classifyInviteCampaignJoin({
      invitedId: INVITED_IDS[0],
      inviterId: INVITER_ID,
      accountAgeDays: 7,
      minAccountAgeDays: 30,
      inviterPresent: true,
    }).status).toBe('REJECTED_CLONE');

    expect(classifyInviteCampaignJoin({
      invitedId: INVITED_IDS[1],
      inviterId: INVITER_ID,
      accountAgeDays: 400,
      priorInviteRecord: { invited_id: INVITED_IDS[1] },
      inviterPresent: true,
    }).status).toBe('REJECTED_REJOIN');
  });

  it('accepts an established unique account into the 48-hour pending state', () => {
    expect(classifyInviteCampaignJoin({
      invitedId: INVITED_IDS[0],
      inviterId: INVITER_ID,
      accountAgeDays: 120,
      inviterPresent: true,
    })).toEqual({ status: 'PENDING', reason: null });
  });

  it('marks a pending invite as left so it can never count at 48 hours', () => {
    insertEntry({ invitedId: INVITED_IDS[0], status: 'PENDING', qualifiesAt: new Date(Date.now() + 86_400_000).toISOString() });
    const result = markInviteCampaignMemberLeft({
      id: INVITED_IDS[0],
      guild: { id: INVITE_DECOR_CAMPAIGN.guildId },
    });
    const row = db.prepare(`SELECT status, left_at FROM invite_campaign_entries WHERE event_key = ? AND invited_id = ?`)
      .get(INVITE_DECOR_CAMPAIGN.eventKey, INVITED_IDS[0]);

    expect(result.changed).toBe(1);
    expect(row.status).toBe('LEFT');
    expect(row.left_at).toBeTruthy();
  });

  it('validates at 48 hours only when Discord still reports the member in Store 1', async () => {
    const joinedAt = new Date(Date.now() - 49 * 3_600_000).toISOString();
    const timestamp = nowIso();
    db.prepare(`
      INSERT OR REPLACE INTO invite_campaign_entries (
        event_key, guild_id, inviter_id, invited_id, status, account_age_days,
        joined_at, qualifies_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'PENDING', 120, ?, ?, ?, ?)
    `).run(
      INVITE_DECOR_CAMPAIGN.eventKey,
      INVITE_DECOR_CAMPAIGN.guildId,
      INVITER_ID,
      INVITED_IDS[0],
      joinedAt,
      new Date(Date.now() - 3_600_000).toISOString(),
      timestamp,
      timestamp,
    );
    const member = { id: INVITED_IDS[0], joinedTimestamp: Date.parse(joinedAt) };
    const guild = {
      id: INVITE_DECOR_CAMPAIGN.guildId,
      members: {
        cache: new Map([[INVITED_IDS[0], member]]),
        fetch: async (id) => (id === INVITED_IDS[0] ? member : null),
      },
    };
    const client = {
      guilds: {
        cache: new Map([[guild.id, guild]]),
        fetch: async () => guild,
      },
    };

    const result = await processInviteDecorCampaign(client, new Date());
    const row = db.prepare(`SELECT status FROM invite_campaign_entries WHERE event_key = ? AND invited_id = ?`)
      .get(INVITE_DECOR_CAMPAIGN.eventKey, INVITED_IDS[0]);

    expect(result.validated).toBe(1);
    expect(row.status).toBe('VALID');
  });

  it('separates valid, pending, left and rejected counts in /invcheck', () => {
    insertEntry({ invitedId: INVITED_IDS[0], status: 'VALID' });
    insertEntry({ invitedId: INVITED_IDS[1], status: 'VALID' });
    insertEntry({ invitedId: INVITED_IDS[2], status: 'PENDING', qualifiesAt: new Date(Date.now() + 3_600_000).toISOString() });
    insertEntry({ invitedId: INVITED_IDS[3], status: 'REJECTED_CLONE' });
    const stats = getInviteCampaignStats(INVITE_DECOR_CAMPAIGN.guildId, INVITER_ID);
    const rendered = JSON.stringify(buildInviteCheckPayload(stats, {
      userId: INVITER_ID,
      username: 'Invite Tester',
    }).components.map((component) => component.toJSON()));

    expect(stats.valid).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.remaining).toBe(3);
    expect(rendered).toContain('TIẾN ĐỘ 2/5');
    expect(rendered).toContain('Chờ 48 giờ');
    expect(rendered).toContain('66.000đ');
  });

  it('publishes the complete rules and the /invcheck instruction', () => {
    const campaign = ensureInviteDecorCampaign();
    const payload = buildInviteCampaignAnnouncementPayload(campaign);
    const rendered = JSON.stringify(payload.components.map((component) => component.toJSON()));

    expect(rendered).toContain('MỜI BẠN · NHẬN DECOR 66K');
    expect(rendered).toContain('48 giờ');
    expect(rendered).toContain('30 ngày');
    expect(rendered).toContain('/invcheck');
    expect(rendered).toContain('<t:1788195599:F>');
  });

  it('recognizes an existing event panel by its stable marker and bot author', () => {
    const matchingMessage = {
      id: 'panel-1',
      author: { id: 'bot-1' },
      content: '',
      components: [{
        toJSON: () => ({
          components: [{ content: '# EVENT MỜI BẠN · NHẬN DECOR 66K\nDùng /invcheck để kiểm tra.' }],
        }),
      }],
    };

    expect(inviteCampaignInternals.isInviteCampaignAnnouncementMessage(matchingMessage, 'bot-1')).toBe(true);
    expect(inviteCampaignInternals.isInviteCampaignAnnouncementMessage(matchingMessage, 'bot-2')).toBe(false);
    expect(inviteCampaignInternals.isInviteCampaignAnnouncementMessage({
      ...matchingMessage,
      components: [{ toJSON: () => ({ components: [{ content: '# Một panel khác' }] }) }],
    }, 'bot-1')).toBe(false);
  });

  it('keeps the oldest matching event panel as the canonical message', () => {
    const original = { id: 'panel-old', createdTimestamp: 100 };
    const duplicate = { id: 'panel-new', createdTimestamp: 200 };

    expect(inviteCampaignInternals.selectCanonicalInviteCampaignAnnouncement([duplicate, original])).toBe(original);
  });
});
