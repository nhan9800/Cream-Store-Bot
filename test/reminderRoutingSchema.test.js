import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const one = '1282637033340403754', two = '1070676180103086132';
const previous = Object.fromEntries(['DATABASE_PATH', 'ENV_FILE', 'ENCRYPTION_KEY'].map(key => [key, process.env[key]]));
let directory, database, routing, layout;
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-reminder-schema-'));
  process.env.DATABASE_PATH = path.join(directory, 'fixture.sqlite');
  process.env.ENV_FILE = '.env.reminder-schema-not-present';
  process.env.ENCRYPTION_KEY = 'test-only-reminder-schema';
  database = await import('../src/database/db.js');
  database.initDatabase();
  routing = await import('../src/services/reminderRoutingService.js');
  layout = await import('../src/services/storeLayoutHealthService.js');
});
afterAll(() => {
  database?.db.close();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (directory && path.dirname(directory) === os.tmpdir()) fs.rmSync(directory, { recursive: true, force: true });
});

describe('actual initDatabase schema compatibility', () => {
  it('reports fresh premium state without creating its lazy columns or breaking health', () => {
    const columns = () => database.db.prepare('PRAGMA table_info(guild_settings)').all().map(column => column.name);
    const before = columns();
    expect(before).not.toContain('premium_category_id');
    expect(layout.getPremiumLayoutHealth(one)).toEqual({ mode: 'price-forum', adopted: false,
      locketChannelId: '1568249645497450606', locketMessageId: null });
    expect(columns()).toEqual(before);
  });
  it('fails closed when the required populated guild configuration is absent', () => {
    expect(() => routing.adoptStoreOneReminderRouting(one)).toThrow('STORE_ONE_REMINDER_SETTINGS_MISSING');
    expect(database.db.prepare('SELECT * FROM guild_settings WHERE guild_id=?').get(one)).toBeUndefined();
  });
  it('updates only the requested field on existing NOT NULL configuration and leaves Store2 untouched', () => {
    const insert = database.db.prepare(`INSERT INTO guild_settings
      (guild_id,ticket_category_id,order_log_channel_id,feedback_channel_id,staff_log_channel_id,reminder_channel_id)
      VALUES (?,?,?,?,?,?)`);
    insert.run(one, 'tickets-one', 'orders-one', 'feedback-one', 'staff-one', 'old-reminders');
    insert.run(two, 'tickets-two', 'orders-two', 'feedback-two', 'staff-two', 'global-reminders');
    const beforeOne = database.db.prepare('SELECT * FROM guild_settings WHERE guild_id=?').get(one);
    const beforeTwo = database.db.prepare('SELECT * FROM guild_settings WHERE guild_id=?').get(two);
    expect(routing.adoptStoreOneReminderRouting(one)).toEqual({ skipped: false, changed: true });
    expect(database.db.prepare('SELECT * FROM guild_settings WHERE guild_id=?').get(one))
      .toEqual({ ...beforeOne, reminder_channel_id: routing.STORE_ONE_REMINDER_CHANNEL_ID });
    expect(routing.adoptStoreOneReminderRouting(one).changed).toBe(false);
    expect(routing.adoptStoreOneReminderRouting(two).skipped).toBe(true);
    expect(database.db.prepare('SELECT * FROM guild_settings WHERE guild_id=?').get(two)).toEqual(beforeTwo);
    expect(routing.getReminderRoutingHealth(one).persisted).toBe(true);
  });
});
