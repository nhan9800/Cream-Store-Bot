import { SlashCommandBuilder } from 'discord.js';
import { executeInviteCheck } from './invcheck.js';

// Alias giữ tương thích cho người dùng đã quen lệnh /invites.
export const data = new SlashCommandBuilder()
  .setName('invites')
  .setDescription('Mở tiến độ event invite (khuyên dùng /invcheck)');

export const execute = executeInviteCheck;
