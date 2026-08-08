// Gửi panel dịch vụ Setup Discord + Bot Custom vào kênh dịch vụ
// Chạy: node scripts/send-service-panel.js
// Có thể thêm --dry để xem log mà không gửi
import 'dotenv/config';
import {
  Client, GatewayIntentBits, ChannelType, MessageFlags,
  ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
  SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { fmt, subtext } from '../src/utils/embedHelpers.js';
import { createEmojiResolver } from '../src/utils/emojiHelper.js';
import { normalizeV2Text } from '../src/utils/uiKit.js';
import { config } from '../src/config.js';

const GUILD_ID = process.env.GUILD_ID;
const DRY = process.argv.includes('--dry');

// Tìm kênh có tên chứa từ khóa sau (theo thứ tự ưu tiên)
const CHANNEL_KEYWORDS = ['setup-discord', 'dich-vu-setup', 'dịch-vụ-setup', 'setup', 'dich-vu', 'dịch-vụ'];

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) { console.log('GUILD_NOT_FOUND', GUILD_ID); process.exit(1); }

    await guild.channels.fetch();

    let chan = null;
    for (const kw of CHANNEL_KEYWORDS) {
      chan = guild.channels.cache.find(
        c => c.type === ChannelType.GuildText && c.name.toLowerCase().includes(kw)
      );
      if (chan) break;
    }

    if (!chan) {
      console.log('SERVICE_CHANNEL_NOT_FOUND — tạo kênh hoặc truyền ID trực tiếp.');
      console.log('Các kênh text hiện có:');
      guild.channels.cache
        .filter(c => c.type === ChannelType.GuildText)
        .forEach(c => console.log(' ', c.name, c.id));
      process.exit(1);
    }
    console.log('SERVICE_CHANNEL =', `#${chan.name}`, chan.id);

    const E = createEmojiResolver(GUILD_ID);

    if (DRY) { console.log('DRY_RUN — không gửi.'); process.exit(0); }

    // Xóa tin nhắn cũ của bot
    const old = await chan.messages.fetch({ limit: 20 }).catch(() => null);
    if (old) {
      for (const m of old.filter(m => m.author.id === client.user.id).values()) {
        await m.delete().catch(() => null);
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // ── Panel 1: Giới thiệu dịch vụ ──
    const intro = new ContainerBuilder().setAccentColor(config.accentColorPrimary || 0xF3A6D7);

    intro.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(normalizeV2Text([
        `# ${E('brand_discord')}  DỊCH VỤ SETUP DISCORD & BOT CUSTOM`,
        `> ${E('icon_sparkle')} ${fmt.b('Trọn gói từ A–Z — Chính chủ — Bảo trì dài hạn')}`,
        subtext('Cenar Store cung cấp dịch vụ thiết kế, lập trình và vận hành máy chủ Discord chuyên nghiệp'),
      ].join('\n')))
    );

    intro.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    // ── Combo trọn gói ──
    intro.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(normalizeV2Text([
        `## ${E('icon_gem')}  Combo Trọn Gói — Chỉ từ ${fmt.b('500.000đ')}`,
        `${E('ticket_claim')} ${fmt.b('Setup Máy Chủ Discord Đầy Đủ')}`,
        `> Cấu trúc kênh chuyên nghiệp, phân quyền role, icon server, banner, quy tắc.`,
        `${E('icon_brain')}  ${fmt.b('Bot Custom Hoàn Chỉnh')}`,
        `> Ticket hỗ trợ, log đơn hàng, bảo hành, xác minh OAuth2, chống spam/raid.`,
        `${E('icon_sparkle')} ${fmt.b('Boost Server')}`,
        `> Gói Boost để mở khóa tính năng nâng cao cho server của bạn (theo gói boost).`,
        `${E('icon_calendar')}  ${fmt.b('Bảo Trì Định Kỳ')} — ${fmt.b('30.000đ/tháng')}`,
        `> Hỗ trợ lỗi, cập nhật tính năng, đảm bảo bot luôn online và ổn định.`,
      ].join('\n')))
    );

    intro.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    // ── Dịch vụ thêm ──
    intro.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(normalizeV2Text([
        `## ${E('icon_art')}  Dịch Vụ Bổ Sung (Giá Thương Lượng)`,
        `${E('order_product')}  ${fmt.b('Tính Năng Bot Custom')}`,
        `> Lập trình thêm tính năng theo yêu cầu riêng của server bạn.`,
        `> Tích hợp API ngoài, mini-game, hệ thống kinh tế, v.v.`,
        subtext('Báo giá theo từng tính năng — liên hệ để được tư vấn miễn phí'),
        `${E('icon_brain')}  ${fmt.b('Website Bán Hàng Custom')}`,
        `> Website hiện đại tích hợp với bot Discord, quản lý đơn hàng trực tuyến.`,
        `> Dashboard quản trị, payment gateway, thống kê doanh thu tự động.`,
        subtext('Báo giá theo quy mô dự án — liên hệ để được tư vấn miễn phí'),
      ].join('\n')))
    );

    intro.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    intro.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(normalizeV2Text([
        `## ${E('status_check')}  Cam Kết Chất Lượng`,
        `${E('icon_sparkle')} Bàn giao trong **24–48 giờ** tùy độ phức tạp`,
        `${E('icon_sparkle')} Hỗ trợ kỹ thuật trực tiếp từ developer`,
        `${E('icon_sparkle')} Bảo hành lỗi phát sinh trong **7 ngày** sau bàn giao`,
        `${E('icon_sparkle')} Cam kết bảo mật thông tin — không chia sẻ source code`,
        subtext(`${E('icon_heart_purple')} Cenar Store — Uy Tín & Chất Lượng Hàng Đầu`),
      ].join('\n')))
    );

    const ticketRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:create:ORDER')
        .setLabel('Mở Ticket Tư Vấn')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setLabel('Bảng Giá Chi Tiết')
        .setStyle(ButtonStyle.Link)
        .setURL('https://cenarstore.xyz')
    );

    await chan.send({ components: [intro, ticketRow], flags: MessageFlags.IsComponentsV2 });

    console.log('SENT service panel to #' + chan.name);
  } catch (e) {
    console.error('ERR', e.message, e.stack?.split('\n').slice(0, 3).join('\n'));
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.login(process.env.BOT_TOKEN);
