import { EventEmitter } from 'node:events';
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { GuildQueueEvent } from 'discord-player';

vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE music_play_history (
    id INTEGER PRIMARY KEY, guild_id TEXT, track_id TEXT, track_url TEXT,
    title TEXT, author TEXT, thumbnail TEXT, duration_ms INTEGER, requested_by TEXT,
    status TEXT, started_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT, error_message TEXT
  )`);
  return { db };
});
import { db } from '../src/database/db.js';
import { wirePlayerEvents } from '../src/services/musicPlayerService.js';

beforeEach(() => db.exec('DELETE FROM music_play_history'));
afterAll(() => db.close());

describe('music source error history', () => {
  it('keeps an actual AudioPlayer error after its finish event and preserves normal completion', () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const events = new EventEmitter();
      wirePlayerEvents({ events });
      const track = { id: 'failed', url: 'https://youtube.com/watch?v=failed', title: 'Failed track' };
      const queue = { guild: { id: 'audio-history', name: 'Test' }, currentTrack: track };
      events.emit(GuildQueueEvent.PlayerStart, queue, track);
      events.emit(GuildQueueEvent.Error, queue, Object.assign(new Error('upstream audio failed'), { resource: { metadata: track } }));
      events.emit(GuildQueueEvent.PlayerFinish, queue, track);
      expect(db.prepare('SELECT status, error_message FROM music_play_history').get()).toEqual({ status: 'ERROR', error_message: 'upstream audio failed' });
      const next = { ...track, id: 'next', url: 'https://youtube.com/watch?v=next' };
      queue.currentTrack = next;
      events.emit(GuildQueueEvent.PlayerStart, queue, next);
      events.emit(GuildQueueEvent.PlayerFinish, queue, next);
      expect(db.prepare('SELECT status FROM music_play_history WHERE track_id = ?').get('next').status).toBe('COMPLETED');
    } finally {
      vi.runAllTimers();
      vi.useRealTimers();
      log.mockRestore();
    }
  });
});
