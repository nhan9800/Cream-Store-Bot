import { Client, Events, GatewayIntentBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// Fallback emojis to use
const E = {
  icon_fire: '<a:tsm_fire:1327553120842158111>', 
  icon_sparkle: '<a:starxoay:1481141954346483845>',
  status_check: '<a:tickgreen:1384069022831874169>',
  icon_price: '<:money:1442876095442714748>',
  status_warn: '<a:Dotyellow:1481134440725090315>',
  icon_gem: '<:Diamond:1485905790903783465>',
  icon_arrow: '<a:Arrow2:1367139234833498113>'
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

    const container = new ContainerBuilder().setAccentColor(0xFF3366);

    // Header
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${E.icon_fire} **SIÊU KHUYẾN MÃI FLASH SALE** ${E.icon_sparkle}\n` +
        `> Cơ hội cực hiếm trong tháng! Nhanh tay săn ngay Deal sốc.`
      )
    );

    // Separator
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    // Product Info
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## <:10194purpleween:1384901794475282523> **NITRO BOOST LOGIN 12 THÁNG**\n\n` +
        `${E.icon_price} **Giá siêu sốc:** Chỉ **600 CÁ** *(600,000đ)*\n` +
        `${E.status_warn} **Số lượng:** Chốt duy nhất **2 SLOT**!\n\n` +
        `${E.status_check} **Nâng cấp** tài khoản chính chủ.\n` +
        `${E.status_check} **Hỗ trợ** Full tính năng Discord Nitro.\n` +
        `${E.status_check} **Bảo hành** trọn đời thời gian sử dụng.`
      )
    );

    // Empty space Separator
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Large)
    );

    // Footer Call to Action
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `*${E.icon_gem} Mở Ticket hoặc liên hệ hỗ trợ để chốt slot ngay trước khi hết!* ${E.icon_arrow}`
      )
    );

    // Action Row
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sale_dummy_buy')
        .setLabel('Nhanh tay Mua Hàng!')
        .setStyle(ButtonStyle.Danger)
        .setEmoji({ id: '1348626032747614268', name: 'cr_carttt' }) // custom cart emoji
        .setDisabled(true), 
      new ButtonBuilder()
        .setCustomId('sale_dummy_contact')
        .setLabel('Duy nhất 2 Slot')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji({ id: '1481134440725090315', name: 'Dotyellow', animated: true }) // custom dot warning
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

