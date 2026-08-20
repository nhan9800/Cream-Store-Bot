import { describe, expect, test } from 'vitest';
import { MessageFlags } from 'discord.js';
import { buildSpotifyFamilyPanel } from '../src/services/spotifyFamilyReminderService.js';

describe('Spotify Family Discord panel', () => {
  test('keeps passwords and full card numbers out of channel reminders', () => {
    const payload = buildSpotifyFamilyPanel({
      id: 9,
      guildId: '1282637033340403754',
      name: 'Cenar Fam 09',
      loginEmail: 'owner@example.com',
      loginPassword: 'DO_NOT_SHOW_PASSWORD',
      paymentCardLabel: 'Visa Owner',
      paymentCardNumber: '4111111111111234',
      paymentCardMasked: '•••• 1234',
      renewalCost: 59000,
      totalSlots: 6,
      slotsUsed: 2,
      slotsAvailable: 4,
      daysRemaining: 3,
      overdueDays: 0,
      nextRenewalAt: '2026-08-23T12:00:00.000Z',
      note: 'Kiểm tra số dư.',
      members: [
        { spotifyUsername: 'profile.one', status: 'ACTIVE' },
        { spotifyUsername: 'profile.two', status: 'ACTIVE' },
      ],
    }, { stage: 'DUE_3D' });

    const json = payload.components.map((component) => component.toJSON());
    const serialized = JSON.stringify(json);
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(serialized).toContain('Cenar Fam 09');
    expect(serialized).toContain('•••• 1234');
    expect(serialized).not.toContain('DO_NOT_SHOW_PASSWORD');
    expect(serialized).not.toContain('4111111111111234');
    expect(json[1].components.map((button) => button.custom_id || button.url)).toEqual([
      'spotifyfam:show:9',
      'spotifyfam:renew:9',
      'spotifyfam:snooze:9',
      'https://cenarstore.xyz/admin/spotify-families',
    ]);
  });
});
