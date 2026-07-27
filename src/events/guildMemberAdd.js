import {
  Events, ChannelType,
  ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder,
  SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} from 'discord.js';
import { config } from '../config.js';
import { handleMemberAdd } from '../services/inviteTrackerService.js';

export const name = Events.GuildMemberAdd;
export const once = false;

const SERVER1_ID = '1282637033340403754';
const SERVER2_ID = '1070676180103086132';

const WELCOME_BANNER = {
  s1: 'https://i.pinimg.com/originals/68/ae/bf/68aebf3739f455687a90e871bdc04a98.gif',
  s2: 'https://i.pinimg.com/originals/68/ae/bf/68aebf3739f455687a90e871bdc04a98.gif',
};

// ─── Emoji custom của Cenar Store (hardcode để luôn hiển thị đúng) ────────────
const E = {
  fire:         '<a:tsm_fire:1327553120842158111>',
  star:         '<:star:1327549089704837142>',
  starSpin:     '<a:starxoay:1481141954346483845>',
  heart:        '<:purple_heart_glow:1327541911749263360>',
  heartTim:     '<:cr_tim:1366636325352116225>',
  verify:       '<:verifybadge:1481127479702847646>',
  tick:         '<a:tickgreen:1384069022831874169>',
  shop:         '<:cr_shop:1392749981332541501>',
  pay:          '<:cr_pay:1392750857329705000>',
  cart:         '<:cr_carttt:1348626032747614268>',
  voucher:      '<:cr_voucher:1392749775794737286>',
  arrow:        '<:muiten:1481124261501337601>',
  dotGreen:     '<a:chamxanh:1481124932447371374>',
  dotYellow:    '<a:Dotyellow:1481134440725090315>',
  neonHeart:    '<:68923neonheart:1301580703439519828>',
  neonStar:     '<:61048neonstars:1301580696850141195>',
  snoopy:       '<:53828snoopyok:1282641295415709716>',
  green:        '<:cr_green:1366636327415713832>',
  yellow:       '<:cr_yellow:1366636331127803916>',
  pink:         '<:cr_pink:1366636329349152788>',
  muahang:      '<:cr_muahang:1348622828152426528>',
};

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

export async function execute(member) {
  try {
    const guild       = member.guild;
    const user        = member.user;
    const memberCount = guild.memberCount;
    const isServer1   = guild.id === SERVER1_ID;
    const brandName   = config.storeName || 'Cenar Store';

    // Track invite (Referral Giveaway system)
    await handleMemberAdd(member);

    if (shouldThrottle(user.id)) return;

    // 1. Cấp Auto-Role cho Server 2
    if (guild.id === SERVER2_ID) {
      const defaultRole = guild.roles.cache.find(r => r.name === '🍃 ｜ Thành Viên Mới');
      if (defaultRole) {
        await member.roles.add(defaultRole).catch(e => console.error(`[AUTO-ROLE S2] Thất bại: ${e.message}`));
      }
    }

    // ─── Tìm channels ─────────────────────────────────────────────────────
    const welcomeChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name.includes('chào-mừng'));
    const verifyChannel  = guild.channels.cache.find(c => c.name.includes('xác-minh')  && c.type === ChannelType.GuildText);
    const bangGiaChan    = guild.channels.cache.find(c => c.name.includes('bảng-giá')  && c.type === ChannelType.GuildText);
    const hoTroChan      = guild.channels.cache.find(c => c.name.includes('hỗ-trợ')    && c.type === ChannelType.GuildText && !c.name.startsWith('ticket'));
    const thaoLuanChan   = guild.channels.cache.find(c => c.name.includes('thảo-luận') && c.type === ChannelType.GuildText);

    const accountAgeDays = Math.floor((Date.now() - user.createdTimestamp) / 86400000);
    const accountAgeText = accountAgeDays < 1   ? 'Hôm nay'
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
        `## ${E.fire} CHÀO MỪNG THÀNH VIÊN MỚI ${E.fire}`,
        `${E.heart} Hân hoan chào đón <@${user.id}> đến với **${brandName}**!`,
        ``,
        `${E.starSpin} **Thành viên thứ:** #${memberCount.toLocaleString('vi-VN')}`,
        `${E.dotGreen} **Tài khoản tạo:** ${accountAgeText}`,
      ].join('\n');

      const guideItems = [
        verifyChannel ? `${E.verify} ${verifyChannel} — **Xác minh** để mở khóa toàn bộ server` : null,
        bangGiaChan   ? `${E.pay} ${bangGiaChan} — Xem bảng giá dịch vụ` : null,
        hoTroChan     ? `${E.cart} ${hoTroChan} — Mua hàng & hỗ trợ` : null,
      ].filter(Boolean);

      const guide = guideItems.length
        ? [`${E.shop} **Bắt đầu tại đây:**`, ...guideItems.map(l => `> ${E.arrow} ${l}`)].join('\n')
        : null;

      const footer = `-# ${E.heartTim} ${brandName} — Uy Tín • Chất Lượng • Tự Động 24/7`;

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
        btnRow.addComponents(
          new ButtonBuilder()
            .setLabel('Xác Minh Ngay')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${guild.id}/${verifyChannel.id}`)
            .setEmoji({ id: '1481127479702847646', name: 'verifybadge' })
        );
      }
      if (bangGiaChan) {
        btnRow.addComponents(
          new ButtonBuilder()
            .setLabel('Xem Bảng Giá')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${guild.id}/${bangGiaChan.id}`)
            .setEmoji({ id: '1392750857329705000', name: 'cr_pay' })
        );
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
      const lines = [
        `${E.fire} **THÀNH VIÊN MỚI GIA NHẬP!** ${E.fire}`,
        `${E.heart} Chào mừng <@${user.id}> đã tham gia **${brandName}**!`,
        verifyChannel ? `${E.arrow} Ghé ${verifyChannel} để xác minh & mở khóa server nhé ${E.tick}` : null,
        ``,
        `-# ${E.starSpin} Hiện có **${memberCount.toLocaleString('vi-VN')}** thành viên — ${brandName}`,
      ].filter(Boolean).join('\n');

      const chatContainer = new ContainerBuilder().setAccentColor(accentColor);
      chatContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));

      await thaoLuanChan.send({
        components: [chatContainer],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: [user.id] },
      }).catch(e => console.error('[WELCOME CHAT] Thất bại:', e.message));
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. DM chào mừng (Server 1 only)
    // ═══════════════════════════════════════════════════════════════
    if (isServer1) {
      const dmLines = [
        `## ${E.neonStar} Chào mừng đến **${brandName}**!`,
        `Xin chào **${user.username}**! Cảm ơn bạn đã tham gia ${E.tick}`,
        ``,
        `**Để truy cập đầy đủ server:**`,
        `> ${E.verify} Vào kênh ${verifyChannel ? verifyChannel.toString() : '**#xác-minh**'}`,
        `> ${E.arrow} Bấm **Xác Minh Ngay** — chỉ mất 5 giây`,
        ``,
        `**Dịch vụ nổi bật:**`,
        `> ${E.dotYellow} Nitro & Boost từ **50k** — Decor từ **23k**`,
        `> ${E.dotGreen} AI Premium (ChatGPT / Gemini / Claude)`,
        `> ${E.shop} Setup Discord + Bot trọn gói từ **500k**`,
        ``,
        `-# ${E.heartTim} ${brandName} — Uy Tín • Chất Lượng • Giá Tốt Nhất`,
      ];

      const dmContainer = new ContainerBuilder().setAccentColor(0x7C3AED);
      dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(dmLines.join('\n')));

      const dmComponents = [dmContainer];
      if (verifyChannel) {
        dmComponents.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('Xác Minh Ngay')
              .setStyle(ButtonStyle.Link)
              .setURL(`https://discord.com/channels/${guild.id}/${verifyChannel.id}`)
              .setEmoji({ id: '1481127479702847646', name: 'verifybadge' })
          )
        );
      }

      await user.send({ components: dmComponents, flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }

  } catch (error) {
    console.error('[WELCOME] Lỗi xử lý guildMemberAdd:', error);
  }
}
