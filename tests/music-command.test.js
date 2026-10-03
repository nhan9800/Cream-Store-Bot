import { beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  playYoutube: vi.fn(),
  buildMusicPanelPayload: vi.fn(),
  buildMusicAddedMessage: vi.fn(),
  registerMusicPanelMessage: vi.fn(),
}));
vi.mock('../src/services/musicPlayerService.js', () => service);
import { execute } from '../src/commands/music.js';

function interaction(link = 'https://www.youtube.com/playlist?list=PLtest') {
  return {
    options: { getString: () => link },
    member: { voice: { channel: { id: 'voice' } } },
    guild: { id: 'guild' }, guildId: 'guild', channelId: 'text',
    user: { id: 'listener' },
    deferReply: vi.fn(), editReply: vi.fn(), fetchReply: vi.fn().mockResolvedValue({ id: 'panel' }),
  };
}

describe('Music command playlist acknowledgment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.buildMusicPanelPayload.mockReturnValue({ components: ['panel'] });
    service.buildMusicAddedMessage.mockReturnValue('Đã thêm 3 bài từ playlist.');
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

  it('opens the panel without inventing an added-playlist success', async () => {
    const request = interaction(null);
    await execute(request);
    expect(service.playYoutube).not.toHaveBeenCalled();
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
