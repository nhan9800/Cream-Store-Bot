import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Collection, MessageFlags } from 'discord.js';
import { CORE_UI_EMOJI_ASSETS } from '../src/config/coreEmojiPack2026.js';
import {
  TERMS_BOARD,
  buildTermsBoardPayload,
  isTermsBoardMessage,
} from '../src/campaigns/termsBoard2026.js';

const previousDiscordClient = global.discordClient;

beforeAll(() => {
  const applicationEmojis = new Collection(CORE_UI_EMOJI_ASSETS.map((asset, index) => {
    const id = String(1558200000000000000n + BigInt(index));
    return [id, { id, name: asset.name, animated: false, available: true }];
  }));
  const guildEmojis = new Collection(['cenar_price_nitro', 'cenar_yt_logo'].map((name, index) => {
    const id = String(1558200000000001000n + BigInt(index));
    return [id, { id, name, animated: false, available: true }];
  }));
  global.discordClient = {
    guilds: { cache: new Collection([[TERMS_BOARD.guildId, { id: TERMS_BOARD.guildId, emojis: { cache: guildEmojis } }]]) },
    application: { emojis: { cache: applicationEmojis } },
  };
});
afterAll(() => { global.discordClient = previousDiscordClient; });

function serialize(payload) {
  return JSON.stringify({
    ...payload,
    components: payload.components.map((component) => component.toJSON()),
  });
}

describe('Cenar terms board 2026', () => {
  it('renders the YouTube and Nitro warranty policies with custom Components V2', () => {
    const payload = buildTermsBoardPayload();
    const json = serialize(payload);

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.components).toHaveLength(8);
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(json).toContain(TERMS_BOARD.marker);
    expect(json).toContain('YOUTUBE PREMIUM & GOOGLE FAMILY');
    expect(json).toContain('Không tự ý rời Google Family');
    expect(json).toContain('không còn được bảo hành miễn phí');
    expect(json).toContain('65.000đ');
    expect(json).toContain('một lần kiểm tra/xử lý giới hạn Google Family 12 tháng');
    expect(json).toContain('không cam kết mọi Gmail đều xử lý thành công');
    expect(json).toContain('khách phải đổi Gmail');
    expect(json).toContain('Mail còn sống');
    expect(json).toContain('gia hạn đúng chu kỳ **2 tháng/lần**');
    expect(json).toContain('Mail chết nhưng Nitro còn');
    expect(json).toContain('Mail chết và Nitro cũng mất');
    expect(json).toContain('không thuộc phạm vi bảo hành');
    expect(json).toContain('chỉ hỗ trợ giá ưu đãi');
    expect(json).toContain('HOÀN ĐƠN, CHI PHÍ & QUY TẮC ỨNG XỬ');
    expect(json).toContain('hoàn tối đa **50% giá trị sản phẩm**');
    expect(json).toContain('lăng mạ, đe doạ, quấy rối');
    expect(json).toContain('Chi phí đã phát sinh **không được hoàn lại**');
    expect(json).toContain('đổi mật khẩu Gmail, bật 2FA');
    expect(json).toContain('số điện thoại và email khôi phục');
    expect(json).toContain('tài khoản chưa được bảo mật');
    expect(json).toContain('cenar_price_nitro');
    expect(json).toContain('cenar_yt_logo');
    expect(json).toContain('cenar_ui26_shield');

    const contents = [];
    const collect = (value) => {
      if (!value || typeof value !== 'object') return;
      if (typeof value.content === 'string') contents.push(value.content);
      Object.values(value).forEach((child) => {
        if (Array.isArray(child)) child.forEach(collect);
        else collect(child);
      });
    };
    payload.components.map((component) => component.toJSON()).forEach(collect);
    expect(contents.reduce((total, content) => total + content.length, 0)).toBeLessThanOrEqual(3_800);
  });

  it('recognizes every legacy terms fragment so the publisher can replace all old messages', () => {
    const currentPayload = buildTermsBoardPayload();
    const current = {
      author: { id: 'bot-1' },
      components: currentPayload.components.map((component) => component.toJSON()),
    };
    const legacySections = [
      'ĐIỀU KHOẢN DỊCH VỤ & CHÍNH SÁCH BẢO HÀNH',
      'CHÍNH SÁCH BẢO HÀNH CHUNG',
      'QUY ĐỊNH BẢO HÀNH & GIA HẠN DISCORD NITRO',
      'QUY ĐỊNH DỊCH VỤ YOUTUBE PREMIUM',
      'CHÍNH SÁCH & QUY ĐỊNH NETFLIX',
      'CAM KẾT TRẢ ĐƠN & TIẾN ĐỘ',
      'Điều khoản có thể được cập nhật theo chính sách',
    ];

    expect(isTermsBoardMessage(current, 'bot-1')).toBe(true);
    for (const text of legacySections) {
      const legacy = { author: { id: 'bot-1' }, components: [{ type: 10, content: text }] };
      expect(isTermsBoardMessage(legacy, 'bot-1')).toBe(true);
    }
    expect(isTermsBoardMessage(current, 'bot-2')).toBe(false);
  });
});
