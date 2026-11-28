import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Collection, MessageFlags } from 'discord.js';
import { CORE_UI_EMOJI_ASSETS } from '../src/config/coreEmojiPack2026.js';
import {
  TERMS_BOARD,
  buildTermsBoardPayload,
  isTermsBoardMessage,
  publishTermsBoard,
} from '../src/campaigns/termsBoard2026.js';

const previousDiscordClient = global.discordClient;

beforeAll(() => {
  const applicationEmojis = new Collection(CORE_UI_EMOJI_ASSETS.map((asset, index) => {
    const id = String(1558200000000000000n + BigInt(index));
    return [id, { id, name: asset.name, animated: false, available: true }];
  }));
  const guildEmojis = new Collection(['cenar_price_nitro', 'cenar_yt_logo', 'cenar_board26_netflix'].map((name, index) => {
    const id = String(1558200000000001000n + BigInt(index));
    return [id, { id, name, animated: false, available: true }];
  }));
  global.discordClient = {
    guilds: { cache: new Collection([[TERMS_BOARD.guildId, { id: TERMS_BOARD.guildId, emojis: { cache: guildEmojis } }]]) },
    application: { emojis: { cache: applicationEmojis } },
  };
});
afterAll(() => { global.discordClient = previousDiscordClient; });

const toJSON = (payload) => payload.components.map((component) => component.toJSON());
const texts = (payload) => {
  const out = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.content === 'string') out.push(value.content);
    Object.values(value).forEach((child) => (Array.isArray(child) ? child.forEach(visit) : visit(child)));
  };
  toJSON(payload).forEach(visit);
  return out;
};

describe('Cenar terms board V2 (owner-approved 2026-11-28)', () => {
  it('carries the V2 rules in one Components V2 message within Discord limits', () => {
    const payload = buildTermsBoardPayload();
    const copy = texts(payload).join('\n');

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.components).toHaveLength(9);
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(copy.length).toBeLessThanOrEqual(3_800);
    for (const text of [
      'CENAR-TERMS-BOARD-V2',
      'Hiệu lực từ **28/11/2026**',
      'Giá sale đăng trên Discord áp dụng khi đặt qua ticket',
      'Quá **24 giờ** sau thanh toán',
      '**phí 0%**',
      '**không phải điều kiện bảo hành**',
      'Rời server không làm mất bảo hành',
      '**Số hoàn = Đã trả − Thời gian đã dùng − Phí xử lý (0–50%) − Chi phí khác có tên**',
      'hoàn tối đa **50%** sau đối soát chi phí',
      'phí thường **30%**',
      'gửi bảng mới kèm lý do',
      'dự kiến **2–3 tuần**',
      'YOUTUBE & SPOTIFY FAMILY',
      'phí thêm lại **65.000đ**',
      'Giữ mail shop cấp **suốt thời gian sử dụng**',
      'đổi mật khẩu Gmail, bật 2FA',
      'Đăng nhập tối đa **3 thiết bị**',
      'bảo hành kích hoạt lần đầu',
      'khoảng **3 ngày** trước khi hết hạn',
    ]) expect(copy).toContain(text);
    for (const retired of ['2 tháng/lần', 'Gửi feedback sau khi hoàn tất đơn để ghi nhận quyền lợi bảo hành',
      'có thể bị từ chối bảo hành', 'Điều khoản có thể đổi theo nhà cung cấp']) expect(copy).not.toContain(retired);
    expect(copy).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('never repeats a decoration in the message, buttons included', () => {
    const json = JSON.stringify(toJSON(buildTermsBoardPayload()));
    const textIds = [...texts(buildTermsBoardPayload()).join('\n').matchAll(/<a?:\w+:(\d+)>/g)].map((m) => m[1]);
    const buttonIds = [...json.matchAll(/"emoji":\{"id":"(\d+)"/g)].map((m) => m[1]);
    const ids = [...textIds, ...buttonIds];
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ids).size).toBe(ids.length);
    expect(json).toContain(TERMS_BOARD.websiteTermsUrl);
  });

  it('recognizes current and legacy terms messages', () => {
    const current = { author: { id: 'bot-1' }, components: toJSON(buildTermsBoardPayload()) };
    expect(isTermsBoardMessage(current, 'bot-1')).toBe(true);
    expect(isTermsBoardMessage(current, 'bot-2')).toBe(false);
    for (const text of ['CENAR-TERMS-BOARD-V1', 'CHÍNH SÁCH BẢO HÀNH CHUNG', 'Điều khoản có thể được cập nhật theo chính sách']) {
      expect(isTermsBoardMessage({ author: { id: 'bot-1' }, components: [{ type: 10, content: text }] }, 'bot-1')).toBe(true);
    }
  });

  it('edits the existing V1 board in place instead of posting a new message', async () => {
    const v1 = { id: 'm-v1', author: { id: 'bot-1' }, components: [{ type: 17, components: [{ type: 10, content: '-# CENAR-TERMS-BOARD-V1' }] }],
      edit: vi.fn(async () => {}), pin: vi.fn(async () => {}), delete: vi.fn(async () => {}) };
    const other = { id: 'm-user', author: { id: 'someone' }, content: 'hello', components: [], delete: vi.fn() };
    const channel = {
      isTextBased: () => true,
      messages: {
        fetch: vi.fn(async () => new Collection([[v1.id, v1], [other.id, other]])),
        fetchPinned: vi.fn(async () => new Collection()),
      },
      send: vi.fn(),
    };
    const client = { user: { id: 'bot-1' }, guilds: { cache: new Collection([[TERMS_BOARD.guildId,
      { channels: { cache: new Collection([[TERMS_BOARD.channelId, channel]]) } }]]) } };

    const result = await publishTermsBoard(client);
    expect(result).toEqual({ status: 'updated', messageId: 'm-v1', removed: 0 });
    expect(channel.send).not.toHaveBeenCalled();
    expect(v1.edit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(v1.edit.mock.calls[0][0].components.map((c) => c.toJSON()))).toContain('CENAR-TERMS-BOARD-V2');
    expect(other.delete).not.toHaveBeenCalled();
  });
});
