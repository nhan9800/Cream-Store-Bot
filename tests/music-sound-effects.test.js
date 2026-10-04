import { once } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  createMusicSoundTransform, DEFAULT_MUSIC_SOUND, getMusicSoundPreset,
  MUSIC_SOUND_LIMITS, MUSIC_SOUND_PRESETS, validateMusicSoundPatch,
} from '../src/services/musicSoundEffects.js';
import { createMusicOpusStream, MUSIC_FRAME_BYTES } from '../src/services/musicAudioPipeline.js';

const SAMPLE_RATE = 48000;
function tone({ frames = 50, left = 440, right = left, amplitude = 6000, start = 0, invert = false } = {}) {
  const bytes = Buffer.alloc(frames * MUSIC_FRAME_BYTES);
  for (let index = 0; index < bytes.length / 4; index++) {
    bytes.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * left * (start + index) / SAMPLE_RATE)), index * 4);
    bytes.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * right * (start + index) / SAMPLE_RATE)) * (invert ? -1 : 1), index * 4 + 2);
  }
  return bytes;
}
const fragments = (bytes, size = 961) => Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size));
async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
async function apply(bytes, settings = DEFAULT_MUSIC_SOUND) {
  return Buffer.concat(await collect(createMusicSoundTransform(Readable.from(fragments(bytes)), settings)));
}
function rms(bytes, channel = null, start = 0, end = bytes.length) {
  let sum = 0, samples = 0;
  for (let index = start; index + 3 < end; index += 4) {
    if (channel !== 1) { sum += bytes.readInt16LE(index) ** 2; samples++; }
    if (channel !== 0) { sum += bytes.readInt16LE(index + 2) ** 2; samples++; }
  }
  return Math.sqrt(sum / samples);
}
function peak(bytes) {
  let maximum = 0;
  for (let index = 0; index < bytes.length; index += 2) maximum = Math.max(maximum, Math.abs(bytes.readInt16LE(index)));
  return maximum;
}

describe('music sound configuration', () => {
  it('exposes eight valid presets, an immutable original and fresh validated settings', () => {
    expect(MUSIC_SOUND_PRESETS.map((entry) => entry.id)).toEqual(['original', 'studio', 'bass', 'vocal', 'lofi', 'live', 'karaoke', 'spatial']);
    for (const entry of MUSIC_SOUND_PRESETS) {
      expect(validateMusicSoundPatch(entry.settings)).toEqual(entry.settings);
      expect(getMusicSoundPreset(entry.id)).toBe(entry);
      expect(Object.isFrozen(entry.settings)).toBe(true);
    }
    const changed = validateMusicSoundPatch({ bass: 2 }, { ...DEFAULT_MUSIC_SOUND, width: 110 });
    expect(changed).toEqual({ ...DEFAULT_MUSIC_SOUND, bass: 2, width: 110 });
    changed.bass = 6;
    expect(DEFAULT_MUSIC_SOUND.bass).toBe(0);
    expect(() => getMusicSoundPreset('fake')).toThrow(/không tồn tại/);
  });

  it.each(Object.entries(MUSIC_SOUND_LIMITS))('bounds %s and does not coerce values', (field, limits) => {
    expect(validateMusicSoundPatch({ [field]: limits.min })[field]).toBe(limits.min);
    expect(validateMusicSoundPatch({ [field]: limits.max })[field]).toBe(limits.max);
    for (const value of [limits.min - 0.01, limits.max + 0.01, NaN, Infinity, -Infinity, null, '1', true]) {
      expect(() => validateMusicSoundPatch({ [field]: value })).toThrow(field);
    }
  });

  it('rejects invalid objects, unknown keys and unsafe accessor values', () => {
    for (const input of [null, undefined, [], 'bass', 5, new Date(), { volume: 80 }, { karaoke: 1 }, { karaoke: 'false' }, JSON.parse('{"__proto__":{}}')]) {
      expect(() => validateMusicSoundPatch(input)).toThrow();
    }
    const accessor = Object.defineProperty({}, 'bass', { get() { throw new Error('must not invoke'); } });
    expect(() => validateMusicSoundPatch(accessor)).toThrow(/giá trị trực tiếp/);
    expect(() => validateMusicSoundPatch({ [Symbol('bass')]: 1 })).toThrow();
    expect(() => validateMusicSoundPatch({}, { ...DEFAULT_MUSIC_SOUND, echo: NaN })).toThrow('echo');
  });
});

describe('live PCM sound processing', () => {
  it('is byte-identical in Original, including odd chunks and a partial final sample', async () => {
    const bytes = Buffer.concat([tone({ frames: 3, left: 73, right: 12833, amplitude: 32767 }), Buffer.from([0x80, 0xfe, 0x01])]);
    expect(await apply(bytes)).toEqual(bytes);
    expect(await apply(Buffer.alloc(0))).toEqual(Buffer.alloc(0));
  });

  it.each(MUSIC_SOUND_PRESETS)('preserves stereo sample count, duration and bounded peaks with $id', async ({ settings }) => {
    const bytes = tone({ frames: 30, left: 113, right: 773, amplitude: 20000 });
    const result = await apply(bytes, settings);
    expect(result.length).toBe(bytes.length);
    expect(Number.isFinite(rms(result))).toBe(true);
    expect(rms(result)).toBeGreaterThan(100);
    expect(peak(result)).toBeLessThanOrEqual(32767);
  });

  it('changes bass and treble balance at the intended frequencies without pitch changes', async () => {
    async function response(frequency, settings) {
      const input = tone({ left: frequency });
      const result = await apply(input, validateMusicSoundPatch(settings));
      const start = MUSIC_FRAME_BYTES * 10;
      let crossings = 0;
      for (let i = start + 4; i < result.length; i += 4) {
        if (result.readInt16LE(i - 4) <= 0 && result.readInt16LE(i) > 0) crossings++;
      }
      expect(crossings).toBeCloseTo(frequency * 0.8, -1);
      return rms(result, 0, start) / rms(input, 0, start);
    }
    const bassLow = await response(60, { bass: 6 });
    const bassMid = await response(1000, { bass: 6 });
    expect(bassLow / bassMid).toBeGreaterThan(1.8);
    const trebleHigh = await response(12000, { treble: 6 });
    const trebleLow = await response(200, { treble: 6 });
    expect(trebleHigh / trebleLow).toBeGreaterThan(1.8);
    const lofiHigh = await response(12000, { treble: -6 });
    expect(lofiHigh).toBeLessThan(0.56);
  });

  it('changes stereo width while keeping a centered source centered', async () => {
    const mono = tone();
    expect(await apply(mono, validateMusicSoundPatch({ width: 0 }))).toEqual(mono);
    const sides = tone({ invert: true });
    expect(rms(await apply(sides, validateMusicSoundPatch({ width: 0 })))).toBe(0);
    const wide = await apply(sides, validateMusicSoundPatch({ width: 150 }));
    expect(rms(wide) / rms(sides)).toBeGreaterThan(1.25);
    let maximumChannelSum = 0;
    for (let index = 0; index < wide.length; index += 4) maximumChannelSum = Math.max(maximumChannelSum, Math.abs(wide.readInt16LE(index) + wide.readInt16LE(index + 2)));
    expect(maximumChannelSum).toBeLessThanOrEqual(1);
  });

  it('attenuates centered audio for karaoke and retains independent stereo sides', async () => {
    const settings = validateMusicSoundPatch({ karaoke: true });
    const centered = tone();
    const sides = tone({ invert: true });
    expect(rms(await apply(centered, settings)) / rms(centered)).toBeCloseTo(0.12, 2);
    expect(rms(await apply(sides, settings)) / rms(sides)).toBeCloseTo(1, 2);
  });

  it('adds a decaying room tail and bounded short echoes only within the source duration', async () => {
    const impulse = Buffer.alloc(MUSIC_FRAME_BYTES * 40);
    impulse.writeInt16LE(16000, 0);
    impulse.writeInt16LE(16000, 2);
    const room = await apply(impulse, validateMusicSoundPatch({ reverb: 35 }));
    expect(room.length).toBe(impulse.length);
    expect(peak(room.subarray(MUSIC_FRAME_BYTES, MUSIC_FRAME_BYTES * 5))).toBeGreaterThan(50);
    expect(rms(room, null, MUSIC_FRAME_BYTES * 30)).toBeLessThan(rms(room, null, MUSIC_FRAME_BYTES, MUSIC_FRAME_BYTES * 10));
    const echo = await apply(impulse, validateMusicSoundPatch({ echo: 25 }));
    expect(Math.abs(echo.readInt16LE(10560 * 4))).toBeGreaterThan(1000);
    expect(echo.readInt16LE(10560 * 4 + 2)).toBe(0);
    expect(Math.abs(echo.readInt16LE(12960 * 4 + 2))).toBeGreaterThan(1000);
    expect(peak(echo.subarray(MUSIC_FRAME_BYTES, 10560 * 4))).toBe(0);
  });

  it('moves stereo position slowly without changing sample rate or pitch', async () => {
    const input = tone({ frames: 300 });
    const output = await apply(input, validateMusicSoundPatch({ spatial: 100 }));
    const positivePan = output.subarray(MUSIC_FRAME_BYTES * 50, MUSIC_FRAME_BYTES * 100);
    const negativePan = output.subarray(MUSIC_FRAME_BYTES * 200, MUSIC_FRAME_BYTES * 250);
    expect(rms(positivePan, 1) / rms(positivePan, 0)).toBeGreaterThan(2);
    expect(rms(negativePan, 0) / rms(negativePan, 1)).toBeGreaterThan(2);
    expect(output.length).toBe(input.length);
  });

  it('applies changes to the existing stream with a smooth transition then restores exact Original', async () => {
    const source = new PassThrough();
    const output = createMusicSoundTransform(source);
    const reading = collect(output);
    const before = tone({ frames: 5, left: 100, right: 200 });
    source.write(before);
    const settings = getMusicSoundPreset('spatial').settings;
    expect(output.updateSettings(settings)).toEqual(settings);
    expect(output.getSettings()).toEqual(settings);
    const during = tone({ frames: 10, left: 100, right: 200, start: 5 * 960 });
    source.write(during);
    output.updateSettings(DEFAULT_MUSIC_SOUND);
    const restored = tone({ frames: 10, left: 100, right: 200, start: 15 * 960 });
    source.end(restored);
    const result = Buffer.concat(await reading);
    expect(result.length).toBe(before.length + during.length + restored.length);
    expect(result.subarray(0, before.length)).toEqual(before);
    expect(result.subarray(before.length + MUSIC_FRAME_BYTES * 5, before.length + during.length)).not.toEqual(during.subarray(MUSIC_FRAME_BYTES * 5));
    expect(result.subarray(before.length + during.length + MUSIC_FRAME_BYTES * 5)).toEqual(restored.subarray(MUSIC_FRAME_BYTES * 5));
    let maximumStep = 0;
    for (let i = 4; i < result.length; i += 4) {
      maximumStep = Math.max(maximumStep, Math.abs(result.readInt16LE(i) - result.readInt16LE(i - 4)), Math.abs(result.readInt16LE(i + 2) - result.readInt16LE(i - 2)));
    }
    expect(maximumStep).toBeLessThan(450);
    expect(source.destroyed).toBe(true);
    expect(output.destroyed).toBe(true);
  });

  it('keeps Original identical through the existing native Opus encoder', async () => {
    const bytes = tone({ frames: 5, left: 311, right: 1299 });
    const direct = await collect(createMusicOpusStream(Readable.from(fragments(bytes)), { bitrate: 384000 }));
    const transformed = await collect(createMusicOpusStream(createMusicSoundTransform(Readable.from(fragments(bytes))), { bitrate: 384000 }));
    expect(transformed).toEqual(direct);
  });

  it('clears old delay tails when Original is restored before effects are enabled again', async () => {
    const source = new PassThrough();
    const output = createMusicSoundTransform(source, getMusicSoundPreset('live').settings);
    const reading = collect(output);
    const impulse = Buffer.alloc(MUSIC_FRAME_BYTES * 3);
    impulse.writeInt16LE(24000, 0);
    impulse.writeInt16LE(24000, 2);
    source.write(impulse);
    output.updateSettings(DEFAULT_MUSIC_SOUND);
    source.write(Buffer.alloc(MUSIC_FRAME_BYTES * 5));
    output.updateSettings(getMusicSoundPreset('live').settings);
    source.end(Buffer.alloc(MUSIC_FRAME_BYTES * 30));
    const result = Buffer.concat(await reading);
    expect(peak(result.subarray(MUSIC_FRAME_BYTES * 8))).toBe(0);
  });

  it('handles full-scale content and maximum effects without clipping, nonfinite samples or excessive processing cost', async () => {
    const input = tone({ frames: 500, left: 31, right: 9997, amplitude: 32767 });
    const settings = validateMusicSoundPatch(Object.fromEntries(Object.entries(MUSIC_SOUND_LIMITS).map(([key, value]) => [key, value.max])));
    const started = performance.now();
    const output = await apply(input, settings);
    const elapsed = performance.now() - started;
    expect(output.length).toBe(input.length);
    expect(peak(output)).toBeLessThanOrEqual(Math.ceil(0.985 * 32768));
    expect(Number.isFinite(rms(output))).toBe(true);
    expect(rms(output)).toBeGreaterThan(1000);
    expect(rms(output, null, MUSIC_FRAME_BYTES * 450)).toBeGreaterThan(1000);
    // Ten audio seconds must cost substantially less than real time, with a
    // generous ceiling for shared CI machines. No benchmark controls the UI.
    expect(elapsed).toBeLessThan(3500);
  });

  it('cancels the complete source pipeline and rejects writes after closure', async () => {
    const source = new PassThrough();
    const output = createMusicSoundTransform(source, getMusicSoundPreset('live').settings);
    output.destroy();
    await once(output, 'close');
    expect(source.destroyed).toBe(true);
    expect(output.processor).toBeNull();
    expect(() => output.updateSettings(DEFAULT_MUSIC_SOUND)).toThrow(/đã kết thúc/);
    const failed = new PassThrough();
    const processed = createMusicSoundTransform(failed);
    const reading = collect(processed);
    failed.destroy(new Error('extractor failed'));
    await expect(reading).rejects.toThrow('extractor failed');
    expect(processed.destroyed).toBe(true);
  });

  it('retains every sample when settings are changed repeatedly while chunks are unaligned', async () => {
    const source = new PassThrough();
    const output = createMusicSoundTransform(source);
    const reading = collect(output);
    const bytes = tone({ frames: 12 });
    const chunks = fragments(bytes, 477);
    for (let index = 0; index < chunks.length; index++) {
      output.updateSettings(MUSIC_SOUND_PRESETS[index % MUSIC_SOUND_PRESETS.length].settings);
      source.write(chunks[index]);
    }
    source.end();
    const result = Buffer.concat(await reading);
    expect(result.length).toBe(bytes.length);
    expect(Number.isFinite(rms(result))).toBe(true);
    const changed = output.getSettings();
    changed.bass = 99;
    expect(output.getSettings().bass).not.toBe(99);
  });
});
