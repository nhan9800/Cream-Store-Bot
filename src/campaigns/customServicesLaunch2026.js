import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { normalizeV2Text } from '../utils/uiKit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const emojiAssetRoot = path.resolve(__dirname, '../../assets/emojis');

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
    Object.freeze({ name: 'BOT CUSTOM STARTER', price: 500_000, copy: 'Bot theo nhận diện riêng, đầy đủ tính năng cốt lõi và tặng hosting 24/7 trong 3 tháng.' }),
    Object.freeze({ name: 'STORE AUTOMATION PRO', price: 750_000, copy: 'Bot bảng giá, catalog, ticket, đơn hàng, bảo hành, booking và luồng tự động hóa.' }),
    Object.freeze({ name: 'BOT + WEBSITE BUSINESS', price: 1_000_000, copy: 'Combo bot custom + website đồng bộ theo thương hiệu; tối ưu chi phí theo phạm vi.' }),
    Object.freeze({ name: 'BOT RESCUE & REDESIGN', price: 500_000, copy: 'Kiểm tra lỗi, cứu mã nguồn và thiết kế lại giao diện Components V2; giá từ mức niêm yết.' }),
  ]),
});

export const CUSTOM_SERVICES_EMOJIS = Object.freeze([
  Object.freeze({ name: 'cenar_dev_bot', fileName: 'cenar_dev_bot.png' }),
  Object.freeze({ name: 'cenar_dev_web', fileName: 'cenar_dev_web.png' }),
  Object.freeze({ name: 'cenar_dev_sale', fileName: 'cenar_dev_sale.png' }),
  Object.freeze({ name: 'cenar_dev_lifetime', fileName: 'cenar_dev_lifetime.png' }),
]);

function emojiAssetPath(asset) {
  return path.join(emojiAssetRoot, asset.fileName);
}

function validateEmojiAssets() {
  for (const asset of CUSTOM_SERVICES_EMOJIS) {
    const filePath = emojiAssetPath(asset);
    if (!fs.existsSync(filePath)) throw new Error(`Thiếu emoji dịch vụ custom: ${filePath}`);
    const size = fs.statSync(filePath).size;
    if (!size || size > 256 * 1024) {
      throw new Error(`${asset.name} có kích thước ${size} bytes, không hợp lệ với Discord.`);
    }
  }
}

function asCustomEmoji(emoji) {
  return emoji.animated
    ? `<a:${emoji.name}:${emoji.id}>`
    : `<:${emoji.name}:${emoji.id}>`;
}

export async function syncCustomServicesEmojis(guild) {
  validateEmojiAssets();
  await guild.emojis.fetch();
  const emojis = {};

  for (const asset of CUSTOM_SERVICES_EMOJIS) {
    let emoji = guild.emojis.cache.find((item) => item.name === asset.name);
    let status = 'reused';
    if (!emoji) {
      emoji = await guild.emojis.create({
        attachment: emojiAssetPath(asset),
        name: asset.name,
        reason: 'Cenar Store · quảng bá dịch vụ code bot và website custom',
      });
      status = 'created';
    }
    emojis[asset.name] = {
      status,
      text: asCustomEmoji(emoji),
      component: { id: emoji.id, name: emoji.name, animated: emoji.animated },
    };
  }

  return emojis;
}

const divider = () => new SeparatorBuilder()
  .setDivider(true)
  .setSpacing(SeparatorSpacingSize.Small);

const money = (value) => `${Number(value).toLocaleString('vi-VN')}đ`;

function campaignIcon(customEmojis, name, fallback) {
  return customEmojis?.[name]?.text || fallback;
}

export function buildCustomServicesLaunchPayload({
  customEmojis = {},
  tagEveryone = true,
  tagRoles = true,
} = {}) {
  const campaign = CUSTOM_SERVICES_LAUNCH;
  const E = createEmojiResolver(campaign.guildId);
  const bot = campaignIcon(customEmojis, 'cenar_dev_bot', E('icon_brain'));
  const web = campaignIcon(customEmojis, 'cenar_dev_web', E('icon_store'));
  const sale = campaignIcon(customEmojis, 'cenar_dev_sale', E('cenar_price'));
  const lifetime = campaignIcon(customEmojis, 'cenar_dev_lifetime', E('warranty_shield'));
  const mentions = [
    tagEveryone ? '@everyone' : null,
    ...(tagRoles ? campaign.audienceRoleIds.map((id) => `<@&${id}>`) : []),
  ].filter(Boolean).join(' ');

  const header = new ContainerBuilder()
    .setAccentColor(0xA855F7)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      mentions || null,
      `# ${bot} CODE BOT · CODE WEB GIÁ TỐT`,
      `## ${web} BOT CUSTOM ĐẸP · ĐỦ TÍNH NĂNG · THIẾT KẾ THEO YÊU CẦU`,
      '> Có ý tưởng, Cenar biến thành sản phẩm thật: giao diện theo thương hiệu, thao tác dễ hiểu, vận hành ổn định và phù hợp ngân sách.',
      `${sale} **Nhận dự án từ bot cơ bản đến hệ thống bot + website hoàn chỉnh.** Báo giá rõ ràng sau khi chốt phạm vi.`,
    ].filter(Boolean).join('\n'))));

  const capabilities = new ContainerBuilder()
    .setAccentColor(0x06B6D4)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${bot} BẠN CẦN BOT GÌ, CENAR THIẾT KẾ BOT ĐÓ`,
      `${bot} **Bot store / bán hàng** · bảng giá, catalog, ticket, đơn hàng, thanh toán và bảo hành.`,
      `${bot} **Bot cộng đồng** · quản lý, phân quyền, chào mừng, log, chống spam/raid và kiểm duyệt.`,
      `${bot} **Bot theo ý tưởng riêng** · booking, giveaway, economy, mini-game, âm nhạc, AI, API ngoài và workflow đặc thù.`,
      `${web} **Website custom** · landing page, store, portfolio, dashboard, cổng thanh toán và dữ liệu đồng bộ với bot.`,
    ].join('\n'))));

  const packages = new ContainerBuilder()
    .setAccentColor(0xEC4899)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${sale} GÓI TRIỂN KHAI · GIÁ DỄ TIẾP CẬN TỪ 500K`,
      ...campaign.packages.map((item, index) => (
        `${index === 2 ? web : index === 3 ? lifetime : bot} **${item.name} — ${index === 2 || index === 3 ? 'TỪ ' : ''}${money(item.price)}**\n> ${item.copy}`
      )),
      '-# Giá cuối phụ thuộc số tính năng, độ phức tạp, hạ tầng và thời hạn bàn giao; shop xác nhận trước khi bắt đầu.',
    ].join('\n'))));

  const benefits = new ContainerBuilder()
    .setAccentColor(0x22C55E)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${sale} NHIỀU ƯU ĐÃI CHO DỰ ÁN MỚI`,
      `${sale} **Tặng tư vấn và phác thảo luồng giao diện** trước khi chốt dự án.`,
      `${sale} **Tặng hosting bot 24/7 trong 03 tháng đầu** cho dự án bot triển khai mới.`,
      `${sale} **Ưu đãi riêng** cho combo bot + website, dự án nhiều hạng mục và khách hàng quay lại.`,
      `${web} Giao diện **Components V2 + emoji custom 100%**, đồng bộ màu sắc và nhận diện thương hiệu.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `### ${lifetime} BẢO HÀNH LỖI CODE TRỌN ĐỜI`,
      '> Lỗi phát sinh từ mã nguồn thuộc phạm vi Cenar bàn giao sẽ được kiểm tra và sửa không tính phí trong suốt thời gian sử dụng.',
      `${lifetime} Bàn giao mã nguồn theo thỏa thuận, hướng dẫn vận hành và hỗ trợ kỹ thuật trực tiếp từ developer.`,
      '-# Tính năng mới, thay đổi API bên thứ ba hoặc chi phí hosting/domain không thuộc bảo hành; mọi khoản phát sinh đều được báo trước.',
    ].join('\n'))));

  const footer = new ContainerBuilder()
    .setAccentColor(0xF59E0B)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${bot} GỬI Ý TƯỞNG · NHẬN LỘ TRÌNH VÀ BÁO GIÁ`,
      '> Chỉ cần gửi: loại bot/website, danh sách tính năng, mẫu tham khảo, ngân sách dự kiến và thời hạn mong muốn.',
      `${web} Quy trình rõ ràng: **khảo sát → chốt giao diện → phát triển → kiểm thử → bàn giao → đồng hành vận hành**.`,
      `${sale} Xem thông tin tại <#${campaign.priceChannelId}> hoặc mở ticket để được tư vấn đúng nhu cầu.`,
      `-# ${campaign.marker}`,
    ].join('\n'))));

  const orderButton = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId('ticket:create:ORDER')
      .setLabel('Nhận Báo Giá Ngay')
      .setStyle(ButtonStyle.Success),
    customEmojis?.cenar_dev_bot?.component,
    E.component('ticket_open'),
  );
  const priceButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Xem Bảng Giá')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${campaign.guildId}/${campaign.priceChannelId}`),
    customEmojis?.cenar_dev_sale?.component,
    E.component('icon_price'),
  );
  const websiteButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Mở Website Cenar')
      .setStyle(ButtonStyle.Link)
      .setURL('https://cenarstore.xyz'),
    customEmojis?.cenar_dev_web?.component,
    E.component('icon_store'),
  );

  return {
    components: [
      header,
      capabilities,
      packages,
      benefits,
      footer,
      new ActionRowBuilder().addComponents(orderButton, priceButton, websiteButton),
    ],
    flags: campaign.flags,
    allowedMentions: {
      parse: tagEveryone ? ['everyone'] : [],
      roles: tagRoles ? [...campaign.audienceRoleIds] : [],
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

export async function publishCustomServicesLaunch(client, {
  repost = false,
  tagEveryone = false,
  tagRoles = false,
} = {}) {
  const campaign = CUSTOM_SERVICES_LAUNCH;
  const guild = client.guilds.cache.get(campaign.guildId)
    || await client.guilds.fetch(campaign.guildId).catch(() => null);
  if (!guild) throw new Error(`Không tìm thấy guild ${campaign.guildId}`);

  const channel = guild.channels.cache.get(campaign.channelId)
    || await guild.channels.fetch(campaign.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages) {
    throw new Error(`Kênh thông báo ${campaign.channelId} không khả dụng`);
  }

  const member = guild.members.me || await guild.members.fetchMe();
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageGuildExpressions,
  ];
  if (tagEveryone || tagRoles) required.push(PermissionFlagsBits.MentionEveryone);
  if (!channel.permissionsFor(member)?.has(required)) {
    throw new Error('Bot thiếu quyền gửi, quản lý thông báo/emoji hoặc tag tại kênh thông báo.');
  }

  const customEmojis = await syncCustomServicesEmojis(guild);
  const recent = await channel.messages.fetch({ limit: 100 });
  const boards = [...recent.values()]
    .filter((message) => isCustomServicesLaunchMessage(message, client.user.id));
  const payload = buildCustomServicesLaunchPayload({ customEmojis, tagEveryone, tagRoles });
  const current = boards[0];

  if (repost) {
    const message = await channel.send(payload);
    await Promise.all(boards.map((item) => item.delete().catch(() => null)));
    return {
      status: current ? 'reposted' : 'published',
      messageId: message.id,
      removed: boards.length,
      customEmojis,
    };
  }

  if (current) {
    await current.edit(payload);
    await Promise.all(boards.slice(1).map((message) => message.delete().catch(() => null)));
    return {
      status: 'updated',
      messageId: current.id,
      removed: Math.max(0, boards.length - 1),
      customEmojis,
    };
  }

  const message = await channel.send(payload);
  return { status: 'published', messageId: message.id, removed: 0, customEmojis };
}
