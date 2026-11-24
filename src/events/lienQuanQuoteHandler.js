import { ChannelType, MessageFlags } from 'discord.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import {
  buildLienQuanQuoteText, lienQuanImageName, LIEN_QUAN_ACCOUNTS, LIEN_QUAN_ATTACHMENT_LIMIT,
  LIEN_QUAN_BUTTON_PREFIX, LIEN_QUAN_CATEGORY_ID, LIEN_QUAN_CHANNEL,
} from '../utils/lienQuanCatalog.js';
import { handleTicketCreate } from './ticketHandlers.js';

export async function handleLienQuanQuote(interaction) {
  const account = LIEN_QUAN_ACCOUNTS.find(({ code }) => interaction.customId === LIEN_QUAN_BUTTON_PREFIX + code);
  const source = interaction.channel;
  if (!interaction.isButton() || !account || interaction.guildId !== STORE_ONE_GUILD_ID
    || source?.type !== ChannelType.GuildText || source?.name !== LIEN_QUAN_CHANNEL
    || source.parentId !== LIEN_QUAN_CATEGORY_ID
    || interaction.message?.author?.id !== interaction.client.user.id) {
    await interaction.reply({ content: 'Hãy mở đúng bài acc trong kênh Acc Liên Quân của Cenar Store.', flags: MessageFlags.Ephemeral });
    return;
  }

  const name = lienQuanImageName(account);
  const photo = interaction.message.attachments?.find(file => file.name === name && file.contentType === 'image/jpeg'
    && Number.isSafeInteger(file.size) && file.size > 0 && file.size <= LIEN_QUAN_ATTACHMENT_LIMIT);
  const url = URL.parse(photo?.url ?? '');
  if (!photo || url?.origin !== 'https://cdn.discordapp.com' || url.pathname !== `/attachments/${source.id}/${photo.id}/${name}`) {
    await interaction.reply({ content: `Ảnh của mã ${account.code} chưa có trên bài. Báo shop để kiểm tra.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let attachment;
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(7_000) });
    if (!response.ok) throw new Error('LIEN_QUAN_IMAGE_UNAVAILABLE');
    attachment = Buffer.from(await response.arrayBuffer());
    if (attachment.length !== photo.size) throw new Error('LIEN_QUAN_IMAGE_SIZE_MISMATCH');
  } catch (error) {
    console.warn('[LIEN_QUAN_QUOTE]', error.code || error.name);
    await interaction.editReply({ content: `Discord chưa tải được ảnh của ${account.code}. Vui lòng thử lại sau ít phút.` });
    return;
  }

  await handleTicketCreate(interaction, 'ORDER', null, {
    intake: { title: `Acc Liên Quân · ${account.code}`, text: buildLienQuanQuoteText(account),
      attachment: { attachment, name, description: `Ảnh acc khách đã chọn · ${account.code}` } },
  });
}
