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
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { normalizeV2Text } from '../utils/uiKit.js';

export const CUSTOM_SERVICES_LAUNCH = Object.freeze({
  guildId: '1282637033340403754',
  channelId: '1514598369597587546',
  priceChannelId: '1514606995842273280',
  supportChannelId: '1514607020098191393',
  audienceRoleIds: Object.freeze([
    '1282638730812854345', // Cenar Member
    '1282637103045279820', // Cenar Patron
  ]),
  marker: 'CENAR-CUSTOM-SERVICES-LAUNCH-V1',
  flags: MessageFlags.IsComponentsV2,
  packages: Object.freeze([
    Object.freeze({ name: 'STORE LAUNCH', price: 500_000, copy: 'Setup Discord + bot custom + bảng giá/nhận đơn cơ bản + hosting 3 tháng.' }),
    Object.freeze({ name: 'STORE AUTOMATION PRO', price: 750_000, copy: 'Bot booking, bot bảng giá, bot store, ticket và catalog giá nguồn.' }),
    Object.freeze({ name: 'FULL BUSINESS', price: 1_000_000, copy: 'Discord Store + bot custom + website đồng bộ theo thương hiệu.' }),
    Object.freeze({ name: 'BOT RESCUE & UI', price: 500_000, copy: 'Tìm lỗi, sửa bot và nâng cấp Components V2/emoji custom; giá từ mức niêm yết.' }),
  ]),
});

const divider = () => new SeparatorBuilder()
  .setDivider(true)
  .setSpacing(SeparatorSpacingSize.Small);

const money = (value) => `${Number(value).toLocaleString('vi-VN')}đ`;

export function buildCustomServicesLaunchPayload() {
  const campaign = CUSTOM_SERVICES_LAUNCH;
  const E = createEmojiResolver(campaign.guildId);
  const mentions = ['@everyone', ...campaign.audienceRoleIds.map((id) => `<@&${id}>`)].join(' ');

  const header = new ContainerBuilder()
    .setAccentColor(0x5865F2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      mentions,
      `# ${E('cenar_announce')} CENAR DIGITAL LAB · BIẾN STORE THÀNH HỆ THỐNG`,
      `### SETUP DISCORD · BOT CUSTOM · WEBSITE ĐỒNG BỘ`,
      `> ${E('icon_sparkle')} Không chỉ làm một con bot — Cenar xây dựng **bộ máy vận hành có nhận diện riêng**, dễ dùng và sẵn sàng phục vụ khách hàng của store.`,
      `> ${E('status_check')} Dự án triển khai mới được **tặng hosting bot 24/7 trong 3 tháng đầu**.`,
    ].join('\n'))));

  const audience = new ContainerBuilder()
    .setAccentColor(0x7C3AED)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('icon_store')} DÀNH RIÊNG CHO STORE MUỐN PHÁT TRIỂN BÀI BẢN`,
      `${E('cenar_partner')} Store bán sản phẩm số, nhận cung cấp **giá nguồn cho reseller/store khác**.`,
      `${E('icon_chart')} Store cần quản lý bảng giá, booking, ticket, đơn hàng và luồng chăm sóc khách thuận tiện hơn.`,
      `${E('icon_art')} Giao diện thiết kế theo thương hiệu, dùng **Components V2 + emoji custom mới mẻ**, rõ ràng và tạo thiện cảm ngay từ lần đầu truy cập.`,
    ].join('\n'))));

  const packages = new ContainerBuilder()
    .setAccentColor(0x10B981)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('cenar_price')} GÓI TRIỂN KHAI · GIÁ HẠT DẺ 500K–1 TRIỆU`,
      ...campaign.packages.map((item, index) => (
        `${index === 0 ? E('brand_discord') : index === 1 ? E('icon_settings') : index === 2 ? E('icon_store') : E('warranty_shield')} **${item.name} — ${money(item.price)}**\n> ${item.copy}`
      )),
      `-# Phạm vi và báo giá cuối được xác nhận sau khi khảo sát yêu cầu/mã nguồn thực tế.`,
    ].join('\n'))));

  const capabilities = new ContainerBuilder()
    .setAccentColor(0x0EA5E9)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('icon_settings')} CENAR CÓ THỂ XÂY DỰNG CHO BẠN`,
      `${E('status_check')} **Bot booking** · form đặt lịch, duyệt yêu cầu và thông báo trạng thái.`,
      `${E('status_check')} **Bot bảng giá / bot store** · catalog, menu sản phẩm, ticket và nhận đơn.`,
      `${E('status_check')} **Bot custom** · tính năng được thiết kế theo đúng quy trình riêng của store.`,
      `${E('status_check')} **Website đầy đủ** · giao diện thương hiệu, catalog và dữ liệu đồng bộ với bot.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `### ${E('warranty_shield')} NHẬN CỨU BOT LỖI · BOT “LỎ” · GIAO DIỆN CŨ`,
      `> Cenar nhận kiểm tra nguyên nhân, sửa luồng hỏng, tối ưu độ ổn định và thiết kế lại panel để bot **đẹp, thân thiện, dễ vận hành** hơn.`,
      `> ${E('icon_search')} Có mã nguồn cũ? Hãy gửi tình trạng và log lỗi trong ticket để được đánh giá chính xác trước khi triển khai.`,
    ].join('\n'))));

  const footer = new ContainerBuilder()
    .setAccentColor(0xF59E0B)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('icon_fire')} BIẾN Ý TƯỞNG CỦA BẠN THÀNH SẢN PHẨM THẬT`,
      `> Từ một server mới đến hệ thống store hoàn chỉnh: **khảo sát → lên giao diện → phát triển → kiểm thử → bàn giao → đồng hành vận hành**.`,
      `${E('cenar_support')} Mở ticket, mô tả loại hình store và tính năng mong muốn để nhận phương án phù hợp.`,
      `${E('cenar_price')} Bảng giá mới đã được đồng bộ tại <#${campaign.priceChannelId}> và trên website.`,
      `-# ${campaign.marker}`,
    ].join('\n'))));

  const orderButton = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId('ticket:create:ORDER')
      .setLabel('Nhận Tư Vấn Dự Án')
      .setStyle(ButtonStyle.Success),
    E.component('ticket_open'),
  );
  const priceButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Xem Bảng Giá Mới')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${campaign.guildId}/${campaign.priceChannelId}`),
    E.component('icon_price'),
  );
  const websiteButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Mở Website Cenar')
      .setStyle(ButtonStyle.Link)
      .setURL('https://cenarstore.xyz'),
    E.component('icon_store'),
  );

  return {
    components: [
      header,
      audience,
      packages,
      capabilities,
      footer,
      new ActionRowBuilder().addComponents(orderButton, priceButton, websiteButton),
    ],
    flags: campaign.flags,
    allowedMentions: {
      parse: ['everyone'],
      roles: [...campaign.audienceRoleIds],
      users: [],
      repliedUser: false,
    },
  };
}

function containsMarker(component, marker = CUSTOM_SERVICES_LAUNCH.marker) {
  if (typeof component?.content === 'string' && component.content.includes(marker)) return true;
  return Array.isArray(component?.components)
    && component.components.some((child) => containsMarker(child, marker));
}

function messageContainsMarker(message) {
  return Array.isArray(message?.components)
    && message.components.some((component) => containsMarker(component));
}

export function isCustomServicesLaunchMessage(message, botUserId) {
  return message?.author?.id === botUserId && messageContainsMarker(message);
}

export async function publishCustomServicesLaunch(client) {
  const campaign = CUSTOM_SERVICES_LAUNCH;
  const guild = client.guilds.cache.get(campaign.guildId)
    || await client.guilds.fetch(campaign.guildId).catch(() => null);
  if (!guild) throw new Error(`Không tìm thấy guild ${campaign.guildId}`);

  const channel = guild.channels.cache.get(campaign.channelId)
    || await guild.channels.fetch(campaign.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages) {
    throw new Error(`Kênh thông báo ${campaign.channelId} không khả dụng`);
  }

  const recent = await channel.messages.fetch({ limit: 100 });
  const boards = [...recent.values()]
    .filter((message) => isCustomServicesLaunchMessage(message, client.user.id));
  const payload = buildCustomServicesLaunchPayload();
  const current = boards[0];

  if (current) {
    await current.edit(payload);
    await Promise.all(boards.slice(1).map((message) => message.delete().catch(() => null)));
    return { status: 'updated', messageId: current.id, removed: Math.max(0, boards.length - 1) };
  }

  const message = await channel.send(payload);
  return { status: 'published', messageId: message.id, removed: 0 };
}
