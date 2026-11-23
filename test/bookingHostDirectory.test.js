import Database from 'better-sqlite3';
import { MessageFlags } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBookingProfileService } from '../src/services/bookingProfileService.js';
import { STORE_TWO_GUILD_ID } from '../src/utils/locale.js';

vi.mock('../src/database/db.js', () => ({ db: null }));
vi.mock('../src/events/shared.js', () => ({ safeReply: (interaction, payload) => interaction.reply(payload) }));

import { handleBookingHostDirectoryInteraction } from '../src/events/bookingHostDirectoryHandlers.js';

const botId = '1139187282075721768';
const member = '1350000000000000001';
const threadId = '1573607352555405319';
const portal = {
  welcome: '1573607352555405369', request: '1573607352555405365', reviews: '1573607355235434537',
  emoji: { voice: { name: 'cenar_voice', id: '1574064688541470810' } },
};
const draft = { name: 'Ánh', tagline: 'Hẹn bạn tối nay', games: 'Valorant', availability: '21–23h', service: 'game', consent: true };

function component(customId, { userId = member, author = botId, channel = portal.welcome, ephemeral = true, button = true } = {}) {
  return {
    customId, guildId: STORE_TWO_GUILD_ID, channelId: channel, client: { user: { id: botId } }, user: { id: userId },
    message: { author: { id: author }, flags: new Set(ephemeral ? [MessageFlags.Ephemeral] : []) },
    isButton: () => button,
    reply: vi.fn(), deferReply: vi.fn(), deferUpdate: vi.fn(), editReply: vi.fn(), showModal: vi.fn(),
  };
}

describe('Cenar Booking host directory', () => {
  let db;
  let profiles;
  const bookingForm = vi.fn();
  const handle = interaction => handleBookingHostDirectoryInteraction(interaction, { portal, profiles, bookingForm });

  function publish(host, input, postId) {
    profiles.saveDraft(host, { ...draft, ...input });
    profiles.approve(host, 1);
    profiles.setHostThread(host, postId);
  }

  beforeEach(() => {
    db = new Database(':memory:');
    profiles = createBookingProfileService(db);
    bookingForm.mockReset();
  });
  afterEach(() => db.close());

  it('pages through published versions in profile-number order without exposing drafts, unpublished approvals or hidden profiles', () => {
    publish('first', {}, threadId);
    publish('second', { name: 'Mây' }, '1573607352555405320');
    profiles.saveDraft('first', { ...draft, name: 'Riêng tư' });
    profiles.saveDraft('unpublished', draft);
    profiles.approve('unpublished', 1);
    expect(profiles.publishedPage(1)).toMatchObject({ total: 2, page: 1, profile: { profile_number: 1, approved: { name: 'Ánh' } } });
    expect(profiles.publishedPage(1).profile).not.toHaveProperty('draft');
    expect(profiles.publishedPage(2)).toMatchObject({ total: 2, page: 2, profile: { profile_number: 2, approved: { name: 'Mây' } } });
    expect(profiles.getPublished(3)).toBeNull();
    profiles.hide('second');
    expect(profiles.getPublished(2)).toBeNull();
    expect(profiles.publishedPage(2)).toMatchObject({ total: 1, page: 1, profile: { profile_number: 1 } });
  });

  it('opens a private directory and displays an empty state linking to staff-assisted booking', async () => {
    const launch = component('booking:dashboard:hosts', { ephemeral: false });
    await handle(launch);
    expect(launch.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const payload = launch.editReply.mock.lastCall[0];
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(JSON.stringify(payload.components[0].toJSON())).toContain('Chưa có hồ sơ host công khai');
    expect(JSON.stringify(payload.components[0].toJSON())).toContain(`/channels/${STORE_TWO_GUILD_ID}/${portal.request}`);
    expect(payload.files).toBeUndefined();
  });

  it('shows only the supported booking actions and replaces the card image when paging', async () => {
    publish('first', {}, threadId);
    publish('second', { name: 'Mây', service: 'voice' }, '1573607352555405320');
    const launch = component('booking:dashboard:hosts', { ephemeral: false });
    await handle(launch);
    const assertPage = (interaction, page, service, prefix) => {
      const payload = interaction.editReply.mock.lastCall[0];
      const card = payload.components[0].toJSON();
      const actions = card.components.filter(item => item.type === 1);
      expect(actions[0].components[0]).toMatchObject({ style: 1, custom_id: `booking:hosts:${service}:${member}:${page}` });
      expect(actions[0].components[1]).toMatchObject({ label: 'Bài hồ sơ' });
      expect(actions[1].components.map(button => button.disabled)).toEqual([page === 1, page === 2]);
      expect(card.components.find(item => item.content?.includes(`Hồ sơ ${page}/2`))).toBeDefined();
      expect(JSON.stringify(card)).toContain(prefix);
      expect(payload.attachments).toEqual([]);
      expect(payload.files[0].attachment.subarray(1, 4).toString()).toBe('PNG');
      expect(payload.allowedMentions.parse).toEqual([]);
      return actions[1];
    };
    const navigation = assertPage(launch, 1, 'game', 'Ánh');
    const next = component(navigation.components[1].custom_id);
    await handle(next);
    expect(next.deferUpdate).toHaveBeenCalledOnce();
    assertPage(next, 2, 'voice', 'Mây');
  });

  it('prefills a still-published host as a preference only and handles withdrawn or changed services', async () => {
    publish('first', { service: 'both' }, threadId);
    const launch = component('booking:dashboard:hosts', { ephemeral: false, channel: portal.request });
    await handle(launch);
    const card = launch.editReply.mock.lastCall[0].components[0].toJSON();
    const actions = card.components.find(item => item.type === 1).components;
    expect(actions.slice(0, 2).map(button => button.label)).toEqual(['Đặt chơi game', 'Đặt trò chuyện']);
    const voice = component(actions[1].custom_id);
    bookingForm.mockReturnValue('prefilled-form');
    await handle(voice);
    expect(voice.showModal).toHaveBeenCalledWith('prefilled-form');
    expect(bookingForm).toHaveBeenCalledWith('voice', { preferredHost: '#0001 Ánh' });
    profiles.saveDraft('first', draft);
    profiles.approve('first', 2);
    const obsoleteVoice = component(actions[1].custom_id);
    await handle(obsoleteVoice);
    expect(obsoleteVoice.showModal).not.toHaveBeenCalled();
    expect(obsoleteVoice.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    profiles.hide('first');
    const hidden = component(actions[0].custom_id);
    await handle(hidden);
    expect(hidden.showModal).not.toHaveBeenCalled();
    expect(hidden.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringMatching(/đã thay đổi/) }));
  });

  it.each([{ userId: 'other' }, { channel: 'other' }, { author: 'other' }, { ephemeral: false }, { button: false }])(
    'rejects controls outside their private owner context (%o)', async settings => {
      publish('first', {}, threadId);
      const click = component(`booking:hosts:game:${member}:1`, settings);
      await handle(click);
      expect(click.showModal).not.toHaveBeenCalled();
      expect(click.deferUpdate).not.toHaveBeenCalled();
      expect(click.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
    });
});
