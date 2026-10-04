import { db } from '../database/db.js';
import {
  DEFAULT_MUSIC_SOUND, MUSIC_SOUND_LIMITS, MUSIC_SOUND_PRESETS,
  createMusicSoundTransform, getMusicSoundPreset, validateMusicSoundPatch,
} from './musicSoundEffects.js';

const activeEffects = new WeakMap();

function validGuildId(guildId) {
  const key = String(guildId || '').trim();
  if (!key || key.length > 100) throw new Error('Máy chủ nhạc không hợp lệ.');
  return key;
}

export function readMusicSoundSettings(guildId) {
  const key = validGuildId(guildId);
  const row = db.prepare('SELECT preset, settings_json FROM music_sound_settings WHERE guild_id = ?').get(key);
  if (!row) return { preset: 'original', settings: { ...DEFAULT_MUSIC_SOUND } };
  try {
    const settings = validateMusicSoundPatch(JSON.parse(row.settings_json));
    if (row.preset !== 'custom') getMusicSoundPreset(row.preset);
    return { preset: row.preset, settings };
  } catch {
    // Corrupt historical preferences must not stop music or overwrite data.
    return { preset: 'original', settings: { ...DEFAULT_MUSIC_SOUND } };
  }
}

export function getMusicSoundState(guildId, queue = null) {
  const saved = readMusicSoundSettings(guildId);
  const active = queue ? activeEffects.get(queue) : null;
  return {
    ...saved, live: Boolean(active && !active.destroyed && !active.writableEnded),
    presets: MUSIC_SOUND_PRESETS, limits: MUSIC_SOUND_LIMITS,
  };
}

export function updateMusicSound(guildId, value, queue = null) {
  const key = validGuildId(guildId);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((field) => !['preset', 'settings'].includes(field))
    || (Object.hasOwn(value, 'preset') === Object.hasOwn(value, 'settings'))) {
    throw new Error('Chọn một preset hoặc gửi cấu hình âm thanh hợp lệ.');
  }
  let next;
  if (Object.hasOwn(value, 'preset')) {
    const preset = getMusicSoundPreset(value.preset);
    next = { preset: preset.id, settings: { ...preset.settings } };
  } else {
    if (!value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)
      || !Object.keys(value.settings).length) throw new Error('Cấu hình âm thanh không được để trống.');
    const current = readMusicSoundSettings(key);
    next = { preset: 'custom', settings: validateMusicSoundPatch(value.settings, current.settings) };
  }
  // Complete validation before writing. A stopped stream keeps the saved
  // choice for the next track, without claiming that audio was changed live.
  db.prepare(`INSERT INTO music_sound_settings (guild_id, preset, settings_json)
    VALUES (?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET
    preset = excluded.preset, settings_json = excluded.settings_json, updated_at = CURRENT_TIMESTAMP`)
    .run(key, next.preset, JSON.stringify(next.settings));
  const active = queue ? activeEffects.get(queue) : null;
  if (active && !active.destroyed && !active.writableEnded) active.updateSettings(next.settings);
  return getMusicSoundState(key, queue);
}

export function attachMusicSoundEffects(pcm, queue) {
  const guildId = queue?.guild?.id;
  // Unit/native stream callers without a guild keep the transparent pipeline.
  const saved = guildId ? readMusicSoundSettings(guildId).settings : DEFAULT_MUSIC_SOUND;
  const effects = createMusicSoundTransform(pcm, saved);
  activeEffects.set(queue, effects);
  return effects;
}
