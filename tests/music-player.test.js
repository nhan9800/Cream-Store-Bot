import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { normalizeYoutubeUrl } from '../src/services/musicPlayerService.js';

describe('Cenar Music YouTube URL boundary', () => {
  it('accepts standard, short and music YouTube HTTPS links', () => {
    expect(normalizeYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toContain('youtube.com/watch');
    expect(normalizeYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toContain('youtu.be/dQw4w9WgXcQ');
    expect(normalizeYoutubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toContain('music.youtube.com/watch');
  });

  it('rejects search text, non-HTTPS and look-alike domains', () => {
    expect(() => normalizeYoutubeUrl('nhac chill')).toThrow(/link YouTube/i);
    expect(() => normalizeYoutubeUrl('http://youtube.com/watch?v=abc')).toThrow(/HTTPS/i);
    expect(() => normalizeYoutubeUrl('https://youtube.com.evil.example/watch?v=abc')).toThrow(/YouTube/i);
  });

  it('strips fragments and embedded credentials', () => {
    const normalized = normalizeYoutubeUrl('https://user:pass@youtube.com/watch?v=abc#chapter');
    expect(normalized).not.toContain('user');
    expect(normalized).not.toContain('pass');
    expect(normalized).not.toContain('#chapter');
  });

  it('does not mutate the native Opus bitrate after playback starts', () => {
    const source = fs.readFileSync(new URL('../src/services/musicPlayerService.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\.setBitrate\s*\(/);
  });

  it('keeps the extractor PCM stream out of a second FFmpeg pass', () => {
    const source = fs.readFileSync(new URL('../src/services/musicPlayerService.js', import.meta.url), 'utf8');
    expect(source).toMatch(/skipFFmpeg:\s*true/);
    expect(source).not.toMatch(/skipFFmpeg:\s*false/);
  });
});
