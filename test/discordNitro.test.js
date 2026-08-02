import { describe, expect, it } from 'vitest';
import { getMemberNitroEligibility } from '../src/utils/discordNitro.js';

function member({ premiumSince = null, roles = [] } = {}) {
  const cache = new Map(roles.map((role) => [role.id, role]));
  return { premiumSince, roles: { cache } };
}

describe('Discord Nitro member eligibility', () => {
  it('recognizes an active server boost', () => {
    expect(getMemberNitroEligibility(member({ premiumSince: new Date() }))).toEqual({
      hasNitroBoost: true,
      source: 'premium-since',
    });
  });

  it('recognizes configured and standard Nitro roles', () => {
    expect(getMemberNitroEligibility(member({ roles: [{ id: 'nitro-role', name: 'VIP' }] }), ['nitro-role']).hasNitroBoost).toBe(true);
    expect(getMemberNitroEligibility(member({ roles: [{ id: 'role-2', name: 'Server Booster' }] }))).toEqual({
      hasNitroBoost: true,
      source: 'named-role',
    });
  });

  it('does not infer Nitro from unrelated roles', () => {
    expect(getMemberNitroEligibility(member({ roles: [{ id: 'owner', name: 'Owner' }] }))).toEqual({
      hasNitroBoost: false,
      source: 'none',
    });
  });
});
