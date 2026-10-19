import { describe, expect, it } from 'vitest';
import { Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { shouldSkipRepeatWelcome } from '../src/events/guildMemberAdd.js';

const GUILD_ID = '1282637033340403754';
const EXPLORER_ID = '1282638730812854345';

function makeMember({ verified = false } = {}) {
  const explorer = {
    id: EXPLORER_ID,
    name: '⌘ Cenar Explorer',
    managed: false,
    position: 5,
    permissions: new PermissionsBitField(67108864n),
  };
  return {
    guild: {
      id: GUILD_ID,
      roles: { cache: new Collection([[EXPLORER_ID, explorer]]) },
      members: {
        me: {
          permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
          roles: { highest: { position: 37 } },
        },
      },
    },
    roles: { cache: new Collection(verified ? [[EXPLORER_ID, explorer]] : []) },
  };
}

describe('guild member welcome guard', () => {
  it('skips repeat welcome messages for a member who already verified', () => {
    expect(shouldSkipRepeatWelcome(makeMember({ verified: true }))).toBe(true);
  });

  it('keeps the welcome flow for an unverified member', () => {
    expect(shouldSkipRepeatWelcome(makeMember())).toBe(false);
  });
});
