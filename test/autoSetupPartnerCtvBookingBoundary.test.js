import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Collection } from 'discord.js';
import { STORE_ONE_CHANNEL_NAMES } from '../src/config/storeOneChannelAesthetic.js';
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID } from '../src/utils/locale.js';

const mocks = vi.hoisted(() => ({
  getCtvSettings: vi.fn(() => ({ category_id: null })),
  upsertCtvSettings: vi.fn(),
  upsertPartnerSettings: vi.fn(),
  ensureCtvRecruitmentCampaign: vi.fn(),
  publishCtvRecruitmentPanel: vi.fn().mockResolvedValue(undefined),
  publishCtvPricePanel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/database/db.js', () => ({ db: { prepare: () => ({ get: () => ({}) }) } }));
vi.mock('../src/utils/emojiHelper.js', () => ({ createEmojiResolver: () => Object.assign(() => '', { component: () => null }) }));
vi.mock('../src/services/partnerService.js', () => ({ getPartnerSettings: vi.fn(), upsertPartnerSettings: mocks.upsertPartnerSettings }));
vi.mock('../src/services/ctvService.js', () => ({
  getCtvSettings: mocks.getCtvSettings,
  upsertCtvSettings: mocks.upsertCtvSettings,
  ensureCtvRecruitmentCampaign: mocks.ensureCtvRecruitmentCampaign,
}));
vi.mock('../src/services/ctvRecruitmentPanelService.js', () => ({ publishCtvRecruitmentPanel: mocks.publishCtvRecruitmentPanel }));
vi.mock('../src/services/ctvPriceService.js', () => ({ publishCtvPricePanel: mocks.publishCtvPricePanel }));

import { autoSetupPartnerAndCtv, PARTNER_CTV_IDS } from '../src/services/autoSetupService.js';

function createFixture(guildId) {
  let sequence = 0;
  const nextId = () => String(1599000000000000000n + BigInt(++sequence));
  const client = { user: { id: '1599111100000000000' }, guilds: { cache: new Collection() } };
  const existingAffiliate = { id: PARTNER_CTV_IDS.ctvRole, name: 'Cenar Affiliate', editable: true, edit: vi.fn(), delete: vi.fn() };
  const guild = {
    id: guildId, name: 'Fixture', features: [],
    roles: {
      cache: new Collection(guildId === STORE_TWO_GUILD_ID ? [[existingAffiliate.id, existingAffiliate]] : []),
      everyone: { id: guildId }, fetch: async () => null,
      create: vi.fn(async ({ name }) => ({ id: nextId(), name, editable: false })),
    },
    channels: {
      cache: new Collection(),
      create: vi.fn(async (options) => ({
        ...options, id: nextId(), client,
        isTextBased: () => options.type === ChannelType.GuildText,
        messages: { fetch: async () => new Collection() }, send: vi.fn().mockResolvedValue(undefined),
      })),
    },
  };
  client.guilds.cache.set(guild.id, guild);
  return { client, guild, existingAffiliate };
}

const createdNames = (guild) => guild.channels.create.mock.calls.map(([options]) => options.name);

describe('Partner and CTV startup for Cenar Booking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('only provisions Partner in Store 2 and leaves Affiliate state untouched', async () => {
    const { client, guild, existingAffiliate } = createFixture(STORE_TWO_GUILD_ID);

    await autoSetupPartnerAndCtv(client);

    expect(createdNames(guild)).toEqual(['PARTNER NETWORK', 'partner-apply', 'verified-partners', 'partner-review', 'partner-media']);
    expect(mocks.upsertPartnerSettings).toHaveBeenCalledWith(expect.objectContaining({ guild_id: guild.id }));
    expect(existingAffiliate.edit).not.toHaveBeenCalled();
    expect(existingAffiliate.delete).not.toHaveBeenCalled();
    for (const action of [mocks.getCtvSettings, mocks.upsertCtvSettings, mocks.ensureCtvRecruitmentCampaign,
      mocks.publishCtvRecruitmentPanel, mocks.publishCtvPricePanel]) expect(action).not.toHaveBeenCalled();
  });

  it('still provisions both workspaces and publishes CTV panels in Store 1', async () => {
    const { client, guild } = createFixture(STORE_ONE_GUILD_ID);

    await autoSetupPartnerAndCtv(client);

    const keys = ['partnerCategory', 'ctvCategory', 'partnerRecruit', 'partnerDirectory', 'partnerReview',
      'partnerBroadcast', 'ctvRecruit', 'ctvReview', 'ctvChat', 'ctvOrderLog', 'ctvPrice'];
    expect(createdNames(guild)).toEqual(keys.map((key) => STORE_ONE_CHANNEL_NAMES[key]));
    expect(mocks.upsertPartnerSettings).toHaveBeenCalledWith(expect.objectContaining({ guild_id: guild.id }));
    expect(mocks.upsertCtvSettings).toHaveBeenCalledWith(expect.objectContaining({ guild_id: guild.id }));
    expect(mocks.ensureCtvRecruitmentCampaign).toHaveBeenCalledWith(guild.id, 3);
    expect(mocks.publishCtvRecruitmentPanel).toHaveBeenCalledWith(guild);
    expect(mocks.publishCtvPricePanel).toHaveBeenCalledWith(guild);
  });
});
