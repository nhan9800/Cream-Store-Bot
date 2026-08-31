import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { db, nowIso } from '../database/db.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { accentFor } from '../utils/uiKit.js';
import { completeWarranty } from './orderService.js';

export const YOUTUBE_GUIDE_CHANNEL_ID = '1524057155022491679';
export const YOUTUBE_GUIDE_URL = `https://discord.com/channels/1282637033340403754/${YOUTUBE_GUIDE_CHANNEL_ID}`;

const CLAIM_STATUSES = new Set(['AWAITING_CUSTOMER', 'SUBMITTED', 'COMPLETED', 'CANCELLED']);
const GMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(gmail\.com|googlemail\.com)$/i;

export class YoutubeWarrantyClaimError extends Error {
  constructor(message, code = 'INVALID_REQUEST') {
    super(message);
    this.name = 'YoutubeWarrantyClaimError';
    this.code = code;
  }
}

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function createAccessToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function createClaimCode() {
  return `YW_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function maskEmail(email) {
  const value = text(email, 254);
  const [local = '', domain = ''] = value.split('@');
  if (!domain) return '';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'•'.repeat(Math.max(4, Math.min(8, local.length - visible.length)))}@${domain}`;
}

function normalizeGmail(value) {
  const email = text(value, 254).toLowerCase();
  if (!GMAIL_PATTERN.test(email)) {
    throw new YoutubeWarrantyClaimError('Vui lòng nhập đúng địa chỉ Gmail dùng để nhận lời mời YouTube Family.', 'INVALID_GMAIL');
  }
  return email;
}

function isYoutubeOrder(order) {
  const identity = `${order?.product_name || ''} ${order?.service_type || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return identity.includes('youtube');
}

function claimUrl(rawToken) {
  const base = String(config.storeWebsiteUrl || 'https://cenarstore.xyz').replace(/\/$/, '');
  return `${base}/youtube-warranty/${encodeURIComponent(rawToken)}`;
}

function hydrateClaim(row, { includeToken = false, includeEmail = true } = {}) {
  if (!row) return null;
  const customerGmail = includeEmail && row.customer_gmail ? decrypt(row.customer_gmail) : null;
  const rawToken = includeToken ? decrypt(row.access_token_encrypted) : null;
  return {
    id: Number(row.id),
    claimCode: row.claim_code,
    guildId: row.guild_id,
    orderCode: row.order_code,
    ticketId: Number(row.ticket_id),
    ticketCode: row.ticket_code || null,
    ticketChannelId: row.ticket_channel_id,
    customerId: row.customer_id,
    productName: row.product_name || 'YouTube Premium',
    status: CLAIM_STATUSES.has(row.status) ? row.status : 'AWAITING_CUSTOMER',
    customerGmail,
    customerGmailMasked: customerGmail ? maskEmail(customerGmail) : null,
    formUrl: rawToken ? claimUrl(rawToken) : null,
    notificationMessageId: row.notification_message_id || null,
    submittedAt: row.submitted_at || null,
    completedAt: row.completed_at || null,
    completedById: row.completed_by_id || null,
    completionNote: row.completion_note || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision || 0),
  };
}

const CLAIM_SELECT = `
  SELECT c.*, o.product_name, t.ticket_code
  FROM youtube_warranty_claims c
  LEFT JOIN orders o ON o.order_code = c.order_code
  LEFT JOIN tickets t ON t.id = c.ticket_id
`;

export function getYoutubeWarrantyClaim(id, options = {}) {
  const row = db.prepare(`${CLAIM_SELECT} WHERE c.id = ? LIMIT 1`).get(Number(id));
  return hydrateClaim(row, options);
}

export function getYoutubeWarrantyClaimByTicket(ticketId, options = {}) {
  const row = db.prepare(`${CLAIM_SELECT} WHERE c.ticket_id = ? LIMIT 1`).get(Number(ticketId));
  return hydrateClaim(row, options);
}

export function getYoutubeWarrantyClaimByToken(token) {
  const rawToken = text(token, 200);
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(rawToken)) return null;
  const row = db.prepare(`${CLAIM_SELECT} WHERE c.access_token_hash = ? LIMIT 1`).get(hashToken(rawToken));
  return hydrateClaim(row, { includeEmail: true, includeToken: false });
}

export function getPublicYoutubeWarrantyClaim(token) {
  const claim = getYoutubeWarrantyClaimByToken(token);
  if (!claim) return null;
  return {
    claimCode: claim.claimCode,
    orderCode: claim.orderCode,
    productName: claim.productName,
    status: claim.status,
    customerGmailMasked: claim.customerGmailMasked,
    submittedAt: claim.submittedAt,
    completedAt: claim.completedAt,
    guideChannelId: YOUTUBE_GUIDE_CHANNEL_ID,
    guideUrl: YOUTUBE_GUIDE_URL,
  };
}

export function ensureYoutubeWarrantyClaim({ order, ticket }) {
  if (!order || !ticket) throw new YoutubeWarrantyClaimError('Thiếu dữ liệu đơn hoặc ticket bảo hành.');
  if (!isYoutubeOrder(order)) throw new YoutubeWarrantyClaimError('Đơn hàng này không phải YouTube.', 'NOT_YOUTUBE');

  const existing = getYoutubeWarrantyClaimByTicket(ticket.id, { includeToken: true });
  if (existing) return { claim: existing, created: false };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rawToken = createAccessToken();
    try {
      const result = db.prepare(`
        INSERT INTO youtube_warranty_claims (
          claim_code, access_token_hash, access_token_encrypted, guild_id,
          order_code, ticket_id, ticket_channel_id, customer_id, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AWAITING_CUSTOMER', ?, ?)
      `).run(
        createClaimCode(), hashToken(rawToken), encrypt(rawToken), order.guild_id,
        order.order_code, Number(ticket.id), ticket.channel_id, order.customer_id,
        nowIso(), nowIso(),
      );
      return { claim: getYoutubeWarrantyClaim(result.lastInsertRowid, { includeToken: true }), created: true };
    } catch (error) {
      if (/youtube_warranty_claims\.ticket_id/i.test(String(error?.message || ''))) {
        return { claim: getYoutubeWarrantyClaimByTicket(ticket.id, { includeToken: true }), created: false };
      }
      if (!/UNIQUE constraint failed/i.test(String(error?.message || '')) || attempt === 4) throw error;
    }
  }
  throw new YoutubeWarrantyClaimError('Không thể tạo mã bảo hành an toàn.', 'TOKEN_CREATE_FAILED');
}

export function submitYoutubeWarrantyGmail(token, gmail) {
  const claim = getYoutubeWarrantyClaimByToken(token);
  if (!claim) throw new YoutubeWarrantyClaimError('Liên kết bảo hành không tồn tại hoặc đã hết hiệu lực.', 'NOT_FOUND');
  if (claim.status === 'COMPLETED') {
    throw new YoutubeWarrantyClaimError('Hồ sơ này đã được shop bảo hành xong.', 'ALREADY_COMPLETED');
  }
  if (claim.status === 'CANCELLED') {
    throw new YoutubeWarrantyClaimError('Hồ sơ bảo hành đã bị hủy.', 'CANCELLED');
  }

  const normalizedGmail = normalizeGmail(gmail);
  const updatedAt = nowIso();
  const result = db.prepare(`
    UPDATE youtube_warranty_claims
    SET customer_gmail = ?, status = 'SUBMITTED', submitted_at = ?, updated_at = ?, revision = revision + 1
    WHERE id = ? AND status IN ('AWAITING_CUSTOMER', 'SUBMITTED')
  `).run(encrypt(normalizedGmail), updatedAt, updatedAt, claim.id);
  if (!result.changes) throw new YoutubeWarrantyClaimError('Hồ sơ vừa được xử lý, vui lòng tải lại trang.', 'STALE_STATUS');
  return getYoutubeWarrantyClaim(claim.id, { includeEmail: true });
}

export function listYoutubeWarrantyClaims(guildId, { status = 'ALL', search = '', limit = 250 } = {}) {
  const normalizedStatus = text(status, 40).toUpperCase();
  const rows = db.prepare(`
    ${CLAIM_SELECT}
    WHERE c.guild_id = ?
      AND (? = 'ALL' OR c.status = ?)
    ORDER BY
      CASE c.status WHEN 'SUBMITTED' THEN 0 WHEN 'AWAITING_CUSTOMER' THEN 1 WHEN 'COMPLETED' THEN 2 ELSE 3 END,
      datetime(COALESCE(c.submitted_at, c.updated_at)) DESC
    LIMIT ?
  `).all(guildId, normalizedStatus, normalizedStatus, Math.max(1, Math.min(500, Number(limit) || 250)));
  const needle = text(search, 200).toLowerCase();
  return rows
    .map((row) => hydrateClaim(row, { includeEmail: true, includeToken: true }))
    .filter((claim) => !needle || [
      claim.claimCode, claim.orderCode, claim.ticketCode, claim.productName,
      claim.customerGmail, claim.customerId,
    ].some((value) => String(value || '').toLowerCase().includes(needle)));
}

export function getYoutubeWarrantyClaimStats(guildId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'AWAITING_CUSTOMER' THEN 1 ELSE 0 END) AS awaiting_customer,
      SUM(CASE WHEN status = 'SUBMITTED' THEN 1 ELSE 0 END) AS submitted,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
    FROM youtube_warranty_claims WHERE guild_id = ?
  `).get(guildId) || {};
  return {
    total: Number(row.total || 0),
    awaitingCustomer: Number(row.awaiting_customer || 0),
    submitted: Number(row.submitted || 0),
    completed: Number(row.completed || 0),
    cancelled: Number(row.cancelled || 0),
  };
}

export function buildYoutubeWarrantyRequestPanel(claim) {
  const E = createEmojiResolver(claim.guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('danger'));
  const statusLine = claim.status === 'SUBMITTED'
    ? `${E('status_check')} **Đã nhận Gmail** — ${claim.customerGmailMasked || 'Đã ẩn bảo mật'}`
    : claim.status === 'COMPLETED'
      ? `${E('status_check')} **Đã bảo hành xong** — hãy làm đúng hướng dẫn trước khi vào Family.`
      : `${E('order_processing')} **Đang chờ bạn điền Gmail cần bảo hành**`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('warranty_shield')} BẢO HÀNH YOUTUBE · ${claim.claimCode}`,
    `> Shop đã xác định đơn \`${claim.orderCode}\` đang trong quy trình bảo hành YouTube.`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('order_id')} **Mã đơn** — \`${claim.orderCode}\``,
    `${E('order_product')} **Sản phẩm** — ${claim.productName}`,
    statusLine,
    '',
    `${E('status_warn')} Chỉ chủ ticket sử dụng liên kết riêng này. Không gửi link cho người khác.`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('icon_clipboard')} QUY TRÌNH BẮT BUỘC`,
    `1. Mở form và nhập đúng Gmail cần nhận bảo hành.`,
    `2. Chờ shop xử lý; bạn sẽ nhận thông báo ngay tại ticket và qua DM.`,
    `3. **Trước khi nhận lời mời Family, bắt buộc làm đúng hướng dẫn YouTube.**`,
    `-# Không tự ý rời Family hoặc nhận lời mời khi chưa hoàn tất hướng dẫn.`
  ].join('\n')));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(claim.status === 'AWAITING_CUSTOMER' ? 'Điền Gmail bảo hành' : 'Xem hồ sơ bảo hành')
      .setStyle(ButtonStyle.Link)
      .setURL(claim.formUrl),
    new ButtonBuilder()
      .setLabel('Hướng dẫn YouTube bắt buộc')
      .setStyle(ButtonStyle.Link)
      .setURL(YOUTUBE_GUIDE_URL),
  );
  return { components: [container, buttons], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export function buildYoutubeWarrantyCompletedPanel(claim, actorId) {
  const E = createEmojiResolver(claim.guildId);
  const container = new ContainerBuilder().setAccentColor(accentFor('success'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('status_check')} YOUTUBE ĐÃ ĐƯỢC BẢO HÀNH`,
    `> Hồ sơ **${claim.claimCode}** · đơn \`${claim.orderCode}\` đã được shop xử lý.`,
    '',
    `${E('ticket_user')} **Khách hàng** — <@${claim.customerId}>`,
    `${E('icon_mail')} **Gmail nhận lời mời** — ${claim.customerGmailMasked || 'Đã ẩn bảo mật'}`,
    actorId ? `${E('ticket_staff')} **Xử lý bởi** — <@${actorId}>` : null,
    claim.completionNote ? `${E('icon_note')} **Ghi chú** — ${claim.completionNote}` : null,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `### ${E('status_warn')} LÀM HƯỚNG DẪN TRƯỚC KHI VÀO FAMILY`,
    `**Không bấm nhận lời mời ngay.** Hãy mở kênh hướng dẫn YouTube, làm đủ từng bước rồi mới chấp nhận lời mời Family.`,
    `-# Nếu tự ý vào/rời Family sai quy trình, tài khoản có thể bị giới hạn Family 12 tháng và ảnh hưởng quyền bảo hành.`,
  ].join('\n')));
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Mở hướng dẫn YouTube ngay').setStyle(ButtonStyle.Link).setURL(YOUTUBE_GUIDE_URL),
  );
  return { components: [container, buttons], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

async function resolveClaimChannel(client, claim) {
  const guild = client?.guilds?.cache?.get(claim.guildId)
    || await client?.guilds?.fetch(claim.guildId).catch(() => null);
  if (!guild) return null;
  return guild.channels.cache.get(claim.ticketChannelId)
    || await guild.channels.fetch(claim.ticketChannelId).catch(() => null);
}

export async function publishYoutubeWarrantyClaim(client, claim, { notify = false } = {}) {
  const hydrated = getYoutubeWarrantyClaim(claim.id, { includeEmail: true, includeToken: true });
  const channel = await resolveClaimChannel(client, hydrated);
  if (!channel?.isTextBased()) return { published: false, missingChannel: true, claim: hydrated };

  const payload = buildYoutubeWarrantyRequestPanel(hydrated);
  let message = null;
  if (hydrated.notificationMessageId) {
    message = await channel.messages.fetch(hydrated.notificationMessageId).catch(() => null);
    if (message) await message.edit(payload).catch(() => null);
  }
  if (!message) {
    await channel.send({
      content: `<@${hydrated.customerId}> shop cần bạn bổ sung Gmail để xử lý bảo hành YouTube.`,
      allowedMentions: { users: [hydrated.customerId], parse: [] },
    }).catch(() => null);
    message = await channel.send(payload);
    db.prepare(`
      UPDATE youtube_warranty_claims
      SET notification_message_id = ?, updated_at = ?, revision = revision + 1
      WHERE id = ?
    `).run(message.id, nowIso(), hydrated.id);
  } else if (notify) {
    await channel.send({
      content: `<@${hydrated.customerId}> vui lòng kiểm tra lại form bảo hành YouTube bên trên.`,
      allowedMentions: { users: [hydrated.customerId], parse: [] },
    }).catch(() => null);
  }
  return { published: true, missingChannel: false, claim: getYoutubeWarrantyClaim(hydrated.id, { includeEmail: true, includeToken: true }) };
}

export async function syncYoutubeWarrantyClaims(client, { guildId = config.guildId } = {}) {
  const rows = db.prepare(`
    SELECT o.*, t.id AS warranty_ticket_id, t.ticket_code AS warranty_ticket_code,
           t.channel_id AS warranty_ticket_channel_id, t.customer_id AS warranty_customer_id
    FROM orders o
    JOIN tickets t ON t.related_order_code = o.order_code
      AND t.guild_id = o.guild_id
      AND t.ticket_type = 'WARRANTY'
      AND t.status = 'OPEN'
    WHERE o.guild_id = ?
      AND o.status = 'WARRANTY_OPEN'
      AND (LOWER(o.product_name) LIKE '%youtube%' OR LOWER(COALESCE(o.service_type, '')) LIKE '%youtube%')
    ORDER BY t.id ASC
  `).all(guildId);
  const result = { scanned: rows.length, created: 0, published: 0, current: 0, missingChannels: 0, failed: 0 };
  for (const order of rows) {
    const ticket = {
      id: order.warranty_ticket_id,
      ticket_code: order.warranty_ticket_code,
      channel_id: order.warranty_ticket_channel_id,
      customer_id: order.warranty_customer_id,
    };
    try {
      const ensured = ensureYoutubeWarrantyClaim({ order, ticket });
      if (ensured.created) result.created += 1;
      const published = await publishYoutubeWarrantyClaim(client, ensured.claim);
      if (published.missingChannel) result.missingChannels += 1;
      else if (ensured.created || !ensured.claim.notificationMessageId) result.published += 1;
      else result.current += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`[YOUTUBE-WARRANTY] Sync failed for ${order.order_code}:`, error);
    }
  }
  return result;
}

export async function refreshYoutubeWarrantyClaimNotification(client, claimId) {
  const claim = getYoutubeWarrantyClaim(claimId, { includeEmail: true, includeToken: true });
  if (!claim) return null;
  return publishYoutubeWarrantyClaim(client, claim);
}

export async function resendYoutubeWarrantyClaim(client, claimId) {
  const claim = getYoutubeWarrantyClaim(claimId, { includeEmail: true, includeToken: true });
  if (!claim) throw new YoutubeWarrantyClaimError('Không tìm thấy hồ sơ bảo hành.', 'NOT_FOUND');
  return publishYoutubeWarrantyClaim(client, claim, { notify: true });
}

export async function completeYoutubeWarrantyClaim(client, claimId, { actorId, note = '' } = {}) {
  const existing = getYoutubeWarrantyClaim(claimId, { includeEmail: true, includeToken: false });
  if (!existing) throw new YoutubeWarrantyClaimError('Không tìm thấy hồ sơ bảo hành.', 'NOT_FOUND');
  if (existing.status === 'COMPLETED') return { completed: false, claim: existing, alreadyCompleted: true };
  if (existing.status !== 'SUBMITTED' || !existing.customerGmail) {
    throw new YoutubeWarrantyClaimError('Khách hàng chưa gửi Gmail nên chưa thể đánh dấu đã bảo hành.', 'GMAIL_REQUIRED');
  }

  const completedAt = nowIso();
  const completionNote = text(note, 500) || null;
  const result = db.prepare(`
    UPDATE youtube_warranty_claims
    SET status = 'COMPLETED', completed_at = ?, completed_by_id = ?, completion_note = ?,
        updated_at = ?, revision = revision + 1
    WHERE id = ? AND status = 'SUBMITTED'
  `).run(completedAt, text(actorId, 100) || 'WEB_ADMIN', completionNote, completedAt, existing.id);
  if (!result.changes) {
    return { completed: false, claim: getYoutubeWarrantyClaim(existing.id, { includeEmail: true }), alreadyCompleted: true };
  }

  completeWarranty(existing.orderCode, text(actorId, 100) || 'WEB_ADMIN');
  const claim = getYoutubeWarrantyClaim(existing.id, { includeEmail: true, includeToken: true });
  await publishYoutubeWarrantyClaim(client, claim).catch(() => null);
  const payload = buildYoutubeWarrantyCompletedPanel(claim, actorId);
  const channel = await resolveClaimChannel(client, claim);
  if (channel?.isTextBased()) {
    await channel.send({
      content: `<@${claim.customerId}> hồ sơ YouTube của bạn đã được bảo hành. Hãy đọc hướng dẫn trước khi vào Family.`,
      allowedMentions: { users: [claim.customerId], parse: [] },
    }).catch(() => null);
    await channel.send(payload).catch(() => null);
  }
  const user = await client?.users?.fetch(claim.customerId).catch(() => null);
  if (user) await user.send(payload).catch(() => null);
  return { completed: true, claim, alreadyCompleted: false };
}

