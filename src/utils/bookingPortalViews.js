import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SectionBuilder,
  SeparatorBuilder, StringSelectMenuBuilder, TextDisplayBuilder,
} from 'discord.js';

export const BOOKING_PANEL_MARKER = 'CENAR-BOOKING-20261121';
export const BOOKING_BANNER_NAME = 'cenar-booking-header.webp';
export const BOOKING_PANEL_IDS = { welcome: 84267101, rules: 84267102, request: 84267103,
  handbook: 84267104, apply: 84267105, news: 84267106, games: 84267107, events: 84267108 };
const bannerPath = fileURLToPath(new URL(`../../assets/booking/${BOOKING_BANNER_NAME}`, import.meta.url));
const indigo = 0x7167db;
const mint = 0x50c8a2;
const blue = 0x556ed5;
const rose = 0xbf6c8e;

const text = content => new TextDisplayBuilder().setContent(content);
const split = () => new SeparatorBuilder().setDivider(true);
const row = (...controls) => new ActionRowBuilder().addComponents(controls);
const message = (card, hidden = false) => ({
  components: [card], flags: MessageFlags.IsComponentsV2 | (hidden ? MessageFlags.Ephemeral : 0),
  allowedMentions: { parse: [] },
});
const glyph = (emoji, key) => {
  const icon = emoji[key];
  return icon ? `<${icon.animated ? 'a' : ''}:${icon.name}:${icon.id}> ` : '';
};

function button(emoji, key, label, { url, id, primary = false }) {
  const control = new ButtonBuilder().setLabel(label);
  if (emoji[key]) control.setEmoji(emoji[key]);
  return url ? control.setStyle(ButtonStyle.Link).setURL(url)
    : control.setStyle(primary ? ButtonStyle.Primary : ButtonStyle.Secondary).setCustomId(id);
}

function section(copy, action) {
  return new SectionBuilder().addTextDisplayComponents(text(copy)).setButtonAccessory(action);
}

function panel(title, intro, accent) {
  return new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(text(`## ${title}\n${intro}`));
}

export function bookingPanels(guildId, channels, emoji) {
  const link = (key, label, channel) => channels[channel]
    ? button(emoji, key, label, { url: `https://discord.com/channels/${guildId}/${channels[channel].id}` })
    : button(emoji, key, label, { id: 'booking:dashboard:help' });
  const action = (key, label, id, primary = false) => button(emoji, key, label, { id, primary });
  const finish = (key, card) => message(card.setId(BOOKING_PANEL_IDS[key]));
  const title = (key, label) => `${glyph(emoji, key)}${label}`;
  const requestLink = () => link('calendar', 'Đặt lịch', 'request');
  const hostBrowser = () => action('profiles', 'Duyệt hồ sơ', 'booking:dashboard:hosts');
  const hostForum = () => link('profiles', 'Diễn đàn host', 'profiles');
  const help = () => action('rules', 'Mở hướng dẫn', 'booking:dashboard:help');

  const welcome = new ContainerBuilder().setAccentColor(indigo)
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder()
      .setURL(`attachment://${BOOKING_BANNER_NAME}`).setDescription('Cenar Booking. Hai dải kính tím gặp nhau trên nền chàm.')))
    .addTextDisplayComponents(text('## Chọn người đồng hành\nĐặt một buổi chơi game hoặc trò chuyện riêng với host của Cenar.'))
    .addSeparatorComponents(split())
    .addSectionComponents(
      section('**Đặt phiên**\nChọn dịch vụ và giờ rảnh. Staff xác nhận lịch trong phiếu riêng.', requestLink()),
      section('**Khám phá host**\nXem hồ sơ, chọn ca trống theo host hoặc gửi yêu cầu riêng.', hostBrowser()),
      section('**Trở thành host**\nGửi hồ sơ để staff xem xét cùng bạn.', link('apply', 'Ứng tuyển', 'apply')),
    )
    .addSeparatorComponents(split())
    .addActionRowComponents(row(link('rules', 'Cẩm nang', 'handbook'), link('game', 'Trò chơi', 'games'),
      link('news', 'Sự kiện', 'events'), action('support', 'Liên hệ hỗ trợ', 'ticket:create:SUPPORT')));

  const request = panel(title('calendar', 'Đặt phiên cùng Cenar'), 'Chọn một dịch vụ bên dưới để mở phiếu riêng.', indigo)
    .addSeparatorComponents(split())
    .addSectionComponents(
      section('**Đặt theo ca có sẵn**\nXem giờ của host, thời lượng và tổng tiền trước khi xác nhận.',
        action('calendar', 'Đặt lịch tự động', 'booking:dashboard:auto', true)),
      section('**Chơi game**\nGhi tên game, giờ bắt đầu và thời lượng.', action('game', 'Chọn game', 'booking:open:game', true)),
      section('**Trò chuyện qua voice**\nChọn host hoặc nhờ staff gợi ý theo chủ đề bạn thích.', action('voice', 'Chọn voice', 'booking:open:voice', true)),
    )
    .addSeparatorComponents(split())
    .addActionRowComponents(row(action('reviews', 'Lịch của bạn', 'booking:dashboard:my'), hostBrowser(), help()))
    .addTextDisplayComponents(text('-# Staff xác nhận riêng đối với yêu cầu game hoặc voice ngoài danh sách ca có sẵn.'));

  const handbook = panel(title('rules', 'Cẩm nang Booking'), 'Chọn một chủ đề để xem hướng dẫn riêng.', blue)
    .addSeparatorComponents(split())
    .addTextDisplayComponents(text('**Đặt lịch** · Chọn dịch vụ, giờ Việt Nam và thời lượng.\n**Theo dõi** · Mở phiếu để xác nhận host và chi phí.\n**Sau phiên** · Gửi đánh giá bằng mã phiếu đã hoàn thành.'))
    .addActionRowComponents(row(help(), requestLink(), link('support', 'Nội quy', 'rules')));

  const apply = panel(title('apply', 'Tham gia đội ngũ host'), 'Đồng hành cùng khách trong các phiên game hoặc trò chuyện.', rose)
    .addSeparatorComponents(split())
    .addTextDisplayComponents(text('**Chuẩn bị hồ sơ**\nBiệt danh, game hoặc chủ đề bạn nhận và khung giờ rảnh theo giờ Việt Nam.\n\nStaff trao đổi qua phiếu riêng trước khi duyệt hồ sơ công khai.'))
    .addActionRowComponents(row(action('apply', 'Gửi hồ sơ', 'booking:open:apply', true), hostForum()));

  const rules = panel(title('rules', 'Nội quy phiên booking'), 'Giữ lịch hẹn và tôn trọng ranh giới của nhau.', mint)
    .addSeparatorComponents(split())
    .addTextDisplayComponents(text('**Trong phiên**\nChơi game và trò chuyện theo nội quy Discord.\n\n**Khi có vấn đề**\nBáo staff trong phiếu riêng nếu cần đổi lịch hoặc gặp hành vi quấy rối.'))
    .addActionRowComponents(row(action('support', 'Liên hệ hỗ trợ', 'ticket:create:SUPPORT')));

  const news = panel(title('news', 'Tin từ Cenar'), 'Lịch hoạt động và thay đổi dịch vụ được cập nhật tại đây.', indigo)
    .addActionRowComponents(row(link('calendar', 'Về sảnh', 'welcome'), link('news', 'Xem sự kiện', 'events'),
      link('support', 'Hỗ trợ đơn cũ', 'support')));

  const shortcut = (icon, label, key, primary = false) => action(icon, label, `booking:shortcut:${key}`, primary);
  const games = panel(title('game', 'Phòng trò chơi Cenar'), 'Chọn một bảng để mở riêng cho bạn.', blue)
    .addSeparatorComponents(split())
    .addTextDisplayComponents(text('**Ô chữ hôm nay**\nChọn Tiếng Việt hoặc English. Mỗi đề có sáu lượt đoán và làm mới lúc 00:00 giờ Việt Nam.'))
    .addActionRowComponents(row(shortcut('game', 'Ô chữ Tiếng Việt', 'words-vi', true), shortcut('rules', 'English word grid', 'words-en', true)))
    .addSeparatorComponents(split())
    .addTextDisplayComponents(text('**Điểm cộng đồng**\nĐiểm danh, nhận thưởng nhiệm vụ và dùng điểm để lấy vật phẩm trong bot.'))
    .addActionRowComponents(row(shortcut('calendar', 'Điểm danh', 'checkin'), shortcut('news', 'Nhiệm vụ', 'missions'),
      shortcut('apply', 'Cửa hàng', 'shop'), shortcut('reviews', 'Bảng xếp hạng', 'leaderboard')))
    .addTextDisplayComponents(text('-# Dùng `/cenar-cong-dong choi` để mở các trò chơi nhanh. Điểm cộng đồng không quy đổi ra tiền.'));

  const events = panel(title('news', 'Sự kiện Cenar'), 'Theo dõi lịch sinh hoạt và các đợt giveaway do ban vận hành tổ chức.', rose)
    .addSeparatorComponents(split())
    .addTextDisplayComponents(text('Mỗi bài sự kiện sẽ ghi giờ bắt đầu, điều kiện tham gia và phần thưởng nếu có. Khi có giveaway, nút tham gia nằm ngay trong bài sự kiện.'))
    .addActionRowComponents(row(link('game', 'Mở trò chơi', 'games'), link('voice', 'Vào trò chuyện', 'chat')));

  return { welcome: { ...finish('welcome', welcome), files: [new AttachmentBuilder(bannerPath, { name: BOOKING_BANNER_NAME })] },
    rules: finish('rules', rules), request: finish('request', request), handbook: finish('handbook', handbook),
    apply: finish('apply', apply), news: finish('news', news), games: finish('games', games), events: finish('events', events) };
}

const topics = {
  dat_lich: { label: 'Đặt lịch và phòng voice', icon: 'calendar', body: 'Chọn game hoặc voice, nhập giờ Việt Nam và thời lượng. Staff chốt host, giờ và chi phí trong phiếu. Khi đến giờ, mở phòng riêng từ mục **Lịch của bạn** hoặc từ tin nhắn trong phiếu.' },
  ho_so: { label: 'Hồ sơ và đánh giá', icon: 'profiles', body: 'Bấm **Duyệt hồ sơ** ở sảnh hoặc cổng đặt lịch, rồi chọn **Xem ca trống**. Nếu cần giờ khác, chọn dịch vụ từ thẻ để điền sẵn host trong phiếu. Dùng `/cenar-ho-so` để cập nhật hồ sơ hoặc đánh giá phiên đã hoàn thành.' },
  cong_dong: { label: 'Trò chơi và vật phẩm', icon: 'game', body: 'Dùng `/cenar-cong-dong` để mở trò chơi chữ, trò chơi nhanh và cửa hàng vật phẩm. Điểm chỉ dùng trong cộng đồng Cenar.' },
  nhiem_vu: { label: 'Nhiệm vụ và điểm danh', icon: 'welcome', body: 'Xem tiến độ ngày và chuỗi điểm danh tại `/cenar-cong-dong`. Mốc ngày tính theo giờ Việt Nam.' },
  ho_tro: { label: 'Trợ giúp trong phiếu', icon: 'support', body: 'Mở lại phiếu của bạn từ mục **Lịch của bạn** để đổi lịch, yêu cầu gia hạn hoặc nhờ staff kiểm tra báo giá.' },
};

export function bookingHelpCard({ userId, emoji, topic }) {
  const selected = Object.hasOwn(topics, topic) ? topics[topic] : null;
  const menu = new StringSelectMenuBuilder().setCustomId(`booking:guide:topic:${userId}`).setPlaceholder('Chọn chủ đề bạn cần')
    .addOptions(Object.entries(topics).map(([value, item]) => ({ label: item.label, value, default: topic === value,
      ...(emoji[item.icon] ? { emoji: emoji[item.icon] } : {}) })));
  const card = panel(`${glyph(emoji, 'rules')}Trợ giúp Cenar Booking`, 'Đặt lịch, theo dõi phiên và khám phá hoạt động cộng đồng.', blue)
    .addSeparatorComponents(split());
  if (selected) card.addTextDisplayComponents(text(`### ${glyph(emoji, selected.icon)}${selected.label}\n${selected.body}`));
  card.addActionRowComponents(row(menu));
  return message(card, true);
}

export function bookingScheduleCard(guildId, portal, sessions, hidden = false) {
  const card = panel(`${glyph(portal.emoji, 'calendar')}Lịch của bạn`, 'Các phiên sắp tới và lịch sử gần đây.', indigo)
    .addSeparatorComponents(split());
  for (const [index, session] of sessions.slice(0, 8).entries()) {
    if (index) card.addSeparatorComponents(split());
    card.addTextDisplayComponents(text(session));
  }
  card.addActionRowComponents(row(button(portal.emoji, 'calendar', 'Mở cổng đặt lịch', {
    url: `https://discord.com/channels/${guildId}/${portal.request}`,
  })));
  return message(card, hidden);
}
