import { Client, ChannelType, TextChannel } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/services/emojiService.js', () => ({
  resolveLiveCustomEmoji: () => '',
  sanitizeCustomEmojiText: (_guildId, text) => text,
}));

import { installDiscordEmojiBoundary } from '../src/utils/discordEmojiBoundary.js';
import { consumeManualAnnouncementWrite, withManualAnnouncementWrite } from '../src/utils/manualAnnouncementWrite.js';

const channelId = '1515008584549797979';
const nonce = '1570816080459604068';
const grant = rest => ({ rest, channelId, nonce });
const requestOptions = (overrides = {}) => ({
  method: 'POST', fullRoute: `/channels/${channelId}/messages`,
  body: { content: 'Thông báo từ quản trị viên', nonce, enforce_nonce: true }, ...overrides,
});
const clients = [];

function discordChannel() {
  const client = new Client({ intents: [] });
  clients.push(client);
  const message = { id: '1570816080459604070' };
  const channel = new TextChannel({ id: '1282637033340403754' }, {
    id: channelId, type: ChannelType.GuildText, name: 'thong-bao',
  }, client);
  client.channels.cache.set(channelId, channel);
  channel.messages.cache.set(message.id, message);
  const request = vi.fn(async () => message);
  client.rest.request = request;
  installDiscordEmojiBoundary(client);
  return { client, channel, request, message };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.destroy()));
});

describe('manual announcement exception to automatic marketing pause', () => {
  it('allows the confirmed draft nonce through real Discord.js send serialization once', async () => {
    const { client, channel, request, message } = discordChannel();
    await expect(withManualAnnouncementWrite(grant(client.rest), () => channel.send({
      content: '@everyone Lịch hỗ trợ mới', nonce, enforceNonce: true,
      allowedMentions: { parse: ['everyone'], users: [], roles: [] },
    }))).resolves.toBe(message);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'POST', fullRoute: `/channels/${channelId}/messages`,
      body: { nonce, enforce_nonce: true, content: '@everyone Lịch hỗ trợ mới',
        allowed_mentions: { parse: ['everyone'], users: [], roles: [] } },
    });
    await expect(channel.send({ content: 'Automatic campaign', nonce, enforceNonce: true }))
      .rejects.toMatchObject({ code: 'MARKETING_PAUSED', requestNotSent: true });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not grant a simultaneous automatic send in another async task', async () => {
    const { client, channel, request } = discordChannel();
    let release;
    const ready = new Promise(resolve => { release = resolve; });
    const manual = withManualAnnouncementWrite(grant(client.rest), async () => {
      await ready;
      return channel.send({ content: 'Manual notice', nonce, enforceNonce: true });
    });
    await expect(channel.send({ content: 'Automatic campaign', nonce, enforceNonce: true }))
      .rejects.toMatchObject({ code: 'MARKETING_PAUSED' });
    release();
    await manual;
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects other clients, channels, nonces and edits without consuming the authorized send', async () => {
    const rest = {};
    await withManualAnnouncementWrite(grant(rest), async () => {
      expect(consumeManualAnnouncementWrite({}, requestOptions())).toBe(false);
      expect(consumeManualAnnouncementWrite(rest, requestOptions({
        fullRoute: '/channels/1514606987839672563/messages',
      }))).toBe(false);
      expect(consumeManualAnnouncementWrite(rest, requestOptions({
        body: { nonce: 'another-draft', enforce_nonce: true },
      }))).toBe(false);
      expect(consumeManualAnnouncementWrite(rest, requestOptions({
        method: 'PATCH', fullRoute: `/channels/${channelId}/messages/1570816080459604070`,
      }))).toBe(false);
      expect(consumeManualAnnouncementWrite(rest, requestOptions({
        body: { nonce, enforce_nonce: false },
      }))).toBe(false);
      expect(consumeManualAnnouncementWrite(rest, requestOptions())).toBe(true);
      expect(consumeManualAnnouncementWrite(rest, requestOptions())).toBe(false);
    });
  });

  it('keeps edits and second sends blocked at the actual REST boundary inside the grant', async () => {
    const { client, request } = discordChannel();
    await withManualAnnouncementWrite(grant(client.rest), async () => {
      await expect(client.rest.request(requestOptions({
        method: 'PATCH', fullRoute: `/channels/${channelId}/messages/1570816080459604070`,
      }))).rejects.toMatchObject({ code: 'MARKETING_PAUSED' });
      await client.rest.request(requestOptions());
      await expect(client.rest.request(requestOptions())).rejects.toMatchObject({ code: 'MARKETING_PAUSED' });
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('revokes an unconsumed inherited grant when operation completes (throws=%s)', async throws => {
    const rest = {};
    let release;
    let delayed;
    const ready = new Promise(resolve => { release = resolve; });
    const operation = withManualAnnouncementWrite(grant(rest), () => {
      delayed = ready.then(() => consumeManualAnnouncementWrite(rest, requestOptions()));
      if (throws) throw new Error('Publication failed before sending');
      return 'finished';
    });
    if (throws) await expect(operation).rejects.toThrow('Publication failed');
    else await expect(operation).resolves.toBe('finished');
    release();
    await expect(delayed).resolves.toBe(false);
    expect(consumeManualAnnouncementWrite(rest, requestOptions())).toBe(false);
  });
});
