import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} from 'discord.js';
import { config, getWebhookUrl, getPayOSReturnUrl, getPayOSCancelUrl } from '../config.js';
import { decrypt } from './crypto.js';
import { formatDateTime, formatDurationSince } from './time.js';
import {
  formatCurrency,
  formatOrderProduct,
  getOrderStatusLabel,
  getPaymentStatusLabel,
  normalizeQueueGroup,
  numericEmoji,
  toStars,
  resolveTicketLabel,
} from './formatters.js';
import { getEmojiMap } from '../services/emojiService.js';
import { T, fmt, h2, h3, subtext, fieldQ, fields, vnd, lines as joinLines, statusPill, SP } from './embedHelpers.js';
import { accentFor, brandName } from './uiKit.js';

// Parses a custom emoji string "<a:name:id>" or "<:name:id>" into a component object
// for use with ButtonBuilder.setEmoji() / StringSelectMenuOptionBuilder
function ec(em, slot) {
  const raw = em[slot];
  const m = raw && raw.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
  return m ? { id: m[3], name: m[2], animated: m[1] === 'a' } : null;
}

// ═══════════════════════════════════════════════
// Brand helpers
// ═══════════════════════════════════════════════
function brandConfig(kind = 'store') {
  if (kind === 'shipper') {
    return { name: config.shipperName, footer: config.shipperFooter, icon: config.shipperIconUrl };
  }
  return { name: config.storeName, footer: config.storeFooter, icon: config.storeIconUrl };
}

function applyBranding(embed, kind = 'store') {
  const brand = brandConfig(kind);
  if (brand.icon) embed.setAuthor({ name: brand.name, iconURL: brand.icon });
  else embed.setAuthor({ name: brand.name });
  if (brand.footer) embed.setFooter({ text: brand.footer });
  return embed;
}

function unixTs(dateStr) {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

// ═══════════════════════════════════════════════
// Ticket Panel (Legacy embed — ĐÃ XOÁ, chỉ dùng V2 bên dưới)
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// Ticket Panel V2 (Components V2 — Premium)
// ═══════════════════════════════════════════════
export function buildTicketPanelV2(customConfig = {}) {
  const brand = brandConfig('store');
  const hasCustomDesc = Boolean(customConfig.panel_description);
  const title = customConfig.panel_title || `${brand.name || 'Cenar Store'} — Trung Tâm Hỗ Trợ`;
  const imageUrl = customConfig.panel_image_url || null;
  const guildId = customConfig.guild_id;

  // Load emoji map (custom > default)
  const em = guildId ? getEmojiMap(guildId) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;

  const container = new ContainerBuilder().setAccentColor(accentFor('primary'));

  if (hasCustomDesc) {
    // Chế độ tuỳ chỉnh: chỉ hiện tiêu đề + nội dung user nhập (không kèm services mặc định)
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${title}\n${customConfig.panel_description}`)
    );
  } else {
    // Chế độ mặc định
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${title}\n` +
        `> Chào mừng bạn đến với **${brand.name || 'Cenar Store'}**!\n` +
        `> Bấm nút bên dưới để mở ticket. Chọn **đúng loại** giúp staff phục vụ bạn nhanh hơn.`
      )
    );
  }

  // Ảnh banner hiển thị inline qua MediaGallery
  if (imageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(imageUrl)
      )
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  // Chỉ hiện services mặc định khi user CHƯA tuỳ chỉnh nội dung
  if (!hasCustomDesc) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${E('panel_order')}  **Mua Hàng** — Netflix, Spotify, YouTube Premium, Nicho...\n` +
        `${E('panel_support')}  **Hỗ Trợ** — Tài khoản lỗi, thắc mắc về dịch vụ\n` +
        `${E('panel_complaint')}  **Khiếu Nại** — Phản ánh trải nghiệm chưa tốt\n` +
        `${E('panel_partnership')}  **Hợp Tác** — Đề xuất hợp tác kinh doanh\n` +
        `${E('panel_warranty')}  **Bảo Hành** — Yêu cầu bảo hành sản phẩm đã mua`
      )
    );
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `> _Sau khi mở ticket, bot sẽ hướng dẫn bạn từng bước._\n` +
      `— _${brand.footer || brand.name}_`
    )
  );


  // Buttons row 1
  const btnOrder = new ButtonBuilder().setCustomId('ticket:create:ORDER').setLabel('Mua Hàng').setStyle(ButtonStyle.Primary);
  const btnSupport = new ButtonBuilder().setCustomId('ticket:create:SUPPORT').setLabel('Ho Tro').setStyle(ButtonStyle.Secondary);
  const btnComplaint = new ButtonBuilder().setCustomId('ticket:create:COMPLAINT').setLabel('Khieu Nai').setStyle(ButtonStyle.Danger);
  const btnPartnership = new ButtonBuilder().setCustomId('ticket:create:PARTNERSHIP').setLabel('Hop Tac').setStyle(ButtonStyle.Success);
  const e1 = ec(em, 'panel_order'); if (e1) btnOrder.setEmoji(e1);
  const e2 = ec(em, 'panel_support'); if (e2) btnSupport.setEmoji(e2);
  const e3 = ec(em, 'panel_complaint'); if (e3) btnComplaint.setEmoji(e3);
  const e4 = ec(em, 'panel_partnership'); if (e4) btnPartnership.setEmoji(e4);
  const row1 = new ActionRowBuilder().addComponents(btnOrder, btnSupport, btnComplaint, btnPartnership);

  // Buttons row 2
  const btnWarranty = new ButtonBuilder().setCustomId('ticket:warranty:panel').setLabel('Bảo Hành Sản Phẩm').setStyle(ButtonStyle.Secondary);
  const btnAppeal = new ButtonBuilder().setCustomId('ytb:appeal:apply').setLabel('Kháng 12 Tháng YT').setStyle(ButtonStyle.Primary);
  const btnEdit = new ButtonBuilder().setCustomId('ticket:panel:edit').setLabel('Sửa Panel').setStyle(ButtonStyle.Secondary);
  const e5 = ec(em, 'panel_warranty'); if (e5) btnWarranty.setEmoji(e5);
  btnAppeal.setEmoji('🛡️');
  const e6 = ec(em, 'panel_edit'); if (e6) btnEdit.setEmoji(e6);
  const row2 = new ActionRowBuilder().addComponents(btnWarranty, btnAppeal, btnEdit);

  return { container, rows: [row1, row2], flags: MessageFlags.IsComponentsV2 };
}



// ═══════════════════════════════════════════════
// Ticket Welcome
// ═══════════════════════════════════════════════
const TICKET_TYPE_META = {
  ORDER: {
    titleSlot: 'panel_order',
    title: 'Ticket Mua Hàng Đã Được Tạo',
    color: () => config.accentColorPrimary,
    intro: 'Bạn muốn mua sản phẩm / dịch vụ gì, báo **staff** ngay trong ticket này nhé!',
    steps: [
      '**Bước 1** — Cho staff biết sản phẩm bạn muốn mua',
      '**Bước 2** — Staff tạo đơn và gửi link thanh toán PayOS',
      '**Bước 3** — Thanh toán xong, bot xác nhận và giao hàng qua DM',
    ],
  },
  SUPPORT: {
    titleSlot: 'panel_support',
    title: 'Ticket Hỗ Trợ Đã Được Tạo',
    color: () => config.accentColorInfo,
    intro: 'Cảm ơn bạn đã liên hệ. Vui lòng mô tả **chi tiết** vấn đề bạn đang gặp phải.',
    steps: [
      '**Mô tả rõ** — Thiết bị gì, lỗi gì, xảy ra khi nào?',
      '**Gửi bằng chứng** — Ảnh/video lỗi để staff xử lý nhanh hơn',
      '**Kiên nhẫn chờ** — Staff sẽ phản hồi trong thời gian sớm nhất',
    ],
  },
  COMPLAINT: {
    titleSlot: 'panel_complaint',
    title: 'Ticket Khiếu Nại Đã Được Tạo',
    color: () => config.accentColorDanger,
    intro: 'Rất xin lỗi vì trải nghiệm chưa tốt. **Quản lý** sẽ vào xử lý ngay cho bạn.',
    steps: [
      '**Mô tả sự cố** — Nêu rõ vấn đề và thời điểm xảy ra',
      '**Gửi bằng chứng** — Ảnh, video, screenshot liên quan',
      '**Quản lý xử lý** — Cam kết giải quyết công bằng, nhanh chóng',
    ],
  },
  PARTNERSHIP: {
    titleSlot: 'panel_partnership',
    title: 'Ticket Hợp Tác Đã Được Tạo',
    color: () => config.accentColorSuccess,
    intro: 'Cảm ơn sự quan tâm đến Cream Store! Quản lý sẽ xem xét và phản hồi sớm.',
    steps: [
      '**Giới thiệu bản thân** — Tên, lĩnh vực và quy mô hoạt động',
      '**Đề xuất hợp tác** — Ý tưởng và mong muốn cụ thể của bạn',
      '**Chờ phản hồi** — Quản lý sẽ liên hệ trong vòng 48 giờ',
    ],
  },
  WARRANTY: {
    titleSlot: 'panel_warranty',
    title: 'Ticket Bảo Hành Đã Được Tạo',
    color: () => config.accentColorWarning,
    intro: 'Yêu cầu bảo hành đã ghi nhận. Staff sẽ vào xử lý cho bạn ngay!',
    steps: [
      '**Mô tả lỗi** — Gặp lỗi gì? Xảy ra khi nào?',
      '**Gửi bằng chứng** — Ảnh/video lỗi giúp staff xử lý nhanh hơn',
      '**Thời gian xử lý** — Thường từ 5–30 phút tùy mức độ',
    ],
  },
  APPEAL: {
    titleSlot: 'panel_warranty',
    title: 'Ticket Kháng 12 Tháng YouTube Premium',
    color: () => 0x5865F2,
    intro: 'Yêu cầu kháng cáo giới hạn 12 tháng gia đình YouTube của bạn đã được tiếp nhận. Vui lòng đọc kỹ các quy định sau và chuẩn bị phối hợp cùng Admin.',
    steps: [
      '⚠️ **1. Luôn online**: Bạn cần duy trì online. Khi Admin/Chủ shop tag tên, bạn cần phản hồi ngay lập tức để tiến hành kháng.',
      '⏳ **2. Kế hoạch dự phòng**: Nếu không kháng được, bắt buộc phải đổi email khác hoặc chờ 7 - 15 ngày để bắt đầu lượt kháng thứ 2.',
      '💳 **3. Phí dịch vụ (Khách vãng lai)**: Miễn phí nếu mua YouTube tại shop. Phí 20,000đ/lượt thành công đối với khách vãng lai.',
    ],
  },
};

export function buildTicketWelcomeEmbed(ticketCode, customerId, ticketType = 'ORDER', relatedOrderCode = null) {
  const meta = TICKET_TYPE_META[ticketType] ?? TICKET_TYPE_META.ORDER;
  return applyBranding(
    new EmbedBuilder()
      .setColor(meta.color())
      .setTitle(meta.title)
      .setDescription([
        `Xin chào <@${customerId}>!`,
        `> **Mã Ticket:** \`${ticketCode}\``,
        relatedOrderCode ? `> **Liên kết Đơn:** \`${relatedOrderCode}\`` : null,
        '',
        `**${meta.intro}**`,
      ].filter(Boolean).join('\n'))
      .addFields({
        name: 'Huong Dan',
        value: meta.steps.map(s => `> ${s}`).join('\n'),
        inline: false,
      })
      .setTimestamp(),
  );
}

// ═══════════════════════════════════════════════
// Ticket Welcome V2 (Components V2)
// ═══════════════════════════════════════════════
const TICKET_V2_ACCENT = {
  ORDER:       accentFor('primary'),
  SUPPORT:     accentFor('info'),
  COMPLAINT:   accentFor('danger'),
  PARTNERSHIP: accentFor('success'),
  WARRANTY:    accentFor('warning'),
};

const TICKET_V2_STEPS = {
  ORDER: [
    { slot: 'icon_cart', text: '**Bước 1** — Chọn sản phẩm và số lượng muốn mua' },
    { slot: 'payment_payos', text: '**Bước 2** — Chọn phương thức thanh toán (PayOS / VietQR)' },
    { slot: 'status_check', text: '**Bước 3** — Thanh toán xong, bot tự xác nhận và giao hàng qua DM' },
  ],
  SUPPORT: [
    { slot: 'icon_doc', text: '**Mô tả rõ** — Thiết bị gì, lỗi gì, xảy ra khi nào?' },
    { slot: 'icon_search', text: '**Gửi bằng chứng** — Ảnh/video lỗi để staff xử lý nhanh hơn' },
    { slot: 'icon_clock', text: '**Kiên nhẫn chờ** — Staff sẽ phản hồi sớm nhất có thể' },
  ],
  COMPLAINT: [
    { slot: 'icon_doc', text: '**Mô tả sự cố** — Nêu rõ vấn đề và thời điểm xảy ra' },
    { slot: 'icon_search', text: '**Gửi bằng chứng** — Ảnh, video, screenshot liên quan' },
    { slot: 'ticket_staff', text: '**Quản lý xử lý** — Cam kết giải quyết công bằng, nhanh chóng' },
  ],
  PARTNERSHIP: [
    { slot: 'ticket_user', text: '**Giới thiệu bản thân** — Tên, lĩnh vực và quy mô hoạt động' },
    { slot: 'icon_tip', text: '**Đề xuất hợp tác** — Ý tưởng và mong muốn cụ thể của bạn' },
    { slot: 'icon_announce', text: '**Chờ phản hồi** — Quản lý sẽ liên hệ trong vòng 48 giờ' },
  ],
  WARRANTY: [
    { slot: 'panel_warranty', text: '**Mô tả lỗi** — Gặp lỗi gì? Xảy ra khi nào?' },
    { slot: 'icon_search', text: '**Gửi bằng chứng** — Ảnh/video lỗi giúp staff xử lý nhanh hơn' },
    { slot: 'icon_clock', text: '**Thời gian xử lý** — Thường từ 5–30 phút tùy mức độ' },
  ],
};

export function buildTicketWelcomeV2(ticketCode, customerId, ticketType = 'ORDER', relatedOrderCode = null, productName = null, guildId = null) {
  const meta = TICKET_TYPE_META[ticketType] ?? TICKET_TYPE_META.ORDER;
  const accentColor = TICKET_V2_ACCENT[ticketType] ?? accentFor('primary');
  const steps = TICKET_V2_STEPS[ticketType] ?? TICKET_V2_STEPS.ORDER;
  const brand = brandConfig('store');
  const em = guildId ? getEmojiMap(guildId) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;

  const container = new ContainerBuilder().setAccentColor(accentColor);

  // Header — title h2, info dạng quoted fields
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `## ${E(meta.titleSlot)}  ${meta.title}`,
      `> ${E('ticket_user')} Xin chào ${/^\\d+$/.test(customerId) ? fmt.user(customerId) : 'Khách Vãng Lai (Web)'}!`,
      `> ${E('ticket_open')} ${fmt.b('Mã Ticket:')} ${fmt.code(ticketCode)}`,
      relatedOrderCode ? `> ${E('order_id')} ${fmt.b('Liên kết Đơn:')} ${fmt.code(relatedOrderCode)}` : null,
      productName ? `> ${E('order_product')} ${fmt.b('Sản phẩm:')} ${fmt.b(productName)}` : null,
      `> ${E('icon_clock')} ${fmt.b('Thời gian:')} ${T.rel(new Date())}`,
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  // Intro + steps — heading h3
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `### ${E('status_info')}  ${fmt.b(meta.intro)}`,
      '',
      ...steps.map((s) => `${E(s.slot)} ${s.text}`),
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  // Footer subtext
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      subtext(`${E('icon_heart_purple')} ${brand.footer || brand.name}`)
    )
  );

  return { container, flags: MessageFlags.IsComponentsV2 };
}

// ═══════════════════════════════════════════════
// Payment Method Selector (Components V2)
// ═══════════════════════════════════════════════
export function buildPaymentMethodSelector(order) {
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;

  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      h2(`${E('payment_payos')}  Chọn Phương Thức Thanh Toán`) + '\n' +
      `> ${E('order_product')} ${fmt.b('Sản phẩm:')} ${order.quantity}x ${order.product_name}\n` +
      `> ${E('payment_money')} ${fmt.b('Số tiền:')} ${fmt.code(formatCurrency(order.total_amount))}\n` +
      `> ${E('order_id')} ${fmt.b('Mã đơn:')} ${fmt.code(order.order_code)}\n\n` +
      subtext('Chọn phương thức thanh toán phù hợp bên dưới')
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${E('payment_qr')} ${fmt.b('Thanh Toán Tự Động')} — Quét QR từ app ngân hàng, hệ thống tự xác nhận trong 1-2 phút.\n` +
      subtext(`${E('icon_clock')} QR có hiệu lực 60 phút từ khi tạo`)
    )
  );

  const qrBtn = new ButtonBuilder()
    .setCustomId(`payment:method:payos:${order.order_code}`)
    .setLabel('Lay Ma QR Thanh Toan')
    .setStyle(ButtonStyle.Primary);
  const cancelBtn = new ButtonBuilder()
    .setCustomId(`order:cancel_customer:${order.order_code}`)
    .setLabel('Huy Don')
    .setStyle(ButtonStyle.Danger);
  const eQr = ec(em, 'payment_qr'); if (eQr) qrBtn.setEmoji(eQr);
  const eCancel = ec(em, 'order_cancel'); if (eCancel) cancelBtn.setEmoji(eCancel);
  const actionRow = new ActionRowBuilder().addComponents(qrBtn, cancelBtn);

  return { container, actionRow, flags: MessageFlags.IsComponentsV2 };
}

// ═══════════════════════════════════════════════
// Ticket Control (buttons inside ticket)
// ═══════════════════════════════════════════════
export function buildTicketControlComponents(ticketId, customerId = null) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticketId}`)
      .setLabel('Đóng Ticket')
      .setStyle(ButtonStyle.Danger),
  );
  if (customerId) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:mute:${customerId}`)
        .setLabel('Mute User')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return [row];
}

// ═══════════════════════════════════════════════
// Close Confirm
// ═══════════════════════════════════════════════
export function buildCloseConfirmEmbed(ticketCode, reason = null, guildId = null) {
  const em = guildId ? getEmojiMap(guildId) : {};
  const lockRaw = em['icon_lock'] || '';
  const warnRaw = em['status_cross'] || '';
  return new EmbedBuilder()
    .setColor(config.accentColorDanger)
    .setTitle(`${lockRaw} Xác Nhận Đóng Ticket?`.trim())
    .setDescription([
      `> **Ticket:** \`${ticketCode}\``,
      reason ? `> **Lý do:** ${reason}` : null,
      '',
      `${warnRaw} **Sau khi xác nhận:**`.trim(),
      '> - Ticket bị khóa, **chỉ Admin** mới chat được',
      '> - Channel sẽ **tự xóa sau 2 phút**',
      '> - Transcript sẽ được lưu và gửi cho khách',
    ].filter(Boolean).join('\n'))
    .setTimestamp();
}

export function buildCloseConfirmComponents(ticketId, guildId = null) {
  const em = guildId ? getEmojiMap(guildId) : {};
  const confirmEmoji = ec(em, 'status_check');
  const cancelEmoji = ec(em, 'order_cancel');

  const confirmBtn = new ButtonBuilder()
    .setCustomId(`ticket:close:confirm:${ticketId}`)
    .setLabel('Xác Nhận Đóng')
    .setStyle(ButtonStyle.Danger);
  if (confirmEmoji) confirmBtn.setEmoji(confirmEmoji);

  const cancelBtn = new ButtonBuilder()
    .setCustomId('ticket:close:cancel')
    .setLabel('Hủy')
    .setStyle(ButtonStyle.Secondary);
  if (cancelEmoji) cancelBtn.setEmoji(cancelEmoji);

  return [new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)];
}

// ═══════════════════════════════════════════════
// Mute Ticket Result
// ═══════════════════════════════════════════════
export function buildMuteTicketEmbed(user, isMuted, reason = null, actorId = null) {
  return new EmbedBuilder()
    .setColor(isMuted ? config.accentColorDanger : config.accentColorSuccess)
    .setTitle(isMuted ? 'Đã Khóa Tạo Ticket' : 'Đã Mở Khóa Tạo Ticket')
    .setDescription([
      `> **Người dùng:** <@${user.id}> \`(${user.tag ?? user.username})\``,
      actorId ? `> **Thực hiện bởi:** <@${actorId}>` : null,
      reason ? `> **Lý do:** ${reason}` : null,
      '',
      isMuted
        ? 'User này **không thể tạo ticket** cho đến khi được bỏ khóa.'
        : 'User này đã được phép **tạo ticket** trở lại.',
    ].filter(Boolean).join('\n'))
    .setThumbnail(user.displayAvatarURL())
    .setTimestamp();
}

// ═══════════════════════════════════════════════
// Warranty Select Menu
// ═══════════════════════════════════════════════
export function buildWarrantySelectEmbed() {
  return new EmbedBuilder()
    .setColor(config.accentColorWarning)
    .setTitle('Chon San Pham Can Bao Hanh')
    .setDescription([
      '> Dưới đây là danh sách **đơn hàng đã hoàn thành** của bạn.',
      '> Chọn sản phẩm cần bảo hành từ menu bên dưới.',
      '',
      '_Nếu không thấy đơn, hãy liên hệ staff để được hỗ trợ._',
    ].join('\n'))
    .setTimestamp();
}

export function buildWarrantySelectV2(guildId = null) {
  const em = guildId ? getEmojiMap(guildId) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;
  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      h2(`${E('panel_warranty')} Bảo Hành Sản Phẩm`),
      `> ${E('icon_sparkle')} Chọn đơn hàng cần bảo hành từ danh sách bên dưới.`,
      `> Sau khi chọn, bạn sẽ cần điền thông tin tài khoản để chúng tôi hỗ trợ nhanh hơn.`,
    ].join('\n'))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `${E('icon_tip')} **Lưu ý:** Chỉ hiển thị các đơn đã hoàn thành trong 6 tháng gần nhất.`,
      subtext('Nếu không thấy đơn phù hợp, hãy liên hệ staff để được hỗ trợ trực tiếp.'),
    ].join('\n'))
  );

  return { container, flags: MessageFlags.IsComponentsV2 };
}

export function buildWarrantyProductSelectComponents(orders, guildId = null) {
  const em = guildId ? getEmojiMap(guildId) : {};
  const productEmoji = ec(em, 'order_product');
  const options = orders.slice(0, 25).map(order => {
    const opt = {
      label: `${order.order_code} — ${String(order.product_name ?? '').slice(0, 50)}`,
      description: `Hoàn thành: ${order.completed_at ? new Date(order.completed_at).toLocaleDateString('vi-VN') : 'N/A'}`,
      value: order.order_code,
    };
    if (productEmoji) opt.emoji = productEmoji;
    return opt;
  });
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('warranty:product:select')
        .setPlaceholder('Chọn đơn hàng cần bảo hành...')
        .addOptions(options),
    ),
  ];
}

// ═══════════════════════════════════════════════
// Order
// ═══════════════════════════════════════════════
export function buildOrderCreatedEmbed(order, orderChannelId) {
  const hasPay = order.total_amount > 0;
  return applyBranding(
    new EmbedBuilder()
      .setColor(hasPay ? config.accentColorInfo : config.accentColorSuccess)
      .setTitle(`Don Hang \`${order.order_code}\` Da Duoc Tao`)
      .setDescription(hasPay
        ? '> Vui lòng **thanh toán** qua QR / link bên dưới để đơn được xử lý.'
        : '> Đơn không cần thanh toán — đưa vào hàng xử lý ngay!')
      .addFields(
        { name: 'San Pham', value: formatOrderProduct(order.quantity, order.product_name), inline: true },
        { name: 'So Tien', value: hasPay ? `**${formatCurrency(order.total_amount)}**` : '_Thương lượng_', inline: true },
        { name: 'Trang Thai', value: getOrderStatusLabel(order.status), inline: true },
        { name: 'Theo Doi Tai', value: `<#${orderChannelId}>`, inline: false },
      )
      .setTimestamp(),
  );
}

// ═══ Order Created V2 (Components V2) ═══
export function buildOrderCreatedV2(order, orderChannelId) {
  const hasPay = order.total_amount > 0;
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;
  const container = new ContainerBuilder().setAccentColor(accentFor(hasPay ? 'primary' : 'success'));

  // Header — mention khách ngay trong header (gộp tin thừa, chống spam)
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `## ${E('order_created')} Đơn Hàng ${fmt.code(order.order_code)} Đã Được Tạo`,
      `> ${fmt.user(order.customer_id)} — đơn của bạn đã được tạo!`,
      hasPay
        ? `> ${E('payment_payos')} Vui lòng ${fmt.b('chọn phương thức thanh toán')} để đơn được xử lý`
        : `> ${E('icon_gift')} Đơn không cần thanh toán — đưa vào hàng xử lý ngay!`,
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  // Order details — table-like layout
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `${E('order_product')} ${fmt.b('Sản phẩm:')} ${formatOrderProduct(order.quantity, order.product_name)}`,
      `${E('payment_money')} ${fmt.b('Số tiền:')} ${hasPay ? fmt.b(formatCurrency(order.total_amount)) : `${fmt.i('Miễn phí')}`}`,
      `${E('icon_chart')} ${fmt.b('Trạng thái:')} ${getOrderStatusLabel(order.status)}`,
      `${E('icon_clock')} ${fmt.b('Tạo lúc:')} ${T.rel(order.created_at || new Date())}`,
      `${E('icon_clipboard')} ${fmt.b('Theo dõi tại:')} ${fmt.channel(orderChannelId)}`,
    ))
  );

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`order:cancel:${order.order_code}`)
    .setLabel('Hủy Đơn')
    .setStyle(ButtonStyle.Danger);
  if (em.order_cancel) cancelBtn.setEmoji(em.order_cancel);
  const actionRow = new ActionRowBuilder().addComponents(cancelBtn);

  return { container, actionRow, flags: MessageFlags.IsComponentsV2 };
}

// Cập nhật log embed khi trạng thái đơn thay đổi (hủy / hoàn thành / đang xử lý)
export function buildOrderLogV2Update(order) {
  const hasPay = order.total_amount > 0;
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;

  const accentMap = {
    CANCELLED:       0xEF4444,
    COMPLETED:       0x22C55E,
    PROCESSING:      0xF59E0B,
    PENDING_PAYMENT: accentFor('primary'),
  };
  const accentColor = accentMap[order.status] ?? accentFor('primary');

  const headerEmojiSlot = {
    CANCELLED:       'order_cancel',
    COMPLETED:       'order_complete',
    PROCESSING:      'payment_success',
    PENDING_PAYMENT: 'order_created',
  }[order.status] ?? 'order_created';

  const container = new ContainerBuilder().setAccentColor(accentColor);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `## ${E(headerEmojiSlot)} Đơn Hàng ${fmt.code(order.order_code)}`,
      `> ${fmt.user(order.customer_id)} — ${getOrderStatusLabel(order.status, order.guild_id)}`,
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  const lines = [
    `${E('order_product')} ${fmt.b('Sản phẩm:')} ${formatOrderProduct(order.quantity, order.product_name)}`,
    `${E('payment_money')} ${fmt.b('Số tiền:')} ${hasPay ? fmt.b(formatCurrency(order.total_amount)) : fmt.i('Miễn phí')}`,
    `${E('icon_chart')} ${fmt.b('Trạng thái:')} ${getOrderStatusLabel(order.status, order.guild_id)}`,
    order.ticket_channel_id
      ? `${E('icon_clipboard')} ${fmt.b('Ticket:')} ${fmt.channel(order.ticket_channel_id)}`
      : null,
    order.status === 'CANCELLED' && order.payment_cancel_reason
      ? `${E('status_warn')} ${fmt.b('Lý do:')} ${order.payment_cancel_reason}`
      : null,
    order.status === 'COMPLETED' && order.completed_at
      ? `${E('icon_clock')} ${fmt.b('Hoàn thành:')} ${T.rel(order.completed_at)}`
      : null,
  ].filter(Boolean);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(...lines))
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function buildOrderActionComponents(orderCode) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`order:cancel:${orderCode}`)
        .setLabel('Huy Don')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function buildQueuePositionEmbed(order, position, totalInQueue) {
  const groupName = normalizeQueueGroup(order.product_name) || 'đơn hàng';
  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorInfo)
      .setTitle('Vi Tri Xep Hang')
      .addFields(
        { name: 'Vi Tri', value: `**${position} / ${totalInQueue}**`, inline: true },
        { name: 'Nhom', value: `\`${groupName}\``, inline: true },
        { name: 'Ma Don', value: `\`${order.order_code}\``, inline: true },
      )
      .setFooter({ text: 'Thứ tự xử lý theo ưu tiên và thời gian đặt hàng.' })
      .setTimestamp(),
  );
}

// ═══ Queue Position V2 (Components V2) ═══
export function buildQueuePositionV2(order, position, totalInQueue) {
  const groupName = normalizeQueueGroup(order.product_name) || 'đơn hàng';
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;
  const container = new ContainerBuilder().setAccentColor(accentFor('info'));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${E('order_queue')} Vị Trí Xếp Hàng\n` +
      `> ${E('icon_tag')} Mã đơn: \`${order.order_code}\`\n` +
      `> ${E('order_product')} Nhóm: \`${groupName}\``
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${E('order_pending')} **Vị trí:** \`${position} / ${totalInQueue}\`\n` +
      `${E('icon_folder')} **Nhóm xử lý:** \`${groupName}\`\n` +
      `${E('status_info')} _Thứ tự xử lý theo ưu tiên và thời gian đặt hàng._`
    )
  );

  const viewBtn = new ButtonBuilder()
    .setCustomId(`queue:view:${order.order_code}`)
    .setLabel('Xem Vị Trí')
    .setStyle(ButtonStyle.Primary);
  if (em.icon_location) viewBtn.setEmoji(em.icon_location);
  const claimBtn = new ButtonBuilder()
    .setCustomId(`order:claim:${order.order_code}`)
    .setLabel('Claim Đơn')
    .setStyle(ButtonStyle.Secondary);
  if (em.ticket_claim) claimBtn.setEmoji(em.ticket_claim);
  const actionRow = new ActionRowBuilder().addComponents(viewBtn, claimBtn);

  return { container, actionRow, flags: MessageFlags.IsComponentsV2 };
}

export function buildQueueViewComponents(orderCode) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`queue:view:${orderCode}`)
        .setLabel('Xem Vi Tri')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`order:claim:${orderCode}`)
        .setLabel('Claim Don')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}



// ═══════════════════════════════════════════════
// Payment
// ═══════════════════════════════════════════════
export function buildPaymentRequestEmbed(order, paymentMeta = {}, imageUrl = null) {
  const expireText = order.payment_expired_at
    ? `<t:${unixTs(order.payment_expired_at)}:R>`
    : '_Theo mặc định PayOS_';

  const descLines = [
    `> **Mã Đơn:** \`${order.order_code}\``,
    `> **Mã Thanh Toán:** \`${order.payment_code ?? order.order_code}\``,
    paymentMeta.paymentLinkId ? `> **PayOS Link ID:** \`${paymentMeta.paymentLinkId}\`` : null,
    '',
    '> Quét QR bên dưới **hoặc** bấm nút **Thanh Toán Ngay**',
    '> Bot sẽ **tự động xác nhận** sau khi nhận được giao dịch',
  ].filter(Boolean).join('\n');

  const embed = new EmbedBuilder()
    .setColor(config.accentColorInfo)
    .setTitle('Thanh Toan Don Hang')
    .setDescription(descLines)
    .addFields(
      { name: 'San Pham', value: formatOrderProduct(order.quantity, order.product_name), inline: true },
      { name: 'So Tien', value: `**${formatCurrency(order.total_amount)}**`, inline: true },
      { name: 'Het Han', value: expireText, inline: true },
    )
    .setTimestamp();

  if (config.paymentThumbnailUrl) embed.setThumbnail(config.paymentThumbnailUrl);
  if (imageUrl) embed.setImage(imageUrl);
  return applyBranding(embed);
}

export function buildPaymentPendingComponents(orderCode, checkoutUrl = null) {
  const row = new ActionRowBuilder();
  if (checkoutUrl && /^https?:\/\//i.test(checkoutUrl)) {
    row.addComponents(
      new ButtonBuilder().setLabel('Thanh Toán Ngay').setStyle(ButtonStyle.Link).setURL(checkoutUrl),
    );
  }
  row.addComponents(
    new ButtonBuilder().setCustomId(`queue:view:${orderCode}`).setLabel('Xem Hàng Chờ').setStyle(ButtonStyle.Secondary),
  );
  return row.components.length ? [row] : [];
}

// ═══ Payment QR V2 (Components V2 — QR inline qua MediaGallery attachment://) ═══
export function buildPaymentQrV2({ order, attachmentName = null, checkoutUrl = null, hasImage = false }) {
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;

  const expireText = order.payment_expired_at
    ? `<t:${Math.floor(new Date(order.payment_expired_at).getTime() / 1000)}:R>`
    : '_30 phút_';

  const container = new ContainerBuilder().setAccentColor(accentFor('info'));

  // Header — mention khách trong TextDisplay (V2 không dùng content/embeds)
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      h2(`${E('payment_payos')}  Thanh Toán Đơn Hàng`),
      `> ${fmt.user(order.customer_id)}`,
      `> ${E('payment_qr')} Quét mã QR ${fmt.b('hoặc')} bấm ${fmt.b('Thanh Toán Ngay')} bên dưới`,
      `> ${E('status_check')} Bot ${fmt.b('tự động xác nhận')} sau khi nhận được giao dịch`,
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  // Thông tin đơn
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `${E('order_id')} ${fmt.b('Nội dung:')} ${fmt.code(order.payment_code ?? order.order_code)}`,
      `${E('order_product')} ${fmt.b('Sản phẩm:')} ${formatOrderProduct(order.quantity, order.product_name)}`,
      `${E('payment_money')} ${fmt.b('Số tiền:')} ${fmt.b(formatCurrency(order.total_amount))}`,
      `${E('icon_clock')} ${fmt.b('Hết hạn:')} ${expireText}`,
    ))
  );

  // QR inline qua MediaGallery (attachment://)
  if (hasImage && attachmentName) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${attachmentName}`)
      )
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      subtext(`${E('status_warn')} Giao dịch hết hạn sau ít phút nếu chưa thanh toán. Bạn có thể tạo lại hoá đơn mới.`)
    )
  );

  const actionRow = new ActionRowBuilder();
  if (checkoutUrl && /^https?:\/\//i.test(checkoutUrl)) {
    const payBtn = new ButtonBuilder().setLabel('Thanh Toán Ngay').setStyle(ButtonStyle.Link).setURL(checkoutUrl);
    const ePay = ec(em, 'payment_payos'); if (ePay) payBtn.setEmoji(ePay);
    actionRow.addComponents(payBtn);
  }
  const regenBtn = new ButtonBuilder().setCustomId(`payment:regen:${order.order_code}`).setLabel('Tạo Hoá Đơn Mới').setStyle(ButtonStyle.Secondary);
  const queueBtn = new ButtonBuilder().setCustomId(`queue:view:${order.order_code}`).setLabel('Xem Hàng Chờ').setStyle(ButtonStyle.Secondary);
  const eRefresh = ec(em, 'icon_refresh'); if (eRefresh) regenBtn.setEmoji(eRefresh);
  const eQueue = ec(em, 'order_queue'); if (eQueue) queueBtn.setEmoji(eQueue);
  actionRow.addComponents(regenBtn, queueBtn);

  return { container, actionRow, flags: MessageFlags.IsComponentsV2 };
}

export function buildPaymentSuccessEmbed(order, amountText = null, transactionContent = null) {
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot) => em[slot] || '';

  const amountDisplay = amountText ?? formatCurrency(order.amount_paid || order.total_amount);
  const productDisplay = formatOrderProduct(order.quantity, order.product_name);

  const container = new ContainerBuilder().setAccentColor(accentFor('success'));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      joinLines(
        `<@${order.customer_id}>`,
        h2(`${E('payment_success')}  Thanh Toán Thành Công!`),
        `> ${E('icon_heart_purple')} Đơn hàng đã xác nhận — shop sẽ xử lý ngay!`.trim(),
      )
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      joinLines(
        `> ${E('order_id')} ${fmt.b('Mã Đơn:')} ${fmt.code(order.order_code)}`.trim(),
        `> ${E('payment_money')} ${fmt.b('Đã Nhận:')} **${amountDisplay}**`.trim(),
        `> ${E('order_product')} ${fmt.b('Sản Phẩm:')} ${productDisplay}`.trim(),
        `> ${E('icon_clock')} ${fmt.b('Thời gian:')} ${T.rel(order.payment_confirmed_at || new Date())}`.trim(),
        ...(transactionContent ? [`> ${E('icon_doc')} ${fmt.b('Mã GD:')} ${fmt.code(transactionContent)}`.trim()] : []),
      )
    )
  );

  if (config.paymentImageUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(config.paymentImageUrl)
      )
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      subtext(`${brandName()} — Vui lòng chờ staff giao hàng qua DM.`)
    )
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [order.customer_id] },
  };
}

export function buildPaymentSuccessDmEmbed(order) {
  // Lấy emoji custom (theo guild của order, fallback unicode)
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;

  const desc = joinLines(
    h2(`${E('payment_success')}  Đã Nhận Thanh Toán`),
    fmt.b('Cảm ơn bạn đã tin tưởng Cenar Store!'),
    '',
    `> ${E('order_id')} ${fmt.b('Mã Đơn:')} ${fmt.code(order.order_code)}`,
    `> ${E('payment_money')} ${fmt.b('Số Tiền:')} ${fmt.b(formatCurrency(order.amount_paid || order.total_amount))}`,
    `> ${E('order_product')} ${fmt.b('Sản Phẩm:')} ${formatOrderProduct(order.quantity, order.product_name)}`,
    `> ${E('icon_clock')} ${fmt.b('Thời gian:')} ${T.rel(order.payment_confirmed_at || new Date())}`,
    '',
    subtext('Shop sẽ xử lý đơn của bạn ngay lập tức. Vui lòng đợi tin nhắn giao hàng qua DM.'),
  );

  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorSuccess)
      .setDescription(desc)
      .setTimestamp(),
  );
}

// ═══════════════════════════════════════════════
// Order Completed
// ═══════════════════════════════════════════════
export function buildOrderCompletedMainEmbed(order) {
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;

  const desc = joinLines(
    h2(`${E('order_complete')}  Đơn Hàng Hoàn Thành`),
    `${E('icon_heart')} ${fmt.b('Cảm ơn bạn đã ủng hộ')} ${fmt.b('Cenar Store')}${fmt.b('!')}`,
    '',
    `> ${E('order_id')} ${fmt.b('Mã Đơn:')} ${fmt.code(order.order_code)}`,
    `> ${E('order_product')} ${fmt.b('Sản Phẩm:')} ${formatOrderProduct(order.quantity, order.product_name)}`,
    `> ${E('icon_clock')} ${fmt.b('Hoàn thành:')} ${T.rel(order.completed_at || new Date())}`,
    order.expiry_at
      ? `> ${E('icon_calendar')} ${fmt.b('Hết hạn:')} ${T.full(order.expiry_at)} (${T.rel(order.expiry_at)})`
      : null,
    '',
    subtext(`${E('icon_heart_purple')} Hãy đánh giá đơn hàng giúp shop để được giảm giá đơn tiếp nhé!`),
  );

  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorPrimary)
      .setDescription(desc)
      .setTimestamp(),
  );
}

export function buildOrderCompletedInfoEmbed(order, staffId, supportId = null) {
  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorSuccess)
      .setTitle('Thong Tin Xu Ly Don')
      .addFields(
        { name: 'Khach Hang', value: `<@${order.customer_id}>`, inline: true },
        { name: 'Nhan Vien', value: `<@${staffId}>`, inline: true },
        { name: 'Ho Tro', value: supportId ? `<@${supportId}>` : `<@${staffId}>`, inline: true },
        { name: 'San Pham', value: formatOrderProduct(order.quantity, order.product_name), inline: false },
        { name: 'Hoan Thanh', value: `<t:${unixTs(order.completed_at ?? new Date())}:F>`, inline: false },
        ...(order.expiry_at ? [{ name: 'Ngay Het Han', value: `<t:${unixTs(order.expiry_at)}:F>`, inline: false }] : []),
      )
      .setTimestamp(),
  );
}

export function buildCompletionDmEmbed(order) {
  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorSuccess)
      .setTitle('Đơn Hàng Đã Hoàn Thành')
      .setDescription('> Cảm ơn bạn đã ủng hộ Cream Store!')
      .addFields(
        { name: 'Mã Đơn', value: `\`${order.order_code}\``, inline: true },
        { name: 'Sản Phẩm', value: formatOrderProduct(order.quantity, order.product_name), inline: true },
        ...(order.expiry_at ? [{ name: 'Hết Hạn', value: `<t:${unixTs(order.expiry_at)}:D>`, inline: false }] : []),
      )
      .setTimestamp(),
  );
}

// ═══ Order Completed V2 (gộp completion + info + nhắc feedback vào 1 container) ═══
export function buildOrderCompletedV2(order, staffId, supportId = null) {
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;
  const store = brandName('store');

  const container = new ContainerBuilder().setAccentColor(accentFor('primary'));

  // Header — lời cảm ơn + mention khách (V2 mention trong TextDisplay)
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `# ${E('order_complete', '<a:Dotyellow:1481134440725090315>')} **ĐƠN HÀNG HOÀN THÀNH** ${E('icon_gift', '<:gift:1392749981332541501>')}`,
      `> ${E('icon_heart', '<:cr_shop:1392749981332541501>')} ${fmt.user(order.customer_id)} — cảm ơn bạn đã ủng hộ **${store}**!`,
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  // Thông tin đơn + xử lý
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `> ${E('order_id', '<:Diamond:1485905790903783465>')} **Mã Đơn:** \`${order.order_code}\``,
      `> ${E('order_product', '<:cr_shop:1392749981332541501>')} **Sản Phẩm:** ${formatOrderProduct(order.quantity, order.product_name)}`,
      `> ${E('ticket_staff', '<:verifybadge:1481127479702847646>')} **Nhân Viên:** ${fmt.user(staffId)}`,
      `> ${E('ticket_claim', '<:verifybadge:1481127479702847646>')} **Hỗ Trợ:** ${fmt.user(supportId || staffId)}`,
      `> ${E('icon_clock', '<a:Time:1481134440725090315>')} **Hoàn thành:** ${T.rel(order.completed_at || new Date())}`,
      order.expiry_at
        ? `> ${E('icon_calendar', '<a:Time:1481134440725090315>')} **Hết hạn:** ${T.full(order.expiry_at)} (${T.rel(order.expiry_at)})`
        : null,
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
  );

  // Nhắc feedback + bảo hành (gộp tin thừa, chống spam)
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `## ${E('icon_star', '<a:Dotyellow:1481134440725090315>')} HÃY ĐÁNH GIÁ TRẢI NGHIỆM MUA HÀNG CỦA BẠN!`,
      `> ${E('icon_sparkle', '<a:Dotyellow:1481134440725090315>')} Feedback giúp shop cải thiện dịch vụ — và bạn được **giảm giá đơn sau**.`,
      `> ${E('panel_warranty', '<:cr_baohanh:1348625535512870965>')} Cần **bảo hành**? Dùng nút bên dưới bất cứ lúc nào.`,
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(subtext(`${E('icon_heart_purple')} ${config.storeFooter || store}`))
  );

  return { container, flags: MessageFlags.IsComponentsV2 };
}

export function buildPublicOrderLogEmbed(order) {
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;

  const color = 0x22c55e; // Green COMPLETED color

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`GIAO HANG THANH CONG — ${order.order_code}`)
    .setDescription(`> ${E('icon_heart_purple')} Cảm ơn quý khách đã tin tưởng và mua hàng tại Cenar Store!`)
    .addFields(
      { name: 'Khach Hang', value: `<@${order.customer_id}>`, inline: true },
      { name: 'San Pham', value: `**${formatOrderProduct(order.quantity, order.product_name)}**`, inline: true },
      { name: 'Tong Tien', value: `\`${vnd(order.total_amount)}đ\``, inline: true },
      { name: 'Thanh Toan', value: statusPill(order.payment_status || 'PAID'), inline: true },
      { name: 'Ticket', value: order.ticket_channel_id ? `<#${order.ticket_channel_id}>` : `\`${order.ticket_code || 'N/A'}\``, inline: true },
      order.completed_at
        ? { name: 'Hoan Thanh', value: T.rel(order.completed_at), inline: true }
        : { name: '\u200b', value: '\u200b', inline: true }
    )
    .setTimestamp(order.completed_at ? new Date(order.completed_at) : undefined);

  return applyBranding(embed);
}

export function buildPublicOrderLogV2(order) {
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;

  const ticketVal = order.ticket_channel_id
    ? `<#${order.ticket_channel_id}>`
    : `\`${order.ticket_code || 'N/A'}\``;

  const container = new ContainerBuilder().setAccentColor(0x22c55e);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('order_complete')} GIAO H\u00c0NG TH\u00c0NH C\u00d4NG \u2014 \`${order.order_code}\``,
      `> ${E('icon_heart_purple')} C\u1ea3m \u01a1n qu\u00fd kh\u00e1ch \u0111\u00e3 tin t\u01b0\u1edfng v\u00e0 mua h\u00e0ng t\u1ea1i **${brandName()}**!`,
    ].join('\n'))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `${E('ticket_user')} **Kh\u00e1ch H\u00e0ng** \u2014 <@${order.customer_id}>`,
      `${E('order_product')} **S\u1ea3n Ph\u1ea9m** \u2014 ${formatOrderProduct(order.quantity, order.product_name)}`,
      `${E('payment_money')} **T\u1ed5ng Ti\u1ec1n** \u2014 \`${vnd(order.total_amount)}\u0111\``,
      `${E('payment_success')} **Thanh To\u00e1n** \u2014 ${statusPill(order.payment_status || 'PAID')}`,
      `${E('ticket_open')} **Ticket** \u2014 ${ticketVal}`,
      order.completed_at
        ? `${E('icon_clock')} **Ho\u00e0n Th\u00e0nh** \u2014 ${T.rel(order.completed_at)}`
        : null,
    ].filter(Boolean).join('\n'))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# ${E('icon_sparkle')} **${brandName()}** \u2014 Uy T\u00edn \u2022 Ch\u1ea5t L\u01b0\u1ee3ng \u2022 H\u1ed7 Tr\u1ee3 24/7`
    )
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}


// ═══════════════════════════════════════════════
// Feedback
// ═══════════════════════════════════════════════
export function buildFeedbackReminderText(orderCode) {
  const safeOrderCode = String(orderCode ?? '').trim() || 'KHONG_RO_MA_DON';
  return [
    `> **Mã Đơn:** \`${safeOrderCode}\``,
    '',
    '**Hãy đánh giá trải nghiệm mua hàng của bạn!**',
    '> Feedback của bạn giúp chúng tôi cải thiện dịch vụ ngày càng tốt hơn.',
    '',
    'Cần **bảo hành** sau này? Dùng nút **Bảo Hành Sản Phẩm** ở panel ticket.',
  ].join('\n');
}

export function buildQuickFeedbackComponents(orderCode) {
  const starLabels = ['1 Sao', '2 Sao', '3 Sao', '4 Sao', '5 Sao'];
  const starStyles = [ButtonStyle.Danger, ButtonStyle.Danger, ButtonStyle.Secondary, ButtonStyle.Success, ButtonStyle.Success];
  return [
    new ActionRowBuilder().addComponents(
      ...[1, 2, 3, 4, 5].map((stars) =>
        new ButtonBuilder()
          .setCustomId(`feedback:quick:${orderCode}:${stars}`)
          .setLabel(starLabels[stars - 1])
          .setStyle(starStyles[stars - 1]),
      ),
    ),
  ];
}

export function buildWarrantyActionComponents(orderCode) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:warranty:${orderCode}`)
        .setLabel('Mo Ticket Bao Hanh')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export function buildFeedbackLinkComponents(guildId, feedbackChannelId) {
  if (!feedbackChannelId) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Xem Kênh Feedback')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${feedbackChannelId}`),
    ),
  ];
}

export function buildFeedbackEmbed({ member, order, stars, content }) {
  const safeContent = content?.trim() || 'Không có ý kiến';
  const safeOrderCode = String(order?.order_code ?? order?.payment_code ?? '').trim() || 'KHONG_RO_MA_DON';
  const guildId = order?.guild_id ?? null;
  const starBar = toStars(stars, guildId);
  return applyBranding(
    new EmbedBuilder()
      .setColor(stars >= 4 ? config.accentColorSuccess : stars >= 3 ? config.accentColorWarning : config.accentColorDanger)
      .setTitle(`${starBar}  Đánh Giá ${stars}/5 Sao`)
      .setDescription([
        `> **Khach:** <@${member.id}>`,
        `> **Ma Don:** \`${safeOrderCode}\``,
        `> **San Pham:** ${formatOrderProduct(order?.quantity ?? 1, order?.product_name ?? 'Không xác định')}`,
        '',
        '**Y Kien Khach Hang:**',
        `> ${safeContent}`,
      ].join('\n'))
      .setThumbnail(member.displayAvatarURL())
      .setTimestamp(),
  );
}

export function buildQuickFeedbackAckEmbed(order, stars) {
  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorSuccess)
      .setTitle('Cảm Ơn Bạn Đã Feedback!')
      .setDescription([
        `> Bạn đã đánh giá đơn **\`${order.order_code}\`** với mức **${stars} sao**`,
        '> Feedback của bạn rất quan trọng với chúng tôi!',
      ].join('\n'))
      .setTimestamp(),
  );
}

export function buildQuickFeedbackAckV2(order, stars) {
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;
  const starEmoji = E('icon_star');
  const starBar = starEmoji ? starEmoji.repeat(Math.max(1, Math.min(5, stars))) : `${stars}/5`;
  const accent = stars >= 4 ? 'success' : stars >= 3 ? 'warning' : 'danger';
  const container = new ContainerBuilder().setAccentColor(accentFor(accent));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      h2(`${E('payment_success')}  Cảm Ơn Bạn Đã Feedback!`),
      `> ${E('order_id')} ${fmt.b('Mã đơn:')} ${fmt.code(order.order_code)}`.trim(),
      `> ${E('icon_star')} ${fmt.b('Đánh giá:')} ${fmt.b(`${stars}/5 sao`)}`.trim(),
      `> ${starBar}`,
    ))
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      subtext(`${E('icon_heart_purple')} Cảm ơn bạn! Feedback giúp shop ngày càng hoàn thiện hơn.`.trim())
    )
  );
  return { container, flags: MessageFlags.IsComponentsV2 };
}

export function buildFeedbackV2({ member, order, stars, content }) {
  const safeContent = content?.trim() || 'Không có ý kiến';
  const safeOrderCode = String(order?.order_code ?? order?.payment_code ?? '').trim() || 'KHONG_RO_MA_DON';
  const guildId = order?.guild_id ?? null;
  const em = guildId ? getEmojiMap(guildId) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;
  const starBar = toStars(stars, guildId);
  const accent = stars >= 4 ? 'success' : stars >= 3 ? 'warning' : 'danger';

  const container = new ContainerBuilder().setAccentColor(accentFor(accent));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      h2(`${starBar}  Đánh Giá ${stars}/5 Sao`),
      `> ${E('ticket_user')} ${fmt.b('Khách:')} ${fmt.user(member.id)}`,
      `> ${E('order_id')} ${fmt.b('Mã Đơn:')} ${fmt.code(safeOrderCode)}`,
      `> ${E('order_product')} ${fmt.b('Sản Phẩm:')} ${formatOrderProduct(order?.quantity ?? 1, order?.product_name ?? 'Không xác định')}`,
    ))
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `${E('icon_doc')} ${fmt.b('Ý Kiến Khách Hàng:')}`,
      `> ${safeContent}`,
    ))
  );
  return { container, flags: MessageFlags.IsComponentsV2 };
}

export function buildFeedbackModalPrompt(stars) {
  const titles = ['', 'Không Hài Lòng', 'Cần Cải Thiện', 'Tạm Ổn', 'Khá Hài Lòng', 'Rất Hài Lòng!'];
  return {
    title: titles[stars] || `Đánh Giá ${stars} Sao`,
    label: 'Ý kiến của bạn về đơn hàng',
    placeholder: 'Chia sẻ trải nghiệm của bạn... Đừng ngại góp ý để shop cải thiện nhé!',
  };
}

export function buildWarrantyPanelModalPrompt() {
  return {
    title: 'Bảo Hành Sản Phẩm',
    orderLabel: 'Mã đơn hàng cần bảo hành',
    orderPlaceholder: 'Ví dụ: CR_325081',
    reasonLabel: 'Mô tả lỗi / yêu cầu bảo hành',
    reasonPlaceholder: 'Ví dụ: Profile bị out, không đăng nhập được, sai PIN...',
  };
}

// ═══════════════════════════════════════════════
// Delivery
// ═══════════════════════════════════════════════
export function buildDeliveryNoticeEmbed(order) {
  const embed = new EmbedBuilder()
    .setColor(config.accentColorPrimary)
    .setTitle('Đơn Hàng Đã Được Giao!')
    .setDescription('> Nếu đơn có tài khoản, bấm nút bên dưới để nhận thông tin đăng nhập.')
    .addFields(
      { name: 'Mã Đơn', value: `\`${order.order_code}\``, inline: true },
      { name: 'Sản Phẩm', value: formatOrderProduct(order.quantity, order.product_name), inline: true },
      ...(order.expiry_at ? [{ name: 'Hết Hạn', value: `<t:${unixTs(order.expiry_at)}:D>`, inline: true }] : []),
    )
    .setTimestamp();
  if (config.deliveryBannerUrl) embed.setImage(config.deliveryBannerUrl);
  return applyBranding(embed);
}

// ═══ Delivery Notice V2 (Components V2) ═══
export function buildDeliveryNoticeV2(order) {
  const em = order.guild_id ? getEmojiMap(order.guild_id) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;
  const store = brandName('store');

  const container = new ContainerBuilder().setAccentColor(accentFor('primary'));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      h2(`${E('order_product')}  Đơn Hàng Đã Được Giao!`),
      `> ${fmt.user(order.customer_id)} — ${E('icon_doc')} Nếu đơn có tài khoản, bấm nút bên dưới để nhận thông tin đăng nhập.`,
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `${E('order_id')} ${fmt.b('Mã Đơn:')} ${fmt.code(order.order_code)}`,
      `${E('order_product')} ${fmt.b('Sản Phẩm:')} ${formatOrderProduct(order.quantity, order.product_name)}`,
      order.expiry_at ? `${E('icon_calendar')} ${fmt.b('Hết Hạn:')} ${T.date(order.expiry_at)}` : null,
    ))
  );

  if (config.deliveryBannerUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(config.deliveryBannerUrl)
      )
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(subtext(`${E('icon_heart_purple')} ${config.shipperFooter || store}`))
  );

  return { container, flags: MessageFlags.IsComponentsV2 };
}

export function buildDeliveryClaimComponents(orderCode) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`delivery:claim:${orderCode}`)
        .setLabel('Nhan Thong Tin Tai Khoan')
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

export function buildDeliveryCredentialEmbeds(order) {
  const credEmail = decrypt(order.credential_email);
  const credPassword = decrypt(order.credential_password);
  const credProfile = decrypt(order.credential_profile);
  const credPin = decrypt(order.credential_pin);
  const accountEmbed = applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorInfo)
      .setTitle(`Thong Tin Tai Khoan — ${order.product_name}`)
      .setDescription('> Bảo mật thông tin này, **không chia sẻ** với bất kỳ ai!')
      .addFields(
        { name: 'Email', value: `\`${credEmail ?? 'Chưa cấu hình'}\``, inline: true },
        { name: 'Mat Khau', value: `\`${credPassword ?? 'Chưa cấu hình'}\``, inline: true },
        { name: 'Profile', value: credProfile ? `\`${credProfile}\`` : '`—`', inline: true },
        { name: 'PIN', value: credPin ? `\`${credPin}\`` : '`—`', inline: true },
        ...(order.expiry_at ? [{ name: 'Het Han', value: `<t:${unixTs(order.expiry_at)}:F>`, inline: false }] : []),
      )
      .setTimestamp(),
    'shipper',
  );
  const termsEmbed = applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorSuccess)
      .setTitle('Dieu Khoan Su Dung Dich Vu')
      .setDescription(order.claim_notes ?? config.defaultDeliveryTerms)
      .setTimestamp(),
    'shipper',
  );
  return [accountEmbed, termsEmbed];
}

export function buildDeliveryLoginComponents(order) {
  if (!order.delivery_login_url) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Dang Nhap Dich Vu').setStyle(ButtonStyle.Link).setURL(order.delivery_login_url),
    ),
  ];
}

export function buildCredentialEmbeds(order) {
  const credEmail = decrypt(order.credential_email);
  const credPassword = decrypt(order.credential_password);
  const credentialEmbed = applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorInfo)
      .setTitle('Thong Tin Tai Khoan Nhan Hang')
      .addFields(
        { name: 'Mã Đơn', value: `\`${order.order_code}\`` },
        { name: 'Gmail', value: `\`${credEmail}\`` },
        { name: 'Mật Khẩu', value: `\`${credPassword}\`` },
      )
      .setTimestamp(),
  );
  const noteEmbed = applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorDanger)
      .setTitle('Lưu Ý Quan Trọng')
      .setDescription(order.claim_notes ?? config.defaultDeliveryNotes)
      .setTimestamp(),
  );
  return [credentialEmbed, noteEmbed];
}

// ═══════════════════════════════════════════════
// Transcript
// ═══════════════════════════════════════════════
export function buildTranscriptSummaryEmbed(ticket, closedById, messageCount, transcriptUrl) {
  const embed = applyBranding(
    new EmbedBuilder()
      .setTitle('Ticket Đã Đóng — Transcript')
      .setColor(0x99aab5)
      .addFields(
        { name: 'Mã Ticket', value: `\`${ticket.ticket_code}\``, inline: true },
        { name: 'Loại', value: ticket.ticket_type === 'WARRANTY' ? 'Bảo Hành' : ticket.ticket_type, inline: true },
        { name: 'Khách', value: `<@${ticket.customer_id}>`, inline: true },
        { name: 'Đóng Bởi', value: `<@${closedById}>`, inline: true },
        { name: 'Tin Nhắn', value: `${messageCount}`, inline: true },
      )
      .setTimestamp()
  );
  if (transcriptUrl) embed.setDescription(`[Xem Transcript trên Web](${transcriptUrl})`);
  return embed;
}

export function buildTranscriptCustomerEmbed(ticket, messageCount, transcriptUrl) {
  const embed = applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorInfo)
      .setTitle(`Transcript Ticket \`${ticket.ticket_code}\``)
      .setDescription(`> Bot gửi lại transcript của ticket này cho bạn. (${messageCount} tin nhắn)`)
      .setTimestamp()
  );
  if (transcriptUrl) {
    embed.setDescription(embed.data.description + `\n**[Bấm vào đây để xem nội dung chat trên web](${transcriptUrl})**`);
  }
  return embed;
}

export function buildTranscriptLinkComponents(url) {
  if (!url) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Xem Transcript trên Web').setStyle(ButtonStyle.Link).setURL(url)
    )
  ];
}

// ═══════════════════════════════════════════════
// Queue & Status text
// ═══════════════════════════════════════════════
export function buildQueueStatusText(order, position, totalInQueue) {
  const claim = order.claimed_by_id ? ` • đang claim bởi <@${order.claimed_by_id}>` : '';
  return `Đơn **\`${order.order_code}\`** đang ở vị trí **${position} / ${totalInQueue}** — nhóm **\`${order.queue_group ?? normalizeQueueGroup(order.product_name) ?? 'mac-dinh'}\`**${claim}`;
}

// ═══════════════════════════════════════════════
// Bot Info
// ═══════════════════════════════════════════════
export function buildAutomationGuideEmbed() {
  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorInfo)
      .setTitle('Cơ Chế Bot Bán Hàng Tự Động')
      .setDescription([
        '**Luồng Mua Hàng:**',
        '`1.` Khách bấm **Mua Hàng** → Tạo ticket riêng tư',
        '`2.` Staff dùng `/order` → Tạo đơn, gắn sản phẩm và giá',
        '`3.` Bot tạo QR + link PayOS → Chờ thanh toán',
        '`4.` PayOS webhook xác nhận → Bot tự cập nhật trạng thái',
        '`5.` Staff dùng `/giaohang` → Giao tài khoản qua DM',
        '`6.` Bot nhắc feedback → Lưu lịch sử khách hàng',
        '',
        '**Bảo Hành:**',
        '`7.` Khách bấm **Bảo Hành** → Chọn sản phẩm → Mở ticket bảo hành',
      ].join('\n'))
      .addFields(
        { name: 'Lệnh Staff', value: '`/order` `/giaohang` `/qr` `/hoanthanh` `/sua-don` `/renew`' },
        { name: 'Lệnh Admin', value: '`/setup-ticket` `/setup-payos` `/blacklist` `/mute-ticket` `/thongke`' },
      )
      .setTimestamp(),
  );
}

export function buildDoneConfirmationText(order, dmSent) {
  return dmSent
    ? `Đã hoàn tất đơn \`${order.order_code}\` và gửi DM cho khách.`
    : `Đã hoàn tất đơn \`${order.order_code}\`, nhưng bot chưa gửi được DM cho khách.`;
}

export function buildDeliveryLogText(order) {
  return `> Đã giao tài khoản cho <@${order.customer_id}> — Đơn \`${order.order_code}\`. Kiểm tra DM để xem chi tiết.`;
}

// ═══════════════════════════════════════════════
// Customer Profile
// ═══════════════════════════════════════════════
export function buildCustomerProfileEmbed(user, profile, orders) {
  const embed = applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorInfo)
      .setTitle('Ho So Khach Hang')
      .setDescription(`<@${user.id}>`)
      .addFields(
        { name: 'Mua Tu', value: profile?.first_seen_at ? `<t:${unixTs(profile.first_seen_at)}:R>` : '_Chua co_', inline: true },
        { name: 'Tong Don', value: `${profile?.total_orders ?? 0}`, inline: true },
        { name: 'Hoan Thanh', value: `${profile?.total_completed_orders ?? 0}`, inline: true },
        { name: 'Dang No', value: `${profile?.total_open_orders ?? 0}`, inline: true },
        { name: 'Tong Chi', value: formatCurrency(profile?.total_spent ?? 0), inline: true },
        { name: 'Da Thanh Toan', value: formatCurrency(profile?.total_paid_amount ?? 0), inline: true },
      )
      .setThumbnail(user.displayAvatarURL())
      .setTimestamp(),
  );
  if (orders?.length) {
    embed.addFields({
      name: '5 Don Gan Nhat',
      value: orders.map(o =>
        `• \`${o.order_code}\` — ${formatOrderProduct(o.quantity, o.product_name)} — **${getOrderStatusLabel(o.status)}**`,
      ).join('\n'),
    });
  }
  return embed;
}

// ═══ Customer Profile V2 (Components V2) ═══
export function buildCustomerProfileV2(user, profile, orders, points, guildId = null) {
  const em = guildId ? getEmojiMap(guildId) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;

  const container = new ContainerBuilder().setAccentColor(accentFor('info'));

  // Calculate Rank based on lifetime points
  const lp = points?.lifetime_points ?? 0;
  let rankName = 'Thành Viên Mới';
  let rankEmoji = E('icon_sparkle', '✨');
  if (lp >= 1000) {
    rankName = 'Thành Viên Kim Cương';
    rankEmoji = E('icon_gem', '💎');
  } else if (lp >= 500) {
    rankName = 'Thành Viên Bạch Kim';
    rankEmoji = E('icon_crown', '👑');
  } else if (lp >= 200) {
    rankName = 'Thành Viên Vàng';
    rankEmoji = E('icon_gold', '🥇');
  } else if (lp >= 50) {
    rankName = 'Thành Viên Bạc';
    rankEmoji = E('icon_silver', '🥈');
  } else if (lp >= 10) {
    rankName = 'Thành Viên Đồng';
    rankEmoji = E('icon_bronze', '🥉');
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      h2(`${E('ticket_user', '👤')} HỒ SƠ KHÁCH HÀNG ${E('icon_sparkle', '✨')}`),
      `> ${fmt.user(user.id)}`,
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `### ${E('icon_clipboard', '📋')} Thông Tin Mua Hàng`,
      `* ${E('icon_calendar', '📅')} ${fmt.b('Thành viên từ:')} ${profile?.first_seen_at ? T.rel(profile.first_seen_at) : fmt.i('Chưa rõ')}`,
      `* ${E('order_product', '📦')} ${fmt.b('Tổng số đơn:')} ${profile?.total_orders ?? 0} (Đã hoàn thành: **${profile?.total_completed_orders ?? 0}** | Đang xử lý: **${profile?.total_open_orders ?? 0}** )`,
      `* ${E('payment_money', '💵')} ${fmt.b('Tổng chi tiêu:')} ${fmt.b(formatCurrency(profile?.total_spent ?? 0))}`,
      `* ${E('payment_success', '💳')} ${fmt.b('Thực nhận:')} ${formatCurrency(profile?.total_paid_amount ?? 0)}`,
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `### ${E('icon_trophy', '🏆')} Tích Lũy Điểm Thưởng`,
      `* ${rankEmoji} ${fmt.b('Hạng thành viên:')} ${fmt.b(rankName)}`,
      `* ${E('icon_star', '⭐')} ${fmt.b('Điểm hiện tại:')} **${points?.points ?? 0}** LP`,
      `* ${E('icon_trophy', '🏆')} ${fmt.b('Điểm tích lũy trọn đời:')} **${lp}** LP`,
    ))
  );

  if (orders?.length) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(joinLines(
        `### ${E('icon_history', '📜')} Lịch Sử Đơn Hàng`,
        ...orders.map(o =>
          `> \`${o.order_code}\` — ${formatOrderProduct(o.quantity, o.product_name)} — ${fmt.b(getOrderStatusLabel(o.status, guildId))}`,
        ),
      ))
    );
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(subtext(`${E('icon_heart_purple', '💜')} ${config.storeFooter || brandName('store')}`))
  );

  return { container, flags: MessageFlags.IsComponentsV2 };
}

// ═══════════════════════════════════════════════
// Outstanding Orders
// ═══════════════════════════════════════════════
export function buildOutstandingOrdersEmbed(summary, orders, customer = null) {
  const titleSuffix = customer ? ` — ${customer.username}` : '';
  const embed = applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorWarning)
      .setTitle(`Don Hang Con Xu Ly${titleSuffix}`)
      .addFields(
        { name: 'Tong Cong', value: `${summary.total_orders ?? 0}`, inline: true },
        { name: 'Cho Thanh Toan', value: `${summary.waiting_payment ?? 0}`, inline: true },
        { name: 'Dang Xu Ly', value: `${summary.processing ?? 0}`, inline: true },
        { name: 'Dang Bao Hanh', value: `${summary.warranty_open ?? 0}`, inline: true },
      )
      .setTimestamp(),
  );
  if (orders?.length) {
    embed.addFields({
      name: 'Danh Sach',
      value: orders.map(o =>
        `• \`${o.order_code}\` <@${o.customer_id}> ${o.ticket_channel_id ? `(<#${o.ticket_channel_id}>)` : ''} — ${formatOrderProduct(o.quantity, o.product_name)} — ${getOrderStatusLabel(o.status)}`,
      ).join('\n').slice(0, 1024),
    });
  }
  return embed;
}

// ═══════════════════════════════════════════════
// Warranty
// ═══════════════════════════════════════════════
export function buildWarrantyOpenedEmbed(order, reason, channel) {
  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorWarning)
      .setTitle('Ticket Bảo Hành Đã Mở')
      .addFields(
        { name: 'Mã Đơn', value: `\`${order.order_code}\``, inline: true },
        { name: 'Sản Phẩm', value: formatOrderProduct(order.quantity, order.product_name), inline: true },
        { name: 'Ticket', value: `${channel}`, inline: true },
        ...(reason ? [{ name: 'Mô Tả Lỗi', value: reason, inline: false }] : []),
      )
      .setTimestamp(),
  );
}

export function buildWarrantyPromptEmbed(orderCode) {
  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorWarning)
      .setTitle('Ho Tro Bao Hanh')
      .setDescription(`> Cần bảo hành đơn \`${orderCode}\`? Bấm nút bên dưới để mở ticket bảo hành riêng.`)
      .setTimestamp(),
  );
}

// ═══════════════════════════════════════════════
// Setup & Config
// ═══════════════════════════════════════════════
export function buildBankSetupEmbed() {
  const webhookUrl = getWebhookUrl();
  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorSuccess)
      .setTitle('PayOS Da San Sang')
      .addFields(
        { name: 'Provider', value: `\`${config.paymentProvider}\``, inline: true },
        { name: 'Client ID', value: config.payosClientId ? `\`${String(config.payosClientId).slice(0, 8)}...\`` : '`Thieu`', inline: true },
        { name: 'API Key', value: config.payosApiKey ? '`Da cau hinh`' : '`Thieu`', inline: true },
        { name: 'Webhook URL', value: webhookUrl ? `\`${webhookUrl}\`` : '`Chua cau hinh PUBLIC_BASE_URL`', inline: false },
      )
      .setTimestamp(),
  );
}

export function buildPayOSSetupEmbed(extraLines = []) {
  const base = buildBankSetupEmbed();
  if (extraLines.length) {
    base.addFields({ name: 'Ghi Chu', value: extraLines.join('\n').slice(0, 1024) });
  }
  return base;
}

export function buildWebhookHealthEmbed() {
  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorInfo)
      .setTitle('Webhook Server Dang Hoat Dong')
      .addFields(
        { name: 'Port', value: `\`${config.httpPort}\``, inline: true },
        { name: 'Provider', value: `\`${config.paymentProvider}\``, inline: true },
        { name: 'Webhook Path', value: `\`${config.payosWebhookPath}\``, inline: true },
        { name: 'Public URL', value: getWebhookUrl() ? `\`${getWebhookUrl()}\`` : '`Chua cau hinh`', inline: false },
      )
      .setTimestamp(),
  );
}

export function buildPaymentWaitingAckEmbed(order) {
  return applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorInfo)
      .setTitle('Dang Cho Xac Nhan Thanh Toan')
      .setDescription('> Bot se **tu dong cap nhat** sau khi nhan xac nhan tu PayOS.')
      .addFields(
        { name: 'Ma Don', value: `\`${order.order_code}\``, inline: true },
        { name: 'Can Thanh Toan', value: `**${formatCurrency(order.total_amount)}**`, inline: true },
        { name: 'Trang Thai', value: `\`${getPaymentStatusLabel(order.payment_status)}\``, inline: true },
        ...(order.payment_expired_at ? [{ name: 'Het Han', value: `<t:${unixTs(order.payment_expired_at)}:R>`, inline: true }] : []),
      )
      .setTimestamp(),
  );
}

// ═══════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════
export function buildDashboardEmbed(summary, topProducts = [], recentLogs = [], guildId = null) {
  const em = guildId ? getEmojiMap(guildId) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;
  const MEDAL_SLOTS = ['icon_gold', 'icon_silver', 'icon_bronze'];

  // Build description đẹp với heading + grouped stats
  const orderStats = joinLines(
    `> ${fmt.b('Tổng đơn:')} ${fmt.code(summary.total_orders ?? 0)}`,
    `> ${E('order_pending')} ${fmt.b('Chờ TT:')} ${fmt.code(summary.pending_payment ?? 0)} · ${E('icon_cycle')} ${fmt.b('Đang xử lý:')} ${fmt.code(summary.processing ?? 0)}`,
    `> ${E('status_check')} ${fmt.b('Hoàn thành:')} ${fmt.code(summary.completed ?? 0)} · ${E('panel_warranty')} ${fmt.b('Bảo hành:')} ${fmt.code(summary.warranty_open ?? 0)}`,
  );

  const customerStats = joinLines(
    `> ${E('icon_group')} ${fmt.b('Khách hàng:')} ${fmt.code(summary.customers ?? 0)}`,
    `> ${E('icon_block')} ${fmt.b('Blacklist:')} ${fmt.code(summary.blacklisted ?? 0)}`,
  );

  const revenue = `> ${E('payment_money')} ${fmt.b('Doanh thu:')} ${fmt.b(formatCurrency(summary.revenue_paid ?? 0))}`;

  const desc = joinLines(
    h2(`${E('icon_chart')}  Dashboard Cream Store`),
    subtext(`Cập nhật ${T.rel(new Date())}`),
    '',
    h3(`${E('order_product')} Đơn hàng`),
    orderStats,
    '',
    h3(`${E('icon_group')} Khách hàng`),
    customerStats,
    '',
    h3(`${E('payment_money')} Doanh thu`),
    revenue,
  );

  const embed = applyBranding(
    new EmbedBuilder()
      .setColor(config.accentColorInfo)
      .setDescription(desc)
      .setTimestamp(),
  );

  if (topProducts.length) {
    const topText = topProducts.slice(0, 5).map((item, i) => {
      const medal = MEDAL_SLOTS[i] ? E(MEDAL_SLOTS[i]) : `${i + 1}.`;
      return `${medal} ${fmt.b(item.product_name)} — ${fmt.code(item.total_orders + ' đơn')}`;
    }).join('\n');
    embed.addFields({
      name: `${E('icon_trophy')} Top Sản Phẩm`,
      value: topText.slice(0, 1024),
    });
  }

  if (recentLogs.length) {
    const logText = recentLogs.slice(0, 8).map(item =>
      `• ${fmt.b(item.action)} — ${item.detail ?? '—'}`
    ).join('\n');
    embed.addFields({
      name: `${E('icon_clipboard')} Nhật Ký Staff`,
      value: logText.slice(0, 1024),
    });
  }

  return embed;
}

// ═══════════════════════════════════════════════
// Blacklist
// ═══════════════════════════════════════════════
export function buildBlacklistEmbed(user, flag) {
  return applyBranding(
    new EmbedBuilder()
      .setColor(Number(flag?.is_blacklisted) ? config.accentColorDanger : config.accentColorWarning)
      .setTitle('Ho So Canh Bao Khach Hang')
      .setDescription(`<@${user.id}>`)
      .addFields(
        { name: 'Canh Bao', value: `${flag.warning_count ?? 0}`, inline: true },
        { name: 'Blacklist', value: Number(flag.is_blacklisted) ? '**Co**' : 'Khong', inline: true },
        { name: 'Mute Ticket', value: Number(flag.is_ticket_muted ?? 0) ? '**Co**' : 'Khong', inline: true },
        { name: 'Ly Do Blacklist', value: flag.blacklist_reason ?? '_Chua co_', inline: false },
        ...(flag.ticket_mute_reason ? [{ name: 'Ly Do Mute', value: flag.ticket_mute_reason, inline: false }] : []),
      )
      .setThumbnail(user.displayAvatarURL())
      .setTimestamp(),
  );
}

// ═══════════════════════════════════════════════
// Credit Offer (Ví Trả Sau / Vay Hạn Mức)
// ═══════════════════════════════════════════════
export function buildCreditOfferV2(creditInfo, customerId, guildId = null) {
  const brand = brandConfig('store');
  const em = guildId ? getEmojiMap(guildId) : {};
  const E = (slot, fallback = '') => em[slot] || fallback;

  const container = new ContainerBuilder().setAccentColor(0x57F287); // Emerald Green

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(joinLines(
      `## <:verifybadge:1481127479702847646> BẠN ĐỦ ĐIỀU KIỆN KÍCH HOẠT VÍ TRẢ SAU (BNPL)`,
      `> ${E('icon_heart_purple')} **Xin chúc mừng!** Dựa trên lịch sử tín nhiệm, bạn đã được cấp hạn mức mua trước trả sau 0% lãi suất.`,
      `> <:cr_cardd:1348624271437463552> ${fmt.b('Hạn mức được cấp:')} ${fmt.code(vnd(creditInfo.limit))}`,
      `> <:money:1442876095442714748> ${fmt.b('Có thể dùng:')} ${fmt.code(vnd(creditInfo.available))}`,
      '',
      `### ${E('status_info')}  ${fmt.b('Quyền lợi & Yêu cầu:')}`,
      `> - Nhận tài khoản/dịch vụ **ngay lập tức**, thanh toán phần còn lại sau 7 - 14 ngày.`,
      `> - Có thể cần trả trước/cọc (30% - 50%) tùy theo loại sản phẩm.`,
      `> - Quá hạn 14 ngày không thanh toán sẽ bị thu hồi tài khoản & vào Blacklist.`,
      '',
      `Bấm nút bên dưới nếu bạn muốn sử dụng đặc quyền này cho đơn hàng hiện tại.`
    ))
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );

  const btnApply = new ButtonBuilder()
    .setCustomId('ticket:credit_apply')
    .setLabel('Sử Dụng Ví Trả Sau')
    .setStyle(ButtonStyle.Success)
    .setEmoji(ec(em, 'payment_payos') || { id: '1348624271437463552', name: 'cr_cardd' });

  const btnRules = new ButtonBuilder()
    .setCustomId('ticket:credit_rules')
    .setLabel('Xem Quy Chế')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji(ec(em, 'icon_doc') || { id: '1481127479702847646', name: 'verifybadge' });

  const row = new ActionRowBuilder().addComponents(btnApply, btnRules);

  return { container, row, flags: MessageFlags.IsComponentsV2 };
}

// END OF FILE
