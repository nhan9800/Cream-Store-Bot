import { Transform, pipeline } from 'node:stream';

const SAMPLE_RATE = 48_000;
const STEREO_SAMPLE_BYTES = 4;
const SMOOTH_SAMPLES = Math.round(SAMPLE_RATE * 0.08);
const COEFFICIENT_INTERVAL = 48;
const NUMBER_FIELDS = ['bass', 'treble', 'width', 'reverb', 'echo', 'spatial'];
const ALL_FIELDS = [...NUMBER_FIELDS, 'karaoke'];
const SMOOTH_FIELDS = [...ALL_FIELDS, 'active'];

export const MUSIC_SOUND_LIMITS = Object.freeze({
  bass: Object.freeze({ min: -6, max: 6, default: 0 }),
  treble: Object.freeze({ min: -6, max: 6, default: 0 }),
  width: Object.freeze({ min: 0, max: 150, default: 100 }),
  reverb: Object.freeze({ min: 0, max: 35, default: 0 }),
  echo: Object.freeze({ min: 0, max: 25, default: 0 }),
  spatial: Object.freeze({ min: 0, max: 100, default: 0 }),
});

export const DEFAULT_MUSIC_SOUND = Object.freeze({
  bass: 0, treble: 0, width: 100, reverb: 0, echo: 0, spatial: 0, karaoke: false,
});

const preset = (id, label, description, settings = {}) => Object.freeze({
  id, label, description, settings: Object.freeze({ ...DEFAULT_MUSIC_SOUND, ...settings }),
});

export const MUSIC_SOUND_PRESETS = Object.freeze([
  preset('original', 'Nguyên bản', 'Giữ nguyên âm thanh nguồn, không thêm hiệu ứng.'),
  preset('studio', 'Studio', 'Bass ấm, âm cao sáng và không gian nhẹ.', { bass: 1.8, treble: 1.4, width: 112, reverb: 6 }),
  preset('bass', 'Bass sâu', 'Nhấn dải trầm, giữ nhịp và cao độ của bài.', { bass: 5, treble: 1, width: 108 }),
  preset('vocal', 'Giọng hát', 'Giảm trầm đục, làm sáng phần giọng hát.', { bass: -1.8, treble: 2.8, reverb: 4 }),
  preset('lofi', 'Lo-fi', 'Âm cao dịu, stereo gọn và vang nhẹ.', { bass: 2, treble: -5, width: 80, reverb: 7, echo: 3 }),
  preset('live', 'Sân khấu', 'Stereo rộng, vang phòng và tiếng lặp ngắn.', { bass: 1, treble: 1, width: 125, reverb: 22, echo: 6 }),
  preset('karaoke', 'Karaoke', 'Giảm âm ở giữa stereo; không tách được mọi giọng hát.', { width: 115, reverb: 8, karaoke: true }),
  preset('spatial', 'Không gian', 'Stereo rộng và chuyển vị trí trái/phải chậm.', { bass: 1.5, treble: 1.5, width: 145, reverb: 10, spatial: 65 }),
]);

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_MUSIC_SOUND';
  error.status = 400;
  return error;
}

function validateObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw invalid('Cấu hình âm thanh phải là một object.');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (!ALL_FIELDS.includes(key)) throw invalid(`Thông số âm thanh không hợp lệ: ${String(key)}.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw invalid('Thông số âm thanh phải là giá trị trực tiếp.');
    if (key === 'karaoke') {
      if (typeof value[key] !== 'boolean') throw invalid('karaoke phải là true hoặc false.');
    } else {
      const { min, max } = MUSIC_SOUND_LIMITS[key];
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) {
        throw invalid(`${key} phải là số từ ${min} đến ${max}.`);
      }
    }
  }
}

export function validateMusicSoundPatch(value, current = DEFAULT_MUSIC_SOUND) {
  validateObject(current);
  validateObject(value);
  return { ...DEFAULT_MUSIC_SOUND, ...current, ...value };
}

export function getMusicSoundPreset(id) {
  const found = MUSIC_SOUND_PRESETS.find((entry) => entry.id === id);
  if (!found) throw invalid('Preset âm thanh không tồn tại.');
  return found;
}

function isOriginal(settings) {
  return ALL_FIELDS.every((key) => settings[key] === DEFAULT_MUSIC_SOUND[key]);
}

class Shelf {
  constructor(frequency, high) {
    this.frequency = frequency;
    this.high = high;
    this.state = [new Float64Array(4), new Float64Array(4)];
    this.coefficients = [1, 0, 0, 0, 0];
    this.lastGain = null;
  }

  // RBJ shelving filters, S=1, normalized a0 (W3C Audio EQ Cookbook):
  // https://www.w3.org/TR/audio-eq-cookbook/#shelving-eq-filters
  setGain(gain) {
    if (gain === this.lastGain) return;
    this.lastGain = gain;
    const a = 10 ** (gain / 40);
    const omega = 2 * Math.PI * this.frequency / SAMPLE_RATE;
    const cos = Math.cos(omega);
    const beta = Math.sin(omega) * Math.sqrt(2 * a);
    const plus = a + 1;
    const minus = a - 1;
    let b0, b1, b2, a0, a1, a2;
    if (this.high) {
      b0 = a * (plus + minus * cos + beta);
      b1 = -2 * a * (minus + plus * cos);
      b2 = a * (plus + minus * cos - beta);
      a0 = plus - minus * cos + beta;
      a1 = 2 * (minus - plus * cos);
      a2 = plus - minus * cos - beta;
    } else {
      b0 = a * (plus - minus * cos + beta);
      b1 = 2 * a * (minus - plus * cos);
      b2 = a * (plus - minus * cos - beta);
      a0 = plus + minus * cos + beta;
      a1 = -2 * (minus + plus * cos);
      a2 = plus + minus * cos - beta;
    }
    this.coefficients = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  }

  process(input, channel) {
    const [b0, b1, b2, a1, a2] = this.coefficients;
    const state = this.state[channel];
    const output = b0 * input + b1 * state[0] + b2 * state[1] - a1 * state[2] - a2 * state[3];
    state[1] = state[0];
    state[0] = input;
    state[3] = state[2];
    state[2] = Math.abs(output) < 1e-20 ? 0 : output;
    return output;
  }
}

class DelayLine {
  constructor(length, feedback = 0, damping = 1) {
    this.buffer = new Float32Array(length);
    this.feedback = feedback;
    this.damping = damping;
    this.index = 0;
    this.filtered = 0;
  }

  process(input) {
    const delayed = this.buffer[this.index];
    this.filtered += this.damping * (delayed - this.filtered);
    this.buffer[this.index] = input + this.filtered * this.feedback;
    this.index = (this.index + 1) % this.buffer.length;
    return delayed;
  }
}

function limit(value) {
  // Continuous soft knee with slope 1 at the boundary, rather than digital
  // clipping or full-time saturation. The dry Original path bypasses this.
  const magnitude = Math.abs(value);
  if (magnitude <= 0.85) return value;
  return Math.sign(value) * (0.85 + 0.135 * Math.tanh((magnitude - 0.85) / 0.135));
}

class SoundProcessor {
  constructor(settings) {
    this.target = { ...settings };
    this.values = { ...settings, karaoke: Number(settings.karaoke), active: Number(!isOriginal(settings)) };
    this.step = {};
    this.remaining = 0;
    this.resetWhenBypassed = false;
    this.coefficientClock = 0;
    this.bass = new Shelf(180, false);
    this.treble = new Shelf(3800, true);
    this.reverb = [
      [1423, 1783, 1973, 2099].map((size, index) => new DelayLine(size, 0.48 + index * 0.04, 0.32)),
      [1451, 1811, 2011, 2137].map((size, index) => new DelayLine(size, 0.48 + index * 0.04, 0.32)),
    ];
    this.echo = [new DelayLine(10560, 0.34, 0.6), new DelayLine(12960, 0.34, 0.6)];
    this.phase = 0;
    this.refresh();
  }

  update(settings) {
    this.target = { ...settings };
    this.resetWhenBypassed = isOriginal(settings);
    this.remaining = SMOOTH_SAMPLES;
    for (const key of SMOOTH_FIELDS) {
      const next = key === 'active' ? Number(!isOriginal(settings)) : Number(settings[key]);
      this.step[key] = (next - this.values[key]) / SMOOTH_SAMPLES;
    }
  }

  refresh() {
    this.bass.setGain(this.values.bass);
    this.treble.setGain(this.values.treble);
    const { bass, treble, width, reverb, echo, spatial } = this.values;
    // Reserve predictable headroom before the limiter. The tonal balance is
    // changed, not advertised as louder; controls retain their usual volume.
    this.headroom = 10 ** (-Math.max(0, bass, treble) / 20)
      / (1 + Math.max(0, width / 100 - 1) * 0.35 + reverb / 100 * 0.6
        + echo / 100 * 0.8 + spatial / 100 * 0.3);
    const pan = Math.sin(this.phase) * spatial / 100 * 0.8;
    this.leftPan = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2;
    this.rightPan = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
  }

  process(bytes) {
    if (this.remaining === 0 && isOriginal(this.target)) return bytes;
    const output = Buffer.allocUnsafe(bytes.length);
    for (let offset = 0; offset < bytes.length; offset += STEREO_SAMPLE_BYTES) {
      if (this.remaining > 0) {
        for (const key of SMOOTH_FIELDS) this.values[key] += this.step[key];
        this.remaining--;
        if (!this.remaining) {
          this.values = { ...this.target, karaoke: Number(this.target.karaoke), active: Number(!isOriginal(this.target)) };
          this.refresh();
        }
      }
      if (this.coefficientClock++ % COEFFICIENT_INTERVAL === 0) this.refresh();
      const dryLeft = bytes.readInt16LE(offset) / 32768;
      const dryRight = bytes.readInt16LE(offset + 2) / 32768;
      let left = this.treble.process(this.bass.process(dryLeft, 0), 0);
      let right = this.treble.process(this.bass.process(dryRight, 1), 1);
      const middle = (left + right) * 0.5;
      const side = (left - right) * 0.5 * this.values.width / 100;
      const centerGain = 1 - 0.88 * this.values.karaoke;
      left = middle * centerGain + side;
      right = middle * centerGain - side;
      let roomLeft = 0, roomRight = 0;
      for (let index = 0; index < 4; index++) {
        roomLeft += this.reverb[0][index].process(left) * 0.25;
        roomRight += this.reverb[1][index].process(right) * 0.25;
      }
      left += roomLeft * this.values.reverb / 100 * 0.5 + this.echo[0].process(left) * this.values.echo / 100 * 0.7;
      right += roomRight * this.values.reverb / 100 * 0.5 + this.echo[1].process(right) * this.values.echo / 100 * 0.7;
      this.phase = (this.phase + 2 * Math.PI / (SAMPLE_RATE * 6)) % (2 * Math.PI);
      left *= this.leftPan;
      right *= this.rightPan;
      left = limit(left * this.headroom);
      right = limit(right * this.headroom);
      const mix = this.values.active;
      output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((dryLeft * (1 - mix) + left * mix) * 32768))), offset);
      output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((dryRight * (1 - mix) + right * mix) * 32768))), offset + 2);
    }
    return output;
  }
}

class MusicSoundTransform extends Transform {
  constructor(settings) {
    super({ highWaterMark: 3840 * 16 });
    this.settings = { ...settings };
    this.processor = new SoundProcessor(settings);
    this.pending = Buffer.alloc(0);
  }

  getSettings() {
    return { ...this.settings };
  }

  updateSettings(settings) {
    if (this.destroyed || !this.processor) {
      const error = new Error('Luồng âm thanh đã kết thúc.');
      error.code = 'MUSIC_SOUND_CLOSED';
      throw error;
    }
    const next = validateMusicSoundPatch(settings);
    this.settings = next;
    this.processor.update(next);
    return this.getSettings();
  }

  _transform(chunk, _encoding, done) {
    try {
      const bytes = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      const end = bytes.length - bytes.length % STEREO_SAMPLE_BYTES;
      if (end) this.push(this.processor.process(bytes.subarray(0, end)));
      this.pending = Buffer.from(bytes.subarray(end));
      if (!this.processor.remaining && this.processor.resetWhenBypassed) {
        this.processor = new SoundProcessor(this.settings);
      }
      done();
    } catch (error) {
      done(error);
    }
  }

  _flush(done) {
    // A malformed final partial stereo sample cannot be processed, but must
    // never disappear. The preceding aligned PCM pipeline normally pads it.
    if (this.pending.length) this.push(this.pending);
    this.pending = Buffer.alloc(0);
    done();
  }

  _destroy(error, done) {
    this.pending = Buffer.alloc(0);
    this.processor = null;
    done(error);
  }
}

export function createMusicSoundTransform(source, initialSettings = DEFAULT_MUSIC_SOUND) {
  const settings = validateMusicSoundPatch(initialSettings);
  const output = new MusicSoundTransform(settings);
  // One PCM processor, before the existing native Opus encoder. No source,
  // FFmpeg, player resource or playback position is replaced by live updates.
  pipeline(source, output, () => {});
  return output;
}
