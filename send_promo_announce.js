import { Client, Events, GatewayIntentBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

const E = {
  icon_shop: '<:cr_shop:1392749981332541501>',
  icon_gem: '<:Diamond:1485905790903783465>',
  status_check: '<a:tickgreen:1384069022831874169>'
};

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[READY] Logged in as ${readyClient.user.tag}`);
  try {
    const channelId = '1515008584549797979';
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      console.error('Channel not found!');
      process.exit(1);
    }

    const container = new ContainerBuilder().setAccentColor(0x5865F2); // Blurple

    // Header
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${E.icon_gem} **BẢNG GIÁ KHUYẾN MÃI ĐỘC QUYỀN CENAR STORE** ${E.icon_gem}\n` +
        `> Cập nhật giá siêu rẻ tháng 7/2026. Deal cực hời, chốt đơn ngay để thăng hạng trải nghiệm số!`
      )
    );

    // Separator
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
    );

    // Nitro
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## 🚀 **Nitro Boost Login (Gia Hạn)**\n` +
        `- 2 Tháng: **99k**\n` +
        `- 4 Tháng: **250k**\n` +
        `- 6 Tháng: **380k**\n` +
        `- 8 Tháng: **450k**\n` +
        `- 12 Tháng: **590k**\n\n` +
        `## 🚀 **Nitro Boost Login (Mua Thẳng)**\n` +
        `- 1 Tháng: **90k**\n` +
        `- 12 Tháng: **850k**\n\n` +
        `## 💫 **Nitro Trial**\n` +
        `- 3 Tháng: **45k**\n\n` +
        `## 🔮 **Nâng Cấp Máy Chủ (Boost Server)**\n` +
        `- 1 Tháng: **150k**\n` +
        `- 3 Tháng: **320k**\n\n` +
        `> **Lưu ý Trial:**\n` +
        `> - Dành cho tài khoản tạo trên 1 tháng\n` +
        `> - Chưa từng sử dụng Nitro Discord (kể cả Basic, không tính Nitro Trial)`
      )
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
    );

    // Entertainment
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## 🎵 **Spotify Premium (Add Family)**\n` +
        `- 3 Tháng: **120k** | 6 Tháng: **230k** | 12 Tháng: **300k**\n\n` +
        `## ✂️ **Capcut Pro (Chính Chủ)**\n` +
        `- 1 Tháng: **85k** | 6 Tháng: **450k**\n\n` +
        `## 🎨 **Adobe Full App (Chính Chủ)**\n` +
        `- 1 Tháng: **90k** | 2 Tháng: **130k**\n` +
        `- 3 Tháng: **250k** | 4 Tháng: **450k**`
      )
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
    );

    // Youtube
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ▶️ **YouTube Premium (Chính Chủ - Ổn định lâu dài)**\n` +
        `- 3 Tháng: **190k** | 6 Tháng: **300k** | 12 Tháng: **550k**\n\n` +
        `## ▶️ **YouTube Premium (Gia Hạn Mỗi Tháng)**\n` +
        `- 3 Tháng: **90k** | 6 Tháng: **180k** | 12 Tháng: **280k**`
      )
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
    );

    // Work & AI
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## 🖌️ **Canva Pro (Chính Chủ)**\n` +
        `- 1 Năm: **150k**\n\n` +
        `## 📊 **Office 365 + Full Apps + 1TB OneDrive (Chính Chủ)**\n` +
        `- 1 Năm: **250k**\n\n` +
        `## 🤖 **Gemini Pro + 5TB Google One (Chính Chủ)**\n` +
        `- 12 Tháng: **250k**\n` +
        `- 18 Tháng: **280k** *(Chỉ còn 20 Slot!)*`
      )
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)
    );

    // Gaming
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## 🧊 **Tài Khoản Minecraft**\n` +
        `**Bedrock Edition: 190k**\n` +
        `- Chơi Online trên tài khoản Xbox/Microsoft cá nhân\n` +
        `- Phiên bản Bedrock full update mọi tính năng\n` +
        `- Sở hữu vĩnh viễn, bảo hành 1 năm\n\n` +
        `**Java + Bedrock: 450k**\n` +
        `- Tài khoản Microsoft mua sẵn game (Chỉ việc tải và chơi)\n` +
        `- Giao toàn bộ thông tin tài khoản + Email đăng ký\n` +
        `- Đổi mọi thông tin thoải mái (Email, Pass, SĐT)`
      )
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Large)
    );

    // Footer
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `🔗 *Khám phá thêm hàng ngàn sản phẩm siêu ngon khác tại <#1514607020098191393> để được chốt giá mềm nhất!*`
      )
    );
    
    const bannerPath = path.join(process.cwd(), 'assets', 'promo_banner.jpg');
    let attachment = null;
    if (fs.existsSync(bannerPath)) {
      attachment = new AttachmentBuilder(fs.readFileSync(bannerPath), { name: 'banner.jpg' });
    }

    console.log('[SENDING] Sending promo message to channel...');
    const messagePayload = {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    };
    
    if (attachment) {
       messagePayload.files = [attachment];
    }
    
    await channel.send(messagePayload);
    console.log('[SUCCESS] Message sent successfully!');
  } catch(e) { 
    console.error('[ERROR]', e); 
  } finally {
    process.exit(0);
  }
});

client.login(process.env.BOT_TOKEN);
