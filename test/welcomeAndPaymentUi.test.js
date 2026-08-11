import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import { buildWelcomeChatV2 } from '../src/events/guildMemberAdd.js';
import { buildPaymentReminderV2 } from '../src/services/ticketAutoCloseService.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;
const RAW_EMOJI_NAME = /(^|[^<a]):[a-zA-Z0-9_]+:/;

function textContent(payload) {
  return payload.components
    .flatMap((component) => component.toJSON().components || [])
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');
}

function expectCustomEmojiOnly(payload) {
  const content = textContent(payload);
  expect(content).not.toMatch(NATIVE_EMOJI);
  expect(content).not.toMatch(RAW_EMOJI_NAME);
  expect(content).toMatch(/<a?:[a-zA-Z0-9_]+:\d+>/);
  return content;
}

describe('welcome and payment Components V2', () => {
  it('renders the compact member welcome without stale raw emoji names', () => {
    const payload = buildWelcomeChatV2({
      guildId: '1070676180103086132',
      userId: '123456789012345678',
      brandName: 'Cenar Store',
      memberCount: 1323,
      verifyChannelId: '1535880000000000000',
    });

    const content = expectCustomEmojiOnly(payload);
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.allowedMentions).toEqual({ users: ['123456789012345678'] });
    expect(content).toContain('WELCOME TO CENAR GLOBAL');
    expect(content).toContain('<#1535880000000000000>');
    expect(content).not.toContain(':purple_heart_glow:');
    expect(content).not.toContain(':muiten:');
  });

  it.each([
    ['first', 'PAYMENT REMINDER • 1/2', '20 minutes'],
    ['final', 'PAYMENT REMINDER • FINAL NOTICE', '10 minutes'],
  ])('renders the %s payment reminder with an explicit deadline', (stage, heading, deadline) => {
    const payload = buildPaymentReminderV2({
      guildId: '1070676180103086132',
      customerId: '123456789012345678',
      orderCode: 'CN_213802',
      stage,
    });

    const content = expectCustomEmojiOnly(payload);
    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(content).toContain(heading);
    expect(content).toContain('CN_213802');
    expect(content).toContain(deadline);
    expect(content).not.toMatch(/(<a?:[^>]+>){2,}/);
  });
});
