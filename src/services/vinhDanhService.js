import {
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { db } from '../database/db.js';
import { config } from '../config.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import {
  getLeaderboardPeriodBounds,
  getLeaderboardRows as queryLeaderboardRows,
} from './leaderboardService.js';

// Huy hiệu top — slot custom emoji
const MEDAL_SLOTS = ['icon_gold', 'icon_silver', 'icon_bronze', 'icon_num4', 'icon_num5', 'icon_num6', 'icon_num7', 'icon_num8', 'icon_num9', 'icon_num10'];
const VIP_TIERS = [
  { min: 8_000_000, label: 'Diamond', emojiSlot: 'icon_gem', color: 0x60A5FA },
  { min: 5_000_000, label: 'Ruby',    emojiSlot: 'icon_heart', color: 0xF87171 },
  { min: 3_000_000, label: 'Elite',   emojiSlot: 'icon_crown', color: 0xFBBF24 },
  { min: 1_000_000, label: 'VIP',     emojiSlot: 'icon_star',  color: 0xA78BFA },
  { min: 0,         label: 'Khách',   emojiSlot: 'icon_cart', color: 0x6B7280 },
];

function getTier(spent) {
  return VIP_TIERS.find(t => spent >= t.min) || VIP_TIERS[VIP_TIERS.length - 1];
}

function fmt(n) { return new Intl.NumberFormat('vi-VN').format(Number(n||0)); }

function formatOrderProduct(quantity, productName) {
  const qty = Number(quantity ?? 1);
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const safeName = String(productName ?? '').trim();
  return `x${safeQty} ${safeName}`.replace(/\s+/g, ' ').trim();
}

// Trả về { components, flags } — V2 để custom emoji hiển thị ở mọi vị trí
function buildLeaderboardV2(title, subtitle, rows, guildId) {
  const E = createEmojiResolver(guildId);
  const topTier = rows.length ? getTier(rows[0]?.total_spent || 0) : { color: 0x7C3AED };
  const container = new ContainerBuilder().setAccentColor(topTier.color);

  if (!rows.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${E('icon_trophy')} ${title}\n> *Chưa có dữ liệu đơn hàng hoàn thành.*`
    ));
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
  }

  const lines = rows.map((r, i) => {
    const medal = MEDAL_SLOTS[i] ? E(MEDAL_SLOTS[i]) : `${i + 1}.`;
    const tier  = getTier(r.total_spent || 0);
    const spent = fmt(r.total_spent || 0);
    return `${medal} <@${r.customer_id}> ${E(tier.emojiSlot)} **${tier.label}**\n` +
           `> ${E('payment_payos')} ${r.orders} đơn | ${E('payment_money')} **${spent}đ**`;
  });

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${E('icon_trophy')} ${title}\n> ${subtitle}`
  ));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n\n')));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# ${E('icon_heart_purple')} Cenar Store — Cảm ơn quý khách đã ủng hộ`
  ));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export async function runAutoVinhDanh(client) {
  const now = new Date();
  const currentPeriod = getLeaderboardPeriodBounds('monthly', now);
  const [currentMonthLabel, currentYearLabel] = currentPeriod.label.split('/');
  const currentMonth = Number(currentMonthLabel) - 1;
  const currentYear = Number(currentYearLabel);

  // Start of previous month
  const prevMonthDate = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
  const prevYear = prevMonthDate.getUTCFullYear();
  const prevMonth = prevMonthDate.getUTCMonth();

  for (const [guildId, guild] of client.guilds.cache) {
    try {
      // Tìm kênh vinh-danh
      const vinhdanhChan = guild.channels.cache.find(
        c => c.type === ChannelType.GuildText && c.name.includes('vinh-danh')
      );
      if (!vinhdanhChan) continue;

      const E = createEmojiResolver(guildId);

      // 1. Kiểm tra xem đã chốt bảng vinh danh tháng trước chưa
      const prevMonthKey = `final_vinh_danh_posted_${prevYear}_${prevMonth + 1}_${guildId}`;
      const hasPostedPrev = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(prevMonthKey);

      if (!hasPostedPrev) {
        // Query top 10 của tháng trước
        const rowsPrev = queryLeaderboardRows(
          guildId,
          'monthly',
          prevMonthDate,
          10,
        ).rows;
        if (rowsPrev.length > 0) {
          const titlePrev = `BẢNG VINH DANH THÁNG CHUNG CUỘC — THÁNG ${prevMonth + 1}/${prevYear}`;
          const subtitlePrev = `Danh sách vinh danh khách hàng tiêu biểu nhất trong toàn bộ **tháng ${prevMonth + 1}/${prevYear}**`;
          const payloadPrev = buildLeaderboardV2(titlePrev, subtitlePrev, rowsPrev, guildId);

          // Gửi bảng chốt tháng (V2 — không kèm content text riêng)
          await vinhdanhChan.send(payloadPrev).catch(() => null);

          // Lưu trạng thái đã post vào DB
          db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)').run(prevMonthKey, '1');
          console.log(`[Vinh Danh] Guild ${guild.name} đã chốt bảng vinh danh tháng ${prevMonth + 1}/${prevYear}`);
        }
      }

      // 2. Cập nhật bảng vinh danh LIVE cho tháng này
      const currentMonthKey = `live_vinh_danh_msg_id_${currentYear}_${currentMonth + 1}_${guildId}`;
      const liveMsgRow = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(currentMonthKey);
      let liveMsgId = liveMsgRow?.value || null;

      const rowsCurr = queryLeaderboardRows(guildId, 'monthly', now, 10).rows;
      const titleCurr = `BẢNG XẾP HẠNG TIÊU DÙNG THÁNG ${currentMonth + 1}/${currentYear} (LIVE)`;
      const subtitleCurr = `Bảng xếp hạng cập nhật liên tục các khách hàng chi tiêu nhiều nhất trong **tháng ${currentMonth + 1}/${currentYear}**`;
      const payloadCurr = buildLeaderboardV2(titleCurr, subtitleCurr, rowsCurr, guildId);

      let msg = null;
      if (liveMsgId) {
        msg = await vinhdanhChan.messages.fetch(liveMsgId).catch(() => null);
      }

      if (msg) {
        // Edit tin nhắn cũ
        await msg.edit(payloadCurr).catch(() => null);
        console.log(`[Vinh Danh] Guild ${guild.name} đã cập nhật bảng vinh danh live`);
      } else {
        // Đăng tin nhắn mới
        // Bỏ logic tự động xóa tất cả tin nhắn cũ của bot để tránh xóa nhầm các panel (như Bảng Giá) 
        // nếu người dùng đặt chung một kênh.
        const newMsg = await vinhdanhChan.send(payloadCurr).catch(() => null);
        if (newMsg) {
          db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)').run(currentMonthKey, newMsg.id);
          console.log(`[Vinh Danh] Guild ${guild.name} đã tạo bảng vinh danh live mới: ${newMsg.id}`);
        }
      }

    } catch (err) {
      console.error(`[Vinh Danh] Lỗi xử lý guild ${guildId}:`, err);
    }
  }
}
