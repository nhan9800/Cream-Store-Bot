import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ContainerBuilder, MediaGalleryBuilder,
  MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';
import { storefrontComponentEmoji, storefrontEmoji as icon } from './storefrontEmoji.js';

export const LIEN_QUAN_CHANNEL = '🎮・acc-lien-quan';
export const LIEN_QUAN_CHANNEL_NAMES = [LIEN_QUAN_CHANNEL, 'acc-lien-quan'];
export const LIEN_QUAN_CATEGORY_ID = '1514606994256957600';
export const LIEN_QUAN_TOPIC = 'Acc Liên Quân · 80.000–100.000đ tùy acc · Bấm Mua acc để hỏi giá trong ticket riêng.';
export const LIEN_QUAN_BUTTON_PREFIX = 'lien-quan:quote:';
export const LIEN_QUAN_PRICE = '80.000–100.000đ';
export const LIEN_QUAN_TICKET_PREFIX = 'Acc Liên Quân · ';
export const LIEN_QUAN_ATTACHMENT_LIMIT = 1024 * 1024;

export const LIEN_QUAN_ACCOUNTS = [
  { code: 'LQ-01', level: 30, heroes: 91, skins: 95, matches: '2.917', winRate: '54,0%', title: 'Hai trang phục EVO',
    featured: ['Nhóc tỳ bá đạo (EVO II)', 'Xạ thần Kagutsuchi (EVO I)', 'Phù Thủy Bóng Đêm', 'Sứ giả tận thế', 'Thần Long tỷ tỷ'],
    color: 0xA78BFA, icons: { title: 'crown', price: 'received', stats: 'number', skins: 'sparkles', buy: 'next' } },
  { code: 'LQ-02', level: 30, heroes: 58, skins: 74, matches: '616', winRate: '58,8%', reputation: 100, title: 'ECHO và Attack on Titan',
    featured: ['ECHO', 'Kỷ Nguyên Hổ Phách', 'Nghịch Thiên long đế', 'Annie Leonhart', 'Scout Regiment'],
    color: 0xF472B6, icons: { title: 'heart', price: 'wallet', stats: 'group', skins: 'gold', buy: 'add' } },
  { code: 'LQ-03', level: 30, heroes: 65, skins: 110, matches: '1.327', winRate: '61,0%', title: 'Bộ sưu tập 110 trang phục',
    featured: ['Vợ người ta (SS hữu hạn)', 'Thần Long tỷ tỷ', 'Đệ nhất thần thám', 'Thánh nữ Khởi nguyên', 'Quán quân (FMVP)'],
    color: 0x22D3EE, icons: { title: 'diamond', price: 'money', stats: 'queue', skins: 'gift', buy: 'play' } },
  { code: 'LQ-04', level: 28, heroes: 53, skins: 82, matches: '507', winRate: '63,5%', title: 'Bình Minh Tận Thế EVO II',
    featured: ['Bình Minh Tận Thế (EVO II)', 'ECHO', 'WaVe', 'Sứ giả tận thế', 'Đao phủ tận thế', 'Mèo công nghệ'],
    color: 0x60A5FA, icons: { title: 'trophy', price: 'bank', stats: 'position', skins: 'up', buy: 'claim' } },
  { code: 'LQ-05', level: 25, heroes: 53, skins: 95, matches: '232', winRate: '67,2%', title: 'Pháo hoa Neon và bộ SS',
    featured: ['Pháo hoa Neon', 'Ngạo Hổ Hàn Đao', 'Siêu việt', 'Tư lệnh Robot', 'Tiệc bãi biển'],
    color: 0xFBBF24, icons: { title: 'celebrate', price: 'checkout', stats: 'tracking', skins: 'music', buy: 'approve' } },
];

export const lienQuanImageName = account => `acc-lien-quan-${account.code.slice(3)}.jpg`;

export function lienQuanImageUrl(components, channelId, account) {
  // Discord returns a V2 gallery upload in media.attachment_id, with an
  // empty message.attachments array. Use the original CDN URL of that item.
  const items = components.flatMap(part => part.components ?? [])
    .filter(part => part.type === ComponentType.MediaGallery)
    .flatMap(part => part.items ?? []);
  if (items.length !== 1) return null;
  const media = items[0].media;
  if (!media) return null;
  const url = URL.parse(media.url ?? '');
  const filename = lienQuanImageName(account);
  if (media.content_type !== 'image/jpeg' || !/^\d{17,22}$/.test(media.attachment_id ?? '')
    || url?.origin !== 'https://cdn.discordapp.com'
    || url.pathname !== `/attachments/${channelId}/${media.attachment_id}/${filename}`) return null;
  return url;
}

export async function readLienQuanImage(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(7_000) });
  if (!response.ok || !response.body) throw new Error('LIEN_QUAN_IMAGE_UNAVAILABLE');
  const parts = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.byteLength;
    if (size > LIEN_QUAN_ATTACHMENT_LIMIT) throw new Error('LIEN_QUAN_IMAGE_TOO_LARGE');
    parts.push(part);
  }
  const jpeg = Buffer.concat(parts, size);
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('LIEN_QUAN_IMAGE_NOT_JPEG');
  return jpeg;
}

const divider = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);
const block = content => new TextDisplayBuilder().setContent(content);
const image = account => new MediaGalleryBuilder().addItems({
  media: { url: `attachment://${lienQuanImageName(account)}` },
  description: `Ảnh ${account.code}, cấp ${account.level}, ${account.heroes} tướng và ${account.skins} trang phục`,
});

function accountStats(account) {
  return [
    `> ${icon(account.icons.stats)} **Cấp ${account.level}** · **${account.heroes} tướng** · **${account.skins} trang phục**`,
    `> ${account.matches} trận · Thắng **${account.winRate}**${account.reputation ? ` · Uy tín **${account.reputation}**` : ''}`,
  ].join('\n');
}

function featuredSkins(account) {
  return `### ${icon(account.icons.skins)} Trang phục nổi bật\n${account.featured.join(' · ')}`;
}

function priceAndInfo(priceIcon) {
  return `> ${icon(priceIcon)} **${LIEN_QUAN_PRICE}** tùy acc\n> Trắng toàn bộ thông tin`;
}

export function buildLienQuanQuoteText(account) {
  return [
    `### ${icon(account.icons.title)} Báo giá acc Liên Quân · \`${account.code}\``,
    `**${account.title}**\n${accountStats(account)}`,
    priceAndInfo(account.icons.price),
    featuredSkins(account),
    '-# Shop kiểm tra còn hàng, tình trạng liên kết và chốt giá trong ticket này.',
  ].join('\n\n');
}

export function buildLienQuanAccountCard(account) {
  const button = new ButtonBuilder().setCustomId(LIEN_QUAN_BUTTON_PREFIX + account.code)
    .setLabel(`Mua acc ${account.code}`).setStyle(ButtonStyle.Primary)
    .setEmoji(storefrontComponentEmoji(account.icons.buy));
  const card = new ContainerBuilder().setAccentColor(account.color)
    .addTextDisplayComponents(block([
      `-# LIÊN QUÂN MOBILE · \`${account.code}\``,
      `## ${icon(account.icons.title)} ${account.title}`,
    ].join('\n')))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(block(priceAndInfo(account.icons.price)))
    .addTextDisplayComponents(block(accountStats(account)))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(block(featuredSkins(account)))
    .addMediaGalleryComponents(image(account))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(block('-# Bấm Mua acc để gửi đúng ảnh vào ticket riêng và nhận giá chốt.'))
    .addActionRowComponents(new ActionRowBuilder().addComponents(button));
  return { components: [card.toJSON()], flags: MessageFlags.IsComponentsV2, allowed_mentions: { parse: [] } };
}

export function buildLienQuanGuide() {
  const card = new ContainerBuilder().setAccentColor(0x34D399)
    .addTextDisplayComponents(block(`## ${icon('home')} Acc Liên Quân Mobile\n${priceAndInfo('transaction')}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(block([
      `### ${icon('tip')} Cách mua acc`,
      `- ${icon('folder')} **Chọn acc** · Bấm nút Mua acc trên thẻ bạn thích.`,
      `- ${icon('feedback')} **Mở ticket** · Bot chuyển ảnh và thông số đúng mã vào ticket riêng.`,
      `- ${icon('scan')} **Chốt giá** · Shop kiểm tra còn hàng, liên kết và báo giá trước khi thanh toán.`,
    ].join('\n')))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(block('-# Thông số được ghi theo ảnh của từng acc.'));
  return { components: [card.toJSON()], flags: MessageFlags.IsComponentsV2, allowed_mentions: { parse: [] } };
}
