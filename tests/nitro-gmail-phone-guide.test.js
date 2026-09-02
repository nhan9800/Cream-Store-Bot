import { describe, expect, it } from 'vitest';
import {
  NITRO_GMAIL_PHONE_GUIDE,
  buildNitroGmailPhoneGuideMessage,
  buildNitroGmailPhoneGuideSections,
  isNitroGmailPhoneGuideMessage,
} from '../src/campaigns/nitroGmailPhoneGuide2026.js';

const E = (slot) => {
  const fn = (name) => `<:cenar_${name}:1535618654358736926>`;
  fn.component = () => null;
  return fn(slot);
};

describe('Nitro Gmail phone security guide', () => {
  it('targets the Nitro guide channel and support channel', () => {
    expect(NITRO_GMAIL_PHONE_GUIDE.guildId).toBe('1282637033340403754');
    expect(NITRO_GMAIL_PHONE_GUIDE.nitroGuideChannelId).toBe('1524057149783937214');
    expect(NITRO_GMAIL_PHONE_GUIDE.supportChannelId).toBe('1514607020098191393');
  });

  it('explains the exact device-phone verification flow and two-month routine', () => {
    const sections = buildNitroGmailPhoneGuideSections(
      NITRO_GMAIL_PHONE_GUIDE.guildId,
      E,
    );
    const content = Object.values(sections).join('\n');

    expect(content).toContain('GIỮ GMAIL NITRO ỔN ĐỊNH TRONG 2 THÁNG');
    expect(content).toContain('Cài đặt điện thoại → Google');
    expect(content).toContain('Thông tin cá nhân → Điện thoại');
    expect(content).toContain('Xác minh số điện thoại thiết bị');
    expect(content).toContain('cùng một điện thoại chính');
    expect(content).toContain('đủ 2 tháng');
    expect(content).toContain(NITRO_GMAIL_PHONE_GUIDE.marker);
  });

  it('does not promise an invincible account and protects sensitive credentials', () => {
    const sections = buildNitroGmailPhoneGuideSections(
      NITRO_GMAIL_PHONE_GUIDE.guildId,
      E,
    );
    const content = Object.values(sections).join('\n');

    expect(content).toContain('không phải cam kết Gmail “bất tử”');
    expect(content).toContain('không đồng nghĩa');
    expect(content).toContain('Không tự ý đổi mật khẩu, 2FA');
    expect(content).toContain('Không gửi mật khẩu, mã OTP hoặc mã 2FA');
    expect(content).toContain('tối đa 7 ngày');
    expect(content).not.toMatch(/bảo đảm 100%|cam kết 100%|không bao giờ mất/i);
  });

  it('uses Components V2, the supplied screenshot and no mentions', () => {
    const payload = buildNitroGmailPhoneGuideMessage({
      guildId: NITRO_GMAIL_PHONE_GUIDE.guildId,
      attachmentName: NITRO_GMAIL_PHONE_GUIDE.screenshotAttachmentName,
    });
    const serialized = JSON.stringify(payload.toJSON?.() ?? payload);

    expect(payload.flags).toBeDefined();
    expect(serialized).toContain('"type":17');
    expect(serialized).toContain('"type":12');
    expect(serialized).toContain(
      `attachment://${NITRO_GMAIL_PHONE_GUIDE.screenshotAttachmentName}`,
    );
    expect(payload.allowedMentions).toEqual({
      parse: [], roles: [], users: [], repliedUser: false,
    });
  });

  it('recognizes the guide marker so republishing edits instead of duplicating', () => {
    const message = {
      author: { id: 'bot-1' },
      toJSON: () => ({ content: NITRO_GMAIL_PHONE_GUIDE.marker }),
    };

    expect(isNitroGmailPhoneGuideMessage(message, 'bot-1')).toBe(true);
    expect(isNitroGmailPhoneGuideMessage(message, 'other-bot')).toBe(false);
  });
});
