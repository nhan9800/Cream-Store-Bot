import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const envFileName = process.env.ENV_FILE || '.env';
const envPath = path.resolve(projectRoot, envFileName);
const envExamplePath = path.resolve(projectRoot, '.env.example');
const envFileExists = fs.existsSync(envPath);

dotenv.config({
  path: envPath,
  override: true,
});

function normalizeEnvValue(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function isPlaceholder(name, value) {
  const normalized = normalizeEnvValue(value)?.toUpperCase();
  if (!normalized) return false;

  const placeholders = {
    BOT_TOKEN: ['YOUR_BOT_TOKEN', 'BOT_TOKEN_HERE', 'PASTE_TOKEN_HERE'],
    CLIENT_ID: ['YOUR_CLIENT_ID', 'CLIENT_ID_HERE'],
    GUILD_ID: ['YOUR_GUILD_ID', 'GUILD_ID_HERE'],
    PAYOS_CLIENT_ID: ['YOUR_PAYOS_CLIENT_ID', 'PAYOS_CLIENT_ID_HERE'],
    PAYOS_API_KEY: ['YOUR_PAYOS_API_KEY', 'PAYOS_API_KEY_HERE'],
    PAYOS_CHECKSUM_KEY: ['YOUR_PAYOS_CHECKSUM_KEY', 'PAYOS_CHECKSUM_KEY_HERE'],
  };

  return (placeholders[name] ?? []).includes(normalized);
}

function getEnv(name, fallback = undefined) {
  const value = normalizeEnvValue(process.env[name] ?? fallback);
  if (isPlaceholder(name, value)) return undefined;
  return value;
}

function getBooleanEnv(name, fallback = false) {
  const value = getEnv(name);
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function getMultilineEnv(name, fallback = '') {
  const value = getEnv(name, fallback);
  return String(value ?? '').replace(/\\n/g, '\n');
}

function parseNumberEnv(name, fallback) {
  const value = getEnv(name, fallback);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number(fallback);
}

function pathWithLeadingSlash(value, fallback) {
  const raw = getEnv(value, fallback) ?? fallback;
  if (!raw.startsWith('/')) return `/${raw}`;
  return raw;
}


export const environmentInfo = {
  cwd: process.cwd(),
  projectRoot,
  envPath,
  envExamplePath,
  envFileExists,
};

const isStoreTwoEnvironment = getEnv('GUILD_ID') === '1070676180103086132';

export const config = {
  botToken: getEnv('BOT_TOKEN'),
  clientId: getEnv('CLIENT_ID'),
  guildId: getEnv('GUILD_ID'),
  databasePath: getEnv('DATABASE_PATH', './data/shopbot.sqlite'),
  feedbackTimeoutHours: Number.parseInt(getEnv('FEEDBACK_TIMEOUT_HOURS', '48'), 10),
  defaultDeliveryNotes: getMultilineEnv(
    isStoreTwoEnvironment ? 'GLOBAL_DEFAULT_DELIVERY_NOTES' : 'DEFAULT_DELIVERY_NOTES',
    isStoreTwoEnvironment
      ? 'Change the password after delivery when the product terms allow it. Never share the account. Open a support ticket if you need help.'
      : 'Vui lòng đổi mật khẩu ngay sau khi đăng nhập. Không chia sẻ tài khoản cho người khác. Nếu có vấn đề, hãy mở ticket ngay.',
  ),
  defaultDeliveryTerms: getMultilineEnv(
    isStoreTwoEnvironment ? 'GLOBAL_DEFAULT_DELIVERY_TERMS' : 'DEFAULT_DELIVERY_TERMS',
    (isStoreTwoEnvironment ? [
      'DO NOT change the account/profile name or primary language unless the product terms allow it.',
      'DO NOT change the email, phone number, login details or password unless staff explicitly confirms it is permitted.',
      'DO NOT add, edit or remove payment methods, users or profiles.',
      'DO NOT use sign-out-all-devices or share/resell the delivered account.',
      'DO NOT use the service on more devices than the selected package allows.',
      '',
      'Warranty support is available for the eligible duration shown on the order.',
    ] : [
      'KHÔNG: đổi tên, ngôn ngữ tài khoản/profile (có thể đổi ngôn ngữ phụ đề).',
      'KHÔNG: đổi email, số điện thoại, thông tin đăng nhập và mật khẩu.',
      'KHÔNG: thêm, sửa, xoá phương thức thanh toán.',
      'KHÔNG: thêm, sửa, xoá user hoặc profile.',
      'KHÔNG: sử dụng tính năng đăng xuất tất cả thiết bị.',
      'KHÔNG: chia sẻ, bán lại tài khoản.',
      'KHÔNG: sử dụng 2 thiết bị cùng lúc.',
      '',
      '💬 Hỗ trợ bảo hành sản phẩm suốt thời gian sử dụng.',
    ]).join('\n'),
  ),
  defaultWarrantyNote: getMultilineEnv(
    isStoreTwoEnvironment ? 'GLOBAL_DEFAULT_WARRANTY_NOTE' : 'DEFAULT_WARRANTY_NOTE',
    isStoreTwoEnvironment
      ? 'For warranty support, use the /warranty command or the Product Warranty button in the support panel.'
      : 'Nếu cần bảo hành, hãy sử dụng lệnh /baohanh hoặc nút bảo hành trong ticket.',
  ),
  defaultWarrantyDurationDays: Number.parseInt(getEnv('DEFAULT_WARRANTY_DURATION_DAYS', '30'), 10),
  defaultLoginUrl: getEnv('DEFAULT_LOGIN_URL', 'https://www.netflix.com/login'),
  sendTranscriptToCustomer: getBooleanEnv('SEND_TRANSCRIPT_TO_CUSTOMER', true),
  storeName: isStoreTwoEnvironment ? getEnv('GLOBAL_STORE_NAME', 'Cenar Global') : getEnv('STORE_NAME', 'Cenar Store'),
  storeLocale: isStoreTwoEnvironment ? getEnv('GLOBAL_STORE_LOCALE', 'en-US') : getEnv('STORE_LOCALE', 'vi-VN'),
  storeCurrency: (isStoreTwoEnvironment ? getEnv('GLOBAL_STORE_CURRENCY', 'USD') : getEnv('STORE_CURRENCY', 'VND') || '').toUpperCase(),
  storePriceSourceCurrency: (getEnv('STORE_PRICE_SOURCE_CURRENCY', 'VND') || 'VND').toUpperCase(),
  storeVndPerUsd: parseNumberEnv('STORE_VND_PER_USD', '26000'),
  storeFooter: isStoreTwoEnvironment
    ? getEnv('GLOBAL_STORE_FOOTER', 'Cenar Global • International Digital Services')
    : getEnv('STORE_FOOTER', 'Cenar Store'),
  storeIconUrl: getEnv('STORE_ICON_URL', ''),
  shipperName: isStoreTwoEnvironment ? getEnv('GLOBAL_SHIPPER_NAME', 'Cenar Global Delivery') : getEnv('SHIPPER_NAME', 'Cenar Shipper'),
  shipperFooter: isStoreTwoEnvironment ? getEnv('GLOBAL_SHIPPER_FOOTER', 'Cenar Global') : getEnv('SHIPPER_FOOTER', 'Cenar Store'),
  shipperIconUrl: getEnv('SHIPPER_ICON_URL', ''),
  paymentImageUrl: getEnv('PAYMENT_IMAGE_URL', ''),
  paymentThumbnailUrl: getEnv('PAYMENT_THUMBNAIL_URL', ''),
  deliveryBannerUrl: getEnv('DELIVERY_BANNER_URL', ''),
  publicBaseUrl: getEnv('PUBLIC_BASE_URL', ''),
  // Trang cửa hàng người dùng nhìn thấy. Tách khỏi PUBLIC_BASE_URL vì biến đó
  // có thể là địa chỉ callback/hosting nội bộ dành cho PayOS.
  storeWebsiteUrl: getEnv('STORE_WEBSITE_URL', 'https://cenarstore.xyz'),
  // Domain cho link transcript — fallback về PUBLIC_BASE_URL nếu không set riêng
  transcriptBaseUrl: getEnv('TRANSCRIPT_BASE_URL', '') || getEnv('PUBLIC_BASE_URL', ''),
  transcriptRetentionDays: Number.parseInt(getEnv('TRANSCRIPT_RETENTION_DAYS', '30'), 10),
  // Transcript v2 is a compressed, capability-link archive. Keep the logical
  // archive for ten years by default while only retaining a short local cache
  // when a verified Discord mirror exists.
  transcriptViewerBaseUrl: getEnv('TRANSCRIPT_VIEWER_BASE_URL', '') || getEnv('STORE_WEBSITE_URL', 'https://cenarstore.xyz'),
  transcriptArchiveRetentionDays: Number.parseInt(getEnv('TRANSCRIPT_ARCHIVE_RETENTION_DAYS', '3650'), 10),
  transcriptHotCacheDays: Number.parseInt(getEnv('TRANSCRIPT_HOT_CACHE_DAYS', '90'), 10),
  transcriptArchiveMaxBytes: Number.parseInt(getEnv('TRANSCRIPT_ARCHIVE_MAX_BYTES', '26214400'), 10),
  httpPort: Number.parseInt(getEnv('INTERNAL_HTTP_PORT', getEnv('HTTP_PORT', '3000')), 10),
  paymentProvider: (getEnv('PAYMENT_PROVIDER', 'PAYOS') ?? 'PAYOS').toUpperCase(),
  payosClientId: getEnv('PAYOS_CLIENT_ID', ''),
  payosApiKey: getEnv('PAYOS_API_KEY', ''),
  payosChecksumKey: getEnv('PAYOS_CHECKSUM_KEY', ''),
  payosWebhookPath: pathWithLeadingSlash('PAYOS_WEBHOOK_PATH', '/webhooks/payos'),
  payosReturnPath: pathWithLeadingSlash('PAYOS_RETURN_PATH', '/payments/payos/return'),
  payosCancelPath: pathWithLeadingSlash('PAYOS_CANCEL_PATH', '/payments/payos/cancel'),
  payosAutoConfirmWebhook: getBooleanEnv('PAYOS_AUTO_CONFIRM_WEBHOOK', false),
  payosExpireMinutes: Number.parseInt(getEnv('PAYOS_EXPIRE_MINUTES', '60'), 10),
  binancePayEnabled: getBooleanEnv('BINANCE_PAY_ENABLED', false),
  binancePayApiKey: getEnv('BINANCE_PAY_API_KEY', ''),
  binancePaySecretKey: getEnv('BINANCE_PAY_SECRET_KEY', ''),
  binancePayApiBase: getEnv('BINANCE_PAY_API_BASE', 'https://bpay.binanceapi.com'),
  binancePayCurrency: (getEnv('BINANCE_PAY_CURRENCY', 'USDT') || 'USDT').toUpperCase(),
  binancePayCurrencies: (getEnv('BINANCE_PAY_CURRENCIES', 'USDT,USDC') || 'USDT,USDC')
    .split(',').map((value) => value.trim().toUpperCase()).filter(Boolean),
  binancePayWebhookPath: pathWithLeadingSlash(
    'BINANCE_PAY_WEBHOOK_PATH',
    isStoreTwoEnvironment ? '/webhooks/binance-pay-store2' : '/webhooks/binance-pay',
  ),
  binancePayReturnPath: pathWithLeadingSlash(
    'BINANCE_PAY_RETURN_PATH',
    isStoreTwoEnvironment ? '/payments/binance-pay-store2/return' : '/payments/binance-pay/return',
  ),
  binancePayCancelPath: pathWithLeadingSlash(
    'BINANCE_PAY_CANCEL_PATH',
    isStoreTwoEnvironment ? '/payments/binance-pay-store2/cancel' : '/payments/binance-pay/cancel',
  ),
  binancePayExpireMinutes: Number.parseInt(getEnv('BINANCE_PAY_EXPIRE_MINUTES', '60'), 10),
  // VietQR fallback (dùng khi guild chưa setup-bank)
  vietqrBankBin: getEnv('VIETQR_BANK_BIN', '970418'),
  vietqrAccountNo: getEnv('VIETQR_ACCOUNT_NO', ''),
  vietqrAccountName: getEnv('VIETQR_ACCOUNT_NAME', isStoreTwoEnvironment ? 'CENAR GLOBAL' : 'CREAM STORE'),
  customerRoleThreshold: Number.parseInt(getEnv('CUSTOMER_ROLE_THRESHOLD', '1'), 10),
  loyalRoleThreshold: Number.parseInt(getEnv('LOYAL_ROLE_THRESHOLD', '3'), 10),
  vipRoleThreshold: Number.parseInt(getEnv('VIP_ROLE_THRESHOLD', '10'), 10),
  pendingPaymentReminderMinutes: Number.parseInt(getEnv('PENDING_PAYMENT_REMINDER_MINUTES', '15'), 10),
  processingReminderMinutes: Number.parseInt(getEnv('PROCESSING_REMINDER_MINUTES', '60'), 10),
  adminDiscordIds: (getEnv('ADMIN_DISCORD_IDS') || '').split(',').map(id => id.trim()).filter(Boolean),
  ownerRoleIds: (getEnv('OWNER_ROLE_IDS', '1282638119497109524') || '').split(',').map(id => id.trim()).filter(Boolean),
  storeOneGuildId: getEnv('STORE1_GUILD_ID', '1282637033340403754'),
  ctvMultiTicketRoleIds: (getEnv('CTV_MULTI_TICKET_ROLE_IDS', '1522844530242748446') || '')
    .split(',').map(id => id.trim()).filter(Boolean),
  ctvTicketOpenBurstLimit: Math.max(2, Number.parseInt(getEnv('CTV_TICKET_OPEN_BURST_LIMIT', '5'), 10) || 5),
  ctvTicketOpenBurstWindowSeconds: Math.max(10, Number.parseInt(getEnv('CTV_TICKET_OPEN_BURST_WINDOW_SECONDS', '60'), 10) || 60),
  adminOrderReminderWeekOneDays: Math.max(1, Number.parseInt(getEnv('ADMIN_ORDER_REMINDER_WEEK_ONE_DAYS', '7'), 10) || 7),
  adminOrderReminderWeekTwoDays: Math.max(2, Number.parseInt(getEnv('ADMIN_ORDER_REMINDER_WEEK_TWO_DAYS', '14'), 10) || 14),
  protectedOwnerId: getEnv('PROTECTED_OWNER_ID', '1138315103821889566'),
  nitroRoleIds: (getEnv('DISCORD_NITRO_ROLE_IDS') || '').split(',').map(id => id.trim()).filter(Boolean),
  nitroUserIds: (getEnv('DISCORD_NITRO_USER_IDS', '1138315103821889566') || '').split(',').map(id => id.trim()).filter(Boolean),
  groqApiKey: getEnv('GROQ_API_KEY', getEnv('OPENROUTER_API_KEY', '')), // Dùng chung biến để tiện cho user nếu họ nhác sửa
  aiModel: getEnv('AI_MODEL', 'llama-3.3-70b-versatile'),
  antiScamEnabled: getBooleanEnv('ANTI_SCAM_ENABLED', !isStoreTwoEnvironment),
  antiScamVisionModel: getEnv('ANTI_SCAM_VISION_MODEL', 'gemini-2.5-flash'),
  antiScamConfidenceThreshold: parseNumberEnv('ANTI_SCAM_CONFIDENCE_THRESHOLD', '0.9'),
  antiScamQuarantineMinutes: Math.max(5, Number.parseInt(getEnv('ANTI_SCAM_QUARANTINE_MINUTES', '30'), 10) || 30),
  antiScamMaxImageBytes: Math.max(1, parseNumberEnv('ANTI_SCAM_MAX_IMAGE_MB', '8')) * 1024 * 1024,
  antiScamDownloadTimeoutMs: Math.max(2000, Number.parseInt(getEnv('ANTI_SCAM_DOWNLOAD_TIMEOUT_MS', '8000'), 10) || 8000),
  antiScamOcrTimeoutMs: Math.max(10000, Number.parseInt(getEnv('ANTI_SCAM_OCR_TIMEOUT_MS', '30000'), 10) || 30000),
  antiScamVisionTimeoutMs: Math.max(5000, Number.parseInt(getEnv('ANTI_SCAM_VISION_TIMEOUT_MS', '20000'), 10) || 20000),
  aiSystemPrompt: getMultilineEnv(
    isStoreTwoEnvironment ? 'GLOBAL_AI_SYSTEM_PROMPT' : 'AI_SYSTEM_PROMPT',
    isStoreTwoEnvironment
      ? 'You are the Cenar Global customer assistant. Reply clearly, professionally and concisely in English.'
      : 'Bạn là trợ lý AI thân thiện của Cenar Store. Hãy tư vấn nhiệt tình và ngắn gọn.',
  ),


  ticketOpenCooldownSeconds: Number.parseInt(getEnv('TICKET_OPEN_COOLDOWN_SECONDS', '120'), 10),
  buttonCooldownSeconds: Number.parseInt(getEnv('BUTTON_COOLDOWN_SECONDS', '3'), 10),
  orderCreateBurstWindowSeconds: Number.parseInt(getEnv('ORDER_CREATE_BURST_WINDOW_SECONDS', '30'), 10),
  orderCreateBurstLimit: Number.parseInt(getEnv('ORDER_CREATE_BURST_LIMIT', '2'), 10),
  autoCloseCompletedTicketMinutes: Number.parseInt(getEnv('AUTO_CLOSE_COMPLETED_TICKET_MINUTES', '2'), 10),
  defaultOrderDurationMonths: Number.parseInt(getEnv('DEFAULT_ORDER_DURATION_MONTHS', '1'), 10),
  expiryReminderDaysBeforeFirst: Number.parseInt(getEnv('EXPIRY_REMINDER_DAYS_BEFORE_FIRST', '2'), 10),
  expiryReminderDaysBeforeSecond: Number.parseInt(getEnv('EXPIRY_REMINDER_DAYS_BEFORE_SECOND', '1'), 10),
  subscriptionAdminReminderDays: Math.min(30, Math.max(3, Number.parseInt(getEnv('SUBSCRIPTION_ADMIN_REMINDER_DAYS', '7'), 10) || 7)),
  subscriptionAdminSnoozeHours: Math.min(168, Math.max(1, Number.parseInt(getEnv('SUBSCRIPTION_ADMIN_SNOOZE_HOURS', '24'), 10) || 24)),
  accentColorPrimary: parseNumberEnv('ACCENT_COLOR_PRIMARY', '0xF3A6D7'),
  accentColorSuccess: parseNumberEnv('ACCENT_COLOR_SUCCESS', '0x57F287'),
  accentColorWarning: parseNumberEnv('ACCENT_COLOR_WARNING', '0xFEE75C'),
  accentColorInfo: parseNumberEnv('ACCENT_COLOR_INFO', '0x5865F2'),
  accentColorDanger: parseNumberEnv('ACCENT_COLOR_DANGER', '0xED4245'),
};

function buildEnvError(prefix, missing) {
  const extra = [];

  if (!environmentInfo.envFileExists) {
    extra.push(`Không tìm thấy file .env tại: ${environmentInfo.envPath}`);
    extra.push(`Hãy copy ${environmentInfo.envExamplePath} thành ${environmentInfo.envPath}`);
  } else {
    extra.push(`Bot đang đọc file môi trường tại: ${environmentInfo.envPath}`);
  }

  extra.push(`Thư mục chạy hiện tại: ${environmentInfo.cwd}`);
  extra.push('Nếu deploy vẫn hiện YOUR_CLIENT_ID hoặc YOUR_GUILD_ID thì bạn đang sửa nhầm file .env.');

  return `${prefix}: ${missing.join(', ')}\n${extra.join('\n')}`;
}

function collectInvalidEnv(mode) {
  const missing = [];

  if (!config.botToken || String(config.botToken).length < 20) {
    missing.push('BOT_TOKEN');
  }

  if (mode === 'deploy') {
    if (!config.clientId || !/^\d{17,20}$/.test(String(config.clientId))) {
      missing.push('CLIENT_ID');
    }

    if (!config.guildId || !/^\d{17,20}$/.test(String(config.guildId))) {
      missing.push('GUILD_ID');
    }
  }

  return missing;
}

export function collectPaymentConfigIssues() {
  const issues = [];

  if (!['PAYOS', 'BINANCE_PAY'].includes(config.paymentProvider)) {
    issues.push('PAYMENT_PROVIDER must be PAYOS or BINANCE_PAY.');
  }

  if (config.paymentProvider === 'PAYOS') {
    if (!config.payosClientId) issues.push('Thiếu PAYOS_CLIENT_ID');
    if (!config.payosApiKey) issues.push('Thiếu PAYOS_API_KEY');
    if (!config.payosChecksumKey) issues.push('Thiếu PAYOS_CHECKSUM_KEY');
  }
  if (config.paymentProvider === 'BINANCE_PAY' || config.binancePayEnabled) {
    if (!config.binancePayApiKey) issues.push('Missing BINANCE_PAY_API_KEY');
    if (!config.binancePaySecretKey) issues.push('Missing BINANCE_PAY_SECRET_KEY');
  }
  if (!config.publicBaseUrl) issues.push('Missing PUBLIC_BASE_URL for payment callbacks.');

  return issues;
}

export function assertRuntimeConfig() {
  const missing = collectInvalidEnv('runtime');
  if (missing.length) {
    throw new Error(buildEnvError('Thiếu hoặc sai biến môi trường', missing));
  }
}

export function assertDeployConfig() {
  const missing = collectInvalidEnv('deploy');
  if (missing.length) {
    throw new Error(buildEnvError('Thiếu hoặc sai biến môi trường để deploy slash commands', missing));
  }
}

export function assertPaymentConfig() {
  const issues = collectPaymentConfigIssues();
  if (issues.length) {
    throw new Error(issues.join('\n'));
  }
}

export function getPublicUrl(pathValue = '') {
  if (!config.publicBaseUrl) return null;
  const base = config.publicBaseUrl.replace(/\/$/, '');
  const safePath = pathValue ? (pathValue.startsWith('/') ? pathValue : `/${pathValue}`) : '';
  return `${base}${safePath}`;
}

export function getTranscriptUrl(pathValue = '') {
  if (!config.transcriptBaseUrl) return null;
  const base = config.transcriptBaseUrl.replace(/\/$/, '');
  const safePath = pathValue ? (pathValue.startsWith('/') ? pathValue : `/${pathValue}`) : '';
  return `${base}${safePath}`;
}

export function getTranscriptViewerUrl(accessToken = '') {
  const token = String(accessToken || '').trim();
  if (!config.transcriptViewerBaseUrl || !token) return null;
  const base = config.transcriptViewerBaseUrl.replace(/\/$/, '');
  return `${base}/transcripts/${encodeURIComponent(token)}`;
}

export function getWebhookUrl() {
  return getPublicUrl(config.payosWebhookPath);
}

export function getPayOSReturnUrl() {
  return getPublicUrl(config.payosReturnPath);
}

export function getPayOSCancelUrl() {
  return getPublicUrl(config.payosCancelPath);
}

export function getBinancePayWebhookUrl() {
  return getPublicUrl(config.binancePayWebhookPath);
}

export function getBinancePayReturnUrl() {
  return getPublicUrl(config.binancePayReturnPath);
}

export function getBinancePayCancelUrl() {
  return getPublicUrl(config.binancePayCancelPath);
}
