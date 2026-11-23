import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown,
  MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
} from 'discord.js';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { addBookingTicketSection, bookingTicketCard, bookingTicketPayload } from './bookingTicketUi.js';
import { formatCurrency } from './formatters.js';

const receiptKinds = {
  BOOKING: { title: 'Hóa đơn đặt lịch', file: 'booking', tint: '#a9a2f8', demo: 150_000 },
  DEPOSIT: { title: 'Biên nhận nạp tiền', file: 'nap-tien', tint: '#8cdbd0', demo: 100_000 },
  DONATION: { title: 'Biên nhận ủng hộ', file: 'ung-ho', tint: '#e1accb', demo: 50_000 },
  REFUND: { title: 'Biên nhận hoàn tiền', file: 'hoan-tien', tint: '#ebc98f', demo: 75_000 },
};

const statuses = {
  PREVIEW: { text: 'BẢN MẪU', color: '#ebc98f' },
  PENDING: { text: 'Chờ thanh toán', color: '#ebc98f' },
  FREE: { text: 'Miễn phí', color: '#8cdbd0' },
  PAID: { text: 'Đã xác nhận giao dịch', color: '#8cdbd0' },
  NEEDS_REVIEW: { text: 'Cần rà soát', color: '#ebc98f' },
  EXPIRED: { text: 'Hết hạn thanh toán', color: '#f3a8a5' },
  REFUNDED: { text: 'Đã xác nhận hoàn tiền', color: '#8cdbd0' },
};

const serviceLabels = { game: 'Chơi game', voice: 'Trò chuyện qua voice' };
const receiptCode = /^[A-Za-z0-9_-]{1,60}$/u;
const numberCode = /^[A-Za-z0-9][A-Za-z0-9_ -]{0,31}$/u;
const formatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hourCycle: 'h23', dateStyle: 'short', timeStyle: 'short',
});
const xmlCharacters = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xml = value => String(value).replace(/[&<>"']/gu, char => xmlCharacters[char]);
const segmenter = new Intl.Segmenter('vi', { granularity: 'grapheme' });

function truncate(value, limit) {
  const parts = [...segmenter.segment(value)].map(item => item.segment);
  return parts.length > limit ? `${parts.slice(0, limit - 1).join('')}…` : value;
}

function timestamp(value) {
  const date = typeof value === 'string' ? Date.parse(value) : value;
  return Number.isSafeInteger(date) && date > 0 && date <= 8.64e15 ? date : null;
}

function cleanDescription(value) {
  if (typeof value !== 'string') return '';
  return truncate(value.slice(0, 800).replace(/\s+/gu, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').trim(), 120);
}

function payOSUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value);
    return url.origin === 'https://pay.payos.vn' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function createReceiptModel(input, now) {
  const { kind, status, description, code, amount, issuedAt, paidAt, startsAt, service, durationMinutes, payment, preview } = input;
  if (!Object.hasOwn(receiptKinds, kind)) throw new TypeError('Loại hóa đơn không hợp lệ.');
  const mode = receiptKinds[kind];
  if (preview === true || status === 'PREVIEW') {
    return { ...mode, status: statuses.PREVIEW, code: `MAU-${mode.file.toUpperCase()}`, amount: formatCurrency(mode.demo),
      preview: true, rows: [], description: 'Chỉ để xem giao diện Cenar Booking.' };
  }
  if (!Object.hasOwn(statuses, status) || typeof code !== 'string' || !receiptCode.test(code)
    || !Number.isSafeInteger(amount) || amount < 0 || (status === 'FREE' ? kind !== 'BOOKING' || amount !== 0 : amount === 0)
    || (kind === 'REFUND' && status === 'PAID')) {
    throw new TypeError('Dữ liệu hóa đơn không hợp lệ.');
  }

  const payableBooking = kind === 'BOOKING' && status === 'PENDING';
  const expiresAt = payableBooking ? timestamp(payment?.expiresAt) : null;
  const activePayOS = expiresAt != null && expiresAt > now;
  const checkoutUrl = activePayOS ? payOSUrl(payment.checkoutUrl) : null;
  const qr = activePayOS && typeof payment.qrPayload === 'string' && /^000201[\x20-\x7e]{1,1024}$/u.test(payment.qrPayload)
    ? payment.qrPayload : null;
  const transferCode = (checkoutUrl || qr) && typeof payment.transferCode === 'string' && numberCode.test(payment.transferCode)
    ? payment.transferCode : null;
  const statusView = payableBooking && expiresAt && !activePayOS ? statuses.EXPIRED : statuses[status];
  const specialisedStatus = {
    BOOKING: { PAID: 'Đã xác nhận giao dịch QR' },
    DEPOSIT: { PENDING: 'Chờ ghi nhận nạp tiền' },
    DONATION: { PENDING: 'Chờ ghi nhận ủng hộ' },
    REFUND: { PENDING: 'Chờ xác nhận hoàn tiền' },
  }[kind][status];
  const rows = [];
  const addTime = (label, value) => {
    const time = timestamp(value);
    if (time) rows.push({ label, value: formatter.format(time), time });
  };
  if (kind === 'BOOKING') {
    if (Object.hasOwn(serviceLabels, service)) rows.push({ label: 'Dịch vụ', value: serviceLabels[service] });
    addTime('Giờ bắt đầu', startsAt);
    if (Number.isInteger(durationMinutes) && durationMinutes > 0 && durationMinutes <= 1440) {
      rows.push({ label: 'Thời lượng', value: `${durationMinutes} phút` });
    }
  }
  addTime('Lập biên nhận', issuedAt);
  if (status === 'PAID' || status === 'REFUNDED') addTime('Xác nhận giao dịch', paidAt);
  if (transferCode) rows.push({ label: 'Nội dung chuyển khoản', value: transferCode, code: true });
  addTime('Hạn thanh toán', expiresAt);
  return { ...mode, status: specialisedStatus ? { ...statusView, text: specialisedStatus } : statusView,
    code, amount: formatCurrency(amount), description: cleanDescription(description), rows, checkoutUrl, qr, payableBooking };
}

function drawQR(payload, left, top) {
  const modules = QRCode.create(payload, { errorCorrectionLevel: 'M' }).modules;
  const size = modules.size;
  const scale = Math.floor(264 / (size + 8));
  const offset = Math.floor((264 - (size + 8) * scale) / 2) + 4 * scale;
  let ink = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules.get(row, col)) ink += `M${col} ${row}h1v1h-1z`;
    }
  }
  return `<rect x="${left}" y="${top}" width="264" height="264" rx="7" fill="#fff"/>
    <path d="${ink}" transform="translate(${left + offset} ${top + offset}) scale(${scale})"
      fill="#111827" shape-rendering="crispEdges"/>`;
}

function renderReceiptArtwork(model) {
  const { status, title, code, amount, rows, qr, tint, preview, description } = model;
  const panelHeight = qr ? Math.max(345, rows.length * 53 + 35) : Math.max(98, Math.ceil(rows.length / 2) * 74 + 28);
  const panelTop = 326;
  const height = panelTop + panelHeight + 74;
  const details = rows.map(({ label, value }, index) => {
    const x = !qr && index % 2 ? 435 : 76;
    const y = panelTop + 42 + (qr ? index * 53 : Math.floor(index / 2) * 74);
    return `<text x="${x}" y="${y}" fill="#bbc3dd" font-size="17">${xml(label)}</text>
      <text x="${x}" y="${y + 24}" fill="#f1f4ff" font-size="21" font-weight="600">${xml(truncate(value, qr ? 29 : 23))}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="${height}" viewBox="0 0 840 ${height}">
    <defs>
      <linearGradient id="base" y2="1"><stop stop-color="#202845"/><stop offset="1" stop-color="#101625"/></linearGradient>
      <linearGradient id="beam" x2="1" y2="1"><stop stop-color="${tint}" stop-opacity=".30"/><stop offset="1" stop-color="${tint}" stop-opacity=".01"/></linearGradient>
      <clipPath id="edge"><rect x="1" y="1" width="838" height="${height - 2}" rx="27"/></clipPath>
    </defs>
    <g clip-path="url(#edge)" font-family="Arial, DejaVu Sans, sans-serif">
      <rect width="840" height="${height}" fill="url(#base)"/>
      <path d="M620 0h200L663 271H463zm181 0h82L725 271h-82z" fill="url(#beam)"/>
      <path d="M53 52l12 12-12 12-12-12zm26 0 12 12-12 12-12-12z" fill="${tint}"/>
      <text x="109" y="72" fill="#eff0ff" font-size="24" font-weight="700">CENAR BOOKING</text>
      <rect x="483" y="43" width="308" height="42" rx="21" fill="#151b2c" stroke="${status.color}" stroke-opacity=".5"/>
      <circle cx="505" cy="64" r="4" fill="${status.color}"/>
      <text x="519" y="71" fill="${status.color}" font-size="19" font-weight="700">${xml(status.text)}</text>
      <path d="M49 108h742" stroke="#dae1ff" stroke-opacity=".22"/>
      <text x="48" y="161" fill="${tint}" font-size="30" font-weight="700">${xml(title)}</text>
      <text x="48" y="234" fill="#fff" font-size="59" font-weight="700">${xml(amount)}</text>
      <text x="49" y="278" fill="#bfc7e1" font-size="19">Mã biên nhận</text>
      <text x="49" y="305" fill="#eef0fa" font-size="22" font-weight="600">${xml(truncate(code, 35))}</text>
      <rect x="48" y="${panelTop}" width="744" height="${panelHeight}" rx="16" fill="#0d1323" stroke="#cbd5ff" stroke-opacity=".20"/>
      ${details || `<text x="76" y="380" fill="#dde2fc" font-size="22">${xml(preview ? 'Mẫu minh họa · Không phải giao dịch thật' : truncate(description || status.text, 54))}</text>`}
      ${qr ? `${drawQR(qr, 499, panelTop + 24)}<text x="631" y="${panelTop + 321}" text-anchor="middle" fill="#dde5fb" font-size="20" font-weight="700">Quét QR PayOS</text>` : ''}
      <text x="49" y="${height - 30}" fill="#bbc3dd" font-size="18">${xml(preview ? 'BẢN MẪU  •  Chỉ để xem giao diện' : 'Cenar Booking  •  Mốc giờ Việt Nam')}</text>
    </g>
    <rect x="1" y="1" width="838" height="${height - 2}" rx="27" fill="none" stroke="${tint}" stroke-opacity=".38" stroke-width="2"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Presentation only. Pass payment data exclusively after binding the order to the canonical booking PayOS invoice. */
export async function buildBookingReceiptCard(input) {
  const model = createReceiptModel(input, Date.now());
  const { title, code, amount, description, rows, status, preview, checkoutUrl, qr, payableBooking } = model;
  const fileName = `cenar-${preview ? 'mau-' : ''}${model.file}.png`;
  let image;
  try {
    image = await renderReceiptArtwork(model);
  } catch { /* Maintain the native text and PayOS button if the renderer is temporarily unavailable. */ }

  const container = bookingTicketCard({ section: preview ? 'XEM TRƯỚC' : 'BIÊN NHẬN RIÊNG', title: preview ? `BẢN MẪU · ${title}` : title,
    subtitle: `**${amount}** · ${preview ? 'Số tiền minh họa' : status.text}`, emoji: input.emoji, accent: Number.parseInt(status.color.slice(1), 16) });
  addBookingTicketSection(container, [
    `**Mã biên nhận** · \`${code}\``,
    ...(description ? [escapeMarkdown(description.replace(/[<>]/gu, char => char === '<' ? '‹' : '›'))] : []),
    ...rows.map(row => `**${row.label}** · ${row.time ? `<t:${Math.floor(row.time / 1000)}:f>` : row.code ? `\`${row.value}\`` : row.value}`),
  ].join('\n'));
  if (image) {
    const alt = `${title} · ${status.text} · ${amount}${qr ? ' · Có mã QR PayOS' : ''}`;
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder()
      .setURL(`attachment://${fileName}`).setDescription(alt)));
  }
  if (checkoutUrl) {
    const button = new ButtonBuilder().setLabel('Mở thanh toán PayOS').setStyle(ButtonStyle.Link).setURL(checkoutUrl);
    container.addActionRowComponents(new ActionRowBuilder().addComponents(button));
  }
  if (checkoutUrl || (qr && image)) addBookingTicketSection(container,
    '-# Kiểm tra số tiền và nội dung chuyển khoản. Bot cập nhật hóa đơn sau khi PayOS đối soát.');
  else if (payableBooking && status === statuses.PENDING) addBookingTicketSection(container,
    '-# Mở phiếu để staff kiểm tra thông tin thanh toán.');
  const payload = bookingTicketPayload(container);
  return { ...payload, flags: payload.flags | (input.ephemeral === false ? 0 : MessageFlags.Ephemeral),
    ...(image ? { files: [new AttachmentBuilder(image, { name: fileName })] } : {}) };
}
