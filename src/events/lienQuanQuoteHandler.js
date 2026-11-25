import { ChannelType, MessageFlags } from 'discord.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import {
  buildLienQuanQuoteText, lienQuanImageName, lienQuanImageUrl, readLienQuanImage, LIEN_QUAN_ACCOUNTS,
  LIEN_QUAN_BUTTON_PREFIX, LIEN_QUAN_CATEGORY_ID, LIEN_QUAN_CHANNEL_NAMES, LIEN_QUAN_TICKET_PREFIX,
} from '../utils/lienQuanCatalog.js';
import { handleTicketCreate } from './ticketHandlers.js';

export async function handleLienQuanQuote(interaction) {
  const account = LIEN_QUAN_ACCOUNTS.find(({ code }) => interaction.customId === LIEN_QUAN_BUTTON_PREFIX + code);
  const source = interaction.channel;
  if (!interaction.isButton() || !account || interaction.guildId !== STORE_ONE_GUILD_ID
    || source?.type !== ChannelType.GuildText || !LIEN_QUAN_CHANNEL_NAMES.includes(source?.name)
    || source.parentId !== LIEN_QUAN_CATEGORY_ID
    || interaction.message?.author?.id !== interaction.client.user.id) {
    await interaction.reply({ content: 'Hãy mở đúng bài acc trong kênh Acc Liên Quân của Cenar Store.', flags: MessageFlags.Ephemeral });
    return;
  }

  const name = lienQuanImageName(account);
  const url = lienQuanImageUrl(interaction.message.components.map(part => part.toJSON()), source.id, account);
  if (!url) {
    await interaction.reply({ content: `Ảnh của mã ${account.code} chưa có trên bài. Báo shop để kiểm tra.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let attachment;
  try {
    attachment = await readLienQuanImage(url);
  } catch (error) {
    console.warn('[LIEN_QUAN_QUOTE]', error.code || error.name);
    await interaction.editReply({ content: `Discord chưa tải được ảnh của ${account.code}. Vui lòng thử lại sau ít phút.` });
    return;
  }

  await handleTicketCreate(interaction, 'ORDER', null, {
    intake: { title: LIEN_QUAN_TICKET_PREFIX + account.code, subjectPrefix: LIEN_QUAN_TICKET_PREFIX, text: buildLienQuanQuoteText(account),
      attachment: { attachment, name, description: `Ảnh acc khách đã chọn · ${account.code}` } },
  });
}
