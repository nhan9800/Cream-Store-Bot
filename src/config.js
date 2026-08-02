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

export const config = {
  botToken: getEnv('BOT_TOKEN'),
  clientId: getEnv('CLIENT_ID'),
  guildId: getEnv('GUILD_ID'),
  databasePath: getEnv('DATABASE_PATH', './data/shopbot.sqlite'),
  feedbackTimeoutHours: Number.parseInt(getEnv('FEEDBACK_TIMEOUT_HOURS', '48'), 10),
  defaultDeliveryNotes: getMultilineEnv(
    'DEFAULT_DELIVERY_NOTES',
    'Vui lòng đổi mật khẩu ngay sau khi đăng nhập. Không chia sẻ tài khoản cho người khác. Nếu có vấn đề, hãy mở ticket ngay.',
  ),
  defaultDeliveryTerms: getMultilineEnv(
    'DEFAULT_DELIVERY_TERMS',
    [
      'KHÔNG: đổi tên, ngôn ngữ tài khoản/profile (có thể đổi ngôn ngữ phụ đề).',
      'KHÔNG: đổi email, số điện thoại, thông tin đăng nhập và mật khẩu.',
      'KHÔNG: thêm, sửa, xoá phương thức thanh toán.',
      'KHÔNG: thêm, sửa, xoá user hoặc profile.',
      'KHÔNG: sử dụng tính năng đăng xuất tất cả thiết bị.',
      'KHÔNG: chia sẻ, bán lại tài khoản.',
      'KHÔNG: sử dụng 2 thiết bị cùng lúc.',
      '',
      '💬 Hỗ trợ bảo hành sản phẩm suốt thời gian sử dụng.',
    ].join('\n'),
  ),
  defaultWarrantyNote: getMultilineEnv(
    'DEFAULT_WARRANTY_NOTE',
    'Nếu cần bảo hành, hãy sử dụng lệnh /baohanh hoặc nút bảo hành trong ticket.',
  ),
  defaultWarrantyDurationDays: Number.parseInt(getEnv('DEFAULT_WARRANTY_DURATION_DAYS', '30'), 10),
  defaultLoginUrl: getEnv('DEFAULT_LOGIN_URL', 'https://www.netflix.com/login'),
  sendTranscriptToCustomer: getBooleanEnv('SEND_TRANSCRIPT_TO_CUSTOMER', true),
  storeName: getEnv('STORE_NAME', 'Cenar Store'),
  storeFooter: getEnv('STORE_FOOTER', 'Cenar Store'),
  storeIconUrl: getEnv('STORE_ICON_URL', ''),
  shipperName: getEnv('SHIPPER_NAME', 'Cenar Shipper'),
  shipperFooter: getEnv('SHIPPER_FOOTER', 'Cenar Store'),
  shipperIconUrl: getEnv('SHIPPER_ICON_URL', ''),
  paymentImageUrl: getEnv('PAYMENT_IMAGE_URL', ''),
  paymentThumbnailUrl: getEnv('PAYMENT_THUMBNAIL_URL', ''),
  deliveryBannerUrl: getEnv('DELIVERY_BANNER_URL', ''),
  publicBaseUrl: getEnv('PUBLIC_BASE_URL', ''),
  // Domain cho link transcript — fallback về PUBLIC_BASE_URL nếu không set riêng
  transcriptBaseUrl: getEnv('TRANSCRIPT_BASE_URL', '') || getEnv('PUBLIC_BASE_URL', ''),
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
  // VietQR fallback (dùng khi guild chưa setup-bank)
  vietqrBankBin: getEnv('VIETQR_BANK_BIN', '970418'),
  vietqrAccountNo: getEnv('VIETQR_ACCOUNT_NO', ''),
  vietqrAccountName: getEnv('VIETQR_ACCOUNT_NAME', 'CREAM STORE'),
  customerRoleThreshold: Number.parseInt(getEnv('CUSTOMER_ROLE_THRESHOLD', '1'), 10),
  loyalRoleThreshold: Number.parseInt(getEnv('LOYAL_ROLE_THRESHOLD', '3'), 10),
  vipRoleThreshold: Number.parseInt(getEnv('VIP_ROLE_THRESHOLD', '10'), 10),
  pendingPaymentReminderMinutes: Number.parseInt(getEnv('PENDING_PAYMENT_REMINDER_MINUTES', '15'), 10),
  processingReminderMinutes: Number.parseInt(getEnv('PROCESSING_REMINDER_MINUTES', '60'), 10),
  adminDiscordIds: (getEnv('ADMIN_DISCORD_IDS') || '').split(',').map(id => id.trim()).filter(Boolean),
  ownerRoleIds: (getEnv('OWNER_ROLE_IDS', '1282638119497109524') || '').split(',').map(id => id.trim()).filter(Boolean),
  nitroRoleIds: (getEnv('DISCORD_NITRO_ROLE_IDS') || '').split(',').map(id => id.trim()).filter(Boolean),
  nitroUserIds: (getEnv('DISCORD_NITRO_USER_IDS', '1138315103821889566') || '').split(',').map(id => id.trim()).filter(Boolean),
  groqApiKey: getEnv('GROQ_API_KEY', getEnv('OPENROUTER_API_KEY', '')), // Dùng chung biến để tiện cho user nếu họ nhác sửa
  aiModel: getEnv('AI_MODEL', 'llama-3.3-70b-versatile'),
  aiSystemPrompt: getMultilineEnv('AI_SYSTEM_PROMPT', 'Bạn là trợ lý AI thân thiện của Cenar Store. Hãy tư vấn nhiệt tình và ngắn gọn.'),


  ticketOpenCooldownSeconds: Number.parseInt(getEnv('TICKET_OPEN_COOLDOWN_SECONDS', '120'), 10),
  buttonCooldownSeconds: Number.parseInt(getEnv('BUTTON_COOLDOWN_SECONDS', '3'), 10),
  orderCreateBurstWindowSeconds: Number.parseInt(getEnv('ORDER_CREATE_BURST_WINDOW_SECONDS', '30'), 10),
  orderCreateBurstLimit: Number.parseInt(getEnv('ORDER_CREATE_BURST_LIMIT', '2'), 10),
  autoCloseCompletedTicketMinutes: Number.parseInt(getEnv('AUTO_CLOSE_COMPLETED_TICKET_MINUTES', '2'), 10),
  defaultOrderDurationMonths: Number.parseInt(getEnv('DEFAULT_ORDER_DURATION_MONTHS', '1'), 10),
  expiryReminderDaysBeforeFirst: Number.parseInt(getEnv('EXPIRY_REMINDER_DAYS_BEFORE_FIRST', '2'), 10),
  expiryReminderDaysBeforeSecond: Number.parseInt(getEnv('EXPIRY_REMINDER_DAYS_BEFORE_SECOND', '1'), 10),
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

  if (config.paymentProvider !== 'PAYOS') {
    issues.push('PAYMENT_PROVIDER phải là PAYOS cho bản v7 này.');
  }

  if (!config.payosClientId) issues.push('Thiếu PAYOS_CLIENT_ID');
  if (!config.payosApiKey) issues.push('Thiếu PAYOS_API_KEY');
  if (!config.payosChecksumKey) issues.push('Thiếu PAYOS_CHECKSUM_KEY');
  if (!config.publicBaseUrl) issues.push('Thiếu PUBLIC_BASE_URL để PayOS gọi webhook / return / cancel URL');

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

export function getWebhookUrl() {
  return getPublicUrl(config.payosWebhookPath);
}

export function getPayOSReturnUrl() {
  return getPublicUrl(config.payosReturnPath);
}

export function getPayOSCancelUrl() {
  return getPublicUrl(config.payosCancelPath);
}
