import { MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { supplierAutobuyRuntime } from '../services/supplierAutobuyRuntime.js';
import {
  buildSupplierAutobuyReply,
  getSupplierAutobuyPanelHealth,
} from '../services/supplierAutobuyPanelService.js';

const PREFIX = 'supplier-autobuy:';
const ACTIONS = new Set(['catalog', 'status']);
const INVALID_PANEL = 'Bảng autobuy này không còn khả dụng. Vui lòng mở bảng mới nhất trong kênh autobuy của Cenar Store.';
const UNAVAILABLE = 'Chưa thể hiển thị thông tin autobuy. Vui lòng thử lại sau; chưa có đơn hàng hoặc thanh toán nào được tạo.';
const NO_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false });

async function replyInvalid(interaction) {
  // Never turn a failed/previously acknowledged interaction into a public reply.
  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.reply({ content: INVALID_PANEL, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
  } catch {
    // Expired interactions and Discord failures must not expose raw payloads.
  }
}

function isCurrentPanel(interaction) {
  if (interaction.guildId !== STORE_ONE_GUILD_ID || config.guildId !== STORE_ONE_GUILD_ID
    || process.env.ENV_FILE !== '.env' || interaction.isButton?.() !== true) return false;
  const panel = getSupplierAutobuyPanelHealth();
  const botId = interaction.client?.user?.id;
  return panel?.status === 'READY'
    && typeof panel.channelId === 'string' && panel.channelId.length > 0
    && typeof panel.messageId === 'string' && panel.messageId.length > 0
    && interaction.channelId === panel.channelId
    && interaction.message?.id === panel.messageId
    && typeof botId === 'string' && botId.length > 0
    && interaction.message?.author?.id === botId;
}

/** Handle only the current Store1 card; both actions read an existing snapshot. */
export async function handleSupplierAutobuyInteraction(interaction) {
  const customId = interaction?.customId;
  if (typeof customId !== 'string' || !customId.startsWith(PREFIX)) return false;
  const action = customId.slice(PREFIX.length);
  try {
    if (!ACTIONS.has(action) || !isCurrentPanel(interaction)) {
      await replyInvalid(interaction);
      return true;
    }
    if (interaction.deferred || interaction.replied) return true;
    // Ack before presentation work. The original response is permanently private.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    return true;
  }

  let payload;
  try {
    payload = buildSupplierAutobuyReply({
      client: interaction.client,
      snapshot: supplierAutobuyRuntime.getHealth(),
      action,
    });
    if (!Array.isArray(payload?.components) || payload.components.length === 0) throw new Error('INVALID_PRESENTATION');
  } catch {
    try {
      await interaction.editReply({ content: UNAVAILABLE, allowedMentions: NO_MENTIONS });
    } catch { /* No public fallback or raw error logging. */ }
    return true;
  }

  try {
    await interaction.editReply({
      components: payload.components,
      // Ephemeral was set by deferReply and cannot be changed by an edit.
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: NO_MENTIONS,
    });
  } catch { /* A failed reply never triggers another request or a public post. */ }
  return true;
}
