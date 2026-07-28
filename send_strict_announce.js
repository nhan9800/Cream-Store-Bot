import { Client, Events, GatewayIntentBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

const E = {
  icon_warn: '<a:Dotyellow:1481134440725090315>', 
  icon_police: '<a:redload:1459179959158571119>',
  status_check: '<a:tickgreen:1384069022831874169>',
  icon_shop: '<:cr_shop:1392749981332541501>',
  icon_verify: '<:verifybadge:1481127479702847646>',
  icon_gem: '<:Diamond:1485905790903783465>'
};

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[READY] Logged in as ${readyClient.user.tag}`);
  try {
    const channelId = '1514598369597587546';
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      console.error('Channel not found!');
      process.exit(1);
    }

    const container = new ContainerBuilder().setAccentColor(0xED4245); // Red color for seriousness

    // Header
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `@everyone\n` +
        `# ${E.icon_warn} **THÔNG BÁO QUAN TRỌNG: SIẾT CHẶT QUY ĐỊNH GIA HẠN** ${E.icon_warn}\n` +
        `> Nhằm nâng cao chất lượng dịch vụ và bảo vệ quyền lợi minh bạch, BQT xin gửi đến quý khách hàng một số quy định mới.`
      )
    );

    // Separator
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
    );

    // Context / Body
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${E.icon_shop} **Vấn Đề Gần Đây**\n` +
        `Vừa qua, hệ thống đã ghi nhận nhiều trường hợp các tài khoản dịch vụ **(YouTube Premium, Netflix, Spotify...)** đã hết hạn nhưng vẫn cố tình duy trì trong nhóm Family để sử dụng chùa, gây thất thoát nghiêm trọng cho hệ thống.\n\n` +
        `## ${E.icon_police} **Biện Pháp Xử Lý Cứng Rắn**\n` +
        `Từ thời điểm này, hệ thống máy chủ đã được nâng cấp tự động hoá toàn diện 100%:\n` +
        `${E.status_check} **Bắt buộc kê khai Email:** Mọi đơn hàng dịch vụ đều phải cung cấp Email chính xác lúc giao hàng.\n` +
        `${E.status_check} **Quét tự động mỗi giờ:** Hệ thống tự động phát hiện và Kick lập tức những tài khoản quá hạn.\n` +
        `${E.status_check} **Block vĩnh viễn:** Các hành vi cố tình gian lận sẽ bị từ chối phục vụ vĩnh viễn.\n\n` +
        `*${E.icon_gem} Kính mong quý khách hàng lưu ý chủ động gia hạn trước ngày hết hạn để trải nghiệm không bị gián đoạn.*`
      )
    );

    // Empty space Separator
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Large)
    );

    // Footer
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Trân trọng,\n**Ban Quản Trị Hệ Thống** ${E.icon_verify}`
      )
    );

    // Action Row
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('announce_dummy_1')
        .setLabel('Quy Định Chung')
        .setStyle(ButtonStyle.Primary)
        .setEmoji({ id: '1392749981332541501', name: 'cr_shop' })
        .setDisabled(true), 
      new ButtonBuilder()
        .setCustomId('announce_dummy_2')
        .setLabel('Chính Sách Bảo Hành')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji({ id: '1348625535512870965', name: 'cr_baohanh' }) 
        .setDisabled(true)
    );

    console.log('[SENDING] Sending message to channel...');
    await channel.send({
      components: [container, actionRow],
      flags: MessageFlags.IsComponentsV2,
    });
    console.log('[SUCCESS] Message sent successfully!');
  } catch(e) { 
    console.error('[ERROR]', e); 
  } finally {
    process.exit(0);
  }
});

client.login(process.env.BOT_TOKEN);
