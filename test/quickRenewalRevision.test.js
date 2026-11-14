import fs from 'node:fs';
import { Collection } from 'discord.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.quick-renewal-revision-test-absent',
  DATABASE_PATH: `./data/test-quick-renewal-revision-${process.pid}-${Date.now()}.sqlite`,
  ENCRYPTION_KEY: 'synthetic-quick-renewal-revision-key',
}));
vi.mock('../src/utils/permissions.js', () => ({ isManager: () => true }));
vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: () => {
    const E = slot => `<:${slot}:1234567890123456789>`;
    E.component = slot => ({ name: slot, id: '1234567890123456789' });
    return E;
  },
  withButtonEmoji: (button, emoji) => button.setEmoji(emoji),
}));

import { db, initDatabase } from '../src/database/db.js';
import {
  createYoutubeMembership, createYoutubeSource, getYoutubeMembership,
  markYoutubeCyclePaid, updateYoutubeMembership,
} from '../src/services/youtubeRenewalService.js';
import {
  createSpotifyFamily, getSpotifyFamily, markSpotifyFamilyRenewed, updateSpotifyFamily,
} from '../src/services/spotifyFamilyService.js';
import { buildYoutubeRenewalPanel, handleYoutubeRenewalButton } from '../src/services/youtubeRenewalReminderService.js';
import { buildSpotifyFamilyPanel, handleSpotifyFamilyButton } from '../src/services/spotifyFamilyReminderService.js';

const guildId = 'test-quick-renewal-revision';
let source;
beforeAll(() => {
  initDatabase();
  source = createYoutubeSource({ guildId, name: 'Synthetic source', defaultCycleCost: 30000 });
});
afterAll(() => {
  const file = db.name;
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
});

function youtube() {
  return createYoutubeMembership({
    guildId, sourceId: source.id, customerGmail: 'quick-fixture@example.com',
    totalMonths: 6, paidCycles: 1, startedAt: '2026-01-31T10:00:00.000Z',
  });
}
function spotify() {
  return createSpotifyFamily({
    guildId, name: 'Synthetic Family', loginEmail: 'family-fixture@example.com',
    loginPassword: 'synthetic-only-password', cycleStartedAt: '2026-01-31T10:00:00.000Z',
  });
}
function buttonId(payload, prefix) {
  const found = [];
  const visit = value => {
    const item = value?.toJSON?.() || value;
    if (item.custom_id?.startsWith(prefix)) found.push(item.custom_id);
    for (const child of item.components || []) visit(child);
  };
  for (const component of payload.components) visit(component);
  expect(found).toHaveLength(1);
  return found[0];
}
function interaction(customId) {
  return {
    isButton: () => true, customId, guildId, member: { roles: { cache: new Collection() } },
    user: { id: '123456789012345678' }, message: { id: '123456789012345679' },
    update: vi.fn(async () => {}), reply: vi.fn(async () => {}),
  };
}

describe('quick renewal panels bind the displayed obligation', () => {
  it('records one YouTube payment for a repeated click on the same panel and permits a fresh panel for the next cycle', async () => {
    const created = youtube();
    const oldId = buttonId(buildYoutubeRenewalPanel(created), 'ytrenew:paid:');
    await handleYoutubeRenewalButton(interaction(oldId));
    const duplicate = interaction(oldId);
    await handleYoutubeRenewalButton(duplicate);
    const current = getYoutubeMembership(created.id);
    expect(current.paidCycles).toBe(2);
    expect(current.history.filter(event => event.eventType === 'PAYMENT')).toHaveLength(1);
    expect(duplicate.reply).toHaveBeenCalled();
    const freshId = buttonId(buildYoutubeRenewalPanel(current), 'ytrenew:paid:');
    await handleYoutubeRenewalButton(interaction(freshId));
    expect(getYoutubeMembership(created.id).paidCycles).toBe(3);
  });

  it('records one Spotify renewal for a repeated old panel and permits the next panel', async () => {
    const created = spotify();
    const oldId = buttonId(buildSpotifyFamilyPanel(created), 'spotifyfam:renew:');
    await handleSpotifyFamilyButton(interaction(oldId));
    const duplicate = interaction(oldId);
    await handleSpotifyFamilyButton(duplicate);
    const current = getSpotifyFamily(created.id);
    expect(current.timesRenewed).toBe(1);
    expect(duplicate.reply).toHaveBeenCalled();
    await handleSpotifyFamilyButton(interaction(buttonId(buildSpotifyFamilyPanel(current), 'spotifyfam:renew:')));
    expect(getSpotifyFamily(created.id).timesRenewed).toBe(2);
  });

  it('rejects old due dates even when an operator keeps the same revision', async () => {
    const y = youtube();
    const s = spotify();
    const youtubeId = buttonId(buildYoutubeRenewalPanel(y), 'ytrenew:paid:');
    const spotifyId = buttonId(buildSpotifyFamilyPanel(s), 'spotifyfam:renew:');
    updateYoutubeMembership(y.id, { nextSourcePaymentAt: '2026-03-02T10:00:00.000Z' });
    updateSpotifyFamily(s.id, { nextRenewalAt: '2026-03-02T10:00:00.000Z' });
    await handleYoutubeRenewalButton(interaction(youtubeId));
    await handleSpotifyFamilyButton(interaction(spotifyId));
    expect(getYoutubeMembership(y.id).paidCycles).toBe(1);
    expect(getSpotifyFamily(s.id).timesRenewed).toBe(0);
  });

  it('holds unversioned legacy mutation buttons and tells the operator to refresh', async () => {
    const y = youtube();
    const s = spotify();
    const yt = interaction(`ytrenew:paid:${y.id}`);
    const sp = interaction(`spotifyfam:renew:${s.id}`);
    await handleYoutubeRenewalButton(yt);
    await handleSpotifyFamilyButton(sp);
    expect(getYoutubeMembership(y.id).paidCycles).toBe(1);
    expect(getSpotifyFamily(s.id).timesRenewed).toBe(0);
    expect(yt.reply).toHaveBeenCalled();
    expect(sp.reply).toHaveBeenCalled();
  });

  it('rejects old source/cost and Family payment settings without changing the displayed due or counter', async () => {
    const y = youtube();
    const s = spotify();
    const youtubeId = buttonId(buildYoutubeRenewalPanel(y), 'ytrenew:paid:');
    const spotifyId = buttonId(buildSpotifyFamilyPanel(s), 'spotifyfam:renew:');
    const otherSource = createYoutubeSource({ guildId, name: 'Other synthetic source', defaultCycleCost: 50000 });
    updateYoutubeMembership(y.id, { sourceId: otherSource.id, sourceCostPerCycle: 50000 });
    updateSpotifyFamily(s.id, { renewalCost: 75000, paymentCardLabel: 'Changed synthetic payment setting' });
    expect(getYoutubeMembership(y.id)).toMatchObject({ paidCycles: y.paidCycles, nextSourcePaymentAt: y.nextSourcePaymentAt });
    expect(getSpotifyFamily(s.id)).toMatchObject({ timesRenewed: s.timesRenewed, nextRenewalAt: s.nextRenewalAt });
    await handleYoutubeRenewalButton(interaction(youtubeId));
    await handleSpotifyFamilyButton(interaction(spotifyId));
    expect(getYoutubeMembership(y.id).paidCycles).toBe(1);
    expect(getYoutubeMembership(y.id).history.filter(event => event.eventType === 'PAYMENT')).toHaveLength(0);
    expect(getSpotifyFamily(s.id).timesRenewed).toBe(0);
  });

  it('does not invalidate a panel when only its reminder receipt is saved', async () => {
    const y = youtube();
    const s = spotify();
    db.prepare('UPDATE youtube_memberships SET reminder_sent_at=?,updated_at=? WHERE id=?')
      .run('2026-02-01T10:00:00Z', '2026-02-01T10:00:00Z', y.id);
    db.prepare('UPDATE spotify_families SET reminder_sent_at=?,updated_at=? WHERE id=?')
      .run('2026-02-01T10:00:00Z', '2026-02-01T10:00:00Z', s.id);
    expect(getYoutubeMembership(y.id).renewalVersion).toBe(y.renewalVersion);
    expect(getSpotifyFamily(s.id).renewalVersion).toBe(s.renewalVersion);
  });

  it('holds a payment calculated before another writer extends the sold duration', () => {
    const y = createYoutubeMembership({ guildId, sourceId: source.id, customerGmail: 'race-fixture@example.com',
      totalMonths: 2, paidCycles: 1, startedAt: '2026-01-31T10:00:00.000Z' });
    const originalTransaction = db.transaction.bind(db);
    const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(callback => {
      const actual = originalTransaction(callback);
      const wrapped = (...args) => actual(...args);
      wrapped.immediate = (...args) => {
        // Model another SQLite writer committing after the initial read and
        // before this operation acquires its write lock.
        db.prepare('UPDATE youtube_memberships SET total_months=4 WHERE id=?').run(y.id);
        return actual.immediate(...args);
      };
      return wrapped;
    });
    try {
      expect(() => markYoutubeCyclePaid(y.id)).toThrow(expect.objectContaining({ code: 'YOUTUBE_RENEWAL_CONFLICT' }));
    } finally { spy.mockRestore(); }
    expect(getYoutubeMembership(y.id)).toMatchObject({ totalMonths: 4, paidCycles: 1, remainingCycles: 3,
      nextSourcePaymentAt: y.nextSourcePaymentAt });
    expect(getYoutubeMembership(y.id).history.filter(event => event.eventType === 'PAYMENT')).toHaveLength(0);
  });

  it('keeps explicit manual service calls available and rejects a stale expected revision', () => {
    const y = youtube();
    const s = spotify();
    markYoutubeCyclePaid(y.id);
    markSpotifyFamilyRenewed(s.id);
    expect(() => markYoutubeCyclePaid(y.id, { expectedPaidCycles: 1, expectedNextPaymentAt: y.nextSourcePaymentAt }))
      .toThrow();
    expect(() => markSpotifyFamilyRenewed(s.id, { expectedTimesRenewed: 0, expectedNextRenewalAt: s.nextRenewalAt }))
      .toThrow();
    expect(getYoutubeMembership(y.id).paidCycles).toBe(2);
    expect(getSpotifyFamily(s.id).timesRenewed).toBe(1);
  });
});
