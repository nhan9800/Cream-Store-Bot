import { beforeAll, describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  createOAuthState,
  parseCookieHeader,
  verifyOAuthState,
} from '../src/utils/oauthState.js';
import {
  buildVerificationPanelV2,
  buildVerificationPromptV2,
  buildVerificationSuccessDmV2,
  buildVerificationUnavailableV2,
} from '../src/services/verificationPanelService.js';
import { resolveVerificationRole } from '../src/services/verificationRoleService.js';

const GUILD_ID = '1282637033340403754';
const DEFAULT_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

function serializedText(payload) {
  return JSON.stringify(payload.components.map((component) => component.toJSON()));
}

describe('OAuth recovery security', () => {
  beforeAll(() => {
    process.env.OAUTH_STATE_SECRET = 'test-oauth-state-secret-that-is-long-and-isolated';
  });

  it('binds a short-lived signed state to the same browser cookie', () => {
    const now = 1_800_000_000_000;
    const state = createOAuthState(GUILD_ID, now);
    const payload = verifyOAuthState(state, state, now + 1_000);
    expect(payload.guildId).toBe(GUILD_ID);
    expect(payload.exp).toBeGreaterThan(now);
    expect(() => verifyOAuthState(state, 'different-cookie', now + 1_000)).toThrow(/trình duyệt/i);
    expect(() => verifyOAuthState(state, state, now + 11 * 60 * 1_000)).toThrow(/hết hạn/i);
  });

  it('parses encoded state cookies without accepting malformed fragments', () => {
    expect(parseCookieHeader('theme=dark; cenar_state=a%2Eb; broken')).toEqual({
      theme: 'dark',
      cenar_state: 'a.b',
    });
  });
});

describe('verification Components V2', () => {
  it('uses a compact custom-emoji-only public panel', () => {
    const panel = buildVerificationPanelV2(GUILD_ID, 'Cenar Store');
    expect(panel.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(serializedText(panel)).not.toMatch(DEFAULT_EMOJI);
    expect(serializedText(panel)).toContain('Xác Minh & Bật Khôi Phục');
  });

  it('renders both the consent prompt and success DM as Components V2', () => {
    const prompt = buildVerificationPromptV2({
      guildId: GUILD_ID,
      username: 'tester',
      loginUrl: 'https://cenarstore.xyz/oauth/login?guild_id=1282637033340403754',
    });
    const dm = buildVerificationSuccessDmV2({
      guildId: GUILD_ID,
      guildName: 'Cenar Store',
      roleName: 'Cenar Member',
    });
    expect(prompt.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(dm.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(serializedText(prompt)).not.toMatch(DEFAULT_EMOJI);
    expect(serializedText(dm)).not.toMatch(DEFAULT_EMOJI);
    expect(serializedText(buildVerificationUnavailableV2(GUILD_ID))).not.toMatch(DEFAULT_EMOJI);
  });

  it('states that no verification role is granted before the OAuth callback', () => {
    const prompt = buildVerificationPromptV2({
      guildId: GUILD_ID,
      username: 'tester',
      loginUrl: 'https://cenarstore.xyz/oauth/login?guild_id=1282637033340403754',
      hasRole: false,
      recoveryActive: false,
    });
    const text = serializedText(prompt);
    expect(text).toContain('BƯỚC 1/2 • CHỜ XÁC NHẬN OAUTH');
    expect(text).toContain('chưa cấp vai trò xác minh');
    expect(text).toContain('Xác Minh Với Discord');
    expect(text).not.toContain('HOÀN TẤT XÁC MINH DISCORD');
  });

  it('does not confuse the customer Patron role with the verification role', () => {
    const roles = [
      { id: '1282637103045279820', name: 'Cenar Patron', managed: false },
      { id: '1282638730812854345', name: 'Cenar Member', managed: false },
    ];
    const guild = {
      roles: {
        cache: {
          get: (id) => roles.find((role) => role.id === id),
          find: (predicate) => roles.find(predicate),
        },
      },
    };

    expect(resolveVerificationRole(guild)?.name).toBe('Cenar Member');
  });
});
