import { describe, expect, it } from 'vitest';
import { buildFfmpegDirectArgs, buildYtDlpDirectArgs } from '../src/services/youtubeDirectPcmStream.js';

describe('direct YouTube PCM fallback', () => {
  it('resolves a fresh audio-only URL with bounded YouTube options', () => {
    const args = buildYtDlpDirectArgs('https://www.youtube.com/watch?v=abc', {
      proxyUri: 'http://proxy.invalid:8080',
      cookiesFile: '/protected/cookies.txt',
    });
    expect(args).toEqual(expect.arrayContaining([
      '--no-playlist', '--js-runtimes', 'node', '--force-ipv4',
      '-f', 'bestaudio[acodec!=none]/bestaudio/best', '-g',
      '--proxy', 'http://proxy.invalid:8080', '--cookies', '/protected/cookies.txt',
    ]));
    expect(args).not.toContain('--yes-playlist');
  });

  it('can pin a public YouTube player client for a retry without dropping auth options', () => {
    const args = buildYtDlpDirectArgs('https://www.youtube.com/watch?v=abc', {
      playerClient: 'android,web',
      proxyUri: 'http://proxy.invalid:8080',
      cookiesFile: '/protected/cookies.txt',
    });
    expect(args).toEqual(expect.arrayContaining([
      '--extractor-args', 'youtube:player_client=android,web',
      '--proxy', 'http://proxy.invalid:8080', '--cookies', '/protected/cookies.txt',
    ]));
  });

  it('asks FFmpeg to reconnect YouTube HTTP audio and emit aligned PCM', () => {
    const args = buildFfmpegDirectArgs('https://googlevideo.invalid/audio');
    expect(args).toEqual(expect.arrayContaining([
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_at_eof', '1',
      '-reconnect_delay_max', '5', '-ar', '48000', '-ac', '2', '-f', 's16le', 'pipe:1',
    ]));
  });
});
