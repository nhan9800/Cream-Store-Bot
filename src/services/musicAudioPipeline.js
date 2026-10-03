import { Transform, pipeline } from 'node:stream';
import { OpusEncoder } from 'mediaplex';

export const MUSIC_SAMPLE_RATE = 48_000;
export const MUSIC_CHANNELS = 2;
export const MUSIC_FRAME_SAMPLES = 960;
export const MUSIC_FRAME_BYTES = MUSIC_FRAME_SAMPLES * MUSIC_CHANNELS * 2;
export const MUSIC_FIRST_FRAME_TIMEOUT_MS = 20_000;

export function musicBitrateForChannel(channel) {
  const bitrate = Number(channel?.bitrate);
  return Number.isFinite(bitrate) && bitrate > 0
    ? Math.round(Math.min(384_000, Math.max(8_000, bitrate)))
    : 64_000;
}

// StreamDispatcher skips its entire DSP when disableFilters is true. Its
// optional presets must also be present to propagate each disabled flag;
// omitted compressor/reverb presets otherwise instantiate audible defaults.
export function configureCleanMusicDispatcher(options) {
  Object.assign(options, {
    disableFilters: false,
    disableVolume: false,
    disableEqualizer: true,
    disableBiquad: true,
    disableResampler: true,
    disableCompressor: true,
    disableReverb: true,
    disableSeeker: true,
    defaultFilters: [],
    eq: [],
    biquadFilter: 'LowPass',
    sampleRate: MUSIC_SAMPLE_RATE,
    compressor: {},
    reverb: {},
  });
  return options;
}

class MusicFrameTransform extends Transform {
  constructor({ encode = null, startupTimeoutMs = 0, ...options } = {}) {
    super(options);
    this.pending = Buffer.alloc(0);
    this.encodeFrame = encode;
    this.startupTimer = startupTimeoutMs > 0 ? setTimeout(() => {
      this.destroy(new Error('YouTube chưa trả âm thanh sau 20 giây; đã đóng nguồn. Hãy kiểm tra lại hoặc chuyển bài.'));
    }, startupTimeoutMs) : null;
    this.startupTimer?.unref();
  }

  emitFrame(frame) {
    clearTimeout(this.startupTimer);
    this.startupTimer = null;
    this.push(this.encodeFrame ? this.encodeFrame(frame) : frame);
  }

  _transform(chunk, _encoding, done) {
    try {
      const bytes = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      let offset = 0;
      while (offset + MUSIC_FRAME_BYTES <= bytes.length) {
        this.emitFrame(bytes.subarray(offset, offset + MUSIC_FRAME_BYTES));
        offset += MUSIC_FRAME_BYTES;
      }
      // Retain even chunks smaller than one frame; the installed generic
      // Opus transform drops these and can silently lose the entire track.
      this.pending = Buffer.from(bytes.subarray(offset));
      done();
    } catch (error) {
      done(error);
    }
  }

  _flush(done) {
    try {
      if (this.pending.length) {
        const frame = Buffer.alloc(MUSIC_FRAME_BYTES);
        this.pending.copy(frame);
        this.emitFrame(frame);
      }
      this.pending = Buffer.alloc(0);
      done();
    } catch (error) {
      done(error);
    }
  }

  _destroy(error, done) {
    clearTimeout(this.startupTimer);
    this.startupTimer = null;
    this.pending = Buffer.alloc(0);
    this.encodeFrame = null;
    done(error);
  }
}

export function createFrameAlignedMusicPcm(source, { startupTimeoutMs = MUSIC_FIRST_FRAME_TIMEOUT_MS } = {}) {
  const frames = new MusicFrameTransform({ startupTimeoutMs, highWaterMark: MUSIC_FRAME_BYTES * 16 });
  // Do not await pipeline: doing so would wait for the entire song before
  // playback. Destruction propagates to the extractor and its child processes.
  pipeline(source, frames, () => {});
  return frames;
}

export function createMusicOpusStream(pcm, channel) {
  const codec = new OpusEncoder(MUSIC_SAMPLE_RATE, MUSIC_CHANNELS);
  // Configure the fresh native encoder before receiving any PCM. The generic
  // wrapper's CTL method names are incompatible with mediaplex, and mutating
  // an already-ended PlayerStart resource used to tear down playback.
  codec.applyEncoderCtl(4000, 2049); // OPUS_SET_APPLICATION / OPUS_APPLICATION_AUDIO
  codec.applyEncoderCtl(4024, 3002); // OPUS_SET_SIGNAL / OPUS_SIGNAL_MUSIC
  codec.setBitrate(musicBitrateForChannel(channel));
  const output = new MusicFrameTransform({
    encode: (frame) => codec.encode(frame),
    readableObjectMode: true,
    readableHighWaterMark: 16,
    writableHighWaterMark: MUSIC_FRAME_BYTES * 16,
  });
  output.audioProfile = {
    codec: 'Opus', sampleRate: MUSIC_SAMPLE_RATE, channels: MUSIC_CHANNELS,
    frameDurationMs: 20, bitrate: codec.getBitrate(), mode: 'music',
  };
  pipeline(pcm, output, () => {});
  return output;
}
