import { db } from '../database/db.js';

export const CLAUDE_PRO_PRODUCT_KEY = 'claude-pro-1-month';
export const CLAUDE_PRO_TERMS_VERSION = 'claude-pro-ios-cdk-2026-11-11-v1';
const ACCEPTANCE_TTL_MS = 15 * 60 * 1000;

export const CLAUDE_PRO_TERMS = Object.freeze([
  'Tài khoản phải được đăng ký trước ngày 15/09/2026, hoàn tất KYC trước khi nạp và không thuộc Team/Organization đã bị khóa hoặc vô hiệu hóa.',
  'Claude đang tăng cường kiểm soát. Apple có thể đã trừ tiền nhưng tài khoản không nhận được gói Pro hoặc mất gói; nạp CDK không bảo đảm kích hoạt thành công 100%.',
  'Nếu tài khoản đủ điều kiện nhưng không nhận được gói, khách dùng Apple ID để yêu cầu Apple hoàn tiền (shop có thể hỗ trợ thao tác). Shop chỉ hoàn sau khi Apple hoàn tiền thành công và shop xác minh đã thực nhận khoản hoàn.',
  'Nếu tài khoản không đủ điều kiện hoặc KYC thất bại, shop không bảo hành việc nạp không lên gói. Khi Apple hoàn tiền thành công, shop khấu trừ 7% phí xử lý và hoàn 93% cho khách.',
  'Shop không ứng trước tiền hoàn dưới mọi hình thức; thời gian và kết quả hoàn phụ thuộc Apple. Chỉ mua khi đã hiểu và chấp nhận các điều kiện, rủi ro và phí xử lý trên.',
]);

export function isClaudeProProduct(product) {
  return String(product?.product_key || product?.productKey || '') === CLAUDE_PRO_PRODUCT_KEY;
}

export function claudeProTermsText({ emoji = slot => slot } = {}) {
  return [
    `## ${emoji('brand_claude')} ĐIỀU KHOẢN CLAUDE PRO 1 THÁNG · CDK iOS`,
    `> ${emoji('status_warn')} Vui lòng đọc kỹ trước khi xác nhận mua. Giá hiện tại vẫn theo bảng giá shop; ví dụ 525.000đ trong chính sách chỉ là ví dụ tính phí, không phải giá bán.`,
    '',
    `${emoji('status_check')} **Điều kiện tài khoản**`,
    `• ${CLAUDE_PRO_TERMS[0]}`,
    '',
    `${emoji('status_warn')} **Rủi ro kích hoạt**`,
    `• ${CLAUDE_PRO_TERMS[1]}`,
    '',
    `${emoji('payment_refund')} **Chính sách hoàn tiền**`,
    ...CLAUDE_PRO_TERMS.slice(2).map(item => `• ${item}`),
  ].join('\n');
}

function ensureAcceptanceTable() {
  db.exec(`CREATE TABLE IF NOT EXISTS claude_pro_terms_acceptances (
    guild_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    product_key TEXT NOT NULL,
    terms_version TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, customer_id, product_key)
  )`);
}

export function acceptClaudeProTerms({ guildId, customerId, productKey = CLAUDE_PRO_PRODUCT_KEY, now = Date.now } = {}) {
  if (!isClaudeProProduct({ product_key: productKey }) || typeof guildId !== 'string' || typeof customerId !== 'string') return false;
  const time = Number(now());
  if (!Number.isSafeInteger(time) || time < 0) return false;
  ensureAcceptanceTable();
  const acceptedAt = new Date(time).toISOString();
  const expiresAt = new Date(time + ACCEPTANCE_TTL_MS).toISOString();
  db.prepare(`INSERT INTO claude_pro_terms_acceptances(guild_id,customer_id,product_key,terms_version,accepted_at,expires_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,customer_id,product_key) DO UPDATE SET terms_version=excluded.terms_version,accepted_at=excluded.accepted_at,expires_at=excluded.expires_at`)
    .run(guildId, customerId, productKey, CLAUDE_PRO_TERMS_VERSION, acceptedAt, expiresAt);
  return true;
}

export function hasAcceptedClaudeProTerms({ guildId, customerId, productKey = CLAUDE_PRO_PRODUCT_KEY, now = Date.now } = {}) {
  if (!isClaudeProProduct({ product_key: productKey }) || typeof guildId !== 'string' || typeof customerId !== 'string') return false;
  const time = Number(now());
  if (!Number.isSafeInteger(time) || time < 0) return false;
  ensureAcceptanceTable();
  const row = db.prepare(`SELECT terms_version,expires_at FROM claude_pro_terms_acceptances
    WHERE guild_id=? AND customer_id=? AND product_key=?`).get(guildId, customerId, productKey);
  return row?.terms_version === CLAUDE_PRO_TERMS_VERSION && Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) > time;
}

export function clearClaudeProTermsAcceptance({ guildId, customerId, productKey = CLAUDE_PRO_PRODUCT_KEY } = {}) {
  if (!isClaudeProProduct({ product_key: productKey }) || typeof guildId !== 'string' || typeof customerId !== 'string') return;
  ensureAcceptanceTable();
  db.prepare('DELETE FROM claude_pro_terms_acceptances WHERE guild_id=? AND customer_id=? AND product_key=?').run(guildId, customerId, productKey);
}
