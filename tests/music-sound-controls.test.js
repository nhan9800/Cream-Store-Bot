import { once } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the real SQLite validation/upsert semantics, without touching a shop DB.
vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE music_sound_settings (
      guild_id TEXT PRIMARY KEY, preset TEXT NOT NULL DEFAULT 'original',
      settings_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE music_guild_settings (
      guild_id TEXT PRIMARY KEY, default_volume INTEGER DEFAULT 80,
      default_voice_channel_id TEXT, dj_role_id TEXT, allow_member_control INTEGER DEFAULT 1,
      max_queue_size INTEGER DEFAULT 100, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE music_play_history (
      id INTEGER PRIMARY KEY, guild_id TEXT, track_id TEXT, track_url TEXT,
      title TEXT, author TEXT, thumbnail TEXT, duration_ms INTEGER, requested_by TEXT,
      status TEXT, started_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT, error_message TEXT
    );
    CREATE TABLE web_users (
      id TEXT PRIMARY KEY, email TEXT, display_name TEXT, role TEXT
    );
    CREATE TABLE customer_flags (
      guild_id TEXT, customer_id TEXT, is_blacklisted INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, customer_id)
    );
    CREATE TABLE web_account_security (
      user_id TEXT PRIMARY KEY, session_version INTEGER DEFAULT 0,
      mfa_secret TEXT, mfa_pending_secret TEXT, mfa_pending_until INTEGER,
      mfa_last_counter INTEGER DEFAULT -1, recovery_hashes TEXT DEFAULT '[]'
    );
  `);
  return { db };
});

const guildId = '123456789012345678';
const otherGuildId = '222222222222222222';
const apiKey = 'music-sound-test-key-only';
const originalEnv = { ...process.env };
let db, sound, effectsModule, player, server, base;

beforeAll(async () => {
  process.env.ENV_FILE = 'music-sound-tests-missing-env';
  process.env.BOT_API_KEY = apiKey;
  process.env.GUILD_ID = guildId;
  db = (await import('../src/database/db.js')).db;
  sound = await import('../src/services/musicSoundService.js');
  effectsModule = await import('../src/services/musicSoundEffects.js');
  player = await import('../src/services/musicPlayerService.js');
  for (const [id, role] of [['admin', 'admin'], ['staff', 'staff'], ['buyer', 'member']]) {
    db.prepare('INSERT INTO web_users(id, email, display_name, role) VALUES (?, ?, ?, ?)')
      .run(id, `${id}@example.com`, id, role);
  }
  const app = express();
  app.use(express.json());
  (await import('../src/services/adminApiRoutes.js')).registerAdminRoutes(app);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/bot/admin/music/control`;
}, 30_000);

beforeEach(() => {
  db.exec(`DROP TRIGGER IF EXISTS fail_music_sound_save;
    DELETE FROM music_sound_settings; DELETE FROM music_guild_settings;
    DELETE FROM music_play_history; DELETE FROM customer_flags;
    DELETE FROM web_account_security;`);
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db?.open) db.close();
  process.env = originalEnv;
});

function savedRows() {
  return db.prepare('SELECT * FROM music_sound_settings ORDER BY guild_id').all();
}

function tone(frames = 5, startSample = 0) {
  const bytes = Buffer.alloc(frames * 3840);
  for (let index = 0; index < bytes.length / 4; index++) {
    const sample = Math.round(4000 * Math.sin(2 * Math.PI * 70 * (index + startSample) / 48000));
    bytes.writeInt16LE(sample, index * 4);
    bytes.writeInt16LE(sample, index * 4 + 2);
  }
  return bytes;
}

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function call(value, { userId = 'admin', key = apiKey, sessionVersion = '0', action = 'sound' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Bot-Api-Key': key, 'X-Session-Version': sessionVersion };
  if (userId !== null) headers['X-User-Id'] = userId;
  return fetch(base, {
    method: 'POST', headers, body: JSON.stringify({ action, value }),
  });
}

describe('persisted music sound settings', () => {
  it('returns Original for an untouched guild without inserting preferences on a read', () => {
    expect(sound.readMusicSoundSettings(guildId)).toEqual({
      preset: 'original', settings: effectsModule.DEFAULT_MUSIC_SOUND,
    });
    expect(sound.getMusicSoundState(guildId)).toMatchObject({
      preset: 'original', live: false, presets: expect.any(Array), limits: expect.any(Object),
    });
    expect(savedRows()).toEqual([]);
  });

  it.each(['original', 'studio', 'bass', 'vocal', 'lofi', 'live', 'karaoke', 'spatial'])
    ('persists the complete %s preset and reads it independently from memory', (preset) => {
      const result = sound.updateMusicSound(guildId, { preset });
      expect(result.preset).toBe(preset);
      expect(result.live).toBe(false);
      expect(Object.keys(result.settings).sort()).toEqual(Object.keys(effectsModule.DEFAULT_MUSIC_SOUND).sort());
      const row = savedRows()[0];
      expect(row).toMatchObject({ guild_id: guildId, preset });
      expect(JSON.parse(row.settings_json)).toEqual(result.settings);
      expect(sound.readMusicSoundSettings(guildId)).toEqual({ preset, settings: result.settings });
      const replacement = effectsModule.getMusicSoundPreset(preset === 'bass' ? 'vocal' : 'bass');
      // A restart must use SQLite, rather than a stale process-local preferences cache.
      db.prepare('UPDATE music_sound_settings SET preset = ?, settings_json = ? WHERE guild_id = ?')
        .run(replacement.id, JSON.stringify(replacement.settings), guildId);
      expect(sound.readMusicSoundSettings(guildId)).toEqual({ preset: replacement.id, settings: replacement.settings });
    });

  it('isolates different stores and merges a custom patch into all prior settings', () => {
    const first = sound.updateMusicSound(guildId, { preset: 'studio' });
    const second = sound.updateMusicSound(otherGuildId, { preset: 'karaoke' });
    const limits = effectsModule.MUSIC_SOUND_LIMITS;
    const field = Object.keys(limits)[0];
    const value = effectsModule.DEFAULT_MUSIC_SOUND[field];
    const changed = sound.updateMusicSound(guildId, { settings: { [field]: value } });
    expect(changed).toMatchObject({ preset: 'custom', live: false });
    expect(changed.settings).toEqual({ ...first.settings, [field]: value });
    expect(sound.readMusicSoundSettings(otherGuildId)).toEqual({ preset: second.preset, settings: second.settings });
    changed.settings[field] = 99999;
    expect(sound.readMusicSoundSettings(guildId).settings[field]).toBe(value);
    expect(savedRows()).toHaveLength(2);
  });

  it('rejects ambiguous, empty and malformed controls before any DB write', () => {
    sound.updateMusicSound(guildId, { preset: 'studio' });
    const rows = savedRows();
    const before = db.prepare('SELECT total_changes() AS count').get().count;
    const field = Object.keys(effectsModule.MUSIC_SOUND_LIMITS)[0];
    const invalid = [
      null, true, [], '', {}, { preset: 'bass', settings: {} }, { preset: 'custom' },
      { preset: 'unknown' }, { preset: null }, { preset: 1 }, { preset: 'bass', unknown: true },
      { settings: null }, { settings: true }, { settings: [] }, { settings: {} },
      { settings: { unknown: 10 } }, { settings: { [field]: NaN } },
      { settings: { [field]: Infinity } }, { settings: { [field]: '1' } },
      { settings: { [field]: null } }, { settings: { [field]: true } },
      { settings: { [field]: -1_000_000 } }, { settings: { [field]: 1_000_000 } },
    ];
    for (const value of invalid) expect(() => sound.updateMusicSound(guildId, value)).toThrow();
    expect(savedRows()).toEqual(rows);
    expect(db.prepare('SELECT total_changes() AS count').get().count).toBe(before);
  });

  it.each(['{invalid', 'null', '[]', '{"unknown":1}', '{"bassDb":999999}'])
    ('plays Original when stored settings %s are corrupt, preserving the record', (settingsJson) => {
      db.prepare('INSERT INTO music_sound_settings(guild_id, preset, settings_json) VALUES (?, ?, ?)')
        .run(guildId, 'studio', settingsJson);
      const row = savedRows()[0];
      expect(sound.readMusicSoundSettings(guildId)).toEqual({
        preset: 'original', settings: effectsModule.DEFAULT_MUSIC_SOUND,
      });
      expect(savedRows()[0]).toEqual(row);
    });

  it('falls back safely for a removed preset and keeps its stored preference untouched', () => {
    db.prepare('INSERT INTO music_sound_settings(guild_id, preset, settings_json) VALUES (?, ?, ?)')
      .run(guildId, 'removed-preset', JSON.stringify(effectsModule.DEFAULT_MUSIC_SOUND));
    const row = savedRows()[0];
    expect(sound.readMusicSoundSettings(guildId).preset).toBe('original');
    expect(savedRows()[0]).toEqual(row);
  });
});

describe('same-stream live music sound controls', () => {
  it('changes the existing DSP while preserving PCM frames, source, playback resource and paused state', async () => {
    const source = new PassThrough();
    const queue = {
      guild: { id: guildId }, currentTrack: { id: 'playing-track' },
      node: { isPaused: () => true, play: vi.fn(), stop: vi.fn(), setPaused: vi.fn() },
    };
    const dsp = sound.attachMusicSoundEffects(source, queue);
    const update = vi.spyOn(dsp, 'updateSettings');
    const resource = { playStream: dsp };
    queue.dispatcher = { audioResource: resource };
    const chunks = [];
    dsp.on('data', (chunk) => chunks.push(chunk));
    const first = tone(5);
    source.write(first);
    await new Promise((resolve) => setImmediate(resolve));
    expect(Buffer.concat(chunks)).toEqual(first);
    expect(sound.getMusicSoundState(guildId, queue).live).toBe(true);
    const changed = sound.updateMusicSound(guildId, { preset: 'bass' }, queue);
    expect(changed).toMatchObject({ preset: 'bass', live: true });
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenLastCalledWith(changed.settings);
    expect(dsp.getSettings()).toEqual(changed.settings);
    source.write(tone(15, 5 * 960));
    await new Promise((resolve) => setImmediate(resolve));
    const reset = sound.updateMusicSound(guildId, { preset: 'original' }, queue);
    expect(reset).toMatchObject({ preset: 'original', live: true });
    expect(update).toHaveBeenCalledTimes(2);
    const ended = once(dsp, 'end');
    source.end(tone(10, 20 * 960));
    await ended;
    expect(Buffer.concat(chunks)).toHaveLength(30 * 3840);
    expect(Buffer.concat(chunks).subarray(first.length, 20 * 3840))
      .not.toEqual(tone(15, 5 * 960));
    expect(queue.dispatcher.audioResource).toBe(resource);
    expect(resource.playStream).toBe(dsp);
    expect(queue.currentTrack.id).toBe('playing-track');
    expect(queue.node.isPaused()).toBe(true);
    expect(queue.node.play).not.toHaveBeenCalled();
    expect(queue.node.stop).not.toHaveBeenCalled();
    expect(queue.node.setPaused).not.toHaveBeenCalled();
    expect(sound.getMusicSoundState(guildId, queue).live).toBe(false);
  });

  it('saves preferences while idle and installs them on the next real PCM stream', async () => {
    const saved = sound.updateMusicSound(guildId, { preset: 'studio' });
    expect(saved.live).toBe(false);
    const queue = { guild: { id: guildId } };
    const source = new PassThrough();
    const dsp = sound.attachMusicSoundEffects(source, queue);
    expect(dsp.getSettings()).toEqual(saved.settings);
    expect(sound.getMusicSoundState(guildId, queue).live).toBe(true);
    const closed = once(dsp, 'close');
    dsp.destroy();
    await closed;
    expect(source.destroyed).toBe(true);
    expect(sound.getMusicSoundState(guildId, queue).live).toBe(false);
    const update = vi.spyOn(dsp, 'updateSettings');
    expect(sound.updateMusicSound(guildId, { preset: 'vocal' }, queue)).toMatchObject({ preset: 'vocal', live: false });
    expect(update).not.toHaveBeenCalled();
    const next = sound.attachMusicSoundEffects(Readable.from([tone(8)]), queue);
    expect(next).not.toBe(dsp);
    expect(next.getSettings()).toEqual(sound.readMusicSoundSettings(guildId).settings);
    expect(await collect(next)).toHaveLength(8 * 3840);
    expect(sound.getMusicSoundState(guildId, queue).live).toBe(false);
  });

  it('does not alter active audio or saved data when validation or persistence fails', async () => {
    sound.updateMusicSound(guildId, { preset: 'studio' });
    const queue = { guild: { id: guildId } };
    const source = new PassThrough();
    const dsp = sound.attachMusicSoundEffects(source, queue);
    const update = vi.spyOn(dsp, 'updateSettings');
    const current = dsp.getSettings();
    const rows = savedRows();
    expect(() => sound.updateMusicSound(guildId, { settings: { unknown: 1 } }, queue)).toThrow();
    db.exec(`CREATE TRIGGER fail_music_sound_save BEFORE INSERT ON music_sound_settings
      BEGIN SELECT RAISE(ABORT, 'test sound save failed'); END;`);
    expect(() => sound.updateMusicSound(guildId, { preset: 'bass' }, queue)).toThrow(/save failed/);
    expect(savedRows()).toEqual(rows);
    expect(dsp.getSettings()).toEqual(current);
    expect(update).not.toHaveBeenCalled();
    const closed = once(dsp, 'close');
    dsp.destroy();
    await closed;
  });

  it('lets sound controls save before a player/queue exists while retaining the guard for transport controls', async () => {
    const state = await player.controlMusic(guildId, 'sound', { preset: 'lofi' });
    expect(state).toMatchObject({ connected: false, playing: false, current: null, sound: { preset: 'lofi', live: false } });
    await expect(player.controlMusic(guildId, 'skip')).rejects.toThrow(/chưa có phiên/);
  });
});

describe('admin music sound API authorization and validation', () => {
  it('allows authenticated Admin and Staff to save sound while idle', async () => {
    for (const userId of ['admin', 'staff']) {
      const response = await call({ preset: 'spatial' }, { userId });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, data: { sound: { preset: 'spatial', live: false } } });
    }
    expect(savedRows()).toHaveLength(1);
  });

  it('blocks invalid keys, missing identities, nonstaff accounts and revoked sessions without storing sound', async () => {
    for (const [options, expected] of [
      [{ key: 'incorrect' }, 401], [{ userId: null }, 401], [{ userId: 'missing' }, 403],
      [{ userId: 'buyer' }, 403], [{ sessionVersion: '99' }, 401],
    ]) expect((await call({ preset: 'bass' }, options)).status).toBe(expected);
    expect(savedRows()).toEqual([]);
  });

  it('retains account suspension and MFA step-up checks for the new sound action', async () => {
    db.prepare('INSERT INTO customer_flags(guild_id, customer_id, is_blacklisted) VALUES (?, ?, 1)').run('WEB', 'admin');
    const banned = await call({ preset: 'bass' });
    expect(banned.status).toBe(403);
    expect(await banned.json()).toMatchObject({ code: 'ACCOUNT_BANNED' });
    db.exec('DELETE FROM customer_flags');
    db.prepare('INSERT INTO web_account_security(user_id, mfa_secret) VALUES (?, ?)').run('admin', 'test-mfa-present');
    const mfa = await call({ preset: 'bass' });
    expect(mfa.status).toBe(403);
    expect(await mfa.json()).toMatchObject({ code: 'MFA_REQUIRED' });
    expect(savedRows()).toEqual([]);
  });

  it('rejects unknown actions and invalid settings with 400, preserving prior preferences', async () => {
    await call({ preset: 'studio' });
    const rows = savedRows();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await call({ preset: 'bass' }, { action: 'unknown-action' })).status).toBe(400);
      for (const value of [{}, { preset: 'unknown' }, { settings: {} }, { settings: { unknown: 1 } }, { preset: 'bass', settings: {} }]) {
        expect((await call(value)).status).toBe(400);
      }
    } finally { quiet.mockRestore(); }
    expect(savedRows()).toEqual(rows);
  });
});
