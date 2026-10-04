import { PassThrough } from 'node:stream';
import { afterAll, expect, it, vi } from 'vitest';
import { FiltersChain } from '@discord-player/equalizer';
import { StreamDispatcher, StreamType } from 'discord-player';
import { OpusEncoder } from 'mediaplex';

vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE music_sound_settings (
    guild_id TEXT PRIMARY KEY, preset TEXT, settings_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  return { db };
});
import { db } from '../src/database/db.js';
import { musicQueueOptions } from '../src/services/musicPlayerService.js';
import { getMusicSoundState, updateMusicSound } from '../src/services/musicSoundService.js';
import { configureCleanMusicDispatcher, createFrameAlignedMusicPcm, MUSIC_FRAME_BYTES } from '../src/services/musicAudioPipeline.js';

afterAll(() => db.close());

function tone(frames, start = 0) {
  const bytes = Buffer.alloc(frames * MUSIC_FRAME_BYTES);
  for (let sample = 0; sample < bytes.length / 4; sample++) {
    const value = Math.round(8000 * Math.sin(2 * Math.PI * 440 * (sample + start) / 48000));
    bytes.writeInt16LE(value, sample * 4);
    bytes.writeInt16LE(value, sample * 4 + 2);
  }
  return bytes;
}
function rms(pcm) {
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 2) sum += pcm.readInt16LE(i) ** 2;
  return Math.sqrt(sum / (pcm.length / 2));
}

it('changes real decoded Opus live through the installed Dispatcher without replacing its resource or volume', async () => {
  const options = musicQueueOptions({ defaultVolume: 80, maxQueueSize: 50 }, null, 'Test');
  const queue = {
    guild: { id: 'native-live-sound' }, channel: { bitrate: 384000 }, hasDebugger: false,
    canIntercept: () => false, onAfterCreateStream: options.onAfterCreateStream,
  };
  const dispatcher = { queue, dsp: new FiltersChain() };
  const source = new PassThrough();
  const resource = await StreamDispatcher.prototype.createStream.call(dispatcher,
    createFrameAlignedMusicPcm(source), configureCleanMusicDispatcher({ volume: 80, type: StreamType.Raw }));
  const volume = dispatcher.dsp.volume;
  const packets = [];
  const reading = (async () => { for await (const packet of resource.playStream) packets.push(packet); })();
  source.write(tone(10));
  const deadline = Date.now() + 2000;
  while (packets.length < 10 && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
  expect(packets).toHaveLength(10);
  expect(getMusicSoundState(queue.guild.id, queue).live).toBe(true);
  updateMusicSound(queue.guild.id, { preset: 'karaoke' }, queue);
  expect(dispatcher.dsp.volume).toBe(volume);
  source.end(tone(20, 10 * 960));
  await reading;
  expect(packets).toHaveLength(30);
  const decoder = new OpusEncoder(48000, 2);
  const decoded = packets.map((packet) => decoder.decode(packet));
  const dry = rms(Buffer.concat(decoded.slice(0, 8)));
  const wet = rms(Buffer.concat(decoded.slice(20)));
  expect(dry).toBeGreaterThan(4000);
  expect(wet / dry).toBeLessThan(0.25);
  expect(dispatcher.dsp.volume).toBeNull(); // Native chain releases DSP after EOF.
  expect(resource.encoder).toBeUndefined();
  expect(getMusicSoundState(queue.guild.id, queue)).toMatchObject({ preset: 'karaoke', live: false });
});
