import {
  PermissionFlagsBits, SlashCommandBuilder, ChannelType,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { STORE_ONE_CHANNEL_NAMES } from '../config/storeOneChannelAesthetic.js';

export const data = new SlashCommandBuilder()
  .setName('setup-guide')
  .setDescription('Tạo danh mục Cẩm Nang Hướng Dẫn với các kênh HD Nitro, Youtube, Spotify, Netflix')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const GUIDE_CHANNELS = [
  {
    key: 'nitro',
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

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  await interaction.deferReply({ ephemeral: true });

  try {
    const guild = interaction.guild;
    const guildConfig = getGuildConfig(guild.id);

    // Tìm verified role để cấp quyền đọc
    let verifiedRole = null;
    if (guildConfig?.customer_role_id) {
      verifiedRole = guild.roles.cache.get(guildConfig.customer_role_id);
    }
    if (!verifiedRole) {
      verifiedRole = guild.roles.cache.find(r =>
        r.name.includes('Explorer') || r.name.includes('Thành Viên') ||
        r.name.includes('Active Customer') || r.name.includes('Khách Mua Hàng')
      );
    }

    const everyoneRole = guild.roles.everyone;

    // Tạo category "Cẩm Nang Hướng Dẫn"
    const category = await guild.channels.create({
      name: STORE_ONE_CHANNEL_NAMES.guideCategory,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        {
          id: everyoneRole.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        ...(verifiedRole ? [{
          id: verifiedRole.id,
          allow: [PermissionFlagsBits.ViewChannel],
          deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
        }] : []),
        {
          id: guild.members.me.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages],
        },
      ],
    });

    const createdChannels = [];

    for (const ch of GUIDE_CHANNELS) {
      const channel = await guild.channels.create({
        name: ch.name,
        type: ChannelType.GuildText,
        topic: ch.topic,
        parent: category.id,
        permissionOverwrites: [
          {
            id: everyoneRole.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          ...(verifiedRole ? [{
            id: verifiedRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.CreatePublicThreads],
          }] : []),
          {
            id: guild.members.me.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages],
          },
        ],
      });

      // Gửi nội dung hướng dẫn vào kênh
      const contentContainer = new ContainerBuilder().setAccentColor(0x7C3AED);
      contentContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(ch.content.join('\n'))
      );
      contentContainer.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      );
      contentContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `-# ${E('icon_heart_purple')} Mọi thắc mắc vui lòng mở ticket tại kênh hỗ-trợ để được giải đáp.`
        )
      );

      // Riêng kênh YouTube: gắn nút "Yêu Cầu Bảo Hành" (customId khớp handler ytb:warranty:apply)
      const guidePayload = {
        components: [contentContainer],
        flags: MessageFlags.IsComponentsV2,
      };

      if (ch.key === 'youtube') {
        const btnWarranty = new ButtonBuilder()
          .setCustomId('ytb:warranty:apply')
          .setLabel('Yêu Cầu Bảo Hành')
          .setStyle(ButtonStyle.Success);
        const warrantyEmoji = E.component('panel_warranty');
        if (warrantyEmoji) btnWarranty.setEmoji(warrantyEmoji);
        guidePayload.components.push(new ActionRowBuilder().addComponents(btnWarranty));
      }

      await channel.send(guidePayload)
        .catch(e => console.error(`[SETUP-GUIDE] Gửi nội dung ${ch.key} thất bại:`, e.message));

      createdChannels.push(channel);
    }

    // Reply xác nhận
    const resultContainer = new ContainerBuilder().setAccentColor(0x10B981);
    resultContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `## ${E('status_check')} Tạo Cẩm Nang Thành Công!`,
        `> ${E('icon_clipboard')} **Danh mục:** ${category}`,
        '',
        `### ${E('icon_store')} Các kênh đã tạo:`,
        ...createdChannels.map(c => `> ${E('icon_link')} ${c}`),
        '',
        verifiedRole
          ? `> ${E('ticket_claim')} Quyền đọc: Chỉ **${verifiedRole.name}** và cao hơn`
          : `> ${E('status_warn')} Chưa tìm thấy verified role — cấp quyền thủ công nếu cần`,
      ].join('\n'))
    );
    resultContainer.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    resultContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${E('icon_sparkle')} Nội dung hướng dẫn đã được gửi tự động vào từng kênh.`
      )
    );

    await interaction.editReply({
      components: [resultContainer],
      flags: MessageFlags.IsComponentsV2,
    });

  } catch (err) {
    console.error('[SETUP-GUIDE] Lỗi:', err);
    await interaction.editReply({
      content: `${E('status_cross')} Đã xảy ra lỗi: \`${err.message}\``,
    }).catch(() => null);
  }
}
