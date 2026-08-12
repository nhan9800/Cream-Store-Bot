import { describe, expect, test } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  classifyScamOcrText,
  isAllowedDiscordMediaUrl,
  isScannableImageAttachment,
  normalizeScamVisionResult,
  shouldEnforceScamVerdict,
} from '../src/utils/antiScam.js';
import {
  buildScamPublicNoticeV2,
  buildScamRecoveryDmV2,
} from '../src/services/scamProtectionService.js';
import { STORE_ONE_GUILD_ID } from '../src/utils/locale.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

describe('Store 1 scam image protection', () => {
  test('accepts Discord CDN images and rejects arbitrary remote URLs', () => {
    expect(isAllowedDiscordMediaUrl('https://cdn.discordapp.com/attachments/1/2/scam.png')).toBe(true);
    expect(isAllowedDiscordMediaUrl('https://media.discordapp.net/attachments/1/2/scam.webp')).toBe(true);
    expect(isAllowedDiscordMediaUrl('https://evil.example/steal.png')).toBe(false);
    expect(isScannableImageAttachment({
      url: 'https://cdn.discordapp.com/attachments/1/2/photo.png',
      contentType: 'image/png',
      name: 'photo.png',
      size: 500_000,
    })).toBe(true);
  });

  test('enforces only high-confidence scam verdicts with concrete evidence', () => {
    const scam = normalizeScamVisionResult({
      decision: 'SCAM',
      confidence: 0.96,
      category: 'MRBEAST_CRYPTO_GIVEAWAY',
      signals: ['MrBeast impersonation', 'Activate code for bonus', 'Withdrawal success bait'],
      visibleText: 'Activate Code for Bonus',
      reason: 'Fake crypto promotion',
    });
    expect(shouldEnforceScamVerdict(scam, 0.9)).toBe(true);
    expect(shouldEnforceScamVerdict({ ...scam, confidence: 0.72 }, 0.9)).toBe(false);
    expect(shouldEnforceScamVerdict({ ...scam, decision: 'UNCERTAIN' }, 0.9)).toBe(false);
    expect(shouldEnforceScamVerdict({ ...scam, signals: [] }, 0.9)).toBe(false);
  });

  test('detects the illustrated MrBeast crypto lure from locally extracted text', () => {
    const result = classifyScamOcrText(`
      MrBeast Giveaway — giving away $3,500 to everyone who registers
      Activate Code for Bonus
      Deposit  Withdraw  Bonuses  Verification
      Rakeback  Cryptocurrency casino
      Withdrawal Successful
    `, 67);

    expect(result.decision).toBe('SCAM');
    expect(result.category).toBe('MRBEAST_CRYPTO_GIVEAWAY');
    expect(result.confidence).toBeGreaterThanOrEqual(0.98);
    expect(shouldEnforceScamVerdict(result, 0.9)).toBe(true);
  });

  test('does not delete ordinary MrBeast discussion or normal store receipts', () => {
    const fanContent = classifyScamOcrText('MrBeast fan art and video thumbnail discussion', 92);
    const receipt = classifyScamOcrText('Cenar Store order completed. Total 300000 VND. Thank you.', 91);

    expect(shouldEnforceScamVerdict(fanContent, 0.9)).toBe(false);
    expect(shouldEnforceScamVerdict(receipt, 0.9)).toBe(false);
  });

  test('builds custom-emoji-only public and recovery interfaces without banning', () => {
    const publicNotice = buildScamPublicNoticeV2({
      guildId: STORE_ONE_GUILD_ID,
      userId: '123456789012345678',
      timeoutApplied: true,
      quarantineMinutes: 30,
    });
    const recovery = buildScamRecoveryDmV2({
      guildId: STORE_ONE_GUILD_ID,
      quarantineMinutes: 30,
    });
    const publicJson = JSON.stringify(publicNotice.components.map((component) => component.toJSON()));
    const recoveryJson = JSON.stringify(recovery.components.map((component) => component.toJSON()));

    expect(publicNotice.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(recovery.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(publicJson).toContain('không mặc định coi là người lừa đảo');
    expect(recoveryJson).toContain('không bị ban khỏi server');
    expect(publicJson).not.toMatch(NATIVE_EMOJI);
    expect(recoveryJson).not.toMatch(NATIVE_EMOJI);
    const buttons = recovery.components[1].toJSON().components;
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.style === 5 && button.emoji?.id)).toBe(true);
  });
});
