import { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextDisplayBuilder } from 'discord.js';
import { buildBookingProfilePost, buildBookingProfileResponse } from '../services/bookingProfilePublication.js';
import { canRequestHostService } from '../services/bookingProfileService.js';

const services = { game: 'Đặt chơi game', voice: 'Đặt trò chuyện' };
const channelUrl = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

function link(label, url, emoji) {
  const button = new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
  if (emoji) button.setEmoji(emoji);
  return button;
}

function pageButton(label, direction, ownerId, target, disabled) {
  return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled)
    .setCustomId(`booking:hosts:${direction}:${ownerId}:${target}`);
}

export async function bookingHostDirectoryCard({ guildId, ownerId, portal, page, total, profile, rating, template }) {
  if (!profile) {
    const payload = buildBookingProfileResponse({ title: 'Chưa có hồ sơ host công khai',
      detail: 'Mở phiếu đặt lịch để staff tìm host theo game, chủ đề và giờ bạn muốn.' });
    payload.components[0].addActionRowComponents(new ActionRowBuilder().addComponents(
      link('Mở cổng đặt lịch', channelUrl(guildId, portal.request), portal.emoji.calendar),
    ));
    return payload;
  }

  const payload = await buildBookingProfilePost(profile, rating, template, portal.emoji);
  const availability = new ButtonBuilder().setStyle(ButtonStyle.Primary).setLabel('Xem ca trống')
    .setCustomId(`booking:hosts:slots:${ownerId}:${profile.profile_number}`);
  if (portal.emoji.calendar) availability.setEmoji(portal.emoji.calendar);
  const bookButtons = Object.entries(services).filter(([service]) => canRequestHostService(profile, service))
    .map(([service, label]) => {
      const button = new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(label)
        .setCustomId(`booking:hosts:${service}:${ownerId}:${profile.profile_number}`);
      if (portal.emoji[service]) button.setEmoji(portal.emoji[service]);
      return button;
    });
  const card = payload.components[0];
  card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Hồ sơ ${page}/${total} · Ca trống hiển thị giờ và giá đã chốt. Yêu cầu giờ khác qua phiếu riêng.`));
  card.addActionRowComponents(new ActionRowBuilder().addComponents(
    availability,
    ...bookButtons,
    link('Bài hồ sơ', channelUrl(guildId, profile.forum_thread_id), portal.emoji.profiles),
    link('Xem đánh giá', channelUrl(guildId, portal.reviews), portal.emoji.reviews),
  ));
  if (total > 1) {
    card.addActionRowComponents(new ActionRowBuilder().addComponents(
      pageButton('Hồ sơ trước', 'previous', ownerId, Math.max(1, page - 1), page === 1),
      pageButton('Hồ sơ sau', 'next', ownerId, Math.min(total, page + 1), page === total),
    ));
  }
  return payload;
}
