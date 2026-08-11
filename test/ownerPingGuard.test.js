import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, initDatabase } from '../src/database/db.js';
import {
  OWNER_PING_PENALTIES_MS,
  OWNER_PING_POLICY_VERSION,
  OWNER_PING_STRIKE_DECAY_MS,
  isDirectOwnerMention,
  registerOwnerPing,
} from '../src/services/ownerPingGuardService.js';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-owner-ping-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-owner-ping-not-present';
  process.env.DATABASE_PATH = relativePath;
  return relativePath;
});

const guildId = 'test_owner_ping_guild';
const userId = 'test_owner_ping_user';
const startedAt = Date.UTC(2026, 7, 9, 1, 0, 0);

describe('owner ping escalation', () => {
  beforeAll(() => initDatabase());

  afterAll(() => {
    db.prepare('DELETE FROM owner_ping_enforcement WHERE guild_id = ?').run(guildId);
    db.close();
    const absolutePath = path.resolve(process.cwd(), testDatabasePath);
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${absolutePath}${suffix}`, { force: true });
  });

  it('allows three direct tags, warns twice, then escalates gently', () => {
    expect(registerOwnerPing(guildId, userId, startedAt)).toMatchObject({ action: 'counted', mentionCount: 1 });
    expect(registerOwnerPing(guildId, userId, startedAt + 1_000)).toMatchObject({ action: 'counted', mentionCount: 2 });
    expect(registerOwnerPing(guildId, userId, startedAt + 2_000)).toMatchObject({ action: 'counted', mentionCount: 3 });
    expect(registerOwnerPing(guildId, userId, startedAt + 3_000)).toMatchObject({ action: 'warning', mentionCount: 4 });
    expect(registerOwnerPing(guildId, userId, startedAt + 4_000)).toMatchObject({ action: 'warning', mentionCount: 5 });
    expect(registerOwnerPing(guildId, userId, startedAt + 5_000)).toMatchObject({
      action: 'timeout',
      mentionCount: 6,
      penaltyLevel: 1,
      timeoutMs: OWNER_PING_PENALTIES_MS[0],
    });
    expect(registerOwnerPing(guildId, userId, startedAt + OWNER_PING_PENALTIES_MS[0] + 6_000)).toMatchObject({
      action: 'timeout',
      mentionCount: 7,
      penaltyLevel: 2,
      timeoutMs: OWNER_PING_PENALTIES_MS[1],
    });
  });

  it('resets both the daily counter and old strikes after 30 clean days', () => {
    const result = registerOwnerPing(
      guildId,
      userId,
      startedAt + OWNER_PING_STRIKE_DECAY_MS + OWNER_PING_PENALTIES_MS[0] + 7_000,
    );
    expect(result).toMatchObject({ action: 'counted', mentionCount: 1, penaltyLevel: 0, timeoutMs: 0 });
  });

  it('resets counters stored by the stricter reply-sensitive policy', () => {
    const legacyUserId = `${userId}_legacy`;
    const nowIso = new Date(startedAt).toISOString();
    db.prepare(`
      INSERT INTO owner_ping_enforcement (
        guild_id, user_id, window_started_at, mention_count, penalty_level,
        last_mention_at, last_penalty_at, updated_at, policy_version
      ) VALUES (?, ?, ?, 9, 4, ?, ?, ?, 1)
    `).run(guildId, legacyUserId, nowIso, nowIso, nowIso, nowIso);

    expect(registerOwnerPing(guildId, legacyUserId, startedAt + 1_000)).toMatchObject({
      action: 'counted',
      mentionCount: 1,
      penaltyLevel: 0,
    });
    expect(db.prepare(`
      SELECT policy_version FROM owner_ping_enforcement WHERE guild_id = ? AND user_id = ?
    `).get(guildId, legacyUserId).policy_version).toBe(OWNER_PING_POLICY_VERSION);
  });
});

describe('direct owner mention detection', () => {
  const ownerId = '1138315103821889566';
  const mentionsOwner = { users: { has: (id) => id === ownerId } };

  it('does not count an implicit Discord reply mention', () => {
    expect(isDirectOwnerMention({
      content: 'Mình đã nhận được rồi ạ',
      reference: { messageId: '123' },
      mentions: mentionsOwner,
    }, ownerId)).toBe(false);
  });

  it('counts only an explicit owner mention present in message content', () => {
    expect(isDirectOwnerMention({
      content: `Anh <@${ownerId}> kiểm tra giúp em nhé`,
      mentions: mentionsOwner,
    }, ownerId)).toBe(true);
    expect(isDirectOwnerMention({
      content: `Anh <@!${ownerId}> kiểm tra giúp em nhé`,
      mentions: mentionsOwner,
    }, ownerId)).toBe(true);
  });
});
