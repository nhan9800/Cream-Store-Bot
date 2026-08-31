import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  YOUTUBE_STABILITY_TRANSITION,
  buildYoutubeStabilityTransitionMessage,
  buildYoutubeStabilityTransitionSections,
} from '../src/campaigns/youtubeStabilityTransition2026.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

function emojiResolver(slot) {
  return `<:cenar_${slot}:1535618654358736926>`;
}
emojiResolver.component = (slot) => ({ id: '1535618654358736926', name: `cenar_${slot}` });

describe('YouTube stability transition announcement', () => {
  it('states the affected orders and both customer-resolution branches', () => {
    const sections = buildYoutubeStabilityTransitionSections(
      YOUTUBE_STABILITY_TRANSITION.guildId,
      emojiResolver,
    );
    const content = Object.values(sections).join('\n');

    expect(content).toContain('đổi Family mỗi tháng');
    expect(content).toContain('lô cũ');
    expect(content).toContain('PHƯƠNG ÁN 1');
    expect(content).toContain('PHƯƠNG ÁN 2');
    expect(content).toContain('hoàn 50% giá trị sản phẩm');
    expect(content).toContain('đổi sang sản phẩm khác tại shop');
    expect(content).toContain('mã đơn + Gmail đã đăng ký');
  });

  it('publishes only the stable product line at the approved retail prices', () => {
    const sections = buildYoutubeStabilityTransitionSections(
      YOUTUBE_STABILITY_TRANSITION.guildId,
      emojiResolver,
    );
    const content = Object.values(sections).join('\n');

    for (const price of ['60.000đ', '195.000đ', '320.000đ', '580.000đ']) {
      expect(content).toContain(price);
    }
    expect(content).toContain('dừng toàn bộ dòng đổi Family/gia hạn mỗi tháng');
    expect(content).toContain('Các đơn cũ vẫn được lưu');
    expect(content.toLowerCase()).not.toContain('không bao giờ bị out');
    expect(content).not.toMatch(NATIVE_EMOJI);
  });

  it('builds a Components V2 announcement with custom emoji buttons and everyone mention', () => {
    const payload = buildYoutubeStabilityTransitionMessage({
      guildId: YOUTUBE_STABILITY_TRANSITION.guildId,
      E: emojiResolver,
    });
    const json = JSON.stringify(payload);

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.allowedMentions.parse).toEqual(['everyone']);
    expect(payload.components).toHaveLength(4);
    expect(json).toContain(YOUTUBE_STABILITY_TRANSITION.marker);
    expect(json).toContain('https://cenarstore.xyz/products');
    expect(json).toContain(YOUTUBE_STABILITY_TRANSITION.supportChannelId);
    expect(json).toContain(YOUTUBE_STABILITY_TRANSITION.priceChannelId);
    expect(json).not.toMatch(NATIVE_EMOJI);

    const buttons = payload.components.at(-1).toJSON().components;
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.emoji?.id)).toBe(true);
  });
});
