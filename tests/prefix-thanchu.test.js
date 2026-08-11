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
  test('builds a compact custom-emoji-only Components V2 guide', () => {
    const payload = buildThanhChuPayload(STORE_ONE_GUILD_ID, '1138315103821889566');
    const json = JSON.stringify(payload.components.map((component) => component.toJSON()));

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(json).toContain('THẦN CHÚ KHÁNG CÁO GMAIL');
    expect(json).toContain('cenar_price_chatgpt');
    expect(json).toContain('https://chatgpt.com/');
    expect(json).toContain('https://support.google.com/accounts/answer/40695?hl=vi');
    expect(json).not.toMatch(NATIVE_EMOJI);
  });

  test('keeps the prompt truthful and excludes sensitive authentication data', () => {
    expect(GMAIL_APPEAL_PROMPT).toContain('Không bịa đặt');
    expect(GMAIL_APPEAL_PROMPT).toContain('không đưa mật khẩu, mã OTP hoặc mã dự phòng');
    expect(GMAIL_APPEAL_PROMPT).toContain('Full name: [HỌ VÀ TÊN]');
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
