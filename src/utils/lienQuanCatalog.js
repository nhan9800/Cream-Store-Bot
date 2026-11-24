import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ContainerBuilder, MediaGalleryBuilder,
  MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';

export const LIEN_QUAN_CHANNEL = 'acc-lien-quan';
export const LIEN_QUAN_CATEGORY_ID = '1514606994256957600';
export const LIEN_QUAN_TOPIC = 'Acc Liên Quân · 80.000–100.000đ tùy acc · Bấm Mua acc để hỏi giá trong ticket riêng.';
export const LIEN_QUAN_BUTTON_PREFIX = 'lien-quan:quote:';
export const LIEN_QUAN_PRICE = '80.000–100.000đ';
export const LIEN_QUAN_ATTACHMENT_LIMIT = 1024 * 1024;

export const LIEN_QUAN_ACCOUNTS = [
  { code: 'LQ-01', level: 30, heroes: 91, skins: 95, matches: '2.917', winRate: '54,0%', title: 'Hai trang phục EVO',
    featured: ['Nhóc tỳ bá đạo (EVO II)', 'Xạ thần Kagutsuchi (EVO I)', 'Phù Thủy Bóng Đêm', 'Sứ giả tận thế', 'Thần Long tỷ tỷ'], color: 0x7766D2 },
  { code: 'LQ-02', level: 30, heroes: 58, skins: 74, matches: '616', winRate: '58,8%', reputation: 100, title: 'ECHO và Attack on Titan',
    featured: ['ECHO', 'Kỷ Nguyên Hổ Phách', 'Nghịch Thiên long đế', 'Annie Leonhart', 'Scout Regiment'], color: 0xB34C6B },
  { code: 'LQ-03', level: 30, heroes: 65, skins: 110, matches: '1.327', winRate: '61,0%', title: 'Bộ sưu tập 110 trang phục',
    featured: ['Vợ người ta (SS hữu hạn)', 'Thần Long tỷ tỷ', 'Đệ nhất thần thám', 'Thánh nữ Khởi nguyên', 'Quán quân (FMVP)'], color: 0x438FBD },
  { code: 'LQ-04', level: 28, heroes: 53, skins: 82, matches: '507', winRate: '63,5%', title: 'Bình Minh Tận Thế EVO II',
    featured: ['Bình Minh Tận Thế (EVO II)', 'ECHO', 'WaVe', 'Sứ giả tận thế', 'Đao phủ tận thế', 'Mèo công nghệ'], color: 0x467A9D },
  { code: 'LQ-05', level: 25, heroes: 53, skins: 95, matches: '232', winRate: '67,2%', title: 'Pháo hoa Neon và bộ SS',
    featured: ['Pháo hoa Neon', 'Ngạo Hổ Hàn Đao', 'Siêu việt', 'Tư lệnh Robot', 'Tiệc bãi biển'], color: 0xB78043 },
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

function accountDetails(account) {
  return [
    `**Cấp ${account.level}** · **${account.heroes} tướng** · **${account.skins} trang phục**`,
    `${account.matches} trận · Thắng **${account.winRate}**${account.reputation ? ` · Uy tín ${account.reputation}` : ''}`,
    `**Trang phục nổi bật**\n${account.featured.join(' · ')}`,
  ].join('\n');
}

export function buildLienQuanQuoteText(account) {
  return [
    `### Báo giá acc Liên Quân · ${account.code}`,
    `**${account.title}**\n${accountDetails(account)}`,
    `**Tình trạng shop công bố** · Trắng toàn bộ thông tin\n**Khoảng giá** · ${LIEN_QUAN_PRICE}`,
    'Shop kiểm tra acc còn hay không, tình trạng liên kết và báo giá chính xác ngay trong ticket này.',
  ].join('\n\n');
}

export function buildLienQuanAccountCard(account, emoji = {}) {
  const button = new ButtonBuilder().setCustomId(LIEN_QUAN_BUTTON_PREFIX + account.code)
    .setLabel(`Mua acc ${account.code}`).setStyle(ButtonStyle.Primary);
  if (emoji.buyId) button.setEmoji({ id: emoji.buyId });
  const card = new ContainerBuilder().setAccentColor(account.color)
    .addTextDisplayComponents(block([
      `-# CENAR STORE  /  LIÊN QUÂN MOBILE  /  ${account.code}`,
      `## ${account.title}`,
      `**${LIEN_QUAN_PRICE}** · Trắng toàn bộ thông tin`,
    ].join('\n')))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(block(accountDetails(account)))
    .addMediaGalleryComponents(image(account))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(block('-# Bấm Mua acc để gửi đúng ảnh vào ticket riêng. Shop kiểm tra còn hàng và chốt giá.'))
    .addActionRowComponents(new ActionRowBuilder().addComponents(button));
  return { components: [card.toJSON()], flags: MessageFlags.IsComponentsV2, allowed_mentions: { parse: [] } };
}

export function buildLienQuanGuide(emoji = {}) {
  const header = emoji.header ? `${emoji.header} ` : '';
  const card = new ContainerBuilder().setAccentColor(0x7766D2)
    .addTextDisplayComponents(block(`## ${header}Acc Liên Quân Mobile\n**${LIEN_QUAN_PRICE} tùy acc** · Trắng toàn bộ thông tin`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(block([
      'Chọn mã bên dưới và bấm **Mua acc**. Bot chuyển ảnh và thông số của đúng mã vào ticket riêng với shop.',
      'Shop kiểm tra tình trạng liên kết và còn hàng, sau đó báo giá chính xác. Thanh toán sau khi shop đã chốt trong ticket.',
      '-# Số liệu trên thẻ lấy từ ảnh đăng lúc lên danh sách.',
    ].join('\n\n')));
  return { components: [card.toJSON()], flags: MessageFlags.IsComponentsV2, allowed_mentions: { parse: [] } };
}
