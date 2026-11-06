import {
  PermissionFlagsBits, SlashCommandBuilder, ChannelType,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { STORE_FORUMS } from '../config/storeForums202611.js';
import { isManager } from '../utils/permissions.js';
import { STORE_ONE_CHANNEL_NAMES } from '../config/storeOneChannelAesthetic.js';

export const data = new SlashCommandBuilder()
  .setName('setup-guide')
  .setDescription('Thiết lập forum Hướng dẫn mua hàng, mỗi sản phẩm một bài')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const GUIDE_CHANNELS = [
  {
    key: 'nitro',
    emojiSlot: 'brand_nitro',
    name: STORE_ONE_CHANNEL_NAMES.nitroGuide,
    topic: 'Hướng dẫn mua và sử dụng Discord Nitro & Server Boost',
    content: [
      '## Discord Nitro & Server Boost',
      '',
      '**Nitro là gì?**',
      '> Discord Nitro là gói premium của Discord giúp bạn upload file lớn hơn, dùng emoji tùy chỉnh, animated avatar và nhiều tính năng cao cấp khác.',
      '',
      '**Cách đặt mua tại Cenar Store:**',
      '> 1. Ghé kênh hỗ-trợ và mở ticket',
      '> 2. Chọn gói Nitro bạn muốn (Nitro Basic / Nitro Full)',
      '> 3. Cung cấp email Discord để nhận quà tặng',
      '> 4. Thanh toán và nhận Nitro ngay trong vài phút',
      '',
      '**Lưu ý quan trọng:**',
      '> - Không chia sẻ thông tin tài khoản sau khi nhận',
      '> - Nitro Gift được gửi qua link — click để kích hoạt',
      '> - Bảo hành 100% nếu có lỗi trong vòng 24h',
    ],
  },
  {
    key: 'youtube',
    emojiSlot: 'brand_youtube',
    name: STORE_ONE_CHANNEL_NAMES.youtubeGuide,
    topic: 'Hướng dẫn mua và sử dụng YouTube Premium',
    content: [
      '## YouTube Premium',
      '',
      '**YouTube Premium là gì?**',
      '> Xem video không quảng cáo, tải video offline, phát nhạc nền và truy cập YouTube Music Premium.',
      '',
      '**Cách đặt mua tại Cenar Store:**',
      '> 1. Mở ticket tại kênh hỗ-trợ',
      '> 2. Báo nhân viên tài khoản Google bạn muốn nâng cấp',
      '> 3. Nhân viên sẽ thêm bạn vào Family Plan',
      '> 4. Xác nhận lời mời trong Gmail và tận hưởng!',
      '',
      '**Lưu ý quan trọng:**',
      '> - Dùng Gmail chính xác, không dùng tài khoản ảo',
      '> - Không đổi mật khẩu Gmail trong thời gian sử dụng',
      '> - Bảo hành trọn thời gian đăng ký',
    ],
  },
  {
    key: 'spotify',
    emojiSlot: 'brand_spotify',
    name: STORE_ONE_CHANNEL_NAMES.spotifyGuide,
    topic: 'Hướng dẫn mua và sử dụng Spotify Premium',
    content: [
      '## Spotify Premium',
      '',
      '**Spotify Premium là gì?**',
      '> Nghe nhạc không giới hạn, không quảng cáo, tải bài hát offline và chất lượng âm thanh cao nhất.',
      '',
      '**Cách đặt mua tại Cenar Store:**',
      '> 1. Mở ticket tại kênh hỗ-trợ',
      '> 2. Cung cấp email tài khoản Spotify của bạn',
      '> 3. Nhân viên thêm bạn vào Family Plan',
      '> 4. Chấp nhận lời mời trong app Spotify',
      '',
      '**Lưu ý quan trọng:**',
      '> - Tài khoản Spotify cần được tạo trước',
      '> - Không đổi email tài khoản trong thời gian dùng',
      '> - Hỗ trợ 24/7 nếu bị văng khỏi Family Plan',
    ],
  },
  {
    key: 'netflix',
    emojiSlot: 'brand_netflix',
    name: STORE_ONE_CHANNEL_NAMES.netflixGuide,
    topic: 'Hướng dẫn mua và sử dụng Netflix Premium',
    content: [
      '## Netflix Premium',
      '',
      '**Netflix Premium là gì?**',
      '> Xem phim và series 4K Ultra HD, HDR, đồng thời trên nhiều màn hình với chất lượng âm thanh Dolby Atmos.',
      '',
      '**Cách đặt mua tại Cenar Store:**',
      '> 1. Mở ticket tại kênh hỗ-trợ',
      '> 2. Nhận tài khoản Netflix đã được nâng cấp sẵn',
      '> 3. Đăng nhập và tạo Profile riêng của bạn',
      '> 4. Thưởng thức phim 4K không giới hạn!',
      '',
      '**Lưu ý quan trọng:**',
      '> - Chỉ dùng Profile được cấp, KHÔNG đổi mật khẩu',
      '> - Không chia sẻ thông tin với người khác',
      '> - Liên hệ ngay nếu bị lỗi truy cập trong 24h đầu',
    ],
  },
];

export function buildGuideContent(channelConfig, emojiResolver) {
  const lines = [...channelConfig.content];
  const brandEmoji = channelConfig.emojiSlot
    ? emojiResolver(channelConfig.emojiSlot)
    : '';

  if (brandEmoji && lines[0]?.startsWith('## ')) {
    const title = lines[0].slice(3);
    lines[0] = `## ${brandEmoji} ${title} ${brandEmoji}`;
  }

  return lines.join('\n');
}

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  const guildConfig = getGuildConfig(guild.id);
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!isManager(member, guildConfig)) return interaction.editReply('Chỉ Admin/quản lý được thiết lập forum.');
  try {
    await guild.channels.fetch();
    let forum = guild.id === STORE_FORUMS.guildId
      ? await guild.channels.fetch(STORE_FORUMS.guideForumId).catch(() => null)
      : guild.channels.cache.find(channel => channel.type === ChannelType.GuildForum && channel.name.includes('hướng-dẫn-mua-hàng'));
    if (!forum) {
      const category = guild.channels.cache.find(channel => channel.type === ChannelType.GuildCategory && channel.name === STORE_ONE_CHANNEL_NAMES.guideCategory);
      const reader = guildConfig?.customer_role_id;
      const denied = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads];
      forum = await guild.channels.create({
        name: '📘・hướng-dẫn-mua-hàng', type: ChannelType.GuildForum, parent: category?.id,
        topic: 'Chọn bài theo sản phẩm để xem hướng dẫn. Cần hỗ trợ riêng, hãy mở ticket.',
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel, ...denied] },
          ...(reader ? [{ id: reader, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: denied }] : []),
          { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.ManageThreads, PermissionFlagsBits.ReadMessageHistory] },
        ],
      });
    }
    const { listForumPosts } = await import('../services/forumPublicationService.js');
    const posts = await listForumPosts(forum);
    const E = createEmojiResolver(guild.id);
    for (const [index, guide] of GUIDE_CHANNELS.entries()) {
      const name = `${String(index + 1).padStart(2, '0')} · ${guide.content[0].slice(3)}`;
      const fixedId = guild.id === STORE_FORUMS.guildId ? STORE_FORUMS.guidePosts[guide.key] : null;
      if (posts.has(fixedId) || [...posts.values()].some(post => post.name === name)) continue;
      const panel = new ContainerBuilder().setAccentColor(0x10B981)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildGuideContent(guide, E)));
      const payload = { components: [panel], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
      if (guide.key === 'youtube') payload.components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ytb:warranty:apply').setLabel('Yêu Cầu Bảo Hành').setStyle(ButtonStyle.Success)));
      await forum.threads.create({ name, message: payload, autoArchiveDuration: 10080 });
    }
    return interaction.editReply(`Đã thiết lập forum <#${forum.id}>. Mỗi sản phẩm có một bài hướng dẫn; nội dung đã có được giữ nguyên.`);
  } catch (error) {
    console.error('[SETUP-GUIDE]', error.message);
    return interaction.editReply('Chưa hoàn tất forum. Kiểm tra quyền Quản lý kênh/luồng rồi thử lại; các bài đã có được giữ nguyên.');
  }
}
