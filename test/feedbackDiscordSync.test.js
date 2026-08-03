import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildFeedbackV2 = vi.fn();
const getOrderByCode = vi.fn();

vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: vi.fn() }));
vi.mock('../src/services/customerService.js', () => ({ syncCustomerStats: vi.fn() }));
vi.mock('../src/services/orderService.js', () => ({
  getOrderByCode,
  submitFeedback: vi.fn(),
}));
vi.mock('../src/utils/embeds.js', () => ({ buildFeedbackV2 }));

const { syncPublishedFeedbackMessage } = await import('../src/services/feedbackService.js');

describe('feedback Discord synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('edits the original Discord feedback message with the updated values', async () => {
    const edit = vi.fn().mockResolvedValue({ id: 'message-1' });
    const messageFetch = vi.fn().mockResolvedValue({ edit });
    const channelFetch = vi.fn().mockResolvedValue({
      isTextBased: () => true,
      messages: { fetch: messageFetch },
    });
    const memberFetch = vi.fn().mockResolvedValue({ id: 'customer-1' });
    const guild = {
      channels: { fetch: channelFetch },
      members: { fetch: memberFetch },
    };
    const client = {
      guilds: {
        cache: new Map([['guild-1', guild]]),
        fetch: vi.fn(),
      },
    };
    const feedback = {
      guild_id: 'guild-1',
      customer_id: 'customer-1',
      order_code: 'CN_123456',
      product_name: 'Discord Nitro',
      stars: 4,
      content: 'Nội dung đã chỉnh sửa',
      feedback_channel_id: 'channel-1',
      feedback_message_id: 'message-1',
    };
    const order = { order_code: feedback.order_code, guild_id: 'guild-1', product_name: 'Discord Nitro', quantity: 1 };
    const container = { type: 'feedback-card' };
    getOrderByCode.mockReturnValue(order);
    buildFeedbackV2.mockReturnValue({ container, flags: 32768 });

    const result = await syncPublishedFeedbackMessage({ client, feedback });

    expect(result).toEqual({ synced: true, channelId: 'channel-1', messageId: 'message-1' });
    expect(buildFeedbackV2).toHaveBeenCalledWith({
      member: { id: 'customer-1' },
      order,
      stars: 4,
      content: 'Nội dung đã chỉnh sửa',
    });
    expect(edit).toHaveBeenCalledWith({ components: [container], flags: 32768 });
  });

  it('reports a missing Discord reference without touching the API', async () => {
    const client = { guilds: { cache: new Map(), fetch: vi.fn() } };

    const result = await syncPublishedFeedbackMessage({ client, feedback: { guild_id: 'guild-1' } });

    expect(result).toEqual({ synced: false, reason: 'missing_message_reference' });
    expect(client.guilds.fetch).not.toHaveBeenCalled();
  });
});
