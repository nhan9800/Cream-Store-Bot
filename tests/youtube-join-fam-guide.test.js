import { describe, expect, it } from 'vitest';
import {
  YOUTUBE_JOIN_FAM_GUIDE,
  buildYoutubeJoinFamGuideContent,
  buildYoutubeJoinFamGuideMessage,
} from '../src/campaigns/youtubeJoinFamGuide2026.js';

const E = (slot) => {
  const fn = (name) => `<:cenar_${name}:1535618654358736926>`;
  fn.component = () => null;
  return fn(slot);
};

describe('YouTube join-fam guide announcement', () => {
  it('targets the guide channel in the Cenar Store guild', () => {
    expect(YOUTUBE_JOIN_FAM_GUIDE.guildId).toBe('1282637033340403754');
    expect(YOUTUBE_JOIN_FAM_GUIDE.announcementChannelId).toBe('1524057155022491679');
  });

  it('walks through the three ordered payment-profile steps', () => {
    const content = buildYoutubeJoinFamGuideContent(
      YOUTUBE_JOIN_FAM_GUIDE.guildId,
      E,
    );

    expect(content).toContain('HƯỚNG DẪN JOIN FAM YOUTUBE');
    expect(content).toContain('Bước 1');
    expect(content).toContain('Bước 2');
    expect(content).toContain('Bước 3');
    expect(content).toContain(YOUTUBE_JOIN_FAM_GUIDE.paymentSettingsUrl);
    expect(content).toContain(YOUTUBE_JOIN_FAM_GUIDE.addPaymentMethodUrl);
    expect(content).toContain('xóa hết');
    expect(content).toContain('Momo / Zalopay');
  });

  it('renders the exact address to set and the premium warning', () => {
    const content = buildYoutubeJoinFamGuideContent(
      YOUTUBE_JOIN_FAM_GUIDE.guildId,
      E,
    );

    expect(content).toContain('42 Nguyễn Thiện Thuật');
    expect(content).toContain('Dòng địa chỉ 2  : Để trống');
    expect(content).toContain('Mã bưu điện     : 10000');
    expect(content).toContain('Việt Nam (VN)');
    expect(content).toContain('BỊ HỦY GÓI PREMIUM');
    expect(content).toContain(YOUTUBE_JOIN_FAM_GUIDE.marker);
  });

  it('recognizes the old HDAN panel so publishing replaces it instead of duplicating it', async () => {
    const { isYoutubeJoinFamGuideAnnouncement } = await import(
      '../src/campaigns/youtubeJoinFamGuide2026.js'
    );
    const legacy = {
      author: { id: 'bot-1' },
      toJSON: () => ({ content: '‼ HDAN JOIN FAM YT' }),
    };

    expect(isYoutubeJoinFamGuideAnnouncement(legacy, 'bot-1')).toBe(true);
    expect(isYoutubeJoinFamGuideAnnouncement(legacy, 'other-bot')).toBe(false);
  });

  it('builds a Components V2 payload and toggles the media gallery with the screenshot', () => {
    const withoutImage = buildYoutubeJoinFamGuideMessage({
      guildId: YOUTUBE_JOIN_FAM_GUIDE.guildId,
      attachmentName: null,
    });
    expect(withoutImage.flags).toBeDefined();
    const serialized = JSON.stringify(withoutImage.toJSON?.() ?? withoutImage);
    // discord.js serialize type 12 = MEDIA_GALLERY, 17 = CONTAINER
    expect(serialized).not.toContain('"type":12');

    const withImage = buildYoutubeJoinFamGuideMessage({
      guildId: YOUTUBE_JOIN_FAM_GUIDE.guildId,
      tagEveryone: false,
      attachmentName: YOUTUBE_JOIN_FAM_GUIDE.screenshotAttachmentName,
    });
    const serializedImage = JSON.stringify(withImage.toJSON?.() ?? withImage);
    expect(serializedImage).toContain('"type":12');
    expect(serializedImage).toContain(
      `attachment://${YOUTUBE_JOIN_FAM_GUIDE.screenshotAttachmentName}`,
    );
    expect(withImage.allowedMentions.parse).toEqual([]);
  });
});
