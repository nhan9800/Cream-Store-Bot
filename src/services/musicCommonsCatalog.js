export const MUSIC_COMMONS_USER_AGENT = 'CenarMusic/1.0 (https://cenarstore.xyz/)';

const COMMONS_ORIGIN = 'https://commons.wikimedia.org';
const COMMONS_API = `${COMMONS_ORIGIN}/w/api.php`;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_CATALOG_BYTES = 128 * 1024;
const MAX_CONCURRENT_REQUESTS = 2;
const CATALOG_TIMEOUT_MS = 8_000;
const SEARCH_RESULT_LIMIT = 8;
const LICENSE_ORIGIN = 'https://creativecommons.org';

let activeRequests = 0;
let pausedUntil = 0;

function fileNameFromTitle(title) {
  return /^File:([^/\\|<>\[\]{}\p{C}]+\.(?:ogg|mp3))$/iu.exec(title)?.[1];
}

function commonsTitleFromLink(link) {
  if (typeof link !== 'string' || link.length > 1024
    || !/^https:\/\/commons\.wikimedia\.org\/(?:wiki\/|w\/index\.php\?)/i.test(link)
    || /[\u0000-\u0020\u007f\\]/.test(link)) return null;
  try {
    const url = new URL(link);
    const title = url.pathname.startsWith('/wiki/')
      ? decodeURIComponent(url.pathname.slice('/wiki/'.length))
      : url.pathname === '/w/index.php' && url.searchParams.get('title');
    return title && title.length <= 255 && fileNameFromTitle(title) ? title : null;
  } catch {
    return null;
  }
}

export function isMusicCommonsLink(link) {
  return Boolean(commonsTitleFromLink(link));
}

function encodePathSegment(text) {
  return encodeURIComponent(text).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function normalizeMusicCommonsStream(source) {
  const { url, format, size } = source ?? {};
  const match = typeof url === 'string' && url.length <= 2048
    && /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([a-f\d])\/([a-f\d]{2})\/([^/?#\s\\]+))(?:\?[^#\s\\]*)?$/i.exec(url);
  let filename;
  try {
    filename = match && decodeURIComponent(match[4]);
  } catch {
    filename = null;
  }
  if (!filename || /[/\\\p{C}]/u.test(filename) || !match[3].toLowerCase().startsWith(match[2].toLowerCase())
    || !['ogg', 'mp3'].includes(format) || !filename.toLowerCase().endsWith(`.${format}`)
    || !Number.isSafeInteger(size) || size < 1 || size > MAX_AUDIO_BYTES) {
    throw new Error('Bản thu Wikimedia Commons không phải tệp MP3 hoặc OGG hợp lệ (tối đa 8 MiB).');
  }
  return { url: match[1], format, size };
}

function metadataText(metadata, key) {
  const value = metadata?.[key]?.value;
  return typeof value === 'string' ? value.trim() : '';
}

function plainArtist(metadata) {
  return (metadataText(metadata, 'Attribution') || metadataText(metadata, 'Artist'))
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp|#39);/gi, (entity) => ({
      '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '‹', '&gt;': '›', '&nbsp;': ' ', '&#39;': "'",
    })[entity.toLowerCase()])
    .replace(/\p{C}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function readLicense(metadata) {
  if (metadataText(metadata, 'Restrictions')) return null;
  const license = metadataText(metadata, 'LicenseShortName');
  const licenseUrl = metadataText(metadata, 'LicenseUrl');
  const publicDomainMark = '/publicdomain/mark/1.0/';
  const publicDomainZero = '/publicdomain/zero/1.0/';
  const licensePath = /^https?:\/\/creativecommons\.org(\/(?:licenses\/(?:by|by-sa)\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)|publicdomain\/(?:mark|zero)\/1\.0))(?:\/(?:(?:deed|legalcode)(?:\.[a-zA-Z-]+)?\/?)?)?$/.exec(licenseUrl)?.[1];
  const canonicalPath = licensePath && `${licensePath}/`;
  const publicDomain = license.toLowerCase() === 'public domain'
    && metadataText(metadata, 'Copyrighted').toLowerCase() === 'false'
    && metadataText(metadata, 'UsageTerms').toLowerCase() === 'public domain';
  if (publicDomain && !licenseUrl) return { license, licenseUrl: `${LICENSE_ORIGIN}${publicDomainMark}` };
  if (publicDomain && (canonicalPath === publicDomainMark || canonicalPath === publicDomainZero)) {
    return { license, licenseUrl: `${LICENSE_ORIGIN}${canonicalPath}` };
  }
  if (/^CC0(?: 1\.0)?$/i.test(license) && canonicalPath === publicDomainZero) {
    return { license: 'CC0 1.0', licenseUrl: `${LICENSE_ORIGIN}${canonicalPath}` };
  }
  const attribution = /^CC (BY|BY-SA) (1\.0|2\.0|2\.5|3\.0|4\.0)$/i.exec(license);
  if (!attribution || canonicalPath !== `/licenses/${attribution[1].toLowerCase()}/${attribution[2]}/`) return null;
  return { license, licenseUrl: `${LICENSE_ORIGIN}${canonicalPath}` };
}

function catalogRecording(page) {
  if (page?.ns !== 6 || typeof page.title !== 'string' || page.title.length > 255) return null;
  const name = fileNameFromTitle(page.title);
  const file = page.imageinfo?.[0];
  if (!name || !file) return null;
  const format = name.split('.').at(-1).toLowerCase();
  const expectedTypes = format === 'ogg' ? ['application/ogg', 'audio/ogg'] : ['audio/mpeg', 'audio/mp3'];
  if (!expectedTypes.includes(file.mime)) return null;
  const rights = readLicense(file.extmetadata);
  if (!rights) return null;
  try {
    const stream = normalizeMusicCommonsStream({ url: file.url, size: file.size, format });
    return {
      ...stream, ...rights, name,
      title: name.slice(0, -4).replace(/_+/g, ' '),
      pageUrl: `${COMMONS_ORIGIN}/wiki/File:${encodePathSegment(name.replaceAll(' ', '_'))}`,
      artist: plainArtist(file.extmetadata),
    };
  } catch {
    return null;
  }
}

async function readCatalogJson(response) {
  if (!response.body) throw new Error('Missing response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = '';
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_CATALOG_BYTES) throw new Error('Response exceeds catalog size limit');
      result += decoder.decode(value, { stream: true });
    }
    return JSON.parse(result + decoder.decode());
  } finally {
    // Release incomplete responses without buffering the remainder.
    await reader.cancel().catch(() => {});
  }
}

async function requestRecordings(params, fetchCommons) {
  if (Date.now() < pausedUntil) throw new Error('Wikimedia Commons đang giới hạn truy cập. Bạn thử lại sau nhé.');
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) throw new Error('Bot đang tìm nhạc cho người khác. Bạn thử lại sau nhé.');

  const query = new URLSearchParams({
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|mime|size|extmetadata',
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|UsageTerms|Artist|Attribution|Copyrighted|Restrictions',
    format: 'json',
    formatversion: '2',
    maxlag: '5',
    ...params,
  });
  activeRequests += 1;
  try {
    const response = await fetchCommons(`${COMMONS_API}?${query}`, {
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      redirect: 'error',
      credentials: 'omit',
      headers: { 'User-Agent': MUSIC_COMMONS_USER_AGENT, Accept: 'application/json' },
    });
    const retryAfter = response.headers.get('retry-after');
    if (response.status === 429 || retryAfter) {
      const now = Date.now();
      const resumeAt = /^\d+$/.test(retryAfter || '') ? now + Number(retryAfter) * 1_000 : Date.parse(retryAfter);
      pausedUntil = Math.max(pausedUntil, Number.isFinite(resumeAt) && resumeAt > now ? resumeAt : now + 30_000);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Commons API request failed');
    }
    const payload = await readCatalogJson(response);
    if (payload?.error) {
      if (payload.error.code === 'maxlag') pausedUntil = Math.max(pausedUntil, Date.now() + 5_000);
      throw new Error('Commons API reported an error');
    }
    const pages = payload?.query?.pages;
    if (!Array.isArray(pages)) return [];
    return pages.slice(0, SEARCH_RESULT_LIMIT)
      .sort((first, second) => (first?.index ?? 0) - (second?.index ?? 0))
      .map(catalogRecording)
      .filter(Boolean);
  } catch {
    throw new Error('Wikimedia Commons đang phản hồi chậm hoặc giới hạn truy cập. Bạn thử lại sau nhé.');
  } finally {
    activeRequests -= 1;
  }
}

export async function searchMusicCommons(query, { fetchCommons = fetch } = {}) {
  const text = typeof query === 'string' ? query.trim().normalize('NFKC') : '';
  if (!text || text.length > 120) throw new Error('Nhập tên bài hoặc nghệ sĩ, tối đa 120 ký tự.');
  const terms = text.match(/[\p{L}\p{N}\p{M}]+/gu)?.join(' ');
  if (!terms) throw new Error('Nhập tên bài hoặc nghệ sĩ để tìm nhạc.');
  return requestRecordings({
    generator: 'search',
    gsrsearch: `filetype:audio ${terms}`,
    gsrnamespace: '6',
    gsrlimit: String(SEARCH_RESULT_LIMIT),
  }, fetchCommons);
}

export async function resolveMusicCommons(link, { fetchCommons = fetch } = {}) {
  const title = commonsTitleFromLink(link);
  if (!title) throw new Error('Hãy dùng đường dẫn trang tệp MP3 hoặc OGG trên Wikimedia Commons.');
  const [recording] = await requestRecordings({ titles: title }, fetchCommons);
  if (!recording) throw new Error('Bản thu Wikimedia Commons này chưa có giấy phép phát phù hợp hoặc vượt giới hạn 8 MiB.');
  return recording;
}
