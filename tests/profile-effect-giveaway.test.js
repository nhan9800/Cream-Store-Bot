import { describe, expect, it, vi } from 'vitest';
import {
  PROFILE_EFFECT_GIVEAWAY,
  buildProfileEffectGiveawayPayload,
} from '../src/campaigns/profileEffectGiveaway2026.js';
import {
  GIVEAWAY_PROOF,
  buildGiveawayProofPanel,
  handleGiveawayProofMessage,
  isGiveawayProofChannel,
  isImageProofMessage,
} from '../src/services/giveawayProofService.js';

function proofChannel() {
  return {
    guildId: GIVEAWAY_PROOF.guildId,
    name: GIVEAWAY_PROOF.channelName,
  };
}

describe('Profile Effect 66K giveaway', () => {
  it('publishes the banner, exact bio/link requirement and join button', () => {
    const payload = buildProfileEffectGiveawayPayload({
      hostUserId: '1138315103821889566',
      proofChannelId: '1550000000000000000',
      endTime: new Date('2026-09-19T16:59:59.000Z'),
    });
    const json = JSON.stringify(payload.components.map((component) => component.toJSON()));
    expect(json).toContain(PROFILE_EFFECT_GIVEAWAY.marker);
    expect(json).toContain(GIVEAWAY_PROOF.requiredBio);
    expect(json).toContain('1550000000000000000');
    expect(json).toContain('giveaway:join');
    expect(payload.files[0].name).toBe(PROFILE_EFFECT_GIVEAWAY.attachmentName);
  });

  it('builds a pinned-channel guide with privacy and duration warnings', () => {
    const json = JSON.stringify(buildGiveawayProofPanel().components.map((component) => component.toJSON()));
    expect(json).toContain(GIVEAWAY_PROOF.panelMarker);
    expect(json).toContain(GIVEAWAY_PROOF.inviteUrl);
    expect(json).toContain('trong suốt thời gian giveaway');
    expect(json).toContain('không đăng mật khẩu, OTP');
  });

  it('recognizes only image proofs in the dedicated channel', () => {
    const imageMessage = {
      channel: proofChannel(),
      attachments: new Map([['1', { name: 'profile.png', contentType: 'image/png' }]]),
    };
    expect(isGiveawayProofChannel(imageMessage.channel)).toBe(true);
    expect(isImageProofMessage(imageMessage)).toBe(true);
    expect(isImageProofMessage({ ...imageMessage, attachments: new Map() })).toBe(false);
    expect(isGiveawayProofChannel({ ...proofChannel(), name: 'general' })).toBe(false);
  });

  it('reacts with the custom campaign emoji when a member sends an image', async () => {
    const react = vi.fn().mockResolvedValue(undefined);
    const message = {
      id: 'message-1',
      guildId: GIVEAWAY_PROOF.guildId,
      guild: {
        id: GIVEAWAY_PROOF.guildId,
        emojis: { cache: { find: (predicate) => predicate({ name: GIVEAWAY_PROOF.reactionEmojiName }) ? { id: 'emoji-1', name: GIVEAWAY_PROOF.reactionEmojiName } : null } },
      },
      channel: proofChannel(),
      attachments: new Map([['1', { name: 'profile.webp', contentType: 'image/webp' }]]),
      react,
    };
    await expect(handleGiveawayProofMessage(message)).resolves.toBe(true);
    expect(react).toHaveBeenCalledWith('emoji-1');
  });
});
