import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationCommandOptionType } from 'discord.js';

const service = vi.hoisted(() => ({
  playYoutube: vi.fn(),
  playMusicAttachment: vi.fn(),
  buildMusicPanelPayload: vi.fn(),
  buildMusicAddedMessage: vi.fn(),
  registerMusicPanelMessage: vi.fn(),
}));
vi.mock('../src/services/musicPlayerService.js', () => service);
import { data, execute } from '../src/commands/music.js';

function interaction(link = 'https://www.youtube.com/playlist?list=PLtest', attachment = null) {
  return {
    options: { getString: () => link, getAttachment: () => attachment },
    member: { voice: { channel: { id: 'voice' } } },
    guild: { id: 'guild' }, guildId: 'guild', channelId: 'text',
    user: { id: 'listener' },
    deferReply: vi.fn(), editReply: vi.fn(), fetchReply: vi.fn().mockResolvedValue({ id: 'panel' }),
  };
}

describe('Music command source options and acknowledgment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.buildMusicPanelPayload.mockReturnValue({ components: ['panel'] });
    service.buildMusicAddedMessage.mockReturnValue('Đã thêm 3 bài từ playlist.');
  });

  it('registers YouTube and Discord attachment as optional source options', () => {
    expect(data.toJSON()).toMatchObject({
      name: 'music',
      options: [
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
      url: request.options.getString(), requestedBy: request.user,
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

    expect(request.editReply).toHaveBeenCalledWith('Không thể mở Cenar Music: Chỉ chọn một nguồn phát: link YouTube hoặc tệp MP3/OGG.');
    expect(service.playYoutube).not.toHaveBeenCalled();
    expect(service.playMusicAttachment).not.toHaveBeenCalled();
    expect(service.registerMusicPanelMessage).not.toHaveBeenCalled();
  });

  it('requires a voice channel before forwarding a file', async () => {
    const request = interaction(null, { id: 'attachment' });
    request.member.voice.channel = null;

    await execute(request);

    expect(request.editReply).toHaveBeenCalledWith('Không thể mở Cenar Music: Bạn cần vào một phòng thoại trước khi phát nhạc.');
    expect(service.playMusicAttachment).not.toHaveBeenCalled();
  });

  it('opens the panel without inventing an added-playlist success', async () => {
    const request = interaction(null);
    await execute(request);
    expect(service.playYoutube).not.toHaveBeenCalled();
    expect(service.playMusicAttachment).not.toHaveBeenCalled();
    expect(service.buildMusicAddedMessage).not.toHaveBeenCalled();
    expect(service.buildMusicPanelPayload).toHaveBeenCalledWith('guild', { notice: null });
  });

  it('reports queue rejection without displaying a successful add', async () => {
    service.playYoutube.mockRejectedValue(new Error('Hàng đợi không đủ chỗ.'));
    const request = interaction();
    await execute(request);
    expect(request.editReply).toHaveBeenCalledWith('Không thể mở Cenar Music: Hàng đợi không đủ chỗ.');
    expect(service.buildMusicAddedMessage).not.toHaveBeenCalled();
    expect(service.registerMusicPanelMessage).not.toHaveBeenCalled();
  });
});
