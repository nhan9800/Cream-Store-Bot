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
  cake: '<:sale_cake:1534605085659627540>',
  party: '<:sale_party:1534605089057013971>',
  gift: '<:sale_gift:1534605091888431134>',
  nitro: '<:discord_nitro:1384901794475282523>',
  boost: '<:boost:1327543332171284532>',
  spotify: '<:spotify:1459181297288220704>',
  youtube: '<:youtube:1373734824342327297>',
  chatgpt: '<:chatgopete:1481154927677014098>',
  gemini: '<:gemini:1481157054210248864>',
  office: '<:office365:1459180639390535836>',
  claude: '<:claude:1483324441076301824>',
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
        `# ${EMOJI.party} ${BIRTHDAY_SALE.marker}\n` +
        `> ${EMOJI.cake} **Mừng sinh nhật 09/08, Cenar Store mở bảng giá đặc biệt cho cộng đồng.**\n` +
        '> Giá đã được chia theo từng thời hạn để bạn chọn đúng nhu cầu, không cần mua dư thời gian.'
      ),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${EMOJI.nitro} Discord Nitro & Boost\n` +
        `${EMOJI.nitro} **Nitro Boost Login**\n` +
        '- 2 tháng: **99.000đ**\n' +
        '- 4 tháng: **200.000đ**\n' +
        '- 6 tháng: **320.000đ**\n' +
        '- 8 tháng: **420.000đ**\n' +
        '- 12 tháng: **520.000đ**\n\n' +
        `${EMOJI.boost} **Boost Server**\n` +
        '- 1 tháng: **140.000đ**\n' +
        '- 3 tháng: **290.000đ**\n\n' +
        `${EMOJI.nitro} **Nitro Boost Trial 3 tháng: 40.000đ**\n` +
        `${EMOJI.nitro} **Nitro Login 1 năm: 810.000đ**\n` +
        '> Gói 1 năm không gia hạn; shop xử lý theo chu kỳ 2 tháng/lần.'
      ),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${EMOJI.gift} Giải trí & công cụ bản quyền\n` +
        `${EMOJI.spotify} **Spotify Premium**\n` +
        '- 6 tháng: **180.000đ**\n' +
        '- 12 tháng: **280.000đ**\n\n' +
        `${EMOJI.youtube} **YouTube Premium**\n` +
        '- 6 tháng: **280.000đ**\n' +
        '- 12 tháng: **480.000đ**\n\n' +
        `${EMOJI.chatgpt} **ChatGPT cấp tài khoản 1 tháng: 65.000đ**\n` +
        '> Bảo hành 7 ngày; tỷ lệ lỗi shop ghi nhận dưới 2%.\n\n' +
        `${EMOJI.gemini} **Gemini Pro + Google One 5TB, 1 năm: 180.000đ**\n` +
        `${EMOJI.office} **Office 365 + OneDrive 1TB, 1 năm: 180.000đ**`
      ),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${EMOJI.claude} API & Discord Decor\n` +
        `${EMOJI.claude} **Claude API 100M, không giới hạn thời hạn: 85.000đ**\n` +
        `${EMOJI.codex} **Codex API 120M, không giới hạn thời hạn: 75.000đ**\n` +
        `${EMOJI.gift} **Decor Gift chỉ từ 25.000đ**`
      ),
    )
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${EMOJI.nitro} Điều kiện Nitro Boost Trial\n` +
        '- Tài khoản Discord đã tạo trên 1 tháng.\n' +
        '- Tài khoản chưa từng sử dụng Nitro trả phí.\n' +
        '- Tài khoản từng dùng Nitro dùng thử vẫn được áp dụng.\n\n' +
        `> ${EMOJI.gift} Số lượng ưu đãi có hạn theo khả năng xử lý của shop. Nhắn Cenar Care để kiểm tra điều kiện trước khi thanh toán.`
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Xem sản phẩm')
          .setEmoji({ id: '1534605091888431134', name: 'sale_gift' })
          .setStyle(ButtonStyle.Link)
          .setURL('https://cenarstore.xyz/products'),
        new ButtonBuilder()
          .setLabel('Liên hệ Cenar Care')
          .setEmoji({ id: '1534605089057013971', name: 'sale_party' })
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
