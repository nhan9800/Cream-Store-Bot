import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';

vi.mock('../src/database/db.js', async () => {
  const { default: Sqlite } = await import('better-sqlite3');
  const db = new Sqlite(':memory:');
  db.exec(`CREATE TABLE music_sound_settings (
    guild_id TEXT PRIMARY KEY, preset TEXT, settings_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  ); CREATE TABLE music_guild_settings (
    guild_id TEXT PRIMARY KEY, default_volume INTEGER DEFAULT 80, default_voice_channel_id TEXT,
    dj_role_id TEXT, allow_member_control INTEGER DEFAULT 1, max_queue_size INTEGER DEFAULT 100,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  ); CREATE TABLE music_play_history (
    id INTEGER PRIMARY KEY, guild_id TEXT, track_url TEXT, title TEXT, author TEXT, thumbnail TEXT,
    duration_ms INTEGER, requested_by TEXT, started_at TEXT, finished_at TEXT, status TEXT
  );`);
  return { db };
});
import { db } from '../src/database/db.js';
import { buildMusicPanelPayload, handleMusicInteraction } from '../src/services/musicPlayerService.js';
import { readMusicSoundSettings } from '../src/services/musicSoundService.js';

beforeEach(() => db.exec('DELETE FROM music_sound_settings; DELETE FROM music_guild_settings'));
afterAll(() => db.close());

function request(customId, { allowed = true, values = [], fields = {} } = {}) {
  return {
    customId, guild: { id: 'sound-discord' }, guildId: 'sound-discord', values,
    member: { permissions: { has: (permission) => allowed && permission === PermissionFlagsBits.ManageGuild } },
    isStringSelectMenu: () => customId === 'music:sound', isModalSubmit: () => customId.endsWith(':modal'),
    fields: { getTextInputValue: (key) => fields[key] },
    message: { edit: vi.fn(), editable: false },
    reply: vi.fn(), deferUpdate: vi.fn(), deferReply: vi.fn(), followUp: vi.fn(), editReply: vi.fn(), showModal: vi.fn(),
  };
}

describe('Discord sound controls retain voice/DJ authorization', () => {
  it('exposes eight presets and reset without inventing live playback while idle', () => {
    const payload = buildMusicPanelPayload('sound-discord');
    const json = JSON.stringify(payload.components.map((component) => component.toJSON()));
    expect(json).toContain('music:sound');
    expect(json).toContain('music:sound-edit');
    expect(json).toContain('music:sound-reset');
    expect(json).toContain('Sẵn sàng cho bài tiếp theo');
    const component = payload.components[0].toJSON().components.flatMap((row) => row.components || [])
      .find((item) => item.custom_id === 'music:sound');
    expect(component.options).toHaveLength(8);
    expect(component.options.filter((option) => option.default)).toHaveLength(1);
  });

  it('rejects unauthorized selections and forged modal submissions before persistence', async () => {
    for (const customId of ['music:sound', 'music:sound-edit', 'music:sound-edit:modal', 'music:sound-reset']) {
      const interaction = request(customId, { allowed: false, values: ['bass'] });
      await handleMusicInteraction(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    }
    expect(db.prepare('SELECT COUNT(*) AS count FROM music_sound_settings').get().count).toBe(0);
  });

  it('saves a selected preset, opens prefilled modal and resets to Original', async () => {
    await handleMusicInteraction(request('music:sound', { values: ['bass'] }));
    expect(readMusicSoundSettings('sound-discord').preset).toBe('bass');
    const edit = request('music:sound-edit');
    await handleMusicInteraction(edit);
    const modal = edit.showModal.mock.calls[0][0].toJSON();
    expect(modal.components).toHaveLength(5);
    expect(modal.components[0].components[0].value).toBe(String(readMusicSoundSettings('sound-discord').settings.bass));
    await handleMusicInteraction(request('music:sound-reset'));
    expect(readMusicSoundSettings('sound-discord')).toMatchObject({ preset: 'original', settings: { bass: 0, reverb: 0 } });
  });

  it('reports saved-for-next-track after a valid modal and preserves settings after an invalid modal', async () => {
    const values = { bass: '3', treble: '-2', width: '120', reverb: '12', echo: '5' };
    const good = request('music:sound-edit:modal', { fields: values });
    await handleMusicInteraction(good);
    expect(good.editReply).toHaveBeenCalledWith(expect.stringContaining('bài tiếp theo'));
    expect(readMusicSoundSettings('sound-discord')).toMatchObject({ preset: 'custom', settings: { bass: 3, treble: -2, width: 120, reverb: 12, echo: 5 } });
    const before = readMusicSoundSettings('sound-discord');
    for (const bass of ['999', 'Infinity', '', '1e3', 'true']) {
      const bad = request('music:sound-edit:modal', { fields: { ...values, bass } });
      await handleMusicInteraction(bad);
      expect(bad.editReply).toHaveBeenCalledWith(expect.stringContaining('Chưa thay đổi'));
      expect(readMusicSoundSettings('sound-discord')).toEqual(before);
    }
  });
});
