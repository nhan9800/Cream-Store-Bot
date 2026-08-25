import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  CUSTOM_SERVICES_LAUNCH,
  buildCustomServicesLaunchPayload,
  isCustomServicesLaunchMessage,
} from '../src/campaigns/customServicesLaunch2026.js';

function serialize(payload) {
  return JSON.stringify({
    ...payload,
    components: payload.components.map((component) => component.toJSON()),
  });
}

describe('Cenar custom services launch 2026', () => {
  it('publishes a custom-emoji Components V2 launch with the complete offer', () => {
    const payload = buildCustomServicesLaunchPayload();
    const json = serialize(payload);

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.components).toHaveLength(6);
    expect(payload.allowedMentions.parse).toContain('everyone');
    expect(payload.allowedMentions.roles).toEqual(CUSTOM_SERVICES_LAUNCH.audienceRoleIds);
    expect(json).toContain(CUSTOM_SERVICES_LAUNCH.marker);
    expect(json).toContain('hosting bot 24/7 trong 3 tháng đầu');
    expect(json).toContain('giá nguồn cho reseller/store khác');
    expect(json).toContain('Bot booking');
    expect(json).toContain('Bot bảng giá / bot store');
    expect(json).toContain('Website đầy đủ');
    expect(json).toContain('500.000đ');
    expect(json).toContain('750.000đ');
    expect(json).toContain('1.000.000đ');
    expect(json).toContain('BOT RESCUE & UI');
    expect(json).toContain('Components V2 + emoji custom');
    expect(json).toContain('cenar_announce');
    expect(json).toContain('cenar_admin');
    expect(json).toContain('cenar_shop');
    expect(json).toContain('cenar_warranty_shield');
    expect((json.match(/<a?:[A-Za-z0-9_]+:\d+>/g) || []).length).toBeGreaterThan(15);

    const textCharacters = payload.components
      .map((component) => component.toJSON())
      .flatMap((component) => component.components || [])
      .filter((component) => component.type === 10)
      .reduce((total, component) => total + component.content.length, 0);
    expect(textCharacters).toBeLessThanOrEqual(3_800);
  });

  it('recognizes only the current launch panel written by this bot', () => {
    const payload = buildCustomServicesLaunchPayload();
    const message = {
      author: { id: 'bot-1' },
      components: payload.components.map((component) => component.toJSON()),
    };

    expect(isCustomServicesLaunchMessage(message, 'bot-1')).toBe(true);
    expect(isCustomServicesLaunchMessage(message, 'bot-2')).toBe(false);
  });
});
