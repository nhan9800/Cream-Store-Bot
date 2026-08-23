import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  TERMS_BOARD,
  buildTermsBoardPayload,
  isTermsBoardMessage,
} from '../src/campaigns/termsBoard2026.js';

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
    expect(payload.components).toHaveLength(7);
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(json).toContain(TERMS_BOARD.marker);
    expect(json).toContain('YOUTUBE PREMIUM & GOOGLE FAMILY');
    expect(json).toContain('Không tự ý rời Google Family');
    expect(json).toContain('không còn thuộc phạm vi bảo hành miễn phí');
    expect(json).toContain('65.000đ');
    expect(json).toContain('một lần kiểm tra và hỗ trợ xử lý giới hạn Google Family 12 tháng');
    expect(json).toContain('Đây không phải cam kết mọi Gmail đều xử lý thành công');
    expect(json).toContain('khách cần đổi sang Gmail khác');
    expect(json).toContain('Mail còn hoạt động');
    expect(json).toContain('gia hạn đúng chu kỳ **2 tháng/lần**');
    expect(json).toContain('Mail đã chết nhưng Nitro vẫn còn');
    expect(json).toContain('Mail đã chết và Nitro đồng thời bị mất');
    expect(json).toContain('không thuộc phạm vi bảo hành');
    expect(json).toContain('chỉ hỗ trợ mức giá ưu đãi');
    expect(json).toContain('cenar_price_nitro');
    expect(json).toContain('cenar_youtube');
    expect(json).toContain('cenar_warranty_shield');
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
