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

export const BIRTHDAY_SALE = Object.freeze({
  guildId: '1282637033340403754',
  channelId: '1515008584549797979',
  marker: 'CENAR BIRTHDAY SALE 09/08',
  dateLabel: '09/08/2026',
  flags: MessageFlags.IsComponentsV2,
});

const EMOJI = Object.freeze({
  cake: '<:cenar_sale_cake:1534852782878888038>',
  party: '<:cenar_sale_party:1534852786196582514>',
  gift: '<:cenar_sale_gift:1534852792295100436>',
  check: '<a:tickgreen:1384069022831874169>',
  nitro: '<:discord_nitro:1384901794475282523>',
  boost: '<:boost:1327543332171284532>',
  spotify: '<:spotify:1459181297288220704>',
  youtube: '<:cenar_yt_logo:1543842435707310151>',
  chatgpt: '<:chatgopete:1481154927677014098>',
  gemini: '<:gemini:1481157054210248864>',
  office: '<:office365:1459180639390535836>',
  claude: '<:cenar_claude:1535690552874639531>',
  codex: '<:cr_chatgpt:1366630325530136726>',
});

const divider = () => new SeparatorBuilder()
  .setDivider(true)
  .setSpacing(SeparatorSpacingSize.Small);

export function buildBirthdaySaleComponents() {
  const container = new ContainerBuilder()
    .setAccentColor(0xff8b78)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${EMOJI.party} CENAR BIRTHDAY SALE\n` +
        `> ${EMOJI.cake} **Mừng sinh nhật Owner · ${BIRTHDAY_SALE.dateLabel}**\n` +
        `> ${EMOJI.gift} Bảng giá giới hạn dành riêng cho cộng đồng Cenar Store.\n` +
        `-# ${BIRTHDAY_SALE.marker} · Giá đã được chia đúng thời hạn để bạn dễ chọn gói.`
      ),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${EMOJI.nitro} Discord Nitro & Boost\n` +
        `${EMOJI.nitro} **Nitro Boost Login**\n` +
        '`02 tháng` **99.000đ**  ·  `04 tháng` **200.000đ**\n' +
        '`06 tháng` **320.000đ** ·  `08 tháng` **420.000đ**\n' +
        '`12 tháng` **520.000đ**\n\n' +
        `${EMOJI.boost} **Boost Server**  ·  \`01 tháng\` **140.000đ**  ·  \`03 tháng\` **290.000đ**\n` +
        `${EMOJI.nitro} **Nitro Trial**  ·  \`03 tháng\` **40.000đ**\n` +
        `${EMOJI.nitro} **Nitro Login**  ·  \`01 năm\` **810.000đ**\n` +
        '-# Gói 1 năm không gia hạn · Shop xử lý theo chu kỳ 2 tháng/lần.'
      ),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${EMOJI.gift} Giải trí & công cụ bản quyền\n` +
        `${EMOJI.spotify} **Spotify Premium**  ·  \`06 tháng\` **180.000đ**  ·  \`12 tháng\` **280.000đ**\n` +
        `${EMOJI.youtube} **YouTube Premium**  ·  \`06 tháng\` **280.000đ**  ·  \`12 tháng\` **480.000đ**\n\n` +
        `${EMOJI.chatgpt} **ChatGPT cấp tài khoản**  ·  \`01 tháng\` **65.000đ**\n` +
        '-# Bảo hành 07 ngày · Tỷ lệ lỗi shop ghi nhận dưới 2%.\n' +
        `${EMOJI.gemini} **Gemini Pro + Google One 5TB**  ·  \`01 năm\` **180.000đ**\n` +
        `${EMOJI.office} **Office 365 + OneDrive 1TB**  ·  \`01 năm\` **180.000đ**`
      ),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${EMOJI.claude} API & Discord Decor\n` +
        `${EMOJI.claude} **Claude API**  ·  \`100M\`  ·  **85.000đ**  ·  Không giới hạn ngày\n` +
        `${EMOJI.codex} **Codex API**  ·  \`120M\`  ·  **75.000đ**  ·  Không giới hạn ngày\n` +
        `${EMOJI.gift} **Discord Decor Gift**  ·  Chỉ từ **25.000đ**`
      ),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${EMOJI.nitro} Điều kiện Nitro Boost Trial\n` +
        `${EMOJI.check} Tài khoản Discord đã tạo trên 01 tháng.\n` +
        `${EMOJI.check} Chưa từng sử dụng Nitro trả phí.\n` +
        `${EMOJI.check} Từng dùng Nitro dùng thử vẫn được áp dụng.\n\n` +
        `> ${EMOJI.gift} **Ưu đãi có giới hạn.** Nhắn Cenar Care để kiểm tra điều kiện trước khi thanh toán.`
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Xem sản phẩm')
          .setEmoji({ id: '1534852792295100436', name: 'cenar_sale_gift' })
          .setStyle(ButtonStyle.Link)
          .setURL('https://cenarstore.xyz/products'),
        new ButtonBuilder()
          .setLabel('Liên hệ Cenar Care')
          .setEmoji({ id: '1534852786196582514', name: 'cenar_sale_party' })
          .setStyle(ButtonStyle.Secondary)
          .setCustomId('ticket:create:SUPPORT'),
      ),
    );

  return [container];
}

function componentContainsMarker(component) {
  if (typeof component?.content === 'string' && component.content.includes(BIRTHDAY_SALE.marker)) return true;
  return Array.isArray(component?.components) && component.components.some(componentContainsMarker);
}

export function isBirthdaySaleMessage(message, botUserId) {
  return message?.author?.id === botUserId
    && Array.isArray(message.components)
    && message.components.some(componentContainsMarker);
}
