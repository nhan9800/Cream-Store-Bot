import {
  ActionRowBuilder,
  ComponentType,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import {
  isMusicCommonsLink,
  resolveMusicCommons,
  searchMusicCommons,
} from '../services/musicCommonsCatalog.js';
import {
  buildMusicPanelPayload,
  buildMusicAddedMessage,
  playMusicAttachment,
  playMusicCommons,
  playYoutube,
  registerMusicPanelMessage,
} from '../services/musicPlayerService.js';

const MAX_SEARCH_RESULTS = 5;
const SEARCH_SELECTION_TIMEOUT_MS = 60_000;
const SEARCH_TEXT_LENGTH = 120;
const NO_MENTIONS = { parse: [] };

export const data = new SlashCommandBuilder()
  .setName('music')
  .setDescription('Mở Cenar Music để tìm bài theo tên hoặc phát nhạc trong phòng thoại')
  .addStringOption((option) => option
    .setName('ten')
    .setDescription('Tìm bản thu có giấy phép mở theo tên bài hoặc nghệ sĩ')
    .setRequired(false)
    .setMinLength(2)
    .setMaxLength(SEARCH_TEXT_LENGTH))
  .addStringOption((option) => option
    .setName('link')
    .setDescription('Link bản thu Wikimedia Commons hoặc link YouTube (video, playlist, Mix)')
    .setRequired(false)
    .setMaxLength(500))
  .addAttachmentOption((option) => option
    .setName('file')
    .setDescription('Tệp âm thanh MP3 hoặc OGG, tối đa 8 MiB')
    .setRequired(false));

function requireSameVoiceChannel(interaction, voiceChannel) {
  const current = interaction.member?.voice?.channel;
  if (current?.id !== voiceChannel.id) {
    throw new Error('Hãy ở trong phòng thoại ban đầu và dùng lại `/music` để chọn bài.');
  }
  return current;
}

async function playMusicSearch(interaction, query, request) {
  const results = (await searchMusicCommons(query)).slice(0, MAX_SEARCH_RESULTS);
  if (!results.length) {
    await interaction.editReply({
      content: 'Chưa tìm thấy bản thu có giấy phép mở phù hợp. Thử tên bài ngắn hơn hoặc thêm tên nghệ sĩ.',
      allowedMentions: NO_MENTIONS,
    });
    return;
  }

  const customId = `cenar_music_search_${interaction.id}`;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Chọn bản thu để phát hoặc thêm vào hàng đợi')
    .addOptions(results.map((track, index) => ({
      label: track.title.slice(0, 100).toWellFormed(),
      description: [track.license, track.artist].filter(Boolean).join(' · ').slice(0, 100).toWellFormed(),
      value: String(index),
    })));
  const reply = await interaction.editReply({
    content: '**Kết quả tìm nhạc**\nChọn một bản thu từ Wikimedia Commons trong 60 giây.',
    components: [new ActionRowBuilder().addComponents(menu)],
    allowedMentions: NO_MENTIONS,
  });

  let selection;
  try {
    selection = await reply.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: (candidate) => candidate.customId === customId && candidate.user.id === interaction.user.id,
      time: SEARCH_SELECTION_TIMEOUT_MS,
    });
  } catch {
    await interaction.editReply({
      content: 'Danh sách đã hết hạn. Dùng lại `/music ten` để tìm bài.',
      components: [], allowedMentions: NO_MENTIONS,
    });
    return;
  }

  await selection.update({ content: 'Đang thêm bản thu vào hàng đợi…', components: [], allowedMentions: NO_MENTIONS });
  const source = results.find((_track, index) => String(index) === selection.values[0]);
  if (!source) throw new Error('Bản thu đã chọn không còn trong danh sách. Hãy tìm lại.');
  const voiceChannel = requireSameVoiceChannel(selection, request.voiceChannel);
  const added = await playMusicCommons({ ...request, voiceChannel, source });
  const notice = buildMusicAddedMessage(added);
  await interaction.editReply({ content: notice, components: [], allowedMentions: NO_MENTIONS });

  try {
    const message = await interaction.followUp(buildMusicPanelPayload(interaction.guildId, { notice }));
    await registerMusicPanelMessage(interaction.guildId, message);
  } catch {
    // The track is already queued. A failed public reply should not invite a duplicate add.
    await interaction.editReply({
      content: `${notice}\nDùng `/music` để mở bảng điều khiển.`, components: [], allowedMentions: NO_MENTIONS,
    });
  }
}

export async function execute(interaction) {
  const query = interaction.options.getString('ten');
  const link = interaction.options.getString('link');
  const attachment = interaction.options.getAttachment('file');
  if (query !== null) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  else await interaction.deferReply();
  try {
    if ([query, link, attachment].filter(Boolean).length > 1) {
      throw new Error('Chỉ nhập một trong ba tùy chọn `ten`, `link` hoặc `file`.');
    }
    let added = null;
    if (query !== null || link || attachment) {
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) throw new Error('Bạn cần vào một phòng thoại trước khi phát nhạc.');
      const request = {
        guild: interaction.guild,
        voiceChannel,
        requestedBy: interaction.user,
        textChannelId: interaction.channelId,
      };
      if (query !== null) {
        if (query.trim().length < 2) throw new Error('Nhập ít nhất 2 ký tự để tìm bài.');
        await playMusicSearch(interaction, query.trim(), request);
        return;
      }
      if (attachment) {
        added = await playMusicAttachment({ ...request, attachment });
      } else if (isMusicCommonsLink(link)) {
        const source = await resolveMusicCommons(link);
        const currentChannel = requireSameVoiceChannel(interaction, voiceChannel);
        added = await playMusicCommons({ ...request, voiceChannel: currentChannel, source });
      } else {
        added = await playYoutube({ ...request, url: link });
      }
    }
    await interaction.editReply(buildMusicPanelPayload(interaction.guildId, {
      notice: added ? buildMusicAddedMessage(added) : null,
    }));
    const message = await interaction.fetchReply();
    await registerMusicPanelMessage(interaction.guildId, message);
  } catch (error) {
    await interaction.editReply({
      content: `Không thể mở Cenar Music: ${error.message}`,
      components: [], allowedMentions: NO_MENTIONS,
    });
  }
}
