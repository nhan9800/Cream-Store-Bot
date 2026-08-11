import {
  Events, ChannelType,
  ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder,
  SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} from 'discord.js';
import { config } from '../config.js';
import { handleMemberAdd } from '../services/inviteTrackerService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { brandForGuild, isInternationalGuild } from '../utils/locale.js';

export const name = Events.GuildMemberAdd;
export const once = false;

const SERVER1_ID = '1282637033340403754';
const SERVER2_ID = '1070676180103086132';

const WELCOME_BANNER = {
  s1: 'https://i.pinimg.com/originals/68/ae/bf/68aebf3739f455687a90e871bdc04a98.gif',
  s2: 'https://i.pinimg.com/originals/68/ae/bf/68aebf3739f455687a90e871bdc04a98.gif',
};

// Mọi emoji được resolve theo cache thật của guild để emoji đã xóa/đổi tên
// không bị Discord hiển thị thành chuỗi :emoji_name: trong thông báo.
const recentWelcomes = new Map();
const WELCOME_THROTTLE_MS = 60_000;

function shouldThrottle(userId) {
  const now = Date.now();
  const last = recentWelcomes.get(userId);
  if (last && now - last < WELCOME_THROTTLE_MS) return true;
  recentWelcomes.set(userId, now);
  if (recentWelcomes.size > 200) {
    for (const [id, ts] of recentWelcomes) {
      if (now - ts > WELCOME_THROTTLE_MS) recentWelcomes.delete(id);
    }
  }
  return false;
}

export function buildWelcomeChatV2({
  guildId,
  userId,
  brandName = 'Cenar Store',
  memberCount = 0,
  verifyChannelId = null,
  accentColor = 0x7C3AED,
}) {
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const lines = [
    `## ${E('icon_fire')} ${international ? 'WELCOME TO CENAR GLOBAL' : 'THÀNH VIÊN MỚI GIA NHẬP'}`,
    `${E('icon_heart_purple')} ${international ? `Welcome <@${userId}> to **${brandName}**!` : `Chào mừng <@${userId}> đến với **${brandName}**!`}`,
    verifyChannelId
      ? `> ${E('verify_shield')} ${international ? `Complete verification in <#${verifyChannelId}> to unlock the community.` : `Ghé <#${verifyChannelId}> để xác minh và mở khóa đầy đủ các kênh.`}`
      : null,
    '',
    `-# ${E('icon_group')} ${international ? `Member **#${Number(memberCount).toLocaleString('en-US')}** · ${E('icon_sparkle')} Enjoy secure global shopping` : `Thành viên thứ **#${Number(memberCount).toLocaleString('vi-VN')}** · ${E('icon_sparkle')} Chúc bạn mua sắm vui vẻ`}`,
  ].filter((line) => line !== null).join('\n');

  const container = new ContainerBuilder().setAccentColor(accentColor);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [String(userId)] },
  };
}

export async function execute(member) {
  try {
    const guild       = member.guild;
    const user        = member.user;
    const memberCount = guild.memberCount;
    const isServer1   = guild.id === SERVER1_ID;
    const international = isInternationalGuild(guild.id);
    const brandName   = brandForGuild(guild.id, config.storeName || 'Cenar Store');
    const emoji       = createEmojiResolver(guild.id);
    const E = {
      fire: emoji('icon_fire'),
      sparkle: emoji('icon_sparkle'),
      heart: emoji('icon_heart_purple'),
      verify: emoji('verify_shield'),
      tick: emoji('status_check'),
      shop: emoji('icon_store'),
      pay: emoji('payment_money'),
      cart: emoji('icon_cart'),
      arrow: emoji('icon_next'),
      warning: emoji('status_warn'),
      group: emoji('icon_group'),
    };

    // Track invite (Referral Giveaway system)
    await handleMemberAdd(member);

    if (shouldThrottle(user.id)) return;

    // 1. Cấp Auto-Role cho Server 2
    if (guild.id === SERVER2_ID) {
      const defaultRole = guild.roles.cache.find(r => ['🍃 ｜ Thành Viên Mới', 'Global Newcomer'].includes(r.name));
      if (defaultRole) {
        await member.roles.add(defaultRole).catch(e => console.error(`[AUTO-ROLE S2] Thất bại: ${e.message}`));
      }
    }

    // ─── Tìm channels ─────────────────────────────────────────────────────
    const welcomeChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && (c.name.includes('chào-mừng') || c.name === 'welcome'));
    const verifyChannel  = guild.channels.cache.find(c => (c.name.includes('xác-minh') || c.name === 'verify') && c.type === ChannelType.GuildText);
    const bangGiaChan    = guild.channels.cache.find(c => (c.name.includes('bảng-giá') || c.name === 'pricing') && c.type === ChannelType.GuildText);
    const hoTroChan      = guild.channels.cache.find(c => (c.name.includes('hỗ-trợ') || c.name === 'support-center') && c.type === ChannelType.GuildText && !c.name.startsWith('ticket'));
    const thaoLuanChan   = guild.channels.cache.find(c => (c.name.includes('thảo-luận') || c.name === 'global-chat') && c.type === ChannelType.GuildText);

    const accountAgeDays = Math.floor((Date.now() - user.createdTimestamp) / 86400000);
    const accountAgeText = international
      ? (accountAgeDays < 1 ? 'Today'
        : accountAgeDays < 30 ? `${accountAgeDays} days ago`
        : accountAgeDays < 365 ? `${Math.floor(accountAgeDays / 30)} months ago`
        : `${Math.floor(accountAgeDays / 365)} years ago`)
      : accountAgeDays < 1   ? 'Hôm nay'
      : accountAgeDays < 30  ? `${accountAgeDays} ngày trước`
      : accountAgeDays < 365 ? `${Math.floor(accountAgeDays / 30)} tháng trước`
      : `${Math.floor(accountAgeDays / 365)} năm trước`;

    const avatar      = user.displayAvatarURL({ forceStatic: false, size: 256 });
    const accentColor = isServer1 ? 0x7C3AED : 0xF472B6;

    // ═══════════════════════════════════════════════════════════════
    // 2. Kênh #chào-mừng
    // ═══════════════════════════════════════════════════════════════
    if (welcomeChannel) {
      const header = [
        `## ${E.fire} ${international ? 'WELCOME TO CENAR GLOBAL' : 'CHÀO MỪNG THÀNH VIÊN MỚI'}`,
        `${E.heart} ${international ? `Welcome <@${user.id}> to **${brandName}**!` : `Hân hoan chào đón <@${user.id}> đến với **${brandName}**!`}`,
        ``,
        `${E.group} **${international ? 'Member' : 'Thành viên thứ'}:** #${memberCount.toLocaleString(international ? 'en-US' : 'vi-VN')}`,
        `${E.sparkle} **${international ? 'Account age' : 'Tài khoản tạo'}:** ${accountAgeText}`,
      ].join('\n');

      const guideItems = [
        verifyChannel ? `${E.verify} ${verifyChannel} — **${international ? 'Verify' : 'Xác minh'}** ${international ? 'to unlock the community' : 'để mở khóa toàn bộ server'}` : null,
        bangGiaChan   ? `${E.pay} ${bangGiaChan} — ${international ? 'Browse live global pricing' : 'Xem bảng giá dịch vụ'}` : null,
        hoTroChan     ? `${E.cart} ${hoTroChan} — ${international ? 'Orders and customer support' : 'Mua hàng & hỗ trợ'}` : null,
      ].filter(Boolean);

      const guide = guideItems.length
        ? [`${E.shop} **${international ? 'Start here' : 'Bắt đầu tại đây'}:**`, ...guideItems.map(l => `> ${E.arrow} ${l}`)].join('\n')
        : null;

      const footer = international
        ? `-# ${E.heart} ${brandName} — Secure • Transparent • Global Support`
        : `-# ${E.heart} ${brandName} — Uy Tín • Chất Lượng • Tự Động 24/7`;

      const container = new ContainerBuilder().setAccentColor(accentColor);

      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar))
      );

      if (guide) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(guide));
      }

      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(isServer1 ? WELCOME_BANNER.s1 : WELCOME_BANNER.s2))
      );
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));

      // Buttons
      const btnRow = new ActionRowBuilder();
      if (verifyChannel) {
        const button = new ButtonBuilder()
          .setLabel(international ? 'Verify Now' : 'Xác Minh Ngay')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${guild.id}/${verifyChannel.id}`);
        const buttonEmoji = emoji.component('verify_shield');
        if (buttonEmoji) button.setEmoji(buttonEmoji);
        btnRow.addComponents(button);
      }
      if (bangGiaChan) {
        const button = new ButtonBuilder()
          .setLabel(international ? 'View Pricing' : 'Xem Bảng Giá')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${guild.id}/${bangGiaChan.id}`);
        const buttonEmoji = emoji.component('payment_money');
        if (buttonEmoji) button.setEmoji(buttonEmoji);
        btnRow.addComponents(button);
      }

      await welcomeChannel.send({
        components: [container, ...(btnRow.components.length ? [btnRow] : [])],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [user.id] },
      }).catch(e => console.error('[WELCOME] Thất bại:', e.message));
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. Kênh #thảo-luận — gọn, đúng brand
    // ═══════════════════════════════════════════════════════════════
    if (thaoLuanChan) {
      await thaoLuanChan.send(buildWelcomeChatV2({
        guildId: guild.id,
        userId: user.id,
        brandName,
        memberCount,
        verifyChannelId: verifyChannel?.id,
        accentColor,
      })).catch(e => console.error('[WELCOME CHAT] Thất bại:', e.message));
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. DM chào mừng (Server 1 only)
    // ═══════════════════════════════════════════════════════════════
    if (isServer1) {
      const dmLines = [
        `## ${E.sparkle} Chào mừng đến **${brandName}**!`,
        `Xin chào **${user.username}**! Cảm ơn bạn đã tham gia ${E.tick}`,
        ``,
        `**Để truy cập đầy đủ server:**`,
        `> ${E.verify} Vào kênh ${verifyChannel ? verifyChannel.toString() : '**#xác-minh**'}`,
        `> ${E.arrow} Bấm **Xác Minh Ngay** — chỉ mất 5 giây`,
        ``,
        `**Dịch vụ nổi bật:**`,
        `> ${E.warning} Nitro & Boost từ **50k** — Decor từ **23k**`,
        `> ${E.tick} AI Premium (ChatGPT / Gemini / Claude)`,
        `> ${E.shop} Setup Discord + Bot trọn gói từ **500k**`,
        ``,
        `-# ${E.heart} ${brandName} — Uy Tín • Chất Lượng • Giá Tốt Nhất`,
      ];

      const dmContainer = new ContainerBuilder().setAccentColor(0x7C3AED);
      dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(dmLines.join('\n')));

      const dmComponents = [dmContainer];
      if (verifyChannel) {
        const button = new ButtonBuilder()
          .setLabel('Xác Minh Ngay')
          .setStyle(ButtonStyle.Link)
          .setURL(`https://discord.com/channels/${guild.id}/${verifyChannel.id}`);
        const buttonEmoji = emoji.component('verify_shield');
        if (buttonEmoji) button.setEmoji(buttonEmoji);
        dmComponents.push(
          new ActionRowBuilder().addComponents(button)
        );
      }

      await user.send({ components: dmComponents, flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }

  } catch (error) {
    console.error('[WELCOME] Lỗi xử lý guildMemberAdd:', error);
  }
}
