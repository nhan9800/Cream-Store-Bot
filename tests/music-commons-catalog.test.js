import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isMusicCommonsLink,
  MUSIC_COMMONS_USER_AGENT,
  normalizeMusicCommonsStream,
  resolveMusicCommons,
  searchMusicCommons,
} from '../src/services/musicCommonsCatalog.js';

const title = 'File:For Elise (piano).ogg';
const sourceUrl = 'https://upload.wikimedia.org/wikipedia/commons/8/8f/For_Elise_%28piano%29.ogg';
const filePage = 'https://commons.wikimedia.org/wiki/File:For_Elise_%28piano%29.ogg';

function recording({ info, metadata, ...page } = {}) {
  return {
    ns: 6, title, index: 1, ...page,
    imageinfo: [{
      url: `${sourceUrl}?utm_source=commons.wikimedia.org`,
      mime: 'application/ogg', size: 1234, ...info,
      extmetadata: Object.fromEntries(Object.entries({
        Artist: '<a href="https://example.test/performer">A &amp; B</a>',
        LicenseShortName: 'CC BY-SA 4.0',
        LicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en',
        Copyrighted: 'True',
        ...metadata,
      }).map(([key, value]) => [key, { value }])),
    }],
  };
}

const json = (pages) => Response.json({ query: { pages } });

afterEach(() => vi.restoreAllMocks());

describe('Wikimedia Commons music catalog', () => {
  it('uses a bounded search and returns canonical source, attribution and license links', async () => {
    const fetchCommons = vi.fn(async () => json([recording({ index: 2 }), recording({ index: 1, title: 'File:Other.ogg' })]));
    const tracks = await searchMusicCommons('Fur Elise filetype:video', { fetchCommons });
    expect(tracks[0].title).toBe('Other');
    expect(tracks[1]).toEqual({
      url: sourceUrl, format: 'ogg', size: 1234, name: 'For Elise (piano).ogg', title: 'For Elise (piano)',
      pageUrl: filePage, artist: 'A & B', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    });
    const [url, options] = fetchCommons.mock.calls[0];
    expect(new URL(url).origin).toBe('https://commons.wikimedia.org');
    expect(new URL(url).searchParams.get('gsrsearch')).toBe('filetype:audio Fur Elise filetype video');
    expect(new URL(url).searchParams.get('gsrlimit')).toBe('8');
    expect(new URL(url).searchParams.get('maxlag')).toBe('5');
    expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', headers: { 'User-Agent': MUSIC_COMMONS_USER_AGENT } });
  });

  it('recognizes supported file pages, including encoded namespace and classic permalinks', async () => {
    const fetchCommons = vi.fn(async () => json([recording()]));
    const encodedPage = filePage.replace('File:', 'File%3A');
    const permalink = `https://commons.wikimedia.org/w/index.php?title=${encodeURIComponent(title)}&oldid=42`;
    expect(isMusicCommonsLink(encodedPage)).toBe(true);
    expect(isMusicCommonsLink(permalink)).toBe(true);
    await expect(resolveMusicCommons(encodedPage, { fetchCommons })).resolves.toMatchObject({ pageUrl: filePage });
    await expect(resolveMusicCommons(permalink, { fetchCommons })).resolves.toMatchObject({ pageUrl: filePage });
    expect(new URL(fetchCommons.mock.calls[0][0]).searchParams.get('titles')).toBe('File:For_Elise_(piano).ogg');
    expect(new URL(fetchCommons.mock.calls[1][0]).searchParams.get('titles')).toBe(title);
  });

  it.each([
    'https://commons.wikimedia.org.evil.test/wiki/File:Test.ogg',
    'https://commons.wikimedia.org:443/wiki/File:Test.ogg',
    'https://commons.wikimedia.org/wiki/File:Hidden%2FTest.ogg',
    'https://commons.wikimedia.org/wiki/File:Bad%00Name.ogg',
    'https://commons.wikimedia.org/wiki/File:NotSound.webm',
    'https://commons.wikimedia.org/wiki/Category:Sound',
    'https://commons.wikimedia.org/w/index.php?title=File%3ATest%7CFile%3AOther.ogg',
    `${sourceUrl}`,
  ])('rejects invalid input before requesting the API (%s)', async (link) => {
    const fetchCommons = vi.fn();
    expect(isMusicCommonsLink(link)).toBe(false);
    await expect(resolveMusicCommons(link, { fetchCommons })).rejects.toThrow(/đường dẫn trang tệp/);
    expect(fetchCommons).not.toHaveBeenCalled();
  });

  it('accepts clear public domain and CC0 and rejects ambiguous rights or technical metadata', async () => {
    const publicDomain = { LicenseShortName: 'Public domain', LicenseUrl: '', Copyrighted: 'False', UsageTerms: 'Public domain' };
    const pages = [
      recording({ metadata: publicDomain }),
      recording({ metadata: { LicenseShortName: 'CC0', LicenseUrl: 'http://creativecommons.org/publicdomain/zero/1.0/deed.en' } }),
      recording({ metadata: { LicenseShortName: 'CC BY-NC 4.0', LicenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/' } }),
      recording({ metadata: { LicenseShortName: 'CC BY 4.0' } }),
      recording({ metadata: { ...publicDomain, Copyrighted: 'True' } }),
      recording({ metadata: { Restrictions: 'Additional restrictions apply' } }),
      recording({ info: { mime: 'video/ogg' } }),
      recording({ info: { size: 8 * 1024 * 1024 + 1 } }),
    ];
    const tracks = await searchMusicCommons('piano', { fetchCommons: async () => json(pages) });
    expect(tracks.map(({ license }) => license)).toEqual(['Public domain', 'CC0 1.0']);
    expect(tracks.map(({ licenseUrl }) => licenseUrl)).toEqual([
      'https://creativecommons.org/publicdomain/mark/1.0/',
      'https://creativecommons.org/publicdomain/zero/1.0/',
    ]);
    await expect(resolveMusicCommons(filePage, { fetchCommons: async () => json(pages.slice(2)) }))
      .rejects.toThrow(/giấy phép/);
  });

  it('rejects tampered CDN URLs and stops consuming oversized catalog responses', async () => {
    for (const url of [
      sourceUrl.replace('upload.wikimedia.org', 'upload.wikimedia.org.evil.test'),
      sourceUrl.replace('8/8f', '8/9a'),
      sourceUrl.replace('For_Elise_', '%2f'),
      sourceUrl.replace('.ogg', '.mp3'),
      `${sourceUrl}#extra`,
    ]) {
      expect(() => normalizeMusicCommonsStream({ url, format: 'ogg', size: 1234 })).toThrow(/hợp lệ/);
    }
    const fetchCommons = vi.fn(async () => new Response('x'.repeat(128 * 1024 + 1)));
    await expect(searchMusicCommons('piano', { fetchCommons })).rejects.toThrow(/thử lại sau/);
    expect(fetchCommons).toHaveBeenCalledTimes(1);
  });

  it('caps simultaneous requests and observes Retry-After without an automatic retry', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    let resolveRequest;
    const waiting = new Promise((resolve) => { resolveRequest = resolve; });
    const fetchCommons = vi.fn(async () => waiting);
    const first = searchMusicCommons('piano', { fetchCommons });
    const second = searchMusicCommons('guitar', { fetchCommons });
    await expect(searchMusicCommons('violin', { fetchCommons })).rejects.toThrow(/đang tìm nhạc/);
    resolveRequest(new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
    expect((await Promise.allSettled([first, second])).map(({ status }) => status)).toEqual(['rejected', 'rejected']);
    await expect(searchMusicCommons('piano', { fetchCommons })).rejects.toThrow(/giới hạn/);
    expect(fetchCommons).toHaveBeenCalledTimes(2);
    clock.mockReturnValue(now + 2_001);
    await expect(searchMusicCommons('piano', { fetchCommons: async () => json([]) })).resolves.toEqual([]);
  });
});
