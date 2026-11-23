import { MessageFlags } from 'discord.js';
import { db } from '../database/db.js';
import { canRequestHostService, createBookingProfileService } from '../services/bookingProfileService.js';
import { hostNumber } from '../services/bookingProfilePublication.js';
import { bookingHostDirectoryCard } from '../utils/bookingHostDirectoryViews.js';
import { safeReply } from './shared.js';

const directoryControl = /^booking:hosts:(previous|next|game|voice):(\d{17,20}):([1-9]\d{0,14})$/;

export async function handleBookingHostDirectoryInteraction(interaction, { portal, bookingForm, profiles }) {
  const reply = content => safeReply(interaction, { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  const launch = interaction.customId === 'booking:dashboard:hosts';
  const ownerId = interaction.user.id;
  const control = directoryControl.exec(interaction.customId);
  const allowedChannel = interaction.channelId && [portal.welcome, portal.request].includes(interaction.channelId);
  const botMessage = interaction.message?.author?.id === interaction.client.user.id;
  const ownedView = control?.[2] === ownerId && interaction.message?.flags?.has(MessageFlags.Ephemeral);
  if (!interaction.isButton() || !allowedChannel || !botMessage || (!launch && !ownedView)) {
    await reply('Mở danh sách host từ sảnh hoặc cổng đặt lịch để xem hồ sơ của bạn.');
    return true;
  }

  const action = control?.[1];
  const target = Number(control?.[3] ?? 1);
  const directory = profiles ?? createBookingProfileService(db);
  if (action === 'game' || action === 'voice') {
    const profile = directory.getPublished(target);
    if (!profile || !canRequestHostService(profile, action)) {
      await reply('Hồ sơ hoặc dịch vụ này đã thay đổi. Mở lại danh sách host để cập nhật.');
      return true;
    }
    const preferredHost = `#${hostNumber(profile.profile_number)} ${profile.approved.name}`;
    await interaction.showModal(bookingForm(action, { preferredHost }));
    return true;
  }

  if (launch) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  else await interaction.deferUpdate();
  const result = directory.publishedPage(target);
  const rating = result.profile ? directory.ratingFor(result.profile.host_id) : null;
  const payload = await bookingHostDirectoryCard({ guildId: interaction.guildId, ownerId, portal,
    ...result, rating, template: directory.getTemplate() });
  await interaction.editReply({ ...payload, attachments: [] });
  return true;
}
