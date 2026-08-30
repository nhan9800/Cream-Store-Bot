import { describe, expect, test } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  PARTNER_NATIONAL_DAY_UPDATE,
  buildPartnerNationalDayAnnouncement,
  buildPartnerNationalDayContent,
} from '../src/campaigns/partnerNationalDayUpdate2026.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

describe('partner and National Day announcement', () => {
  test('contains all approved commercial details with custom emoji presentation', () => {
    const content = buildPartnerNationalDayContent();
    const payload = buildPartnerNationalDayAnnouncement();
    const serialized = JSON.stringify(payload.components.map((component) => component.toJSON()));

    expect(content).toContain(PARTNER_NATIONAL_DAY_UPDATE.marker);
    expect(content).toContain('1.000 thành viên');
    expect(content).toContain('4 slot Netflix 4K Private');
    expect(content).toContain('35.000đ / 1 tháng');
    expect(content).toContain('Sale Quốc khánh 2/9');
    expect(content).not.toMatch(NATIVE_EMOJI);
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.allowedMentions.parse).toContain('everyone');
    expect(serialized).toContain(PARTNER_NATIONAL_DAY_UPDATE.marker);
  });
});
