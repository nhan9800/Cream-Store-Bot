import { PassThrough, Readable } from 'node:stream';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { OpusEncoder } from 'mediaplex';
import { FiltersChain } from '@discord-player/equalizer';
import { StreamDispatcher, StreamType } from 'discord-player';
import {
  configureCleanMusicDispatcher, createFrameAlignedMusicPcm,
  createMusicOpusStream, MUSIC_FRAME_BYTES, musicBitrateForChannel,
} from '../src/services/musicAudioPipeline.js';
import { musicQueueOptions } from '../src/services/musicPlayerService.js';

vi.mock('../src/database/db.js', () => ({ db: {} }));

function tone(frames = 50) {
  const bytes = Buffer.alloc(frames * MUSIC_FRAME_BYTES);
  for (let index = 0; index < bytes.length / 4; index++) {
    bytes.writeInt16LE(Math.round(7000 * Math.sin(2 * Math.PI * 440 * index / 48000)), index * 4);
    bytes.writeInt16LE(Math.round(7000 * Math.sin(2 * Math.PI * 880 * index / 48000)), index * 4 + 2);
  }
  return bytes;
}
async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
const fragments = (bytes, size = 961) => Array.from({ length: Math.ceil(bytes.length / size) }, (_, i) => bytes.subarray(i * size, (i + 1) * size));
function rms(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) sum += bytes.readInt16LE(i) ** 2;
  return Math.sqrt(sum / (bytes.length / 2));
}

describe('native music PCM/Opus pipeline', () => {
  it('keeps every PCM byte, including chunks smaller than a frame and odd boundaries', async () => {
    const pcm = tone(2);
    const chunks = await collect(createFrameAlignedMusicPcm(Readable.from(fragments(pcm))));
    expect(Buffer.concat(chunks)).toEqual(pcm);
    const opus = createMusicOpusStream(Readable.from(fragments(pcm, 960)), { bitrate: 96000 });
    expect(await collect(opus)).toHaveLength(2);
  });

  it('pads only the last partial frame and does not invent a frame for empty sources', async () => {
    const pcm = tone(1).subarray(0, 999);
    const chunks = await collect(createFrameAlignedMusicPcm(Readable.from(fragments(pcm))));
    const result = Buffer.concat(chunks);
    expect(result.length).toBe(MUSIC_FRAME_BYTES);
    expect(result.subarray(0, pcm.length)).toEqual(pcm);
    expect(result.subarray(pcm.length).every((byte) => byte === 0)).toBe(true);
    expect(await collect(createMusicOpusStream(Readable.from([]), { bitrate: 96000 }))).toEqual([]);
  });

  it.each([64000, 96000, 128000, 256000, 384000])('configures native bitrate %i before encoding and emits decodable stereo packets', async (bitrate) => {
    const output = createMusicOpusStream(Readable.from(fragments(tone(6), 960)), { bitrate });
    expect(output.audioProfile.bitrate).toBe(bitrate);
    const packets = await collect(output);
    expect(packets).toHaveLength(6);
    const decoder = new OpusEncoder(48000, 2);
    expect(packets.map((packet) => decoder.decode(packet)).every((frame) => frame.length === MUSIC_FRAME_BYTES)).toBe(true);
  });

  it('bounds initial silence and closes the extractor source', async () => {
    const source = new PassThrough();
    const aligned = createFrameAlignedMusicPcm(source, { startupTimeoutMs: 15 });
    await expect(collect(aligned)).rejects.toThrow(/chưa trả âm thanh/);
    expect(source.destroyed).toBe(true);
    expect(aligned.startupTimer).toBeNull();
  });

  it('does not time out a paused/back-pressured stream after receiving its first frame', async () => {
    const source = new PassThrough();
    const aligned = createFrameAlignedMusicPcm(source, { startupTimeoutMs: 10 });
    const firstFrame = once(aligned, 'readable');
    source.write(tone(1));
    await firstFrame;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(aligned.destroyed).toBe(false);
    expect(aligned.startupTimer).toBeNull();
    aligned.destroy();
    await once(aligned, 'close');
    expect(source.destroyed).toBe(true);
  });

  it('propagates decoder/source failures and closes the complete pipe on stop', async () => {
    const source = new PassThrough();
    const output = createMusicOpusStream(createFrameAlignedMusicPcm(source), { bitrate: 96000 });
    const consumed = collect(output);
    source.destroy(new Error('source failed'));
    await expect(consumed).rejects.toThrow('source failed');
    const another = new PassThrough();
    const next = createMusicOpusStream(createFrameAlignedMusicPcm(another), { bitrate: 96000 });
    next.destroy();
    await once(next, 'close');
    expect(another.destroyed).toBe(true);
    expect(next.encodeFrame).toBeNull();
  });

  it('keeps a valid channel ceiling and uses 64kbps only when it is unknown', () => {
    expect(musicBitrateForChannel({ bitrate: 512000 })).toBe(384000);
    expect(musicBitrateForChannel({ bitrate: 8000 })).toBe(8000);
    expect(musicBitrateForChannel(null)).toBe(64000);
  });
});

describe('installed Discord Player volume and encoder integration', () => {
  async function dispatch(volume) {
    const options = musicQueueOptions({ defaultVolume: volume, maxQueueSize: 50 }, null, 'Test');
    const queue = { hasDebugger: false, channel: { bitrate: 96000 }, canIntercept: () => false, onAfterCreateStream: options.onAfterCreateStream };
    const dispatcher = { queue, dsp: new FiltersChain() };
    const source = new PassThrough();
    const resource = await StreamDispatcher.prototype.createStream.call(dispatcher,
      createFrameAlignedMusicPcm(source), configureCleanMusicDispatcher({ volume, type: StreamType.Raw }));
    // Verify the real installed pipeline, not just configuration strings.
    expect(dispatcher.dsp.volume).not.toBeNull();
    expect(dispatcher.dsp.compressor).toBeNull();
    expect(dispatcher.dsp.reverb).toBeNull();
    expect(dispatcher.dsp.resampler).toBeNull();
    expect(dispatcher.dsp.biquad).toBeNull();
    expect(dispatcher.dsp.equalizer).toBeNull();
    expect(resource.encoder).toBeUndefined(); // Already Opus; no second encoder.
    const decoder = new OpusEncoder(48000, 2);
    const reading = collect(resource.playStream);
    source.end(tone());
    const packets = await reading;
    expect(packets).toHaveLength(50);
    return rms(Buffer.concat(packets.map((packet) => decoder.decode(packet))));
  }

  it('applies the actual persisted volume to decoded audio without reverb/compression', async () => {
    const quiet = await dispatch(20);
    const louder = await dispatch(80);
    expect(louder / quiet).toBeGreaterThan(3.7);
    expect(louder / quiet).toBeLessThan(4.3);
    expect(louder).toBeGreaterThan(3500);
  });

  it('destroys an already-created source when DAVE negotiation fails', async () => {
    const options = musicQueueOptions({ defaultVolume: 80, maxQueueSize: 50 }, null, 'Test');
    const source = new PassThrough();
    const queue = { dispatcher: { voiceConnection: { state: { status: 'disconnected' } } } };
    await expect(options.onStreamExtracted({ $fmt: 'raw', stream: source }, { title: 'Test' }, queue)).rejects.toThrow(/đã đóng/);
    expect(source.destroyed).toBe(true);
  });
});
