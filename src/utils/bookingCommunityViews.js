import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, SectionBuilder,
  SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
} from 'discord.js';
import { COMMUNITY_SHOP, MAX_CONNECTIONS, communityDay } from '../services/bookingCommunityService.js';

export const communityColors = Object.freeze({ indigo: 0x7167db, mint: 0x50c8a2, blue: 0x556ed5, copper: 0xd49b57 });
export const communityPlayNote = 'Trò chơi miễn phí. Điểm chỉ dùng cho vật phẩm cộng đồng.';
const coin = new Intl.NumberFormat('vi-VN');
const dayMs = 86_400_000;
const vietnamOffsetMs = 7 * 3_600_000;

export function communityNumber(value) {
  return coin.format(value);
}

export function communityResetTime(now = Date.now()) {
  const midnight = Date.parse(`${communityDay(now)}T00:00:00Z`);
  return Math.floor((midnight + dayMs - vietnamOffsetMs) / 1000);
}

function progressBar(progress, total, width = 10) {
  const filled = Math.floor(Math.max(0, Math.min(1, progress / total)) * width);
  return `\`${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}\``;
}

export function communityButton(context, action, label, { style = ButtonStyle.Secondary, icon, disabled = false } = {}) {
  const button = new ButtonBuilder()
    .setCustomId(`booking:community:${context.owner}:${action}`)
    .setLabel(label).setDisabled(disabled).setStyle(style);
  const emoji = context.emoji?.[icon];
  if (emoji?.id) button.setEmoji(emoji);
  return button;
}

export function communityCard(context, { title, lead, fields = [], buttons = [], footnote, icon = 'reviews', color = communityColors.indigo }) {
  const emoji = context.emoji?.[icon];
  const emblem = emoji?.id && emoji.name ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}> ` : '';
  const container = new ContainerBuilder().setAccentColor(color);
  const text = content => new TextDisplayBuilder().setContent(content);
  container.addTextDisplayComponents(text(`## ${emblem}${title}${lead ? `\n${lead}` : ''}`));
  if (fields.length) container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  for (const { label, body, action } of fields) {
    const content = text(`${label ? `### ${label}\n` : ''}${body}`);
    if (action) {
      container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(content).setButtonAccessory(action));
    } else {
      container.addTextDisplayComponents(content);
    }
  }
  if (footnote) container.addTextDisplayComponents(text(`-# ${footnote}`));
  if (buttons.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
  }
  return { components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

const shopDetails = {
  nhan: 'Dùng để cầu hôn khi hai bạn đã kết nối.',
  'thuc-an': 'Tăng cấp thú cưng chung sau khi kết hôn.',
  'huy-hieu': 'Vật phẩm sưu tầm. Mỗi thành viên giữ một huy hiệu.',
};

export function communityShopCard(context, profile, notice) {
  const fields = Object.entries(COMMUNITY_SHOP).map(([sku, item]) => {
    const owned = profile.inventory[sku] ?? 0;
    const uniqueOwned = sku === 'huy-hieu' && owned > 0;
    const lowBalance = profile.points < item.cost;
    return {
      label: item.label,
      body: `${shopDetails[sku]}\n**${communityNumber(item.cost)} điểm** · ${owned ? `Đang có ${communityNumber(owned)}` : 'Chưa có trong túi'}`,
      action: communityButton(context, `buy:${sku}:${context.version}`, uniqueOwned ? 'Đã sở hữu' : lowBalance ? 'Thiếu điểm' : 'Mua',
        { style: ButtonStyle.Primary, disabled: uniqueOwned || lowBalance }),
    };
  });
  return communityCard(context, {
    title: 'Cửa hàng Cenar', lead: `${notice ? `${notice}\n\n` : ''}**Số dư của bạn:** ${communityNumber(profile.points)} điểm`,
    fields, color: communityColors.indigo, icon: 'apply', footnote: 'Điểm cộng đồng dùng trong bot.',
    buttons: [communityButton(context, 'profile', 'Túi đồ', { icon: 'profiles' }), communityButton(context, 'gift', 'Quà hôm nay')],
  });
}

export function communityCheckInCard(context, result, now) {
  const filled = Math.min(7, result.streak);
  return communityCard(context, {
    title: result.status === 'claimed' ? 'Đã điểm danh hôm nay' : 'Điểm danh thành công',
    lead: result.status === 'claimed' ? 'Hôm nay đã ghi nhận một lượt.' : `**+${communityNumber(result.points)} điểm** vào số dư cộng đồng`,
    icon: 'calendar', color: communityColors.mint,
    fields: [{ label: 'Chuỗi điểm danh', body: `**${result.streak} ngày liên tiếp**\n${progressBar(filled, 7, 7)}  ${filled}/7` }],
    footnote: `Lượt tiếp theo <t:${communityResetTime(now)}:R>.`,
    buttons: [communityButton(context, 'missions', 'Nhiệm vụ hôm nay', { icon: 'game' })],
  });
}

export function communityMissionCard(context, tasks, result, now) {
  const completed = tasks.filter(task => task.count >= task.goal).length;
  const reward = result.status === 'awarded' ? 'Đã cộng **25 điểm**.' : result.status === 'claimed'
    ? 'Đã nhận **25 điểm** hôm nay.' : 'Hoàn thành đủ 4 nhiệm vụ để nhận **25 điểm**.';
  return communityCard(context, {
    title: 'Nhiệm vụ hôm nay', lead: `**${completed}/${tasks.length} nhiệm vụ đã xong**\n${reward}`,
    color: completed === tasks.length ? communityColors.mint : communityColors.copper, icon: 'game',
    fields: tasks.map(({ label, count, goal }) => ({
      label,
      body: `${progressBar(count, goal)}  **${Math.min(count, goal)}/${goal}** · ${count >= goal ? 'Đã xong' : 'Đang làm'}`,
    })),
    footnote: `Tiến độ làm mới <t:${communityResetTime(now)}:R>.`,
    buttons: [communityButton(context, 'missions', 'Cập nhật tiến độ')],
  });
}

export function communityProfileCard(context, profile) {
  const items = Object.entries(COMMUNITY_SHOP).filter(([sku]) => profile.inventory[sku] > 0)
    .map(([sku, item]) => `**${item.label}** × ${communityNumber(profile.inventory[sku])}`);
  return communityCard(context, {
    title: 'Hồ sơ của bạn', lead: `**Cấp ${profile.level}** · ${communityNumber(profile.xp)} XP`, icon: 'profiles',
    fields: [
      { label: 'Số dư và điểm danh', body: `**${communityNumber(profile.points)} điểm** · Chuỗi **${profile.streak} ngày**` },
      { label: 'Túi đồ', body: items.length ? items.join('\n') : 'Túi đồ đang trống.' },
    ],
    buttons: [communityButton(context, 'shop', 'Mở cửa hàng', { icon: 'apply' })],
  });
}

export function communityConnectionsCard(context, records) {
  const invitations = [];
  const friendships = [];
  for (const { peer, state, incoming, affinity, pet } of records) {
    if (state === 'pending' || state === 'proposal') {
      invitations.push(`<@${peer}> · ${state === 'pending' ? 'Kết nối' : 'Cầu hôn'} · ${incoming ? 'Đã nhận' : 'Đã gửi'}`);
    } else {
      friendships.push(`**<@${peer}>** · ${state === 'married' ? 'Đã kết hôn' : 'Bạn bè'}\nMức thân thiết **${communityNumber(affinity)}**${state === 'married' ? ` · Thú cưng cấp **${pet + 1}**` : ''}`);
    }
  }
  return communityCard(context, {
    title: 'Lời mời và bạn bè', lead: `**${records.length}/${MAX_CONNECTIONS} chỗ đã dùng**`,
    icon: 'profiles', color: communityColors.blue,
    fields: [
      { label: 'Lời mời', body: invitations.length ? invitations.join('\n') : 'Bạn chưa có lời mời.' },
      { label: 'Kết nối', body: friendships.length ? friendships.join('\n\n') : 'Bạn chưa có kết nối.' },
    ],
    footnote: 'Dùng /cenar-cong-dong tuong-tac để trả lời lời mời hoặc chăm thú cưng.',
  });
}
