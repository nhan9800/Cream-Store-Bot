import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  CUSTOM_SERVICES_EMOJIS,
  CUSTOM_SERVICES_LAUNCH,
  buildCustomServicesLaunchPayload,
  isCustomServicesLaunchMessage,
} from '../src/campaigns/customServicesLaunch2026.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

const customEmojis = Object.fromEntries(CUSTOM_SERVICES_EMOJIS.map((asset, index) => {
  const id = String(100000000000000001n + BigInt(index));
  return [asset.name, {
    text: `<:${asset.name}:${id}>`,
    component: { id, name: asset.name, animated: false },
  }];
}));

function serialize(payload) {
  return JSON.stringify({
    ...payload,
    components: payload.components.map((component) => component.toJSON()),
  });
}

describe('Cenar custom services launch 2026', () => {
  it('publishes a custom-emoji Components V2 launch with the complete offer', () => {
    const payload = buildCustomServicesLaunchPayload({ customEmojis });
    const json = serialize(payload);

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.components).toHaveLength(6);
    expect(payload.allowedMentions.parse).toContain('everyone');
    expect(payload.allowedMentions.roles).toEqual(CUSTOM_SERVICES_LAUNCH.audienceRoleIds);
    expect(json).toContain(CUSTOM_SERVICES_LAUNCH.marker);
    expect(json).toContain('CODE BOT · CODE WEB GIÁ TỐT');
    expect(json).toContain('BẠN CẦN BOT GÌ, CENAR THIẾT KẾ BOT ĐÓ');
    expect(json).toContain('Bot store / bán hàng');
    expect(json).toContain('Bot cộng đồng');
    expect(json).toContain('Bot theo ý tưởng riêng');
    expect(json).toContain('Website custom');
    expect(json).toContain('Tặng hosting bot 24/7 trong 03 tháng đầu');
    expect(json).toContain('500.000đ');
    expect(json).toContain('750.000đ');
    expect(json).toContain('1.000.000đ');
    expect(json).toContain('BOT RESCUE & REDESIGN');
    expect(json).toContain('Components V2 + emoji custom 100%');
    expect(json).toContain('BẢO HÀNH LỖI CODE TRỌN ĐỜI');
    expect(json).toContain('không thuộc bảo hành');
    for (const asset of CUSTOM_SERVICES_EMOJIS) expect(json).toContain(asset.name);
    expect((json.match(/<a?:cenar_dev_[A-Za-z0-9_]+:\d+>/g) || []).length).toBeGreaterThan(15);
    expect(json).not.toMatch(NATIVE_EMOJI);

    const textCharacters = payload.components
      .map((component) => component.toJSON())
      .flatMap((component) => component.components || [])
      .filter((component) => component.type === 10)
      .reduce((total, component) => total + component.content.length, 0);
    expect(textCharacters).toBeLessThanOrEqual(3_800);
  });

  it('can refresh the evergreen announcement without mentioning members again', () => {
    const payload = buildCustomServicesLaunchPayload({
      customEmojis,
      tagEveryone: false,
      tagRoles: false,
    });
    const json = serialize(payload);

    expect(payload.allowedMentions.parse).toEqual([]);
    expect(payload.allowedMentions.roles).toEqual([]);
    expect(json).not.toContain('@everyone');
    for (const roleId of CUSTOM_SERVICES_LAUNCH.audienceRoleIds) {
      expect(json).not.toContain(`<@&${roleId}>`);
    }
  });

  it('recognizes only the current launch panel written by this bot', () => {
    const payload = buildCustomServicesLaunchPayload({ customEmojis });
    const message = {
      author: { id: 'bot-1' },
      components: payload.components.map((component) => component.toJSON()),
    };

    expect(isCustomServicesLaunchMessage(message, 'bot-1')).toBe(true);
    expect(isCustomServicesLaunchMessage(message, 'bot-2')).toBe(false);
  });
});
