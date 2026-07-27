import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createGiveaway, endGiveaway, rerollGiveaway } from '../services/giveawayService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';

function parseDuration(durationStr) {
  const match = durationStr.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const val = parseInt(match[1]);
  const unit = match[2];
  
  if (unit === 's') return val * 1000;
  if (unit === 'm') return val * 60 * 1000;
  if (unit === 'h') return val * 60 * 60 * 1000;
  if (unit === 'd') return val * 24 * 60 * 60 * 1000;
  return null;
}

export const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Quản lý hệ thống Giveaway (Dành cho Admin)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub => 
    sub.setName('start')
       .setDescription('Tạo một Giveaway mới')
       .addStringOption(opt => opt.setName('prize').setDescription('Phần thưởng').setRequired(true))
       .addStringOption(opt => opt.setName('duration').setDescription('Thời gian (vd: 10m, 1h, 2d)').setRequired(true))
       .addIntegerOption(opt => opt.setName('winners').setDescription('Số lượng người thắng').setRequired(false))
  )
  .addSubcommand(sub => 
    sub.setName('end')
       .setDescription('Kết thúc sớm một Giveaway')
       .addStringOption(opt => opt.setName('message_id').setDescription('Message ID của Giveaway').setRequired(true))
  )
  .addSubcommand(sub => 
    sub.setName('reroll')
       .setDescription('Bốc thăm lại người thắng')
       .addStringOption(opt => opt.setName('message_id').setDescription('Message ID của Giveaway').setRequired(true))
  );

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const E = createEmojiResolver(interaction.guildId);

  if (subcommand === 'start') {
    const prize = interaction.options.getString('prize');
    const durationStr = interaction.options.getString('duration');
    const winners = interaction.options.getInteger('winners') || 1;

    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
      return interaction.reply({ content: `${E('status_cross')} Thời gian không hợp lệ! Vui lòng dùng format: \`10m, 1h, 2d\``, ephemeral: true });
    }

    if (durationMs > 30 * 24 * 60 * 60 * 1000) {
      return interaction.reply({ content: `${E('status_cross')} Thời gian tối đa là 30 ngày!`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      await createGiveaway(interaction.client, interaction.channel, interaction.user, prize, winners, durationMs);
      await interaction.editReply(`${E('status_check')} Đã tạo Giveaway thành công!`);
    } catch (e) {
      console.error('[GIVEAWAY] Lỗi tạo giveaway:', e);
      await interaction.editReply(`${E('status_cross')} Có lỗi xảy ra khi tạo Giveaway.`);
    }
  } 
  
  else if (subcommand === 'end') {
    const messageId = interaction.options.getString('message_id');
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const winners = await endGiveaway(interaction.client, messageId);
      if (winners === null) {
        return interaction.editReply(`${E('status_cross')} Không tìm thấy Giveaway ACTIVE nào với ID này!`);
      }
      await interaction.editReply(`${E('status_check')} Đã kết thúc sớm Giveaway!`);
    } catch (e) {
      console.error('[GIVEAWAY] Lỗi kết thúc giveaway:', e);
      await interaction.editReply(`${E('status_cross')} Có lỗi xảy ra khi kết thúc Giveaway.`);
    }
  }

  else if (subcommand === 'reroll') {
    const messageId = interaction.options.getString('message_id');
    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await rerollGiveaway(interaction.client, messageId);
      if (result === true) {
        await interaction.editReply(`${E('status_check')} Đã bốc thăm lại thành công!`);
      } else {
        await interaction.editReply(`${E('status_warn')} ${result}`);
      }
    } catch (e) {
      console.error('[GIVEAWAY] Lỗi reroll giveaway:', e);
      await interaction.editReply(`${E('status_cross')} Có lỗi xảy ra khi bốc thăm lại.`);
    }
  }
}
