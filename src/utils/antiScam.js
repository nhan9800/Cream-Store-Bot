import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import engLanguageData from '@tesseract.js-data/eng';
import { createWorker, OEM, PSM } from 'tesseract.js';
import sharp from 'sharp';
import { config } from '../config.js';
import { db } from '../database/db.js';

const geminiKeys = (process.env.GEMINI_API_KEYS || '')
  .split(',')
  .map((key) => key.trim())
  .filter(Boolean);
let currentKeyIndex = 0;

const IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|heic|heif)(?:$|\?)/i;
const DISCORD_MEDIA_HOSTS = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
  'images-ext-1.discordapp.net',
  'images-ext-2.discordapp.net',
]);
const SAFE_CACHE_HOURS = 24;
const MAX_ATTACHMENTS_PER_MESSAGE = 3;
const inFlightScans = new Map();
const OCR_VISIBLE_TEXT_LIMIT = 1400;
const VISION_COOLDOWN_MS = 60 * 60 * 1000;
let visionDisabledUntil = 0;
let ocrWorkerPromise = null;
let ocrQueue = Promise.resolve();

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeOcrText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[|]/g, 'i')
    .replace(/[^a-z0-9@$+.%:/\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectMatchedPhrases(text, phrases) {
  return phrases.filter((phrase) => text.includes(phrase));
}

/**
 * High-precision local classifier. It intentionally requires multiple visible
 * lure signals so a normal MrBeast thumbnail, receipt or crypto discussion is
 * never removed based on one isolated word.
 */
export function classifyScamOcrText(rawText, ocrConfidence = 0) {
  const text = normalizeOcrText(rawText);
  const visibleText = cleanText(rawText, OCR_VISIBLE_TEXT_LIMIT);
  if (!text) {
    return normalizeScamVisionResult({
      decision: 'UNCERTAIN',
      confidence: 0,
      category: 'OTHER',
      visibleText,
      reason: 'Local OCR found no readable text',
    });
  }

  const brand = collectMatchedPhrases(text, [
    'mrbeast', 'mr beast', '@mrbeast', 'beast games',
  ]);
  const promotions = collectMatchedPhrases(text, [
    'giveaway', 'activate code', 'promo code', 'claim reward', 'claim your reward',
    'exclusive reward', 'limited time', 'free gift', 'bonus', 'bonuses', 'rakeback',
    'prize', 'redeem',
  ]);
  const money = collectMatchedPhrases(text, [
    'withdrawal successful', 'withdraw successful', 'withdrawal', 'withdraw', 'deposit',
    'wallet', 'balance', 'crypto', 'cryptocurrency', 'bitcoin', 'usdc', 'usdt', 'btc',
    'casino', 'betting',
  ]);
  const credentials = collectMatchedPhrases(text, [
    'scan qr', 'qr code', 'connect wallet', 'verify account', 'verification',
    'log in', 'login', 'authorize', 'authorized app',
  ]);
  const gifts = collectMatchedPhrases(text, [
    'free nitro', 'nitro gift', 'steam gift', 'discord gift', 'gift inventory',
  ]);
  const signals = [...new Set([...brand, ...promotions, ...money, ...credentials, ...gifts])]
    .slice(0, 8);
  const ocrQuality = clampConfidence(Number(ocrConfidence) / (Number(ocrConfidence) > 1 ? 100 : 1));

  if (brand.length && promotions.length && money.length) {
    return normalizeScamVisionResult({
      decision: 'SCAM',
      confidence: Math.max(0.98, ocrQuality),
      category: 'MRBEAST_CRYPTO_GIVEAWAY',
      signals,
      visibleText,
      reason: 'Local OCR matched an impersonated MrBeast promotion with crypto/payment bait',
    });
  }
  if (brand.length && promotions.length >= 2) {
    return normalizeScamVisionResult({
      decision: 'SCAM',
      confidence: Math.max(0.97, ocrQuality),
      category: 'BRAND_IMPERSONATION',
      signals,
      visibleText,
      reason: 'Local OCR matched MrBeast branding with multiple prize/activation lures',
    });
  }

  const hasWithdrawalBait = text.includes('withdrawal successful') || text.includes('withdraw successful');
  const hasActivationBait = text.includes('activate code') || text.includes('promo code');
  if ((hasWithdrawalBait || hasActivationBait) && promotions.length && money.length >= 2) {
    return normalizeScamVisionResult({
      decision: 'SCAM',
      confidence: Math.max(0.97, ocrQuality),
      category: 'CRYPTO_CASINO_BONUS',
      signals,
      visibleText,
      reason: 'Local OCR matched activation/withdrawal bait with crypto or casino signals',
    });
  }

  const hasQrCredentialLure = credentials.some((item) => item.includes('qr') || item.includes('login') || item.includes('verify'));
  if (hasQrCredentialLure && (gifts.length || (promotions.length && money.length))) {
    return normalizeScamVisionResult({
      decision: 'SCAM',
      confidence: Math.max(0.97, ocrQuality),
      category: gifts.length ? 'FREE_NITRO_GIFT' : 'QR_CREDENTIAL_PHISHING',
      signals,
      visibleText,
      reason: 'Local OCR matched a QR/login lure combined with a gift or financial reward',
    });
  }

  return normalizeScamVisionResult({
    decision: signals.length >= 2 ? 'UNCERTAIN' : 'SAFE',
    confidence: signals.length >= 2 ? Math.min(0.74, Math.max(0.45, ocrQuality)) : Math.max(0.7, ocrQuality),
    category: signals.length >= 2 ? 'OTHER' : 'SAFE_CONTENT',
    signals,
    visibleText,
    reason: signals.length >= 2
      ? 'Local OCR found partial signals but not enough evidence for automatic deletion'
      : 'No high-confidence scam phrase combination found by local OCR',
  });
}

function getNextKey() {
  if (!geminiKeys.length) return null;
  const key = geminiKeys[currentKeyIndex % geminiKeys.length];
  currentKeyIndex += 1;
  return key;
}

function responseText(response) {
  if (typeof response?.text === 'function') return response.text();
  return response?.text || '';
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Vision scan exceeded ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function isAllowedDiscordMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && DISCORD_MEDIA_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isScannableImageAttachment(attachment) {
  if (!attachment?.url || !isAllowedDiscordMediaUrl(attachment.url)) return false;
  const contentType = String(attachment.contentType || '').toLowerCase();
  const name = String(attachment.name || '').toLowerCase();
  if (!(contentType.startsWith('image/') || IMAGE_EXT_RE.test(name))) return false;
  if (contentType.includes('gif') || /\.gif(?:$|\?)/i.test(name)) return false;
  return Number(attachment.size || 0) <= config.antiScamMaxImageBytes;
}

export function normalizeScamVisionResult(value = {}) {
  const rawDecision = String(value.decision || (value.isScam ? 'SCAM' : 'UNCERTAIN')).toUpperCase();
  const decision = ['SCAM', 'SAFE', 'UNCERTAIN'].includes(rawDecision) ? rawDecision : 'UNCERTAIN';
  const signals = Array.isArray(value.signals)
    ? value.signals.map((signal) => cleanText(signal, 140)).filter(Boolean).slice(0, 8)
    : [];
  return {
    decision,
    confidence: clampConfidence(value.confidence),
    category: cleanText(value.category || 'OTHER', 80).toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
    signals,
    visibleText: cleanText(value.visibleText, 700),
    reason: cleanText(value.reason, 500),
  };
}

export function shouldEnforceScamVerdict(result, threshold = config.antiScamConfidenceThreshold) {
  const normalized = normalizeScamVisionResult(result);
  if (normalized.decision !== 'SCAM' || normalized.confidence < Number(threshold)) return false;
  return normalized.signals.length >= 2
    || (normalized.confidence >= 0.97 && normalized.category !== 'OTHER');
}

function fingerprintRowToResult(row) {
  if (!row) return null;
  let signals = [];
  try { signals = JSON.parse(row.signals_json || '[]'); } catch {}
  return normalizeScamVisionResult({
    decision: row.verdict,
    confidence: row.confidence,
    category: row.category,
    signals,
    visibleText: row.visible_text,
    reason: row.reason,
  });
}

function getCachedFingerprint(sha256) {
  try {
    const row = db.prepare(`
      SELECT * FROM scam_image_fingerprints
      WHERE sha256 = ?
        AND (
          verdict = 'SCAM'
          OR (verdict = 'SAFE' AND datetime(last_scanned_at) >= datetime('now', ?))
        )
      LIMIT 1
    `).get(sha256, `-${SAFE_CACHE_HOURS} hours`);
    if (!row) return null;
    db.prepare(`
      UPDATE scam_image_fingerprints
      SET hit_count = hit_count + 1, last_seen_at = CURRENT_TIMESTAMP
      WHERE sha256 = ?
    `).run(sha256);
    return fingerprintRowToResult(row);
  } catch (error) {
    console.error('[ANTI-SCAM] Fingerprint cache read failed:', error.message);
    return null;
  }
}

function saveFingerprint(sha256, result) {
  const normalized = normalizeScamVisionResult(result);
  try {
    db.prepare(`
      INSERT INTO scam_image_fingerprints (
        sha256, verdict, confidence, category, signals_json, visible_text, reason,
        first_seen_at, last_seen_at, last_scanned_at, hit_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
      ON CONFLICT(sha256) DO UPDATE SET
        verdict = excluded.verdict,
        confidence = excluded.confidence,
        category = excluded.category,
        signals_json = excluded.signals_json,
        visible_text = excluded.visible_text,
        reason = excluded.reason,
        last_seen_at = CURRENT_TIMESTAMP,
        last_scanned_at = CURRENT_TIMESTAMP,
        hit_count = scam_image_fingerprints.hit_count + 1
    `).run(
      sha256,
      normalized.decision,
      normalized.confidence,
      normalized.category,
      JSON.stringify(normalized.signals),
      normalized.visibleText,
      normalized.reason,
    );
  } catch (error) {
    console.error('[ANTI-SCAM] Fingerprint cache write failed:', error.message);
  }
}

async function downloadDiscordImage(attachment) {
  const response = await fetch(attachment.url, {
    signal: AbortSignal.timeout(config.antiScamDownloadTimeoutMs),
    headers: { 'User-Agent': 'CenarStore-SecurityScanner/2.0' },
  });
  if (!response.ok) throw new Error(`Discord media returned HTTP ${response.status}`);

  const length = Number(response.headers.get('content-length') || attachment.size || 0);
  if (length > config.antiScamMaxImageBytes) throw new Error('Image exceeds scan size limit');
  const contentType = String(response.headers.get('content-type') || attachment.contentType || 'image/png')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!contentType.startsWith('image/') || contentType === 'image/gif') {
    throw new Error(`Unsupported media type: ${contentType || 'unknown'}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > config.antiScamMaxImageBytes) {
    throw new Error('Invalid image size');
  }
  return { buffer, contentType };
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('eng', OEM.LSTM_ONLY, {
      langPath: engLanguageData.langPath,
      gzip: engLanguageData.gzip,
      cacheMethod: 'readOnly',
      errorHandler: (error) => console.error('[ANTI-SCAM] Local OCR worker error:', error?.message || error),
    })
      .then(async (worker) => {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          preserve_interword_spaces: '1',
        });
        return worker;
      })
      .catch((error) => {
        ocrWorkerPromise = null;
        throw error;
      });
  }
  return ocrWorkerPromise;
}

async function prepareImageForOcr(buffer) {
  const image = sharp(buffer, { limitInputPixels: 25_000_000, failOn: 'error' });
  const metadata = await image.metadata();
  const largestSide = Math.max(Number(metadata.width || 0), Number(metadata.height || 0));
  if (!largestSide) return buffer;
  const scale = Math.min(3, Math.max(1, 1800 / largestSide));
  return image
    .resize({
      width: Math.max(1, Math.round(Number(metadata.width) * scale)),
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .grayscale()
    .normalize()
    .sharpen()
    .png({ compressionLevel: 6 })
    .toBuffer();
}

async function requestLocalOcrVerdict(buffer) {
  const task = ocrQueue
    .catch(() => undefined)
    .then(async () => {
      const worker = await getOcrWorker();
      let prepared = buffer;
      try {
        prepared = await prepareImageForOcr(buffer);
      } catch (error) {
        console.warn('[ANTI-SCAM] OCR image preprocessing skipped:', error.message);
      }
      const result = await worker.recognize(prepared);
      return classifyScamOcrText(result?.data?.text, result?.data?.confidence);
    });
  // Keep OCR serial: one persistent worker uses far less RAM on small hosting.
  ocrQueue = task.catch(() => undefined);
  return withTimeout(task, config.antiScamOcrTimeoutMs);
}

function isInvalidGeminiKeyError(error) {
  const message = String(error?.message || error || '').toUpperCase();
  return message.includes('API_KEY_INVALID')
    || message.includes('API KEY NOT VALID')
    || message.includes('INVALID API KEY');
}

async function requestVisionVerdict(buffer, mimeType) {
  if (Date.now() < visionDisabledUntil) {
    return { ...normalizeScamVisionResult({
      decision: 'UNCERTAIN',
      reason: 'Gemini vision is in temporary cooldown; local OCR remains active',
    }), scannerUnavailable: true };
  }
  if (!geminiKeys.length) {
    return { ...normalizeScamVisionResult({
      decision: 'UNCERTAIN',
      reason: 'GEMINI_API_KEYS is not configured',
    }), scannerUnavailable: true };
  }

  const attempts = Math.min(2, geminiKeys.length);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const apiKey = getNextKey();
    try {
      const client = new GoogleGenAI({ apiKey });
      const response = await withTimeout(client.models.generateContent({
        model: config.antiScamVisionModel,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { data: buffer.toString('base64'), mimeType } },
            { text: [
              'You are a high-precision security classifier for a Discord store.',
              'Inspect all visible text and imagery. Decide whether this image is a reusable phishing/scam lure posted by a compromised account.',
              'Strong examples: fake MrBeast giveaway; crypto/casino bonus; wallet deposit/withdrawal success bait; claim/activate code; connect wallet; scan QR; free Nitro/Steam gift; impersonated brand promotion; urgent prize or airdrop.',
              'Do NOT mark normal photos, memes, product screenshots, legitimate receipts, artwork, game screenshots, or ordinary MrBeast fan content as scam.',
              'Use SCAM only when the image itself contains clear deceptive promotional or credential/crypto lure signals. Use UNCERTAIN when evidence is incomplete.',
              'List short, concrete signals that are visibly present; never invent text.',
            ].join('\n') },
          ],
        }],
        config: {
          temperature: 0,
          maxOutputTokens: 500,
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['decision', 'confidence', 'category', 'signals', 'visibleText', 'reason'],
            properties: {
              decision: { type: 'string', enum: ['SCAM', 'SAFE', 'UNCERTAIN'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              category: {
                type: 'string',
                enum: [
                  'MRBEAST_CRYPTO_GIVEAWAY',
                  'CRYPTO_CASINO_BONUS',
                  'QR_CREDENTIAL_PHISHING',
                  'FREE_NITRO_GIFT',
                  'BRAND_IMPERSONATION',
                  'OTHER_SCAM',
                  'SAFE_CONTENT',
                  'OTHER',
                ],
              },
              signals: { type: 'array', maxItems: 8, items: { type: 'string' } },
              visibleText: { type: 'string' },
              reason: { type: 'string' },
            },
          },
        },
      }), config.antiScamVisionTimeoutMs);

      const text = responseText(response);
      if (!text) throw new Error('Gemini returned an empty response');
      return normalizeScamVisionResult(JSON.parse(text));
    } catch (error) {
      lastError = error;
      console.error(`[ANTI-SCAM] Vision attempt ${attempt + 1}/${attempts} failed:`, error.message);
      if (isInvalidGeminiKeyError(error)) {
        visionDisabledUntil = Date.now() + VISION_COOLDOWN_MS;
        break;
      }
    }
  }
  return { ...normalizeScamVisionResult({
    decision: 'UNCERTAIN',
    reason: lastError?.message || 'Vision scan failed',
  }), scannerUnavailable: true };
}

export async function scanImageBufferForScam(buffer, mimeType = 'image/png') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new TypeError('A non-empty image Buffer is required');
  }
  let localResult;
  try {
    localResult = await requestLocalOcrVerdict(buffer);
    if (shouldEnforceScamVerdict(localResult)) {
      return { ...localResult, source: 'local-ocr' };
    }
  } catch (error) {
    console.error('[ANTI-SCAM] Local OCR scan failed:', error.message);
    localResult = normalizeScamVisionResult({
      decision: 'UNCERTAIN',
      reason: `Local OCR failed: ${cleanText(error.message, 180)}`,
    });
  }

  const visionResult = await requestVisionVerdict(buffer, mimeType);
  if (shouldEnforceScamVerdict(visionResult)) {
    return { ...visionResult, source: 'gemini-vision' };
  }
  if (visionResult.scannerUnavailable) {
    return { ...localResult, source: 'local-ocr' };
  }
  // Prefer SAFE only when neither scanner saw suspicious partial evidence.
  if (localResult.decision === 'UNCERTAIN' || visionResult.decision === 'UNCERTAIN') {
    const stronger = localResult.confidence >= visionResult.confidence ? localResult : visionResult;
    return { ...stronger, decision: 'UNCERTAIN', source: 'local-ocr+gemini' };
  }
  return { ...localResult, source: 'local-ocr' };
}

async function scanAttachment(attachment) {
  const { buffer, contentType } = await downloadDiscordImage(attachment);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const cached = getCachedFingerprint(sha256);
  if (cached) {
    return {
      ...cached,
      sha256,
      source: 'fingerprint-cache',
      isScam: shouldEnforceScamVerdict(cached),
    };
  }

  let pending = inFlightScans.get(sha256);
  if (!pending) {
    pending = scanImageBufferForScam(buffer, contentType)
      .then((result) => {
        saveFingerprint(sha256, result);
        return result;
      })
      .finally(() => inFlightScans.delete(sha256));
    inFlightScans.set(sha256, pending);
  }
  const result = await pending;
  return {
    ...result,
    sha256,
    source: result.source || 'local-ocr+gemini',
    isScam: shouldEnforceScamVerdict(result),
  };
}

export async function scanScamMessage(message) {
  if (!config.antiScamEnabled || !message?.guildId || message.guildId !== config.guildId) {
    return { scanned: false, isScam: false, reason: 'Scanner disabled for this guild' };
  }
  const attachments = [...message.attachments.values()]
    .filter(isScannableImageAttachment)
    .slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  if (!attachments.length) return { scanned: false, isScam: false, reason: 'No supported images' };

  let scannedCount = 0;
  const errors = [];
  for (const attachment of attachments) {
    try {
      const result = await scanAttachment(attachment);
      scannedCount += 1;
      if (result.isScam) return { ...result, scanned: true, scannedCount };
    } catch (error) {
      errors.push(cleanText(error.message, 160));
      console.error('[ANTI-SCAM] Attachment scan failed:', error.message);
    }
  }
  return {
    scanned: scannedCount > 0,
    scannedCount,
    isScam: false,
    decision: errors.length && scannedCount === 0 ? 'UNCERTAIN' : 'SAFE',
    reason: errors.join(' | ') || 'No high-confidence scam image detected',
  };
}

// Backward-compatible helper for older callers.
export async function isMrBeastScam(message) {
  return Boolean((await scanScamMessage(message)).isScam);
}

export function getLinkWarningCount(userId, guildId) {
  try {
    const row = db.prepare('SELECT warning_count FROM link_warnings WHERE user_id = ? AND guild_id = ?').get(userId, guildId);
    return row ? row.warning_count : 0;
  } catch (error) {
    console.error('[ANTI-SCAM DB] Warning count read failed:', error.message);
    return 0;
  }
}

export function incrementLinkWarningCount(userId, guildId) {
  try {
    db.prepare(`
      INSERT INTO link_warnings (user_id, guild_id, warning_count, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, guild_id) DO UPDATE SET
        warning_count = warning_count + 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(userId, guildId);
    return getLinkWarningCount(userId, guildId);
  } catch (error) {
    console.error('[ANTI-SCAM DB] Warning count update failed:', error.message);
    return 1;
  }
}

export function logAbuseEvent(guildId, userId, action, detail) {
  try {
    db.prepare('INSERT INTO abuse_events (guild_id, user_id, action, detail) VALUES (?, ?, ?, ?)')
      .run(guildId, userId, action, cleanText(detail, 1500));
  } catch (error) {
    console.error('[ANTI-SCAM DB] Abuse log failed:', error.message);
  }
}
