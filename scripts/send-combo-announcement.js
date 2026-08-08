// Script gửi thông báo combo 2.5M vào kênh thông báo — chạy: node scripts/send-combo-announcement.js
import 'dotenv/config';
import {
  Client, GatewayIntentBits, MessageFlags,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { fmt } from '../src/utils/embedHelpers.js';
import { createEmojiResolver } from '../src/utils/emojiHelper.js';
import { normalizeV2Text } from '../src/utils/uiKit.js';
import { config } from '../src/config.js';

const CHANNEL_ID = '1514598369597587546';
const GUILD_ID = process.env.GUILD_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
    if (!channel) { console.error('Channel not found:', CHANNEL_ID); process.exit(1); }

    const guildId = channel.guildId || GUILD_ID;
    const E = createEmojiResolver(guildId);

    // ── Container chính ──
    const container = new ContainerBuilder().setAccentColor(config.accentColorPrimary || 0xF3A6D7);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(normalizeV2Text([
        `# ${E('brand_discord')}  COMBO KHỞI NGHIỆP STORE DISCORD TRỌN GÓI`,
        `> ${E('icon_sparkle')} ${fmt.b('Hệ thống kinh doanh tự động — Vận hành 24/7 — Không cần biết code')}`,
        `## ${E('payment_money')}  Chỉ với ${fmt.b('2.500.000đ')} — Trọn đời, không phí ẩn`,
      ].join('\n')))
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(normalizeV2Text([
        `## ${E('ticket_claim')}  Bao gồm trong Combo`,
        `${E('icon_sparkle')} **Setup Máy Chủ Discord Hoàn Chỉnh**`,
        `> Thiết kế giao diện hiện đại, cấu trúc tối ưu, phân quyền nhân viên & VIP tự động.`,
        `> Tích hợp bot ticket, log đơn hàng, bảo hành, hỗ trợ khách 24/7.`,
        `${E('icon_brain')}  **Bot Custom Tự Động Hóa**`,
        `> Giao hàng tự động qua DM ngay khi thanh toán xong, không cần thủ công.`,
        `> Xác minh khách, chống raid/spam, hệ thống loyalty tích điểm hoàn tiền.`,
        `${E('icon_gem')}  **Cổng Thanh Toán Tự Động (PayOS / VietQR)**`,
        `> Khách quét QR → Bot kiểm tra → Giao hàng ngay lập tức. Chạy 24/7 kể cả khi ngủ!`,
        `${E('order_product')}  **Nguồn Hàng Giá Sỉ Uy Tín**`,
        `> Danh sách nguồn Netflix, Spotify, YouTube Premium, Canva, ChatGPT, Zoom...`,
        `> Giá sỉ rẻ nhất thị trường + hướng dẫn bảo hành sản phẩm.`,
        `${E('icon_calendar')}  **Công Thức & Quy Trình Vận Hành**`,
        `> Quy trình quản trị tránh rủi ro + mẹo marketing kéo thành viên chất lượng.`,
      ].join('\n')))
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(normalizeV2Text([
        `## ${E('icon_heart_purple')}  Cam Kết Đồng Hành`,
        `${E('status_check')} Hỗ trợ kỹ thuật và tư vấn vận hành trọn đời sau mua.`,
        `${E('status_check')} Không phát sinh chi phí ẩn — Thanh toán 1 lần, dùng mãi.`,
        `${E('status_check')} Bảo hành toàn bộ hệ thống trong 30 ngày đầu tiên.`,
        `-# ${E('icon_sparkle')} Liên hệ ngay bên dưới để được tư vấn miễn phí và đặt chỗ!`,
      ].join('\n')))
    );

    const ctaRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Liên Hệ Mua Ngay')
        .setStyle(ButtonStyle.Link)
        .setURL('https://discord.com/channels/1282637033340403754/1514607020098191393')
    );

    // Gửi ping @everyone @here riêng trước (V2 không hỗ trợ content)
    await channel.send({
      content: '@everyone @here',
      allowedMentions: { parse: ['everyone', 'here'] },
    });

    await channel.send({
      components: [container, ctaRow],
      flags: MessageFlags.IsComponentsV2,
    });

    console.log('SUCCESS: Combo announcement posted to', channel.name);
  } catch (err) {
    console.error('ERROR:', err.message, err.stack?.split('\n')[1]);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(process.env.BOT_TOKEN);
