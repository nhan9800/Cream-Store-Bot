import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { MEMBER_ROLES } from '../src/config/membershipProgram.js';
import { memberHasVerificationRole, resolveVerificationRole } from '../src/services/verificationRoleService.js';

const EXPLORER_ID = '1282638730812854345';
const GUILD_ID = '1282637033340403754';
let roleSequence = 0;

function role(name, overrides = {}) {
  roleSequence += 1;
  return {
    id: String(900000000000000000n + BigInt(roleSequence)), name,
    managed: false, position: 5, permissions: new PermissionsBitField(0n),
    ...overrides,
  };
}

function guild(roles, bot = {}) {
  return {
    id: GUILD_ID,
    roles: { cache: new Collection(roles.map((item) => [item.id, item])) },
    members: { me: {
      permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
      roles: { highest: { position: 37 } },
      ...bot,
    } },
  };
}

beforeEach(() => vi.stubEnv('VERIFIED_ROLE_ID', ''));
afterEach(() => vi.unstubAllEnvs());

describe('verification role resolution', () => {
  it('finds the actual renamed Cenar Circle Explorer role using its stable ID', () => {
    const explorer = role('⌘ Cenar Explorer', {
      id: EXPLORER_ID,
      permissions: new PermissionsBitField(67108864n),
    });
    expect(resolveVerificationRole(guild([role('Cenar Patron'), explorer]))).toBe(explorer);
  });

  it.each([
    'Cenar Member', '🧭・Cenar Explorer', '<:badge:123456789012345678> ｜ Explorer',
    '✅ Verified Member', '🔐・Xác Minh', '✦ Thành Viên',
  ])('recognizes the exact decorated alias %s in another guild', (name) => {
    const memberRole = role(name);
    expect(resolveVerificationRole(guild([memberRole]))).toBe(memberRole);
  });

  it.each(['Staff Member', 'VIP Member', 'Unverified Member', 'Customer Verified', 'Bot Member', 'Active Customer', 'Cenar Patron'])('does not infer verification from %s', (name) => {
    expect(resolveVerificationRole(guild([role(name)]))).toBeNull();
  });

  it('rejects all stable buyer role IDs even when renamed to a valid alias', () => {
    for (const tier of MEMBER_ROLES.filter((item) => item.key !== 'explorer')) {
      expect(resolveVerificationRole(guild([role('Verified', { id: tier.id })]))).toBeNull();
    }
  });

  it.each([
    PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.BanMembers, PermissionFlagsBits.ManageWebhooks,
    PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.MentionEveryone,
  ])('rejects a verification alias with elevated permission %s', (permission) => {
    const unsafe = role('Verified', { permissions: new PermissionsBitField(permission) });
    expect(resolveVerificationRole(guild([unsafe]))).toBeNull();
    vi.stubEnv('VERIFIED_ROLE_ID', unsafe.id);
    expect(resolveVerificationRole(guild([unsafe]))).toBeNull();
  });

  it('rejects everyone and managed roles, including explicit configuration', () => {
    for (const unsafe of [role('Verified', { id: GUILD_ID }), role('Verified', { managed: true })]) {
      vi.stubEnv('VERIFIED_ROLE_ID', unsafe.id);
      expect(resolveVerificationRole(guild([unsafe]))).toBeNull();
    }
  });

  it('fails closed for an invalid explicit role instead of falling back to a name', () => {
    const fallback = role('Cenar Member');
    vi.stubEnv('VERIFIED_ROLE_ID', '900000000000009999');
    expect(resolveVerificationRole(guild([fallback]))).toBeNull();
  });

  it('accepts an explicitly configured safe custom role but rejects buyer labels', () => {
    const custom = role('Community Access');
    vi.stubEnv('VERIFIED_ROLE_ID', custom.id);
    expect(resolveVerificationRole(guild([custom, role('Cenar Member')]))).toBe(custom);
    for (const name of ['Cenar Select', 'VIP Buyer', 'Khách Hàng', 'Active Customer']) {
      const buyer = role(name, { id: custom.id });
      expect(resolveVerificationRole(guild([buyer]))).toBeNull();
    }
  });

  it('rejects roles above or equal to the bot and bots lacking ManageRoles', () => {
    const candidate = role('Cenar Member');
    expect(resolveVerificationRole(guild([candidate], { permissions: new PermissionsBitField(0n) }))).toBeNull();
    expect(resolveVerificationRole(guild([candidate], { roles: { highest: { position: 5 } } }))).toBeNull();
    expect(resolveVerificationRole(guild([candidate], { roles: { highest: { comparePositionTo: () => -1 } } }))).toBeNull();
    expect(resolveVerificationRole(guild([role('Cenar Member', { editable: false })]))).toBeNull();
  });

  it('keeps setup compatibility for a known safe cached role without optional member metadata', () => {
    const memberRole = role('Cenar Member');
    const setupGuild = guild([memberRole]);
    delete setupGuild.members;
    expect(resolveVerificationRole(setupGuild)).toBe(memberRole);
  });

  it('counts only the resolved verification role on a member', () => {
    const verified = role('Cenar Member');
    const purchaser = role('Cenar Patron');
    const member = { roles: { cache: new Collection([[purchaser.id, purchaser]]) } };
    expect(memberHasVerificationRole(member, verified)).toBe(false);
    member.roles.cache.set(verified.id, verified);
    expect(memberHasVerificationRole(member, verified)).toBe(true);
    expect(memberHasVerificationRole(member, null)).toBe(false);
  });
});
