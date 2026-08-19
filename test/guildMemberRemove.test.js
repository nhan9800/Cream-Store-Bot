import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import { buildGoodbyeV2 } from '../src/events/guildMemberRemove.js';

describe('compact farewell card', () => {
  it('keeps the farewell concise and uses the new branded visual', () => {
    const payload = buildGoodbyeV2({
      guildId: '1282637033340403754',
      userId: '123456789012345678',
      displayName: 'Cenar Member',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
      joinedDays: 42,
      bannerUrl: 'attachment://cenar-farewell-portal-v2.png',
    });
    const json = payload.components[0].toJSON();
    const serialized = JSON.stringify(json);
    const visibleText = json.components
      .flatMap((component) => component.components || [component])
      .filter((component) => component.type === 10)
      .map((component) => component.content)
      .join('\n');

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(visibleText).toContain('Tạm biệt, Cenar Member');
    expect(visibleText).toContain('42 ngày');
    expect(visibleText).not.toContain('Dấu ấn để lại');
    expect(serialized).toContain('attachment://cenar-farewell-portal-v2.png');
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });
});
