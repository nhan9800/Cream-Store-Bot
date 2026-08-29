import { describe, expect, it } from 'vitest';
import {
  YOUTUBE_FAMILY_POLICY_UPDATE,
  buildYoutubeFamilyPolicyContent,
} from '../src/campaigns/youtubeFamilyPolicyUpdate2026.js';

const E = (slot) => `<:cenar_${slot}:1535618654358736926>`;

describe('YouTube Family policy announcement', () => {
  it('states the official household checks without claiming IP is the only signal', () => {
    const content = buildYoutubeFamilyPolicyContent(
      YOUTUBE_FAMILY_POLICY_UPDATE.guildId,
      E,
    );

    expect(content).toContain('cùng địa chỉ cư trú');
    expect(content).toContain('kiểm tra điện tử mỗi 30 ngày');
    expect(content).toContain('YouTube không công bố toàn bộ tín hiệu kỹ thuật');
    expect(content).toContain('không nên hiểu rằng YouTube chỉ kiểm tra duy nhất địa chỉ IP');
  });

  it('includes the customer action plan and warranty commitment', () => {
    const content = buildYoutubeFamilyPolicyContent(
      YOUTUBE_FAMILY_POLICY_UPDATE.guildId,
      E,
    );

    expect(content).toContain('Không tự rời nhóm gia đình');
    expect(content).toContain('xử lý bảo hành trong tuần này');
    expect(content).toContain('không bỏ mặc đơn hàng');
    expect(content).toContain(YOUTUBE_FAMILY_POLICY_UPDATE.marker);
  });
});
