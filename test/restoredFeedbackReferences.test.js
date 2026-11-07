import Database from 'better-sqlite3';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: null }));
vi.mock('../src/database/db.js', () => ({ get db() { return state.db; }, nowIso: () => 'test-time' }));
vi.mock('../src/config/restoredFeedbackMessages20261107.js', () => ({ RESTORED_FEEDBACK_MESSAGES: {
  'old-message': { sourceChannelId: 'old-channel', messageId: 'restored-message' },
} }));
import { rebindRestoredFeedbackReferences } from '../src/services/restoredFeedbackReferenceService.js';
import { STORE_SERVICE_FORUM } from '../src/config/storeServiceForum202611.js';
import { getGuildConfig } from '../src/services/guildConfigService.js';
state.db = new Database(':memory:');
state.db.exec(`CREATE TABLE feedbacks (guild_id TEXT,feedback_channel_id TEXT,feedback_message_id TEXT,
  stars INTEGER,content TEXT,created_at TEXT,order_code TEXT);`);
state.db.exec(`CREATE TABLE guild_settings (guild_id TEXT PRIMARY KEY,feedback_channel_id TEXT,
  public_order_log_channel_id TEXT,order_log_channel_id TEXT,sale_channel_id TEXT);`);
beforeEach(() => state.db.exec('DELETE FROM feedbacks'));
afterAll(() => state.db.close());
describe('restored feedback reference adoption', () => {
  it('routes new reviews and completion logs to standalone channels while preserving another store', () => {
    const insert = state.db.prepare('INSERT INTO guild_settings VALUES (?,?,?,?,?)');
    insert.run(STORE_SERVICE_FORUM.guildId,'1568256285105987665','1568256313777979492','old-order-log','promotion');
    insert.run('another-store','1568256285105987665','1568256313777979492','other-order-log','other-promotion');
    expect(getGuildConfig(STORE_SERVICE_FORUM.guildId)).toMatchObject({feedback_channel_id:STORE_SERVICE_FORUM.feedbackChannelId,
      public_order_log_channel_id:STORE_SERVICE_FORUM.completedOrderLogChannelId,order_log_channel_id:STORE_SERVICE_FORUM.orderLogChannelId});
    expect(getGuildConfig('another-store')).toMatchObject({feedback_channel_id:'1568256285105987665',
      public_order_log_channel_id:'1568256313777979492',order_log_channel_id:'other-order-log'});
  });
  it('preserves opinions, stars, original dates and unrelated records while rebinding exactly verified copies', () => {
    const insert = state.db.prepare('INSERT INTO feedbacks VALUES (?,?,?,?,?,?,?)');
    insert.run(STORE_SERVICE_FORUM.guildId,'old-channel','old-message',2,'Original customer opinion','2025-01-01','fixture-order');
    insert.run(STORE_SERVICE_FORUM.guildId,'old-channel','not-copied',5,'Keep this row','2025-01-02','fixture-other');
    insert.run('another-store','old-channel','old-message',1,'Other store','2025-01-03','fixture-foreign');
    const before = state.db.prepare('SELECT * FROM feedbacks ORDER BY order_code').all();
    expect(rebindRestoredFeedbackReferences(STORE_SERVICE_FORUM.guildId)).toEqual({changed:1});
    const after = state.db.prepare('SELECT * FROM feedbacks ORDER BY order_code').all();
    expect(after).toEqual(before.map(row => row.order_code==='fixture-order' ? {...row,
      feedback_channel_id:STORE_SERVICE_FORUM.feedbackChannelId,feedback_message_id:'restored-message'} : row));
    expect(rebindRestoredFeedbackReferences(STORE_SERVICE_FORUM.guildId)).toEqual({changed:0});
    expect(rebindRestoredFeedbackReferences('another-store')).toEqual({changed:0});
  });
});
