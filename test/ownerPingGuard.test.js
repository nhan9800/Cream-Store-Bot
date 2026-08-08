import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, initDatabase } from '../src/database/db.js';
import {
  OWNER_PING_PENALTIES_MS,
  OWNER_PING_STRIKE_DECAY_MS,
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

  it('warns on the third ping, then escalates from 15 minutes to 24 hours', () => {
    expect(registerOwnerPing(guildId, userId, startedAt)).toMatchObject({ action: 'counted', mentionCount: 1 });
    expect(registerOwnerPing(guildId, userId, startedAt + 1_000)).toMatchObject({ action: 'counted', mentionCount: 2 });
    expect(registerOwnerPing(guildId, userId, startedAt + 2_000)).toMatchObject({ action: 'warning', mentionCount: 3 });
    expect(registerOwnerPing(guildId, userId, startedAt + 3_000)).toMatchObject({
      action: 'timeout',
      mentionCount: 4,
      penaltyLevel: 1,
      timeoutMs: OWNER_PING_PENALTIES_MS[0],
    });
    expect(registerOwnerPing(guildId, userId, startedAt + OWNER_PING_PENALTIES_MS[0] + 4_000)).toMatchObject({
      action: 'timeout',
      mentionCount: 5,
      penaltyLevel: 2,
      timeoutMs: OWNER_PING_PENALTIES_MS[1],
    });
  });

  it('resets both the daily counter and old strikes after 30 clean days', () => {
    const result = registerOwnerPing(
      guildId,
      userId,
      startedAt + OWNER_PING_STRIKE_DECAY_MS + OWNER_PING_PENALTIES_MS[0] + 5_000,
    );
    expect(result).toMatchObject({ action: 'counted', mentionCount: 1, penaltyLevel: 0, timeoutMs: 0 });
  });
});
