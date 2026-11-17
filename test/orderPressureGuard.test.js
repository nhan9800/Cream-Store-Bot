import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, initDatabase } from '../src/database/db.js';
import {
  ORDER_PRESSURE_DUPLICATE_WINDOW_MS,
  ORDER_PRESSURE_WINDOW_MS,
  classifyOrderPressure,
  normalizeOrderPressureText,
  registerOrderPressure,
} from '../src/services/orderPressureGuardService.js';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-order-pressure-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-order-pressure-not-present';
  process.env.DATABASE_PATH = relativePath;
  return relativePath;
});

const guildId = `order-pressure-guild-${process.pid}-${Date.now()}`;
const userId = 'order-pressure-user';

describe('order pressure guard', () => {
  beforeAll(() => initDatabase());

  afterAll(() => {
    db.prepare('DELETE FROM order_pressure_enforcement WHERE guild_id = ?').run(guildId);
    db.close();
    const absolute = path.resolve(process.cwd(), testDatabasePath);
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${absolute}${suffix}`, { force: true });
  });

  it('normalizes accented Vietnamese and stretched punctuation safely', () => {
    expect(normalizeOrderPressureText('  2 TUẦN rồi chưa trả đơn!!!! '))
      .toBe('2 tuan roi chua tra don!!');
  });

  it('tracks one concrete delay complaint without deleting it', () => {
    expect(classifyOrderPressure({ content: '2 tuần rồi chưa trả đơn' }).shouldTrack).toBe(true);
    expect(classifyOrderPressure({ content: 'Cho mình hỏi đơn đã xử lý chưa ạ?' }).shouldTrack).toBe(false);
  });

  it('tracks broad delay, pressure, and mention variants', () => {
    expect(classifyOrderPressure({ content: '2 tuần rồi chưa trả đơn!!!' })).toMatchObject({
      shouldTrack: true,
      reasons: ['delay-language', 'pressure-language'],
    });
    expect(classifyOrderPressure({
      content: 'Rep đơn này đi <@123>',
      mentions: { users: { size: 1 }, roles: { size: 0 }, everyone: false },
    })).toMatchObject({ shouldTrack: true, reasons: ['pressure-language', 'mention-pressure'] });
  });

  it('keeps the first match and deletes repeated pressure with warning cooldown', () => {
    const first = registerOrderPressure(guildId, userId, 'first', 1_800_000_000_000);
    expect(first).toMatchObject({ action: 'tracked', shouldDelete: false, shouldWarn: false, flaggedCount: 1 });

    const second = registerOrderPressure(guildId, userId, 'second', 1_800_000_001_000);
    expect(second).toMatchObject({ action: 'delete', shouldDelete: true, shouldWarn: true, flaggedCount: 2 });

    const third = registerOrderPressure(
      guildId,
      userId,
      'second',
      1_800_000_001_000 + ORDER_PRESSURE_DUPLICATE_WINDOW_MS - 1,
    );
    expect(third).toMatchObject({ action: 'delete', shouldDelete: true, shouldWarn: false, warningCooling: true });
  });

  it('resets the rolling state after the enforcement window', () => {
    const reset = registerOrderPressure(
      guildId,
      userId,
      'fresh',
      1_800_000_001_000 + ORDER_PRESSURE_WINDOW_MS + 1,
    );
    expect(reset).toMatchObject({ action: 'tracked', shouldDelete: false, flaggedCount: 1 });
  });
});
