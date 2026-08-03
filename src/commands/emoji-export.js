import {
  AttachmentBuilder,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import {
  EMOJI_SLOTS,
  autoSyncGuildEmojis,
  getEmojiMap,
} from '../services/emojiService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';

export const data = new SlashCommandBuilder()
  .setName('emoji-export')
  .setDescription('Xuất toàn bộ emoji custom và trạng thái slot giao diện')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function formattedEmoji(emoji) {
  return emoji.animated
    ? `<a:${emoji.name}:${emoji.id}>`
    : `<:${emoji.name}:${emoji.id}>`;
}

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  await interaction.guild.emojis.fetch().catch(() => null);
  const syncResult = autoSyncGuildEmojis(interaction.guild);
  const E = createEmojiResolver(interaction.guildId);
  const map = getEmojiMap(interaction.guildId);
  const slots = Object.entries(EMOJI_SLOTS);
  const configured = slots.filter(([slot]) => map[slot]);
  const missing = slots.filter(([slot]) => !map[slot]);
  const guildEmojis = [...interaction.guild.emojis.cache.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

  const lines = [
    `# Emoji Export - ${interaction.guild.name}`,
    `# Thời điểm: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    `# Tổng emoji server: ${guildEmojis.length}`,
    `# Slot đã cấu hình: ${configured.length}/${slots.length}`,
    '# Chính sách: bot chỉ dùng custom emoji; không dùng Unicode emoji mặc định.',
    '',
    '## TOÀN BỘ EMOJI TRÊN SERVER',
    ...guildEmojis.map((emoji) => `${emoji.name.padEnd(32)} = ${formattedEmoji(emoji)}`),
    '',
    '## SLOT GIAO DIỆN',
    ...slots.map(([slot, meta]) => `${slot.padEnd(24)} = ${map[slot] || '[chưa gán]'} | ${meta.label}`),
  ];

  const attachment = new AttachmentBuilder(
    Buffer.from(lines.join('\n'), 'utf8'),
    { name: `cenar-custom-emojis-${interaction.guildId}.txt` },
  );

  const container = new ContainerBuilder().setAccentColor(0x7C3AED);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('icon_clipboard')} Kho Emoji Custom Cenar Store`,
      `> ${E('icon_store')} **Emoji trên server:** ${guildEmojis.length}`,
      `> ${E('status_check')} **Slot đã cấu hình:** ${configured.length}/${slots.length}`,
      `> ${E('status_info')} **Vừa tự đồng bộ:** ${syncResult.syncedCount} slot`,
    ].join('\n')),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  if (configured.length) {
    const preview = configured.slice(0, 20)
      .map(([slot, meta]) => `${map[slot]} \`${slot}\` - ${meta.label}`)
      .join('\n');
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E('icon_sparkle')} Slot đang hoạt động\n${preview}`),
    );
  }

  if (missing.length) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${E('status_warn')} ${missing.length} slot chưa có emoji trùng tên/alias; xem file để đổi tên hoặc dùng /emoji-setup.`,
      ),
    );
  }

  await interaction.editReply({
    components: [container],
    files: [attachment],
    flags: MessageFlags.IsComponentsV2,
  });
}
