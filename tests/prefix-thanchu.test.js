import { describe, expect, test, vi } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  buildThanhChuPayload,
  GMAIL_APPEAL_PROMPT,
  handlePrefixThanhChu,
} from '../src/events/prefixHandlers.js';
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID } from '../src/utils/locale.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

describe('+thanchu Store 1 guide', () => {
  test('builds the guide shown in the supplied reference', () => {
    const payload = buildThanhChuPayload(STORE_ONE_GUILD_ID, '1138315103821889566');
    const json = JSON.stringify(payload.components.map((component) => component.toJSON()));

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(json).toContain('HƯỚNG DẪN TẠO VĂN KHÁNG CÁO VỚI CHATGPT');
    expect(json).toContain('Hướng dẫn sử dụng ChatGPT');
    expect(json).toContain('https://chatgpt.com/');
    expect(json).toContain('Copy văn kháng cáo được tạo và gửi đến Google Support');
    expect(json).not.toMatch(NATIVE_EMOJI);
  });

  test('keeps the supplied prompt verbatim without generated additions', () => {
    expect(GMAIL_APPEAL_PROMPT).toBe('Hãy viết giúp tôi một đoạn thư kháng cáo gửi đến đội ngũ hỗ trợ Google khi tài khoản Gmail của tôi bị gắn cờ là do máy tính hoặc robot tạo ra. Yêu cầu: Giọng văn lịch sự, chuyên nghiệp và chân thành. Có lời chào mở đầu và lời cảm ơn kết thúc gửi đến đội ngũ Google. Trình bày rõ ràng rằng tài khoản do con người thật sử dụng, không phải bot. Nêu lý do có thể khiến hệ thống hiểu nhầm (ví dụ: hoạt động đăng nhập lạ, dùng nhiều thiết bị, v.v.). Giữ độ dài khoảng 2-3 đoạn ngắn, đủ súc tích và dễ đọc. Bằng tiếng Anh, bỏ Subject, bỏ phần full name và your email.');
    expect(GMAIL_APPEAL_PROMPT).not.toContain('150–220');
    expect(GMAIL_APPEAL_PROMPT).not.toContain('[HỌ VÀ TÊN]');
  });

  test('does not publish the Vietnamese guide in Store 2', async () => {
    const reply = vi.fn();
    const result = await handlePrefixThanhChu({
      guild: { id: STORE_TWO_GUILD_ID },
      author: { id: '1' },
      reply,
    });

    expect(result).toBe(false);
    expect(reply).not.toHaveBeenCalled();
  });
});
