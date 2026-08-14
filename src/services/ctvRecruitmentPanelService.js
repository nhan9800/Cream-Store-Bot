import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import {
  getCtvRecruitmentSnapshot,
  getCtvSettings,
  setCtvRecruitmentFullNotice,
  setCtvRecruitmentMessage,
} from './ctvService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { isInternationalGuild } from '../utils/locale.js';
import { accentFor } from '../utils/uiKit.js';

export function buildCtvRecruitmentPayload(guildId, references = {}, suppliedSnapshot = null) {
  const E = createEmojiResolver(guildId);
  const snapshot = suppliedSnapshot || getCtvRecruitmentSnapshot(guildId);
  const international = isInternationalGuild(guildId);
  const sparkle = E('ctv_sparkle', '<a:cenar_starxoay:1481141954346483845>');
  const gift = E('ctv_gift', '<:cenar_sale_gift:1534852792295100436>');
  const notes = E('ctv_notes', '<:cenar_34562snoopypencil:1282641307742900225>');
  const arrow = E('ctv_arrow', '<a:cenar_arrow2:1367139234833498113>');
  const verified = E('cenar_verified');
  const boost = E('brand_boost');
  const warning = E('status_warn');
  const blocked = E('status_cross');
  const totalLabel = String(snapshot.capacity || 0).padStart(2, '0');
  const remainingLabel = String(snapshot.remaining ?? 0).padStart(2, '0');

  const hero = new ContainerBuilder().setAccentColor(accentFor(snapshot.isFull ? 'danger' : 'success'));
  const rules = new ContainerBuilder().setAccentColor(accentFor('warning'));

  if (international) {
    hero.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `# ${sparkle} CENAR AFFILIATE RECRUITMENT`,
      snapshot.active
        ? `> ${snapshot.isFull ? blocked : verified} **${snapshot.isFull ? `FILLED · ${totalLabel}/${totalLabel}` : `${remainingLabel}/${totalLabel} OPENINGS LEFT`}**`
        : `> ${verified} Applications are currently open.`,
      '',
      `### ${gift} BENEFITS`,
      `${gift} Private affiliate pricing with a clear resale margin and no inventory commitment.`,
      `${arrow} Automatic affiliate pricing, dedicated order logs and prioritized order handling.`,
      `${notes} Private price board, team discussion area and product/update support.`,
      `${boost} Qualified affiliates can open multiple order tickets to keep customer orders separate.`,
    ].join('\n')));
    rules.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${warning} EXPECTATIONS`,
      `${verified} Maintain a clear customer source and provide responsible after-sales support.`,
      `${arrow} Keep customer orders separated, accurate and traceable through the bot.`,
      `${blocked} No scams, impersonation, misleading claims or sharing private affiliate pricing/data.`,
      `-# Applications are reviewed manually. Approval consumes one opening and updates this panel immediately.`,
    ].join('\n')));
  } else {
    hero.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `# ${sparkle} CENAR STORE · TUYỂN THÊM ${totalLabel} CTV`,
      snapshot.active
        ? `> ${snapshot.isFull ? blocked : verified} **${snapshot.isFull ? `ĐÃ TUYỂN ĐỦ · ${totalLabel}/${totalLabel} VỊ TRÍ` : `CÒN ${remainingLabel}/${totalLabel} VỊ TRÍ` }**`
        : `> ${verified} Shop đang tiếp nhận hồ sơ Cộng Tác Viên.`,
      '',
      `### ${gift} QUYỀN LỢI CTV`,
      `${gift} Sử dụng **bảng giá CTV riêng**, chủ động giá bán và hưởng phần chênh lệch trên mỗi đơn.`,
      `${arrow} Giá CTV được áp dụng tự động; đơn có log riêng và được nhận diện để xử lý thuận tiện.`,
      `${notes} Truy cập ${references.priceChannelId ? `<#${references.priceChannelId}>` : 'bảng giá nội bộ'}, cập nhật sản phẩm và khu trao đổi riêng của đội ngũ.`,
      `${boost} Được mở nhiều ticket đơn hàng cùng lúc để note từng khách, tránh nhầm thông tin và tiến độ.`,
      `${verified} Không cần ôm hàng; được hỗ trợ quy trình, bảo hành và xử lý tình huống với khách.`,
    ].join('\n')));
    hero.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    hero.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${E('cenar_announce')} Kênh trao đổi: ${references.chatChannelId ? `<#${references.chatChannelId}>` : 'khu CTV'} · Log đơn: ${references.orderLogChannelId ? `<#${references.orderLogChannelId}>` : 'tự động trong hệ thống'}.`,
    ));

    rules.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${warning} YÊU CẦU ỨNG TUYỂN`,
      `${verified} Có nguồn khách hoặc kênh bán hàng rõ ràng; nghiêm túc chăm sóc và phản hồi khách.`,
      `${arrow} Ghi đúng thông tin từng đơn, phối hợp với Staff và chịu trách nhiệm theo sát khách của mình.`,
      `${blocked} Cấm scam, giả mạo Cenar Store, quảng cáo sai sự thật hoặc chia sẻ giá/dữ liệu nội bộ CTV.`,
      `${warning} Hồ sơ được Admin duyệt thủ công; mỗi hồ sơ được duyệt sẽ tự trừ **01 vị trí** và cập nhật panel ngay.`,
      `-# Khi đủ ${totalLabel}/${totalLabel}, bot sẽ khóa nút ứng tuyển và thông báo đợt tuyển đã hoàn tất.`,
    ].join('\n')));
  }

  const button = new ButtonBuilder()
    .setCustomId('ctv:apply:start')
    .setLabel(snapshot.isFull
      ? (international ? 'Recruitment filled' : 'Đã tuyển đủ CTV')
      : (international ? 'Apply as Affiliate' : `Ứng tuyển CTV · Còn ${snapshot.remaining ?? totalLabel} slot`))
    .setStyle(snapshot.isFull ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(snapshot.isFull);
  const buttonEmoji = E.component(snapshot.isFull ? 'status_cross' : 'cenar_verified');
  if (buttonEmoji) button.setEmoji(buttonEmoji);

  return {
    components: [hero, rules, new ActionRowBuilder().addComponents(button)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export async function publishCtvRecruitmentPanel(guild, settings = getCtvSettings(guild.id)) {
  const channel = settings.recruit_channel_id
    ? await guild.channels.fetch(settings.recruit_channel_id).catch(() => null)
    : null;
  if (!channel?.isTextBased()) return null;

  const snapshot = getCtvRecruitmentSnapshot(guild.id);
  const payload = buildCtvRecruitmentPayload(guild.id, {
    priceChannelId: settings.price_channel_id,
    chatChannelId: settings.chat_channel_id,
    orderLogChannelId: settings.order_log_channel_id,
  }, snapshot);
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const candidates = recent
    ? [...recent.values()].filter((message) => (
        message.author.id === channel.client.user.id
        && JSON.stringify(message.components.map((component) => component.toJSON())).includes('ctv:apply:start')
      ))
    : [];
  let primary = settings.recruitment_message_id
    ? candidates.find((message) => message.id === settings.recruitment_message_id)
    : null;
  primary ||= candidates[0] || null;

  const message = primary?.flags?.has(MessageFlags.IsComponentsV2)
    ? await primary.edit(payload)
    : await channel.send(payload);
  setCtvRecruitmentMessage(guild.id, message.id);
  await Promise.all(candidates.filter((candidate) => candidate.id !== message.id).map((duplicate) => (
    duplicate.delete('Remove duplicate CTV recruitment panel').catch(() => null)
  )));
  return message;
}

export async function publishCtvRecruitmentFullNotice(guild, settings = getCtvSettings(guild.id)) {
  const snapshot = getCtvRecruitmentSnapshot(guild.id);
  if (!snapshot.isFull) return null;
  const channel = settings.recruit_channel_id
    ? await guild.channels.fetch(settings.recruit_channel_id).catch(() => null)
    : null;
  if (!channel?.isTextBased()) return null;

  if (settings.recruitment_full_notice_message_id) {
    const existing = await channel.messages.fetch(settings.recruitment_full_notice_message_id).catch(() => null);
    if (existing) return existing;
  }

  const E = createEmojiResolver(guild.id);
  const container = new ContainerBuilder().setAccentColor(accentFor('danger'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('status_cross')} ĐỢT TUYỂN CTV ĐÃ ĐỦ ${snapshot.capacity}/${snapshot.capacity}`,
    `${E('cenar_verified')} Cenar Store đã tuyển đủ **${snapshot.capacity} Cộng Tác Viên** cho đợt hiện tại.`,
    `${E('cenar_announce')} Form ứng tuyển đã được khóa tự động. Cảm ơn mọi người đã quan tâm và gửi hồ sơ.`,
    `-# Khi shop mở thêm vị trí, panel tại kênh này sẽ được cập nhật lại ngay.`,
  ].join('\n')));
  const message = await channel.send({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
  setCtvRecruitmentFullNotice(guild.id, message.id);
  return message;
}
