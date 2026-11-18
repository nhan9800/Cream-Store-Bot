import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationCommandOptionType, ComponentType, MessageFlags } from 'discord.js';

const service = vi.hoisted(() => ({
  playYoutube: vi.fn(),
  playMusicAttachment: vi.fn(),
  playMusicCommons: vi.fn(),
  buildMusicPanelPayload: vi.fn(),
  buildMusicAddedMessage: vi.fn(),
  registerMusicPanelMessage: vi.fn(),
}));
const catalog = vi.hoisted(() => ({
  isMusicCommonsLink: vi.fn(),
  resolveMusicCommons: vi.fn(),
  searchMusicCommons: vi.fn(),
}));
vi.mock('../src/services/musicPlayerService.js', () => service);
vi.mock('../src/services/musicCommonsCatalog.js', () => catalog);
import { data, execute } from '../src/commands/music.js';

function interaction(link = 'https://www.youtube.com/playlist?list=PLtest', attachment = null, query = null) {
  return {
    id: 'request-id',
    options: { getString: (name) => name === 'ten' ? query : link, getAttachment: () => attachment },
    member: { voice: { channel: { id: 'voice' } } },
    guild: { id: 'guild' }, guildId: 'guild', channelId: 'text',
    user: { id: 'listener' },
    deferReply: vi.fn(), editReply: vi.fn(), fetchReply: vi.fn().mockResolvedValue({ id: 'panel' }),
    followUp: vi.fn().mockResolvedValue({ id: 'search-panel' }),
  };
}

const commonsTrack = {
  title: 'Für Elise', artist: 'Gaodifan', license: 'CC0',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:FurElise.ogg',
};

describe('Music command source options and acknowledgment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    catalog.isMusicCommonsLink.mockReturnValue(false);
    service.buildMusicPanelPayload.mockReturnValue({ components: ['panel'] });
    service.buildMusicAddedMessage.mockReturnValue('Đã thêm 3 bài từ playlist.');
  });

  it('registers title search, links and Discord attachments as optional source options', () => {
    expect(data.toJSON()).toMatchObject({
      name: 'music',
      options: [
        { name: 'ten', type: ApplicationCommandOptionType.String, required: false, min_length: 2, max_length: 120 },
        { name: 'link', type: ApplicationCommandOptionType.String, required: false },
        { name: 'file', type: ApplicationCommandOptionType.Attachment, required: false },
      ],
    });
  });

  it('includes the completed playlist summary in the control panel', async () => {
    const result = { track: { title: 'First' }, addedCount: 3, playlist: { title: 'Chill', addedCount: 3 } };
    service.playYoutube.mockResolvedValue(result);
    const request = interaction();
    await execute(request);
    expect(service.playYoutube).toHaveBeenCalledWith(expect.objectContaining({
      url: request.options.getString('link'), requestedBy: request.user,
      voiceChannel: request.member.voice.channel, textChannelId: 'text',
    }));
    expect(service.buildMusicAddedMessage).toHaveBeenCalledWith(result);
    expect(service.buildMusicPanelPayload).toHaveBeenCalledWith('guild', { notice: 'Đã thêm 3 bài từ playlist.' });
    expect(request.editReply).toHaveBeenCalledWith({ components: ['panel'] });
    expect(service.registerMusicPanelMessage).toHaveBeenCalledWith('guild', { id: 'panel' });
  });

  it('forwards the resolved Discord attachment and acknowledges the selected track', async () => {
    const attachment = { id: 'attachment', name: 'demo.ogg' };
    const result = { track: { title: 'Demo' }, addedCount: 1 };
    service.playMusicAttachment.mockResolvedValue(result);
    service.buildMusicAddedMessage.mockReturnValue('Đã thêm **Demo** vào Cenar Music.');
    const request = interaction(null, attachment);

    await execute(request);

    expect(request.deferReply).toHaveBeenCalledOnce();
    expect(service.playMusicAttachment).toHaveBeenCalledWith({
      attachment,
      guild: request.guild,
      voiceChannel: request.member.voice.channel,
      requestedBy: request.user,
      textChannelId: request.channelId,
    });
    expect(service.playYoutube).not.toHaveBeenCalled();
    expect(service.buildMusicAddedMessage).toHaveBeenCalledWith(result);
    expect(service.buildMusicPanelPayload).toHaveBeenCalledWith('guild', { notice: 'Đã thêm **Demo** vào Cenar Music.' });
    expect(request.editReply).toHaveBeenCalledWith({ components: ['panel'] });
    expect(service.registerMusicPanelMessage).toHaveBeenCalledWith('guild', { id: 'panel' });
  });

  it('rejects requests that provide both sources before changing playback', async () => {
    const request = interaction('https://youtu.be/track', { id: 'attachment' });

    await execute(request);

    expect(request.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Chỉ nhập một trong ba tùy chọn'),
    }));
    expect(service.playYoutube).not.toHaveBeenCalled();
    expect(service.playMusicAttachment).not.toHaveBeenCalled();
    expect(service.registerMusicPanelMessage).not.toHaveBeenCalled();
  });

  it('requires a voice channel before forwarding a file', async () => {
    const request = interaction(null, { id: 'attachment' });
    request.member.voice.channel = null;

    await execute(request);

    expect(request.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Không thể mở Cenar Music: Bạn cần vào một phòng thoại trước khi phát nhạc.',
    }));
    expect(service.playMusicAttachment).not.toHaveBeenCalled();
  });

  it('opens the panel without inventing an added-playlist success', async () => {
    const request = interaction(null);
    await execute(request);
    expect(service.playYoutube).not.toHaveBeenCalled();
    expect(service.playMusicAttachment).not.toHaveBeenCalled();
    expect(catalog.searchMusicCommons).not.toHaveBeenCalled();
    expect(service.buildMusicAddedMessage).not.toHaveBeenCalled();
    expect(service.buildMusicPanelPayload).toHaveBeenCalledWith('guild', { notice: null });
  });

  it('reports queue rejection without displaying a successful add', async () => {
    service.playYoutube.mockRejectedValue(new Error('Hàng đợi không đủ chỗ.'));
    const request = interaction();
    await execute(request);
    expect(request.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Không thể mở Cenar Music: Hàng đợi không đủ chỗ.',
    }));
    expect(service.buildMusicAddedMessage).not.toHaveBeenCalled();
    expect(service.registerMusicPanelMessage).not.toHaveBeenCalled();
  });

  it('resolves Commons file links and routes their verified descriptor to playback', async () => {
    const request = interaction(commonsTrack.pageUrl);
    catalog.isMusicCommonsLink.mockReturnValue(true);
    catalog.resolveMusicCommons.mockResolvedValue(commonsTrack);

    await execute(request);

    expect(catalog.resolveMusicCommons).toHaveBeenCalledWith(commonsTrack.pageUrl);
    expect(service.playMusicCommons).toHaveBeenCalledWith(expect.objectContaining({
      guild: request.guild, voiceChannel: request.member.voice.channel, source: commonsTrack,
      requestedBy: request.user, textChannelId: 'text',
    }));
    expect(service.playYoutube).not.toHaveBeenCalled();
  });

  it('never starts a title search when a second source is present', async () => {
    const request = interaction(commonsTrack.pageUrl, null, 'Für Elise');

    await execute(request);

    expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(catalog.searchMusicCommons).not.toHaveBeenCalled();
    expect(catalog.resolveMusicCommons).not.toHaveBeenCalled();
    expect(request.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Chỉ nhập một trong ba tùy chọn'),
    }));
  });

  it('shows up to five private results, accepts only the requester, and queues the chosen result once', async () => {
    const request = interaction(null, null, ' Für Elise ');
    const results = Array.from({ length: 6 }, (_, index) => ({ ...commonsTrack, title: `${commonsTrack.title} ${index + 1}` }));
    const result = { track: results[1], addedCount: 1 };
    catalog.searchMusicCommons.mockResolvedValue(results);
    service.playMusicCommons.mockResolvedValue(result);
    const notice = 'Đã thêm **Für Elise 2** · Gaodifan · CC0';
    service.buildMusicAddedMessage.mockReturnValue(notice);
    const selection = { values: ['1'], member: request.member, update: vi.fn() };
    const awaitMessageComponent = vi.fn().mockResolvedValue(selection);
    request.editReply.mockResolvedValueOnce({ awaitMessageComponent });

    await execute(request);

    expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(catalog.searchMusicCommons).toHaveBeenCalledWith('Für Elise');
    const menu = request.editReply.mock.calls[0][0].components[0].toJSON().components[0];
    expect(menu.options).toHaveLength(5);
    expect(menu.options[1]).toMatchObject({ label: 'Für Elise 2', description: 'CC0 · Gaodifan', value: '1' });
    const [collector] = awaitMessageComponent.mock.calls[0];
    expect(collector).toMatchObject({ componentType: ComponentType.StringSelect, time: 60_000 });
    expect(collector.filter({ user: request.user, customId: menu.custom_id })).toBe(true);
    expect(collector.filter({ user: { id: 'other' }, customId: menu.custom_id })).toBe(false);
    expect(collector.filter({ user: request.user, customId: 'other' })).toBe(false);
    expect(selection.update).toHaveBeenCalledOnce();
    expect(service.playMusicCommons).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      source: results[1], voiceChannel: request.member.voice.channel, requestedBy: request.user,
    }));
    expect(request.editReply).toHaveBeenLastCalledWith({ content: notice, components: [], allowedMentions: { parse: [] } });
    expect(request.followUp).toHaveBeenCalledExactlyOnceWith({ components: ['panel'] });
    expect(service.registerMusicPanelMessage).toHaveBeenCalledWith('guild', { id: 'search-panel' });
  });

  it('clears expired search controls without changing the queue', async () => {
    const request = interaction(null, null, 'Für Elise');
    catalog.searchMusicCommons.mockResolvedValue([commonsTrack]);
    request.editReply.mockResolvedValueOnce({ awaitMessageComponent: vi.fn().mockRejectedValue(new Error('time')) });

    await execute(request);

    expect(request.editReply).toHaveBeenLastCalledWith(expect.objectContaining({
      content: expect.stringContaining('Danh sách đã hết hạn'), components: [],
    }));
    expect(service.playMusicCommons).not.toHaveBeenCalled();
    expect(request.followUp).not.toHaveBeenCalled();
  });

  it('rejects a selection after the requester changes voice rooms', async () => {
    const request = interaction(null, null, 'Für Elise');
    catalog.searchMusicCommons.mockResolvedValue([commonsTrack]);
    const selection = { values: ['0'], member: { voice: { channel: { id: 'other' } } }, update: vi.fn() };
    request.editReply.mockResolvedValueOnce({ awaitMessageComponent: vi.fn().mockResolvedValue(selection) });

    await execute(request);

    expect(selection.update).toHaveBeenCalledOnce();
    expect(request.editReply).toHaveBeenLastCalledWith(expect.objectContaining({
      content: expect.stringContaining('phòng thoại ban đầu'), components: [],
    }));
    expect(service.playMusicCommons).not.toHaveBeenCalled();
  });

  it('does not create a select menu or alter playback for an empty result', async () => {
    const request = interaction(null, null, 'Für Elise');
    catalog.searchMusicCommons.mockResolvedValue([]);

    await execute(request);

    expect(request.editReply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      content: expect.stringContaining('Chưa tìm thấy bản thu'),
    }));
    expect(service.playMusicCommons).not.toHaveBeenCalled();
    expect(request.followUp).not.toHaveBeenCalled();
  });
});
