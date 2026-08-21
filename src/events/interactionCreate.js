import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { db } from '../database/db.js';
import { getGuildConfig, upsertGuildConfig } from '../services/guildConfigService.js';
import { getCustomerFlag, getTicketMuteStatus, setTicketMuteStatus } from '../services/blacklistService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { joinGiveaway } from '../services/giveawayService.js';
import {
  cancelOrder,
  getLatestOrderByTicketChannel,
  getOrderByCode,
  getQueuePosition,
  markOrderCompleted,
  setOrderStatus,
  getCompletedOrdersByCustomer,
  claimOrder,
  releaseOrderClaim,
  createOrder,
  saveOrderLogMessage,
  completeWarranty,
} from '../services/orderService.js';
import { publishFeedback } from '../services/feedbackService.js';
import { cancelPayOSPaymentLink, confirmOrderPaidManually, sendOrRefreshPaymentQr } from '../services/paymentService.js';
import { deliverTranscript, sendCompletedFlow, updateOrderLogMessage } from '../services/notificationService.js';
import { closeTicket, closeTicketIfOpen, createTicket, getOpenTicketByCustomer, getTicketByChannelId, getTicketById } from '../services/ticketService.js';
import { exportTicketTranscript } from '../services/transcriptService.js';
import {
  openWarrantyTicket,
  buildWarrantyCustomerConfirmV2,
  buildWarrantyApprovedCustomerV2,
  buildWarrantyReviewedStateV2,
} from '../services/warrantyService.js';
import { resolveSelectMenuEmoji, resolveProductEmoji, formatProductDisplayName } from '../services/emojiService.js';
import {
  handleCtvApplicationApprove,
  handleCtvApplicationReject,
  handleCtvApplyModal,
  handleCtvApplyStart,
  handleCtvApprove,
  handleCtvReject,
  handlePartnerApplyModal,
  handlePartnerApplyStart,
  handlePartnerApprove,
  handlePartnerReject,
} from '../services/partnerAndCtvHandlers.js';
import { isCustomerCtv } from '../services/ctvService.js';
import {
  buildCloseConfirmComponents,
  buildCloseConfirmEmbed,
  buildCredentialEmbeds,
  buildDeliveryCredentialEmbeds,
  buildDeliveryLoginComponents,
  buildFeedbackModalPrompt,
  buildMuteTicketEmbed,
  buildQuickFeedbackAckV2,
  buildQueueStatusText,
  buildTicketControlComponents,
  buildTicketWelcomeEmbed,
  buildWarrantyPanelModalPrompt,
  buildWarrantyProductSelectComponents,
  buildWarrantySelectV2,
} from '../utils/embeds.js';
import { buildTicketWelcomeV2, buildPaymentMethodSelector } from '../utils/embeds.js';
import { buildTicketChannelName, parseMoneyInput, buildOrderLogContent } from '../utils/formatters.js';
import { TICKET_MEMBER_PERMISSIONS, isStaffMember, isManager, assertStaffCapability } from '../utils/permissions.js';
import { ensureRateLimit } from '../services/abuseService.js';
import { keepTicketOpen, scheduleTicketAutoClose } from '../services/ticketService.js';
import { getActiveProducts, getProductById, updateProduct, addProduct, getAllProducts, getProductByName } from '../services/productCatalogService.js';
import { handlePremiumProductInteraction } from '../services/premiumProductSetupService.js';
import { getCenarHub } from '../services/cenarHub.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { isInternationalGuild } from '../utils/locale.js';
import { buildVerificationPromptV2, buildVerificationUnavailableV2 } from '../services/verificationPanelService.js';
import { getRecoveryStatus } from '../services/guildRecoveryService.js';
import { memberHasVerificationRole, resolveVerificationRole } from '../services/verificationRoleService.js';
import { refreshAllShopPanels } from '../services/shopPanelService.js';
import { publishAnnouncement } from '../services/announcementService.js';
import {
  FEEDBACK_TEXT_INPUT_ID,
  WARRANTY_ORDER_INPUT_ID,
  WARRANTY_REASON_INPUT_ID,
  CHAR_TO_SLOT,
  EMOJI_REGEX,
  resolvePayloadEmojis,
  announcementCache,
  ANNOUNCEMENT_CACHE_TTL_MS,
  announcementCacheSet,
  activeTicketCreations,
  activeTicketCloses,
  safeReply,
  completeOrderByCode,
  buildWarrantyPanelModal,
  buildFeedbackModal,
  getTicketCategoryId,
  parsePrice,
  parseCompactSecondaryPrice,
  getDefaultCategoryDetails,
  parseDateInput,
  parsePrefixCommand,
  resolveDecorEmoji,
} from "./shared.js";
import {
  handleBoostBuy,
  handleBoostBuyModal,
  handleBoostCheck,
  handleBoostWarrantyPanel,
  handleBoostCancelButton,
  handleBoostCancelModal,
  handleBoostCancelConfirm,
  handleBoostCompleteButton,
  handleBoostActivateButton,
  handleBoostActivateModal,
  handleBoostWarrantyReq,
  handleBoostWarrantyModal,
} from "./boostHandlers.js";
import {
  handlePriceListSelect,
  handlePriceListAdminEditPortalButton,
  handlePriceListAdminEditPortalModal,
  handlePriceListAdminAddButton,
  handlePriceListAdminAddModal,
  handlePriceListAdminEditCategoryButton,
  handlePriceListAdminEditCategoryModal,
  handlePriceListAdminEditButton,
  handlePriceListAdminSelectProductToEdit,
  handlePriceListAdminEditModal,
} from "./priceListHandlers.js";
import {
  handleProductSelect,
  handleProductPurchaseFlow,
  handleProductEditButton,
  handleProductEditModal,
  handleProductAddModal,
  handleProductSaleModal,
  handleSaleRunModal,
} from "./productHandlers.js";
import {
  handleTicketCreate,
  handleTicketCloseRequest,
  handleTicketClose,
  handleDeliveryClaim,
  handleQueueView,
  handleOrderCancel,
  handleOrderClaim,
  handleKeepOpen,
  handleCreditApply,
  handleCreditRules,
} from "./ticketHandlers.js";
import {
  handleFeedbackButton,
  handleWarrantyProductSelect,
  handleWarrantyReasonModalSubmit,
  handleFeedbackModalSubmit,
  handleWarrantyButton,
} from "./feedbackWarrantyHandlers.js";
import {
  handleSubscriptionAddModal,
  handleSubscriptionRenewButton,
} from "./subscriptionHandlers.js";
import { handleAdminRenewalButton } from '../services/adminRenewalReminderService.js';
import { handleSpotifyFamilyButton } from '../services/spotifyFamilyReminderService.js';
import { handleYoutubeRenewalButton } from '../services/youtubeRenewalReminderService.js';
import {
  handlePrefixQr,
  handlePrefixDone,
  handlePrefixThanhChu,
  isPublicPrefixCommand,
} from "./prefixHandlers.js";
import { handleAnnouncementSelect } from "./announcementHandlers.js";
import { handleOtpInteraction } from "./otpHandlers.js";
import { handleCardSwapInteractions } from "./cardHandlers.js";
import { handleAdminOrderCenterInteraction } from '../services/adminOrderCenterService.js';
import { handleMusicInteraction } from '../services/musicPlayerService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const commandsDirectory = path.resolve(__dirname, '..', 'commands');

async function closeApprovedWarrantyCase({ interaction, ticket, orderCode, ticketChannel = null }) {
  const channel = ticketChannel
    ?? await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
  let transcriptResult = null;
  const closeResult = closeTicketIfOpen(ticket.id, interaction.user.id);

  if (closeResult.closed) {
    transcriptResult = channel?.isTextBased()
      ? await exportTicketTranscript(channel).catch((error) => {
          console.error('[WARRANTY-CLOSE] Transcript error:', error.message);
          return null;
        })
      : null;

    await emitStaffLog(interaction.client, {
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      targetId: ticket.customer_id,
      action: 'WARRANTY_APPROVED_AUTO_CLOSE',
      detail: `Warranty completed and ticket auto-closed: ${ticket.ticket_code}`,
      relatedTicketCode: ticket.ticket_code,
      relatedOrderCode: orderCode,
    }).catch(() => null);

    if (transcriptResult) {
      await deliverTranscript({
        guild: interaction.guild,
        ticket,
        transcriptResult,
        closedById: interaction.user.id,
      }).catch(() => null);
    }
  }

  if (channel?.isTextBased()) {
    if (channel.permissionOverwrites?.edit) {
      await channel.permissionOverwrites.edit(ticket.customer_id, {
        SendMessages: false,
        AddReactions: false,
      }, { reason: `Warranty ${orderCode} completed` }).catch(() => null);
    }
    if (typeof channel.setName === 'function' && !channel.name?.startsWith('closed-')) {
      await channel.setName(`closed-${channel.name}`.slice(0, 95), `Warranty ${orderCode} completed`).catch(() => null);
    }
    setTimeout(() => {
      channel.delete(`Warranty ${orderCode} approved and completed`).catch(() => null);
    }, 5000);
  }

  return { ticket: getTicketById(ticket.id), transcriptResult };
}




export async function loadCommands() {
  const commandFiles = fs.readdirSync(commandsDirectory).filter((file) => file.endsWith('.js')).sort();
  const commands = new Map();

  for (const file of commandFiles) {
    const commandModule = await import(pathToFileURL(path.join(commandsDirectory, file)).href);
    commands.set(commandModule.data.name, commandModule);
  }

  return commands;
}





// Xác định category đúng theo loại ticket


export function registerInteractionHandler(client, commands) {
  client.on(Events.InteractionCreate, async (interaction) => {
    console.log(`[INTERACTION-REC] Type: ${interaction.type} | Command: ${interaction.commandName || 'none'} | CustomID: ${interaction.customId || 'none'} | User: ${interaction.user.tag} (${interaction.user.id})`);
    try {
      if (interaction.guildId) {
        const E = createEmojiResolver(interaction.guildId);
        
        if (typeof interaction.reply === 'function') {
          const originalReply = interaction.reply.bind(interaction);
          interaction.reply = async (payload) => {
            return originalReply(resolvePayloadEmojis(payload, E));
          };
        }
        if (typeof interaction.editReply === 'function') {
          const originalEditReply = interaction.editReply.bind(interaction);
          interaction.editReply = async (payload) => {
            return originalEditReply(resolvePayloadEmojis(payload, E));
          };
        }
        if (typeof interaction.followUp === 'function') {
          const originalFollowUp = interaction.followUp.bind(interaction);
          interaction.followUp = async (payload) => {
            return originalFollowUp(resolvePayloadEmojis(payload, E));
          };
        }
        if (typeof interaction.update === 'function') {
          const originalUpdate = interaction.update.bind(interaction);
          interaction.update = async (payload) => {
            return originalUpdate(resolvePayloadEmojis(payload, E));
          };
        }
        if (typeof interaction.showModal === 'function') {
          const originalShowModal = interaction.showModal.bind(interaction);
          interaction.showModal = async (payload) => {
            return originalShowModal(resolvePayloadEmojis(payload, E));
          };
        }
        // Ticket/order handlers often send a follow-up directly through the
        // channel. Install the same policy once per channel so those messages
        // cannot bypass custom-emoji sanitization.
        if (interaction.channel?.send && !interaction.channel.send.__cenarEmojiPolicy) {
          const originalChannelSend = interaction.channel.send.bind(interaction.channel);
          const wrappedChannelSend = (payload, ...args) => originalChannelSend(resolvePayloadEmojis(payload, E), ...args);
          wrappedChannelSend.__cenarEmojiPolicy = true;
          interaction.channel.send = wrappedChannelSend;
        }
      }

      // ── Autocomplete handler ──
      if (interaction.isAutocomplete()) {
        const command = commands.get(interaction.commandName);
        if (command?.handleAutocomplete) {
          await command.handleAutocomplete(interaction).catch(() =>
            interaction.respond([]).catch(() => null)
          );
        }
        return;
      }

      if (interaction.customId && interaction.customId.startsWith('otp:')) {
        await handleOtpInteraction(interaction);
        return;
      }

      if (interaction.customId && interaction.customId.startsWith('cardswap:')) {
        const handled = await handleCardSwapInteractions(interaction);
        if (handled) return;
      }

      if (interaction.customId && interaction.customId.startsWith('adminorder:')) {
        const handled = await handleAdminOrderCenterInteraction(interaction);
        if (handled) return;
      }

      if (interaction.customId && interaction.customId.startsWith('spotifyfam:')) {
        const handled = await handleSpotifyFamilyButton(interaction);
        if (handled) return;
      }

      if (interaction.customId && interaction.customId.startsWith('ytrenew:')) {
        const handled = await handleYoutubeRenewalButton(interaction);
        if (handled) return;
      }

      if (interaction.customId && interaction.customId.startsWith('music:')) {
        const handled = await handleMusicInteraction(interaction);
        if (handled) return;
      }

      if (interaction.isChatInputCommand()) {
        const command = commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === 'ytb:appeal:modal') {
        const gmail = interaction.fields.getTextInputValue('gmail');
        await handleTicketCreate(interaction, 'APPEAL', gmail);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === 'partner:apply:modal') {
        await handlePartnerApplyModal(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === 'ctv:apply:modal') {
        await handleCtvApplyModal(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('feedback:modal:')) {
        const [, , orderCode, stars] = interaction.customId.split(':');
        await handleFeedbackModalSubmit(interaction, orderCode, stars);
        return;
      }

      // Warranty reason modal: warranty:reason:modal:${orderCode}
      if (interaction.isModalSubmit() && interaction.customId.startsWith('warranty:reason:modal:')) {
        const orderCode = interaction.customId.split(':').slice(3).join(':');
        await handleWarrantyReasonModalSubmit(interaction, orderCode);
        return;
      }

      // Product edit modal: product:edit:modal:${productId}
      if (interaction.isModalSubmit() && interaction.customId.startsWith('product:edit:modal:')) {
        const productId = interaction.customId.split(':')[3];
        await handleProductEditModal(interaction, productId);
        return;
      }

      // Product add modal: product:add:modal
      if (interaction.isModalSubmit() && interaction.customId === 'product:add:modal') {
        await handleProductAddModal(interaction);
        return;
      }

      // Product sale modal: product:sale:modal
      if (interaction.isModalSubmit() && interaction.customId === 'product:sale:modal') {
        await handleProductSaleModal(interaction);
        return;
      }

      // Sale run modal: sale:run:modal:percent
      if (interaction.isModalSubmit() && interaction.customId.startsWith('sale:run:modal:')) {
        await handleSaleRunModal(interaction);
        return;
      }

      // ═══════ Giveaway Handlers ═══════
      if (interaction.isButton() && interaction.customId === 'giveaway:join') {
        await joinGiveaway(interaction, interaction.message.id);
        return;
      }

      // ═══════ Announcement Footer Buttons ═══════
      if (interaction.isButton() && interaction.customId === 'announce_dummy_1') {
        const E = createEmojiResolver(interaction.guildId);
        await interaction.reply({ content: `${E('icon_shop', '🏬')} **Quy Định Chung:**\n- Mọi sản phẩm đều phải tuân thủ chính sách sử dụng của nhà cung cấp.\n- Shop nghiêm cấm các hành vi gian lận (dùng chùa, share acc trái phép).\n- Vui lòng đọc kỹ mô tả sản phẩm trước khi mua.`, ephemeral: true });
        return;
      }

      if (interaction.isButton() && interaction.customId === 'announce_dummy_2') {
        const E = createEmojiResolver(interaction.guildId);
        await interaction.reply({ content: `${E('cr_baohanh', '🛡️')} **Chính Sách Bảo Hành:**\n- Bảo hành 100% thời gian sử dụng đối với lỗi từ nhà cung cấp.\n- Không bảo hành đối với các trường hợp khách hàng tự ý đổi Pass hoặc vi phạm quy định.\n- Vui lòng mở Ticket để được hỗ trợ bảo hành nhanh nhất.`, ephemeral: true });
        return;
      }

      // ═══════ Subscription Modal Handlers ═══════

      if (interaction.isModalSubmit() && interaction.customId.startsWith('sub:add:')) {
        await handleSubscriptionAddModal(interaction);
        return;
      }

      // ═══════ Subscription Button Handlers (customer renewal response) ═══════

      if (interaction.isButton() && interaction.customId.startsWith('sub:admin:')) {
        await handleAdminRenewalButton(interaction);
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith('sub:renew:')) {
        await handleSubscriptionRenewButton(interaction);
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith('sub_order:renew:bill:')) {
        const orderCode = interaction.customId.split(':')[3];
        const { getOrderByCodeRaw } = await import('../services/v11DbHelpers.js');
        const order = getOrderByCodeRaw(orderCode);
        if (order) {
          const customer = await client.users.fetch(order.customer_id).catch(() => null);
          if (customer) {
            const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = await import('discord.js');
            const E = createEmojiResolver(interaction.guildId);
            
            const dmContainer = new ContainerBuilder().setAccentColor(0xED4245);
            dmContainer.addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`# <a:Dotyellow:1481134440725090315> **THÔNG BÁO HẾT HẠN DỊCH VỤ** <a:Dotyellow:1481134440725090315>\n> Gói dịch vụ của bạn đã kết thúc chu kỳ.`)
            );
            dmContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
            dmContainer.addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                `## <:cr_shop:1392749981332541501> **Chi Tiết Gói Đăng Ký**\n` +
                `<a:tsm_fire:1327553120842158111> **Tên Gói:** \`${order.product_name || 'Dịch vụ'}\`\n` +
                `<:Diamond:1485905790903783465> **Mã Đơn:** \`${orderCode}\`\n\n` +
                `*Vui lòng truy cập lại Server của chúng tôi và mở Ticket để gia hạn sớm, tránh bị gián đoạn trải nghiệm!*`
              )
            );
            await customer.send({ components: [dmContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
            await interaction.reply({ content: '✅ Đã gửi DM nhắc khách gia hạn bằng giao diện Component V2!', ephemeral: true });
          } else {
            await interaction.reply({ content: '❌ Không thể tìm thấy khách hàng để DM.', ephemeral: true });
          }
        }
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith('sub_order:renew:kicked:')) {
        const orderCode = interaction.customId.split(':')[3];
        const { markOrderKickedRaw, getOrderByCodeRaw } = await import('../services/v11DbHelpers.js');
        markOrderKickedRaw(orderCode);
        const order = getOrderByCodeRaw(orderCode);
        
        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = await import('discord.js');
        
        const E = createEmojiResolver(interaction.guildId);
        const container = new ContainerBuilder().setAccentColor(0x808080);
        
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## <:cr_baohanh:1348625535512870965> **ĐÃ KICK / NGỪNG GIA HẠN**\n> Đơn \`${orderCode}\` đã được xử lý xong.`)
        );
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`<:cr_shop:1392749981332541501> **Sản phẩm:** \`${order?.product_name || 'Dịch vụ'}\`\n<a:tickgreen:1384069022831874169> Đã xoá khỏi hệ thống cảnh báo.`)
        );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('disabled_yt').setLabel(`Đã xử lý xong`).setStyle(ButtonStyle.Secondary).setDisabled(true)
        );

        await interaction.update({ components: [container, row], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
        return;
      }

      // ═══════ BOOST SERVER MODAL HANDLERS ═══════
      if (interaction.isModalSubmit() && interaction.customId === 'boost:buy:modal') {
        await handleBoostBuyModal(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('boost:cancel:modal:')) {
        const code = interaction.customId.split(':').slice(3).join(':');
        await handleBoostCancelModal(interaction, code);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('boost:activate:modal:')) {
        const code = interaction.customId.split(':').slice(3).join(':');
        await handleBoostActivateModal(interaction, code);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('boost:warranty:modal:')) {
        const code = interaction.customId.split(':').slice(3).join(':');
        await handleBoostWarrantyModal(interaction, code);
        return;
      }

      // Staff check modal
      if (interaction.isModalSubmit() && interaction.customId === 'boost:check:modal_staff') {
        const E_bs = createEmojiResolver(interaction.guildId);
        const codeInput = interaction.fields.getTextInputValue('order_code')?.trim().toUpperCase();
        const { getBoostOrderByCode, getBoostOrdersByCustomer, buildBoostOrderDetailEmbed, buildBoostOrderActionRows } = await import('../services/boostServerService.js');
        const guildConfig = getGuildConfig(interaction.guildId);
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const isStaff = isStaffMember(member, guildConfig);

        let order;
        if (codeInput) {
          order = getBoostOrderByCode(codeInput);
          if (!order || order.guild_id !== interaction.guildId) {
            await interaction.reply({ content: `${E_bs('status_cross')} Không tìm thấy đơn \`${codeInput}\` trong server này.`, ephemeral: true });
            return;
          }
        } else {
          const orders = getBoostOrdersByCustomer(interaction.guildId, interaction.user.id);
          if (!orders.length) {
            await interaction.reply({ content: `${E_bs('status_info')} Bạn chưa có đơn boost nào.`, ephemeral: true });
            return;
          }
          order = orders[0];
        }

        const embed = buildBoostOrderDetailEmbed(order);
        const rows = buildBoostOrderActionRows(order, isStaff);
        await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
        return;
      }

      // Product select dropdown
      if (interaction.isStringSelectMenu() && interaction.customId === 'product:select') {
        await handleProductSelect(interaction);
        return;
      }

      // Announcement select menu handler
      if (interaction.isStringSelectMenu() && interaction.customId === 'select_announcement_item') {
        await handleAnnouncementSelect(interaction);
        return;
      }



      // Product purchase modal
      if (interaction.isModalSubmit() && (interaction.customId === 'product:claude:modal_buy' || interaction.customId === 'product:locket:modal_buy')) {
        await handlePremiumProductInteraction(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('product:purchase:modal:')) {
        const productId = interaction.customId.split(':')[3];
        await handleProductPurchaseFlow(interaction, productId);
        return;
      }

      // ═══════ Price List Dropdown ═══════
      if (interaction.isStringSelectMenu() && interaction.customId === 'price_list:select') {
        await handlePriceListSelect(interaction);
        return;
      }

      // ═══════ Price List Admin Edit Portal Button ═══════
      if (interaction.isButton() && interaction.customId === 'price_list:admin:edit_portal') {
        await handlePriceListAdminEditPortalButton(interaction);
        return;
      }

      // ═══════ Price List Admin Edit Portal Modal Submit ═══════
      if (interaction.isModalSubmit() && interaction.customId === 'price_list:admin:edit_portal_modal') {
        await handlePriceListAdminEditPortalModal(interaction);
        return;
      }

      // ═══════ Price List Admin Add Button ═══════
      if (interaction.isButton() && interaction.customId.startsWith('price_list:admin:add_product:')) {
        const category = interaction.customId.split(':')[3];
        await handlePriceListAdminAddButton(interaction, category);
        return;
      }

      // ═══════ Price List Admin Add Modal Submit ═══════
      if (interaction.isModalSubmit() && interaction.customId.startsWith('price_list:admin:add_modal:')) {
        const category = interaction.customId.split(':')[3];
        await handlePriceListAdminAddModal(interaction, category);
        return;
      }

      // ═══════ Price List Admin Edit Button ═══════
      if (interaction.isButton() && interaction.customId.startsWith('price_list:admin:edit_product:')) {
        const category = interaction.customId.split(':')[3];
        await handlePriceListAdminEditButton(interaction, category);
        return;
      }

      // ═══════ Price List Admin Edit Category Button ═══════
      if (interaction.isButton() && interaction.customId.startsWith('price_list:admin:edit_category:')) {
        const category = interaction.customId.split(':')[3];
        await handlePriceListAdminEditCategoryButton(interaction, category);
        return;
      }

      // ═══════ Price List Admin Edit Category Modal Submit ═══════
      if (interaction.isModalSubmit() && interaction.customId.startsWith('price_list:admin:edit_category_modal:')) {
        const category = interaction.customId.split(':')[3];
        await handlePriceListAdminEditCategoryModal(interaction, category);
        return;
      }

      // ═══════ Price List Admin Select Product to Edit Menu ═══════
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('price_list:admin:select_product_to_edit:')) {
        const category = interaction.customId.split(':')[3];
        await handlePriceListAdminSelectProductToEdit(interaction, category);
        return;
      }

      // ═══════ Price List Admin Edit Modal Submit ═══════
      if (interaction.isModalSubmit() && interaction.customId.startsWith('price_list:admin:edit_modal:')) {
        const productId = interaction.customId.split(':')[3];
        await handlePriceListAdminEditModal(interaction, productId);
        return;
      }

      // Payment method selection buttons
      if (interaction.isButton() && interaction.customId.startsWith('payment:method:')) {
        const parts = interaction.customId.split(':'); // payment:method:<type>:<orderCode>
        const method = parts[2]; // 'payos', 'vietqr' or 'binance'
        const orderCode = parts[3];
        await interaction.deferReply({ flags: 64 });
        try {
          // Disable button ngay để chống spam click
          await interaction.message.edit({ components: [] }).catch(() => null);

          const { sendOrRefreshPaymentQr, sendVietQRPayment } = await import('../services/paymentService.js');
          if (method === 'payos') {
            await sendOrRefreshPaymentQr({ guild: interaction.guild, orderCode });
          } else if (method === 'binance') {
            const { sendOrRefreshBinancePay } = await import('../services/binancePayService.js');
            await sendOrRefreshBinancePay({ guild: interaction.guild, orderCode });
          } else {
            await sendVietQRPayment({ guild: interaction.guild, orderCode });
          }
          const E_pm = createEmojiResolver(interaction.guildId);
          await interaction.editReply(isInternationalGuild(interaction.guildId)
            ? `${E_pm('status_check')} Secure checkout created. Please review it in this ticket.`
            : `${E_pm('status_check')} Đã tạo mã QR thanh toán! Kiểm tra trong ticket nhé.`);
        } catch (err) {
          console.error('[PAYMENT METHOD]', err);
          const E_pm = createEmojiResolver(interaction.guildId);
          await interaction.editReply(isInternationalGuild(interaction.guildId)
            ? `${E_pm('status_warn')} Checkout could not be created: ${err.message}`
            : `${E_pm('status_warn')} Không tạo được QR: ${err.message}`).catch(() => null);
        }
        return;
      }

      // ✏️ Panel Edit button — chỉ manager dùng được
      if (interaction.isButton() && interaction.customId === 'ticket:panel:edit') {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const guildConfig = getGuildConfig(interaction.guildId);
        const E_pe = createEmojiResolver(interaction.guildId);
        if (!isManager(member, guildConfig)) {
          await interaction.reply({ content: `${E_pe('status_cross')} Chỉ **Manager/Admin** mới được chỉnh sửa Panel.`, ephemeral: true });
          return;
        }

        // Nút chỉnh sửa nằm ngay trên panel thật. Ghi nhận lại vị trí này để
        // tự phục hồi cấu hình cũ nếu channel/message trước đó đã bị xóa.
        upsertGuildConfig({
          guild_id: interaction.guildId,
          ticket_panel_channel_id: interaction.channelId,
          ticket_panel_message_id: interaction.message.id,
          updated_by: interaction.user.id,
        });

        const { ModalBuilder, TextInputBuilder, TextInputStyle } = await import('discord.js');
        const modal = new ModalBuilder()
          .setCustomId('ticket:panel:edit:modal')
          .setTitle('Chỉnh Sửa Panel Ticket');

        const titleInput = new TextInputBuilder()
          .setCustomId('panel_title')
          .setLabel('Tiêu đề (bỏ trống = mặc định)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('VD: Cenar Store — Trung Tâm Hỗ Trợ')
          .setValue(guildConfig?.panel_title || '');

        const descInput = new TextInputBuilder()
          .setCustomId('panel_description')
          .setLabel('Mô tả (bỏ trống = mặc định)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder('VD: > Chào mừng bạn đến với shop!\n> Chọn loại ticket phù hợp bên dưới.')
          .setValue(guildConfig?.panel_description || '');

        const imageInput = new TextInputBuilder()
          .setCustomId('panel_image_url')
          .setLabel('URL Ảnh Banner/Thumbnail (bỏ trống = ẩn)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('https://i.imgur.com/...')
          .setValue(guildConfig?.panel_image_url || '');

        const { ActionRowBuilder: AR } = await import('discord.js');
        modal.addComponents(
          new AR().addComponents(titleInput),
          new AR().addComponents(descInput),
          new AR().addComponents(imageInput),
        );
        await interaction.showModal(modal);
        return;
      }

      // ✏️ Panel Edit modal submit
      if (interaction.isModalSubmit() && interaction.customId === 'ticket:panel:edit:modal') {
        await interaction.deferReply({ ephemeral: true });
        const panelTitle = interaction.fields.getTextInputValue('panel_title')?.trim() || null;
        const panelDesc = interaction.fields.getTextInputValue('panel_description')?.trim() || null;
        const panelImage = interaction.fields.getTextInputValue('panel_image_url')?.trim() || null;

        const guildConfig = getGuildConfig(interaction.guildId);
        const updated = upsertGuildConfig({
          guild_id: interaction.guildId,
          panel_title: panelTitle,
          panel_description: panelDesc,
          panel_image_url: panelImage,
          updated_by: interaction.user.id,
        });

        // Cập nhật panel (sửa tin nhắn cũ hoặc gửi tin nhắn mới nếu không tìm thấy)
        try {
          if (updated.ticket_panel_channel_id) {
            const panelChannel = await interaction.guild.channels.fetch(updated.ticket_panel_channel_id).catch(() => null);
            if (panelChannel) {
              const { buildTicketPanelV2 } = await import('../utils/embeds.js');
              const { container, rows, flags } = buildTicketPanelV2({ ...updated, guild_id: interaction.guildId });

              let edited = false;
              if (updated.ticket_panel_message_id) {
                const oldMsg = await panelChannel.messages.fetch(updated.ticket_panel_message_id).catch(() => null);
                if (oldMsg) {
                  await oldMsg.edit({ components: [container, ...rows], flags }).catch(() => null);
                  edited = true;
                }
              }

              if (!edited) {
                // Gửi panel mới nếu không tìm thấy tin nhắn cũ để sửa
                const newMsg = await panelChannel.send({ components: [container, ...rows], flags });
                // Lưu message ID mới vào DB
                upsertGuildConfig({
                  guild_id: interaction.guildId,
                  ticket_panel_message_id: newMsg.id,
                });
              }
            }
          }
        } catch (editErr) {
          console.error('[PANEL EDIT] Lỗi cập nhật panel:', editErr);
        }

        const E_pu = createEmojiResolver(interaction.guildId);
        await interaction.editReply(`${E_pu('status_check')} Panel đã được cập nhật thành công!`);
        return;
      }

      // ═══════ Shop Panel Edit Button ═══════
      if (interaction.isButton() && interaction.customId === 'shop:panel:edit') {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const E_sp = createEmojiResolver(interaction.guildId);
        if (!member || !member.permissions.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({ content: `${E_sp('status_cross')} Chỉ **Admin** mới được chỉnh sửa Panel Shop.`, ephemeral: true });
          return;
        }

        const { getShopPanelByMessageId } = await import('../services/shopPanelService.js');
        const panel = getShopPanelByMessageId(interaction.message.id);

        const modal = new ModalBuilder()
          .setCustomId(`shop:panel:edit:modal:${interaction.message.id}`)
          .setTitle('✏️ Chỉnh Sửa Panel Shop');

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('title')
              .setLabel('Tiêu đề')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setPlaceholder('VD: Discord Nitro')
              .setValue(panel?.title || '')
              .setMaxLength(100)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('image_url')
              .setLabel('Link ảnh Banner')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setPlaceholder('https://i.imgur.com/...')
              .setValue(panel?.image_url || '')
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('features')
              .setLabel('Tính năng (mỗi dòng 1 mục)')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setPlaceholder('ESP + AIM\nChỉ AIM\nSupport HVCI ON')
              .setValue(panel?.features || '')
              .setMaxLength(1000)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('category')
              .setLabel('Danh mục sản phẩm (lọc dropdown)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder('VD: Nitro')
              .setValue(panel?.category || '')
              .setMaxLength(50)
          ),
        );
        await interaction.showModal(modal);
        return;
      }

      // ═══════ Shop Panel Edit Modal Submit ═══════
      if (interaction.isModalSubmit() && interaction.customId.startsWith('shop:panel:edit:modal:')) {
        await interaction.deferReply({ ephemeral: true });
        const messageId = interaction.customId.split(':').slice(4).join(':');
        const title = interaction.fields.getTextInputValue('title')?.trim() || null;
        const imageUrl = interaction.fields.getTextInputValue('image_url')?.trim() || null;
        const features = interaction.fields.getTextInputValue('features')?.trim() || null;
        const category = interaction.fields.getTextInputValue('category')?.trim();

        if (!category) {
          const E_sm = createEmojiResolver(interaction.guildId);
          await interaction.editReply(`${E_sm('status_cross')} Danh mục không được để trống.`);
          return;
        }

        const { getShopPanelByMessageId, updateShopPanel, buildShopPanelV2 } = await import('../services/shopPanelService.js');
        const panel = getShopPanelByMessageId(messageId);

        // Rebuild panel V2
        const { components, flags } = buildShopPanelV2({
          guildId: interaction.guildId,
          category,
          title: title || category,
          imageUrl,
          features,
        });

        try {
          // Tìm và edit message gốc
          const channel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
          if (channel) {
            const msg = await channel.messages.fetch(messageId).catch(() => null);
            if (msg) {
              await msg.edit({ components, flags });
            }
          }

          // Cập nhật DB
          if (panel) {
            updateShopPanel(panel.id, { title: title || category, imageUrl, features, category });
          }

          const E_spu = createEmojiResolver(interaction.guildId);
          await interaction.editReply(`${E_spu('status_check')} Panel Shop đã được cập nhật thành công!`);
        } catch (err) {
          console.error('[SHOP PANEL EDIT]', err);
          const E_spe = createEmojiResolver(interaction.guildId);
          await interaction.editReply(`${E_spe('status_cross')} Lỗi cập nhật: ${err.message}`);
        }
        return;
      }

      // Customer cancel order button
      if (interaction.isButton() && interaction.customId.startsWith('order:cancel_customer:')) {
        await interaction.deferReply({ ephemeral: true });
        const orderCode = interaction.customId.split(':')[2];
        try {
          cancelOrder(orderCode);
          const order = getOrderByCode(orderCode);
          if (order) {
            const ticket = getTicketByChannelId(interaction.channelId);
            if (ticket && ticket.status !== 'CLOSED') {
              closeTicket(ticket.id, interaction.client.user.id);
              const E_cc = createEmojiResolver(interaction.guildId);
              await interaction.channel.send(`${E_cc('status_cross')} Khách hàng đã hủy đơn. Channel sẽ đóng trong giây lát...`);
              setTimeout(() => {
                interaction.channel.delete('Customer cancelled order').catch(() => null);
              }, 5000);
            }
          }
          const E_cc2 = createEmojiResolver(interaction.guildId);
          await interaction.editReply(`${E_cc2('status_check')} Đã hủy đơn hàng và đóng ticket.`);
        } catch (e) {
          const E_cc3 = createEmojiResolver(interaction.guildId);
          await interaction.editReply(`${E_cc3('status_warn')} Lỗi: ${e.message}`);
        }
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === 'ytb:warranty:modal') {
        await interaction.deferReply({ ephemeral: true });
        const E_wl = createEmojiResolver(interaction.guildId);
        try {
          const orderCode = interaction.fields.getTextInputValue('warranty_order_code')?.trim().toUpperCase();
          const customerGmail = interaction.fields.getTextInputValue('warranty_customer_gmail')?.trim();
          const familyOwnerGmail = interaction.fields.getTextInputValue('warranty_family_owner_gmail')?.trim() || 'Không cung cấp';

          if (!orderCode) {
            await interaction.editReply({ content: E_wl('status_warn') + ' Vui lòng điền mã đơn hàng.' });
            return;
          }

          const order = getOrderByCode(orderCode);
          if (!order || order.customer_id !== interaction.user.id) {
            await interaction.editReply({ content: E_wl('status_cross') + ' Không tìm thấy đơn hàng hoặc bạn không phải chủ sở hữu.' });
            return;
          }

          const result = await openWarrantyTicket({
            guild: interaction.guild,
            customerId: interaction.user.id,
            actorId: interaction.user.id,
            orderCode,
            reason: 'Bảo hành YouTube Premium (Tự động)',
            formData: {
              productType: 'YouTube Premium',
              accountInfo: customerGmail,
              password: 'Chủ Family cũ: ' + familyOwnerGmail,
              // Warranty service derives these dates from paid/delivery/expiry
              // metadata so the YouTube flow never prints a hard-coded N/A.
              purchaseDate: null,
              dateExpired: null
            }
          });

          await updateOrderLogMessage(interaction.guild, result.order);
          await interaction.editReply({
            content: result.reused 
              ? E_wl('status_info') + ' Kênh bảo hành của bạn đã tồn tại tại ' + result.channel + '.'
              : E_wl('status_check') + ' Đã mở kênh bảo hành tại ' + result.channel + '. Vui lòng truy cập để được hỗ trợ!'
          });
        } catch (err) {
          console.error('[YOUTUBE-WARRANTY-MODAL] Error:', err.message);
          await interaction.editReply({ content: E_wl('status_cross') + ' Đã xảy ra lỗi: ' + err.message });
        }
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === 'ticket:warranty:panel:modal') {
        // Legacy fallback – không nên xảy ra nhưng giữ để tương thích
        const orderCode = interaction.fields.getTextInputValue('warranty_order_code')?.trim().toUpperCase();
        const reason = interaction.fields.getTextInputValue('warranty_reason')?.trim() || null;
        const E_wl = createEmojiResolver(interaction.guildId);
        if (!orderCode) { await interaction.reply({ content: `${E_wl('status_warn')} Mã đơn trống.`, ephemeral: true }).catch(() => null); return; }
        const order = getOrderByCode(orderCode);
        if (!order || order.customer_id !== interaction.user.id) { await interaction.reply({ content: `${E_wl('status_warn')} Không tìm thấy đơn hoặc không phải chủ sở hữu.`, ephemeral: true }).catch(() => null); return; }
        const result = await openWarrantyTicket({ guild: interaction.guild, customerId: interaction.user.id, actorId: interaction.user.id, orderCode, reason: reason ?? 'Bảo hành từ panel.' });
        await updateOrderLogMessage(interaction.guild, result.order);
        await interaction.reply({ content: result.reused ? `${E_wl('status_info')} Ticket bảo hành đã tồn tại tại ${result.channel}.` : `${E_wl('status_check')} Ticket bảo hành đã mở tại ${result.channel}.`, ephemeral: true }).catch(() => null);
        return;
      }

      if (interaction.isButton() && interaction.customId.startsWith('congno:')) {
        const [, action, customerIdStr, pageStr] = interaction.customId.split(':');
        let page = parseInt(pageStr, 10);
        if (action === 'prev') page--;
        if (action === 'next') page++;
        
        const customerId = customerIdStr === 'all' ? null : customerIdStr;
        
        import('../commands/congno.js').then(async ({ buildCongnoPanel }) => {
          import('discord.js').then(async ({ MessageFlags }) => {
            const payload = buildCongnoPanel(interaction.guildId, customerId, page);
            // Chỉ gắn IsComponentsV2 khi payload có components — tránh xung đột content + flag V2
            await interaction.update({
              ...payload,
              ...(payload.components ? { flags: MessageFlags.IsComponentsV2 } : {}),
            }).catch(() => null);
          });
        });
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === 'announcement:modal') {
        const content = interaction.fields.getTextInputValue('announcement_content');
        
        const roleSelect = new RoleSelectMenuBuilder()
          .setCustomId('announcement:roleselect')
          .setPlaceholder('Gõ phím để tìm role (Discord mặc định chỉ hiện 25 Role)...')
          .setMinValues(0)
          .setMaxValues(10);
          
        const everyoneBtn = new ButtonBuilder()
          .setCustomId('announcement:toggle_everyone')
          .setLabel('Không Tag @everyone')
          .setStyle(ButtonStyle.Secondary);

        const hereBtn = new ButtonBuilder()
          .setCustomId('announcement:toggle_here')
          .setLabel('Không Tag @here')
          .setStyle(ButtonStyle.Secondary);

        const confirmBtn = new ButtonBuilder()
          .setCustomId('announcement:confirm')
          .setLabel('Xác nhận gửi')
          .setStyle(ButtonStyle.Success);

        const editBtn = new ButtonBuilder()
          .setCustomId('announcement:edit')
          .setLabel('Sửa nội dung')
          .setStyle(ButtonStyle.Primary);

        const cancelBtn = new ButtonBuilder()
          .setCustomId('announcement:cancel')
          .setLabel('Hủy')
          .setStyle(ButtonStyle.Danger);

        const embed = new EmbedBuilder()
          .setTitle('Xác nhận thông báo')
          .setDescription(`**Nội dung sẽ gửi:**\n\n${content.substring(0, 4000)}`)
          .setColor(0x3498db)
          .setFields([
            { name: 'Các Role sẽ tag', value: 'Không có (chỉ gửi tin nhắn thường)', inline: false }
          ])
          .setFooter({ text: 'Chọn role bên dưới nếu muốn tag, sau đó bấm Xác nhận gửi.' });
          
        const reply = await interaction.reply({
          embeds: [embed],
          components: [
            new ActionRowBuilder().addComponents(roleSelect),
            new ActionRowBuilder().addComponents(everyoneBtn, hereBtn),
            new ActionRowBuilder().addComponents(confirmBtn, editBtn, cancelBtn)
          ],
          ephemeral: true,
          fetchReply: true
        });
        
        announcementCacheSet(reply.id, {
          content,
          roles: [],
          tagEveryone: false,
          tagHere: false,
          channelId: interaction.channelId
        });
        return;
      }

      if (interaction.isButton() && interaction.customId === 'announcement:edit') {
        const cacheData = announcementCache.get(interaction.message.id);
        if (!cacheData) {
          await safeReply(interaction, { content: 'Phiên bản này đã hết hạn. Vui lòng gõ lại lệnh.', ephemeral: true });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId('announcement:modal')
          .setTitle('Sửa nội dung thông báo');

        const contentInput = new TextInputBuilder()
          .setCustomId('announcement_content')
          .setLabel('Nội dung bạn muốn thông báo')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue(cacheData.content)
          .setMaxLength(3000);

        modal.addComponents(new ActionRowBuilder().addComponents(contentInput));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.isAnySelectMenu() && interaction.customId === 'announcement:roleselect') {
        const cacheData = announcementCache.get(interaction.message.id);
        if (!cacheData) {
          await safeReply(interaction, { content: 'Phiên bản này đã hết hạn. Vui lòng gõ lại lệnh.', ephemeral: true });
          return;
        }
        cacheData.roles = interaction.values;
        
        // Cập nhật Embed hiển thị danh sách các role được tag
        const embed = EmbedBuilder.from(interaction.message.embeds[0]);
        const roleMentions = cacheData.roles.map(r => `<@&${r}>`).join(', ') || 'Không có';
        
        const tags = [];
        if (cacheData.tagEveryone) tags.push('@everyone');
        if (cacheData.tagHere) tags.push('@here');
        const tagSuffix = tags.length > 0 ? ` + ${tags.join(', ')}` : '';

        embed.setFields([
          { name: '🏷️ Các Role sẽ tag', value: `${roleMentions}${tagSuffix}`, inline: false }
        ]);

        const roleSelect = new RoleSelectMenuBuilder()
          .setCustomId('announcement:roleselect')
          .setPlaceholder('Gõ phím để tìm role (Discord mặc định chỉ hiện 25 Role)...')
          .setMinValues(0)
          .setMaxValues(10);
        
        if (cacheData.roles && cacheData.roles.length > 0) {
          roleSelect.setDefaultRoles(...cacheData.roles);
        }

        const everyoneBtn = new ButtonBuilder()
          .setCustomId('announcement:toggle_everyone')
          .setLabel(cacheData.tagEveryone ? 'Đang Tag @everyone' : 'Không Tag @everyone')
          .setStyle(cacheData.tagEveryone ? ButtonStyle.Success : ButtonStyle.Secondary);

        const hereBtn = new ButtonBuilder()
          .setCustomId('announcement:toggle_here')
          .setLabel(cacheData.tagHere ? 'Đang Tag @here' : 'Không Tag @here')
          .setStyle(cacheData.tagHere ? ButtonStyle.Success : ButtonStyle.Secondary);

        const confirmBtn = new ButtonBuilder()
          .setCustomId('announcement:confirm')
          .setLabel('Xác Nhận Gửi')
          .setStyle(ButtonStyle.Success);

        const editBtn = new ButtonBuilder()
          .setCustomId('announcement:edit')
          .setLabel('Sửa nội dung')
          .setStyle(ButtonStyle.Primary);

        const cancelBtn = new ButtonBuilder()
          .setCustomId('announcement:cancel')
          .setLabel('Huy')
          .setStyle(ButtonStyle.Danger);

        await interaction.update({
          embeds: [embed],
          components: [
            new ActionRowBuilder().addComponents(roleSelect),
            new ActionRowBuilder().addComponents(everyoneBtn, hereBtn),
            new ActionRowBuilder().addComponents(confirmBtn, editBtn, cancelBtn)
          ]
        }).catch(() => null);
        return;
      }

      // Warranty product select menu
      if (interaction.isAnySelectMenu() && interaction.customId === 'warranty:product:select') {
        await handleWarrantyProductSelect(interaction);
        return;
      }

      // ═══════ Boost Server Feedback Modal Submit ═══════
      if (interaction.isModalSubmit() && interaction.customId.startsWith('boost:feedback:modal:')) {
        const parts = interaction.customId.split(':');
        const orderCode = parts[3];
        const stars = parseInt(parts[4], 10) || 5;
        const content = interaction.fields.getTextInputValue('feedback_content')?.trim() || 'Không có ý kiến';

        const E = createEmojiResolver(interaction.guildId);
        const { getBoostOrderByCode, updateBoostOrderStatus } = await import('../services/boostServerService.js');
        const order = getBoostOrderByCode(orderCode);

        if (!order) {
          await interaction.reply({ content: E('status_cross') + ' Không tìm thấy đơn hàng boost.', ephemeral: true }).catch(() => null);
          return;
        }

        if (order.customer_id !== interaction.user.id) {
          await interaction.reply({ content: E('status_cross') + ' Bạn không phải chủ sở hữu đơn hàng này.', ephemeral: true }).catch(() => null);
          return;
        }

        if (order.note && order.note.includes('[FEEDBACK_SUBMITTED]')) {
          await interaction.reply({ content: E('status_info') + ' Đơn hàng này đã được đánh giá rồi. Cảm ơn bạn!', ephemeral: true }).catch(() => null);
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        // Đánh dấu đơn đã feedback (giữ nguyên trạng thái hiện tại, chỉ nối cờ vào ghi chú)
        const noteFlag = `[FEEDBACK_SUBMITTED] ${stars}/5`;
        const newNote = order.note ? `${order.note} ${noteFlag}` : noteFlag;
        try {
          updateBoostOrderStatus(order.order_code, order.status, { note: newNote });
        } catch (e) {
          console.error('[BOOST FEEDBACK] Không cập nhật được ghi chú đơn:', e);
        }

        // Đăng feedback vào kênh feedback của server (nếu có)
        const guildConfig = getGuildConfig(interaction.guildId);
        if (guildConfig?.feedback_channel_id) {
          const feedbackChannel = await interaction.guild.channels.fetch(guildConfig.feedback_channel_id).catch(() => null);
          const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
          if (feedbackChannel?.isTextBased() && member) {
            const { buildFeedbackV2 } = await import('../utils/embeds.js');
            const pseudoOrder = {
              order_code: order.order_code,
              guild_id: order.guild_id,
              product_name: `Boost Server — ${order.package}`,
              quantity: 1,
            };
            const { container, flags } = buildFeedbackV2({ member, order: pseudoOrder, stars, content });
            await feedbackChannel.send({ components: [container], flags }).catch(() => null);
          }
        }

        await interaction.editReply({ content: E('status_check') + ` Cảm ơn bạn đã đánh giá ${stars}/5 sao cho đơn boost \`${order.order_code}\`!` }).catch(() => null);
        return;
      }

      if (!interaction.isButton()) return;

      if (interaction.customId.startsWith('product:claude:') || interaction.customId.startsWith('product:locket:')) {
        await handlePremiumProductInteraction(interaction);
        return;
      }

      if (interaction.customId === 'announce:view_price') {
        const guildConfig = getGuildConfig(interaction.guildId);
        if (guildConfig?.price_board_channel_id) {
          return interaction.reply({ content: `👉 Xem Bảng Giá Đầy Đủ tại kênh <#${guildConfig.price_board_channel_id}>`, ephemeral: true });
        }
        return interaction.reply({ content: '👉 Vui lòng xem kênh **BẢNG GIÁ** trong danh sách kênh của server.', ephemeral: true });
      }

      // Xử lý duyệt bảo hành YouTube Premium - Đồng Ý
      if (interaction.customId.startsWith('ytb:approve:')) {
        const parts = interaction.customId.split(':');
        const ticketId = parseInt(parts[2], 10);

        const E = createEmojiResolver(interaction.guildId);
        const guildConfig = getGuildConfig(interaction.guildId);
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        
        if (!isStaffMember(member, guildConfig)) {
          await interaction.reply({ content: E('status_cross') + ' Chỉ Staff mới có quyền duyệt bảo hành.', ephemeral: true }).catch(() => null);
          return;
        }

        await interaction.deferUpdate().catch(() => null);

        try {
          // Truy vấn database SQLite lấy thông tin ticket
          const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
          if (!ticket) {
            await interaction.reply({ content: E('status_cross') + ' Không tìm thấy ticket bảo hành tương ứng trong database.', ephemeral: true }).catch(() => null);
            return;
          }

          let orderCode = ticket.related_order_code;
          if (!orderCode) {
            // 1. Thử trích xuất từ nội dung tin nhắn log (nếu có)
            if (interaction.message && interaction.message.components) {
              for (const row of interaction.message.components) {
                const list = row.components || [];
                for (const comp of list) {
                  const content = comp.content || (comp.data && comp.data.content);
                  if (content) {
                    const orderMatch = content.match(/\*\*Mã đơn hàng:\*\*\s*\*\*([a-zA-Z0-9_-]+)\*\*/i) ||
                                       content.match(/Mã đơn hàng:\s*\*\*([a-zA-Z0-9_-]+)\*\*/i) ||
                                       content.match(/\*\*Mã đơn hàng:\*\*\s*([a-zA-Z0-9_-]+)/i);
                    if (orderMatch && orderMatch[1]) {
                      orderCode = orderMatch[1].toUpperCase();
                      break;
                    }
                  }
                }
                if (orderCode) break;
              }
            }

            // 2. Thử trích xuất từ tên channel của ticket làm fallback tiếp theo
            if (!orderCode) {
              const channel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
              if (channel && channel.name) {
                const match = channel.name.match(/bao-hanh-([a-z0-9_-]+)/i);
                if (match && match[1]) {
                  const suffix = match[1].toUpperCase();
                  let foundOrder = null;
                  if (suffix.includes('_')) {
                    foundOrder = db.prepare("SELECT order_code FROM orders WHERE order_code = ?").get(suffix);
                  } else {
                    foundOrder = db.prepare("SELECT order_code FROM orders WHERE order_code LIKE ?").get(`%_${suffix}`);
                  }

                  if (!foundOrder) {
                    const pathMod = await import('node:path');
                    const fsMod = await import('node:fs');
                    const DatabaseClass = (await import('better-sqlite3')).default;
                    const projectRoot = pathMod.resolve(pathMod.dirname(fileURLToPath(import.meta.url)), '..', '..');
                    const dbPath1 = pathMod.resolve(projectRoot, 'data/shopbot.sqlite');
                    const dbPath2 = pathMod.resolve(projectRoot, 'data/shopbot-store2.sqlite');
                    const otherDbPath = db.name.includes('store2') ? dbPath1 : dbPath2;
                    if (fsMod.existsSync(otherDbPath)) {
                      try {
                        const tempDb = new DatabaseClass(otherDbPath);
                        if (suffix.includes('_')) {
                          foundOrder = tempDb.prepare("SELECT order_code FROM orders WHERE order_code = ?").get(suffix);
                        } else {
                          foundOrder = tempDb.prepare("SELECT order_code FROM orders WHERE order_code LIKE ?").get(`%_${suffix}`);
                        }
                        tempDb.close();
                      } catch (e) {
                        console.error('[DB-CROSS] Lỗi đọc db phụ khi trích xuất code:', e.message);
                      }
                    }
                  }
                  if (foundOrder) {
                    orderCode = foundOrder.order_code;
                  }
                }
              }
            }
          }

          if (!orderCode) {
            await interaction.reply({ content: E('status_cross') + ' Không tìm thấy mã đơn hàng liên quan đến ticket này.', ephemeral: true }).catch(() => null);
            return;
          }

          // Tìm order trong cả 2 database
          let order = null;
          let targetDb = db;
          let isAltDb = false;

          order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(orderCode);
          if (!order) {
            // Thử database còn lại
            const pathMod = await import('node:path');
            const fsMod = await import('node:fs');
            const DatabaseClass = (await import('better-sqlite3')).default;
            
            const projectRoot = pathMod.resolve(pathMod.dirname(fileURLToPath(import.meta.url)), '..', '..');
            const dbPath1 = pathMod.resolve(projectRoot, 'data/shopbot.sqlite');
            const dbPath2 = pathMod.resolve(projectRoot, 'data/shopbot-store2.sqlite');
            const otherDbPath = db.name.includes('store2') ? dbPath1 : dbPath2;
            
            if (fsMod.existsSync(otherDbPath)) {
              try {
                targetDb = new DatabaseClass(otherDbPath);
                order = targetDb.prepare("SELECT * FROM orders WHERE order_code = ?").get(orderCode);
                isAltDb = true;
              } catch (e) {
                console.error('[DB-CROSS] Lỗi kết nối db phụ:', e.message);
              }
            }
          }

          if (!order) {
            if (isAltDb && targetDb) targetDb.close();
            await interaction.reply({ content: E('status_cross') + ` Không tìm thấy đơn hàng \`${orderCode}\` tương ứng trong hệ thống.`, ephemeral: true }).catch(() => null);
            return;
          }

          // Nút duyệt có thể xuất hiện đồng thời ở ticket và kênh log. Trạng
          // thái đơn là khóa idempotency để một hồ sơ không gửi DM/thông báo
          // thành công nhiều lần khi staff bấm ở hai nơi.
          if (order.status !== 'WARRANTY_OPEN') {
            if (isAltDb && targetDb) targetDb.close();
            if (!order.warranty_completed_at) {
              await safeReply(interaction, {
                content: E('status_warn') + ` Hồ sơ này không còn ở trạng thái chờ bảo hành nên không thể duyệt lại.`,
                ephemeral: true,
              });
              return;
            }
            await interaction.editReply({
              ...buildWarrantyReviewedStateV2({
                order,
                ticket,
                reviewerId: interaction.user.id,
                guildId: interaction.guildId,
                state: 'approved',
              }),
              content: null,
              embeds: [],
            }).catch(() => null);
            await closeApprovedWarrantyCase({ interaction, ticket, orderCode }).catch((error) => {
              console.error('[WARRANTY-CLOSE] Idempotent close error:', error.stack || error);
            });
            return;
          }

          const productDisplay = formatProductDisplayName(
            interaction.guildId,
            order.product_name || 'YouTube Premium',
            E,
          ) || 'YouTube Premium';

          // Cập nhật trạng thái đơn hàng về COMPLETED
          let updatedOrder = null;
          let warrantyCompletionApplied = false;
          if (isAltDb) {
            try {
              const now = new Date().toISOString();
              const result = targetDb.prepare("UPDATE orders SET status='COMPLETED', status_changed_at=?, warranty_completed_at=?, warranty_completed_by_id=?, warranty_count=COALESCE(warranty_count,0)+1, updated_at=? WHERE order_code=? AND status='WARRANTY_OPEN'")
                .run(now, now, interaction.user.id, now, orderCode);
              warrantyCompletionApplied = result.changes > 0;
              updatedOrder = targetDb.prepare("SELECT * FROM orders WHERE order_code = ?").get(orderCode);
            } catch (e) {
              console.error('[DB-CROSS] Lỗi update db phụ:', e.message);
              throw e;
            } finally {
              targetDb.close();
            }
          } else {
            const result = completeWarranty(orderCode, interaction.user.id);
            warrantyCompletionApplied = result.completed;
            updatedOrder = result.order;
          }

          // Khóa cập nhật trong database quyết định staff nào xử lý thành công đầu tiên.
          // Click đồng thời ở ticket/log chỉ đóng panel còn lại, không gửi trùng DM/log.
          if (!warrantyCompletionApplied) {
            await interaction.editReply({
              ...buildWarrantyReviewedStateV2({
                order: updatedOrder ?? order,
                ticket,
                reviewerId: updatedOrder?.warranty_completed_by_id || interaction.user.id,
                guildId: interaction.guildId,
                state: 'approved',
              }),
              content: null,
              embeds: [],
            }).catch(() => null);
            await closeApprovedWarrantyCase({ interaction, ticket, orderCode }).catch(() => null);
            return;
          }

          if (updatedOrder) {
            await updateOrderLogMessage(interaction.guild, updatedOrder).catch(() => null);
          }

          // Gửi log vào kênh log bảo hành chung
          if (guildConfig.warranty_log_channel_id) {
            const logChannel = await interaction.guild.channels.fetch(guildConfig.warranty_log_channel_id).catch(() => null);
            if (logChannel?.isTextBased()) {
              const logEmbed = new EmbedBuilder()
                .setColor(0x57F287) // Success green
                .setTitle(`${E('status_check')} ĐÃ DUYỆT BẢO HÀNH YOUTUBE`)
                .setDescription([
                  `> ${E('icon_sparkle')} **Trạng thái:** Duyệt thành công bởi <@${interaction.user.id}>`,
                  '',
                  `${E('ticket_user')} **Khách Hàng:** <@${ticket.customer_id}>`,
                  `${E('order_id')} **Mã Đơn Hàng:** \`${orderCode}\``,
                  `${E('order_product')} **Sản Phẩm:** ${productDisplay}`,
                  `${E('ticket_open')} **Kênh Hỗ Trợ:** <#${ticket.channel_id}>`,
                  `${E('icon_clock')} **Thời Gian:** <t:${Math.floor(Date.now() / 1000)}:F>`
                ].join('\n'))
                .setTimestamp()
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() });

              await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }
          }

          const approvedOrder = updatedOrder ?? { ...order, status: 'COMPLETED' };

          // Gửi DM bằng Components V2 để khách nhận được xác nhận rõ ràng kể
          // cả khi họ không còn mở Discord ở kênh ticket.
          const customer = await interaction.client.users.fetch(ticket.customer_id).catch(() => null);
          if (customer) {
            await customer.send(buildWarrantyApprovedCustomerV2({
              order: approvedOrder,
              ticket,
              reviewerId: interaction.user.id,
              guildId: interaction.guildId,
            })).catch(() => null);
          }

          // Gửi cùng giao diện vào ticket; mention trong TextDisplay được giới
          // hạn đúng customer để không ping nhầm role/everyone.
          const ticketChannel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
          if (ticketChannel?.isTextBased()) {
            const customerNotice = buildWarrantyApprovedCustomerV2({
              order: approvedOrder,
              ticket,
              reviewerId: interaction.user.id,
              guildId: interaction.guildId,
            });
            await ticketChannel.send({
              ...customerNotice,
              allowedMentions: { parse: [], users: [ticket.customer_id] },
            }).catch(() => null);
          }

          // Khóa nút ở chính panel vừa thao tác và thay bằng trạng thái duyệt.
          await interaction.editReply({
            ...buildWarrantyReviewedStateV2({
              order: approvedOrder,
              ticket,
              reviewerId: interaction.user.id,
              guildId: interaction.guildId,
              state: 'approved',
            }),
            content: null,
            embeds: [],
          }).catch(() => null);

          await closeApprovedWarrantyCase({
            interaction,
            ticket,
            orderCode,
            ticketChannel,
          }).catch((error) => {
            console.error('[WARRANTY-CLOSE] Auto-close error:', error.stack || error);
          });
        } catch (err) {
          console.error('[YTB-APPROVE] Error:', err.stack || err);
          await safeReply(interaction, { content: E('status_cross') + ' Lỗi xử lý: ' + err.message, ephemeral: true });
        }
        return;
      }

      // Xử lý duyệt bảo hành YouTube Premium - Từ Chối
      if (interaction.customId.startsWith('ytb:reject:')) {
        const parts = interaction.customId.split(':');
        const ticketId = parseInt(parts[2], 10);

        const E = createEmojiResolver(interaction.guildId);
        const guildConfig = getGuildConfig(interaction.guildId);
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        
        if (!isStaffMember(member, guildConfig)) {
          await interaction.reply({ content: E('status_cross') + ' Chỉ Staff mới có quyền từ chối bảo hành.', ephemeral: true }).catch(() => null);
          return;
        }

        await interaction.deferUpdate().catch(() => null);

        try {
          const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
          if (!ticket) {
            await interaction.reply({ content: E('status_cross') + ' Không tìm thấy ticket bảo hành tương ứng trong database.', ephemeral: true }).catch(() => null);
            return;
          }

          let orderCode = ticket.related_order_code;
          if (!orderCode) {
            // 1. Thử trích xuất từ nội dung tin nhắn log (nếu có)
            if (interaction.message && interaction.message.components) {
              for (const row of interaction.message.components) {
                const list = row.components || [];
                for (const comp of list) {
                  const content = comp.content || (comp.data && comp.data.content);
                  if (content) {
                    const orderMatch = content.match(/\*\*Mã đơn hàng:\*\*\s*\*\*([a-zA-Z0-9_-]+)\*\*/i) ||
                                       content.match(/Mã đơn hàng:\s*\*\*([a-zA-Z0-9_-]+)\*\*/i) ||
                                       content.match(/\*\*Mã đơn hàng:\*\*\s*([a-zA-Z0-9_-]+)/i);
                    if (orderMatch && orderMatch[1]) {
                      orderCode = orderMatch[1].toUpperCase();
                      break;
                    }
                  }
                }
                if (orderCode) break;
              }
            }

            // 2. Thử trích xuất từ tên channel của ticket làm fallback tiếp theo
            if (!orderCode) {
              const channel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
              if (channel && channel.name) {
                const match = channel.name.match(/bao-hanh-([a-z0-9_-]+)/i);
                if (match && match[1]) {
                  const suffix = match[1].toUpperCase();
                  let foundOrder = null;
                  if (suffix.includes('_')) {
                    foundOrder = db.prepare("SELECT order_code FROM orders WHERE order_code = ?").get(suffix);
                  } else {
                    foundOrder = db.prepare("SELECT order_code FROM orders WHERE order_code LIKE ?").get(`%_${suffix}`);
                  }

                  if (!foundOrder) {
                    const pathMod = await import('node:path');
                    const fsMod = await import('node:fs');
                    const DatabaseClass = (await import('better-sqlite3')).default;
                    const projectRoot = pathMod.resolve(pathMod.dirname(fileURLToPath(import.meta.url)), '..', '..');
                    const dbPath1 = pathMod.resolve(projectRoot, 'data/shopbot.sqlite');
                    const dbPath2 = pathMod.resolve(projectRoot, 'data/shopbot-store2.sqlite');
                    const otherDbPath = db.name.includes('store2') ? dbPath1 : dbPath2;
                    if (fsMod.existsSync(otherDbPath)) {
                      try {
                        const tempDb = new DatabaseClass(otherDbPath);
                        if (suffix.includes('_')) {
                          foundOrder = tempDb.prepare("SELECT order_code FROM orders WHERE order_code = ?").get(suffix);
                        } else {
                          foundOrder = tempDb.prepare("SELECT order_code FROM orders WHERE order_code LIKE ?").get(`%_${suffix}`);
                        }
                        tempDb.close();
                      } catch (e) {
                        console.error('[DB-CROSS] Lỗi đọc db phụ khi trích xuất code:', e.message);
                      }
                    }
                  }
                  if (foundOrder) {
                    orderCode = foundOrder.order_code;
                  }
                }
              }
            }
          }

          if (!orderCode) {
            await interaction.reply({ content: E('status_cross') + ' Không tìm thấy mã đơn hàng liên quan đến ticket này.', ephemeral: true }).catch(() => null);
            return;
          }

          // Tìm order trong cả 2 database
          let order = null;
          let targetDb = db;
          let isAltDb = false;

          if (orderCode) {
            order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(orderCode);
            if (!order) {
              const pathMod = await import('node:path');
              const fsMod = await import('node:fs');
              const DatabaseClass = (await import('better-sqlite3')).default;
              
              const projectRoot = pathMod.resolve(pathMod.dirname(fileURLToPath(import.meta.url)), '..', '..');
              const dbPath1 = pathMod.resolve(projectRoot, 'data/shopbot.sqlite');
              const dbPath2 = pathMod.resolve(projectRoot, 'data/shopbot-store2.sqlite');
              
              const otherDbPath = db.name.includes('store2') ? dbPath1 : dbPath2;
              if (fsMod.existsSync(otherDbPath)) {
                try {
                  targetDb = new DatabaseClass(otherDbPath);
                  order = targetDb.prepare("SELECT * FROM orders WHERE order_code = ?").get(orderCode);
                  isAltDb = true;
                } catch (e) {
                  console.error('[DB-CROSS] Lỗi kết nối db phụ khi từ chối:', e.message);
                }
              }
            }
          }

          if (!order) {
            if (isAltDb && targetDb) targetDb.close();
            await interaction.reply({ content: E('status_cross') + ` Không tìm thấy đơn hàng \`${orderCode}\` tương ứng.`, ephemeral: true }).catch(() => null);
            return;
          }

          const productDisplay = formatProductDisplayName(
            interaction.guildId,
            order.product_name || 'YouTube Premium',
            E,
          ) || 'YouTube Premium';

          // Cập nhật trạng thái đơn hàng về COMPLETED
          const updatedOrder = setOrderStatus(orderCode, 'COMPLETED');
          if (updatedOrder) {
            await updateOrderLogMessage(interaction.guild, updatedOrder).catch(() => null);
          }

          // Dùng EmbedBuilder cấp module để tránh shadowing/temporal dead zone.
          const customer = await interaction.client.users.fetch(ticket.customer_id).catch(() => null);
          if (customer) {
            const embedCustomer = new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle(`${E('status_cross')} YÊU CẦU BẢO HÀNH BỊ TỪ CHỐI`)
              .setDescription(
                `> ${E('status_warn')} Đơn hàng \`${orderCode}\` của bạn đã bị từ chối bảo hành.\n\n` +
                `${E('panel_support')} **Hỗ Trợ:** Vui lòng liên hệ staff trong ticket để biết thêm chi tiết.`
              )
              .setTimestamp()
              .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() });

            await customer.send({ embeds: [embedCustomer] }).catch(() => null);
          }

          // Gửi tin nhắn vào kênh ticket của khách hàng
          const ticketChannel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
          if (ticketChannel?.isTextBased()) {
            const embedTicket = new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle(`${E('status_cross')} BẢO HÀNH BỊ TỪ CHỐI`)
              .setDescription(
                `> Chào <@${ticket.customer_id}>, yêu cầu bảo hành cho đơn hàng \`${orderCode}\` của bạn đã bị từ chối.\n\n` +
                `${E('panel_support')} **Hỗ Trợ:** Vui lòng trao đổi trực tiếp với staff trong ticket này để giải quyết.`
              )
              .setTimestamp();

            await ticketChannel.send({ content: `<@${ticket.customer_id}>`, embeds: [embedTicket] }).catch(() => null);
          }

          // Gửi log vào kênh log bảo hành chung
          if (guildConfig.warranty_log_channel_id) {
            const logChannel = await interaction.guild.channels.fetch(guildConfig.warranty_log_channel_id).catch(() => null);
            if (logChannel?.isTextBased()) {
              const logEmbed = new EmbedBuilder()
                .setColor(0xED4245) // Danger red
                .setTitle(`${E('status_cross')} TỪ CHỐI BẢO HÀNH YOUTUBE`)
                .setDescription([
                  `> ${E('status_cross')} **Trạng thái:** Từ chối bởi <@${interaction.user.id}>`,
                  '',
                  `${E('ticket_user')} **Khách Hàng:** <@${ticket.customer_id}>`,
                  `${E('order_id')} **Mã Đơn Hàng:** \`${orderCode}\``,
                  `${E('order_product')} **Sản Phẩm:** ${productDisplay}`,
                  `${E('ticket_open')} **Kênh Hỗ Trợ:** <#${ticket.channel_id}>`,
                  `${E('icon_clock')} **Thời Gian:** <t:${Math.floor(Date.now() / 1000)}:F>`
                ].join('\n'))
                .setTimestamp()
                .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() });

              await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
            }
          }

          // Cập nhật tin nhắn trong kênh duyệt
          const oldEmbed = interaction.message.embeds[0];
          if (oldEmbed) {
            const embed = EmbedBuilder.from(oldEmbed)
              .setColor(0xED4245)
              .setTitle((oldEmbed.title || 'YÊU CẦU BẢO HÀNH YOUTUBE PREMIUM') + ' [ĐÃ TỪ CHỐI]')
              .setDescription((oldEmbed.description || '') + `\n\n${E('status_cross')} **Đã từ chối bảo hành bởi:** <@${interaction.user.id}>`);
            await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
          } else {
            // Đây là V2 Container!
            const { ContainerBuilder, TextDisplayBuilder } = await import('discord.js');
            let originalContent = '';
            if (interaction.message.components && interaction.message.components[0]) {
              const row = interaction.message.components[0];
              const comp = row.components && row.components[0];
              if (comp) {
                originalContent = comp.content || (comp.data && comp.data.content) || '';
              }
            }
            
            const updatedContent = originalContent + `\n\n${E('status_cross')} **Đã từ chối bảo hành bởi:** <@${interaction.user.id}>`;
            const container = new ContainerBuilder().setAccentColor(0xED4245);
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(updatedContent));
            
            await interaction.editReply({
              components: [container],
              flags: MessageFlags.IsComponentsV2
            }).catch(() => null);
          }
        } catch (err) {
          console.error('[YTB-REJECT] Error:', err.stack || err);
          await safeReply(interaction, { content: E('status_cross') + ' Lỗi xử lý: ' + err.message, ephemeral: true });
        }
        return;
      }

      // Xử lý khi khách bấm nút Kháng 12 Tháng YT - Hiện Modal nhập Gmail
      if (interaction.customId === 'ytb:appeal:apply') {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
        const modal = new ModalBuilder()
          .setCustomId('ytb:appeal:modal')
          .setTitle('YÊU CẦU KHÁNG YT 12 THÁNG');

        const gmailInput = new TextInputBuilder()
          .setCustomId('gmail')
          .setLabel('Địa chỉ Gmail bị dính 12 tháng')
          .setPlaceholder('nhap_gmail_cua_ban@gmail.com')
          .setStyle(TextInputStyle.Short)
          .setMinLength(5)
          .setMaxLength(100)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(gmailInput));
        await interaction.showModal(modal).catch(() => null);
        return;
      }

      // Xử lý duyệt kháng 12 tháng - Thành Công
      if (interaction.customId.startsWith('ytb:appeal:approve:')) {
        const parts = interaction.customId.split(':');
        const ticketId = parseInt(parts[3], 10);

        const E = createEmojiResolver(interaction.guildId);
        const guildConfig = getGuildConfig(interaction.guildId);
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        
        if (!isStaffMember(member, guildConfig)) {
          await interaction.reply({ content: E('status_cross') + ' Chỉ Staff mới có quyền duyệt kháng.', ephemeral: true }).catch(() => null);
          return;
        }

        await interaction.deferUpdate().catch(() => null);

        try {
          const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
          if (!ticket) {
            await interaction.reply({ content: E('status_cross') + ' Không tìm thấy ticket tương ứng trong database.', ephemeral: true }).catch(() => null);
            return;
          }

          // Gửi tin nhắn thông báo thành công cho khách hàng qua DM
          const customer = await interaction.client.users.fetch(ticket.customer_id).catch(() => null);
          if (customer) {
            const embedDm = new EmbedBuilder()
              .setColor(0x57F287)
              .setTitle(`<a:tickgreen:1384069022831874169> **KHÁNG CÁO 12 THÁNG THÀNH CÔNG**`)
              .setDescription([
                `Chào <@${ticket.customer_id}>,`,
                '',
                `> **THÔNG TIN CHI TIẾT**`,
                `> <:cr_shop:1392749981332541501> **Mã Ticket:** \`${ticket.ticket_code}\``,
                `> <a:tickgreen:1384069022831874169> **Trạng thái:** \`Thành công\``,
                `> <a:starxoay:1481141954346483845> **Người duyệt:** <@${interaction.user.id}>`,
                '',
                `<a:tsm_fire:1327553120842158111> **Yêu cầu kháng 12 tháng của bạn đã được duyệt thành công!**`,
                `Vui lòng kiểm tra hộp thư **Gmail** của bạn để tham gia vào nhóm gia đình YouTube Premium mới nhé!`,
                '',
                `-# <:purple_heart_glow:1327541911749263360> *Cảm ơn bạn đã tin tưởng Cenar Store!*`
              ].join('\n'))
              .setTimestamp()
              .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() });

            await customer.send({ embeds: [embedDm] }).catch(() => null);
          }

          // Gửi thông báo vào kênh ticket
          const ticketChannel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
          if (ticketChannel?.isTextBased()) {
            const embedChannel = new EmbedBuilder()
              .setColor(0x57F287)
              .setTitle(`<a:tickgreen:1384069022831874169> **KHÁNG CÁO 12 THÁNG THÀNH CÔNG**`)
              .setDescription([
                `### <a:starxoay:1481141954346483845> THÔNG TIN DUYỆT KHÁNG`,
                `> <:cr_shop:1392749981332541501> **Mã Ticket:** \`${ticket.ticket_code}\``,
                `> <a:tickgreen:1384069022831874169> **Trạng thái:** \`Đã hoàn tất\``,
                `> <a:starxoay:1481141954346483845> **Admin xử lý:** <@${interaction.user.id}>`,
                '',
                `**Chào <@${ticket.customer_id}>,**`,
                `*Yêu cầu kháng 12 tháng gia đình YouTube Premium của bạn đã được phê duyệt thành công.*`,
                '',
                `📬 **HƯỚNG DẪN:**`,
                `* Vui lòng truy cập ngay vào hộp thư **Gmail** của bạn.`,
                `* Tìm thư mời gia đình mới và bấm **Chấp nhận lời mời** để khôi phục Premium.`,
                '',
                `⚠️ **LƯU Ý QUAN TRỌNG:**`,
                `> <a:redload:1459179959158571119> Luồng hỗ trợ riêng tư này sẽ **tự động đóng và lưu trữ sau 1 phút**.`
              ].join('\n'))
              .setTimestamp()
              .setFooter({ text: `${interaction.guild.name} · Hỗ Trợ Kháng Cáo`, iconURL: interaction.guild.iconURL() });

            await ticketChannel.send({ content: `<@${ticket.customer_id}>`, embeds: [embedChannel] }).catch(() => null);
          }

          // Cập nhật nút bấm thành trạng thái đã duyệt
          await interaction.editReply({
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId('disabled_approved')
                  .setLabel('Đã Duyệt Kháng Thành Công')
                  .setStyle(ButtonStyle.Success)
                  .setEmoji('1384069022831874169')
                  .setDisabled(true)
              )
            ]
          }).catch(() => null);

          // Tự động đóng ticket sau 1 phút (60000 ms)
          setTimeout(async () => {
            try {
              const thread = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
              if (thread) {
                // Đóng ticket trong DB
                closeTicket(ticket.id, interaction.client.user.id);

                const closeEmbed = new EmbedBuilder()
                  .setColor(0xED4245)
                  .setTitle(`<a:tick_red51:1384069065626222632> **LUỒNG KHÁNG CÁO ĐÃ ĐÓNG**`)
                  .setDescription([
                    `> <:cr_shop:1392749981332541501> **Mã Ticket:** \`${ticket.ticket_code}\``,
                    `> <a:tick_red51:1384069065626222632> **Trạng thái:** \`Đóng tự động sau 1 phút duyệt thành công\``,
                    '',
                    `Luồng hỗ trợ này đã hoàn thành nhiệm vụ và hiện đang được hệ thống tự động lưu trữ / xóa.`,
                    `Bản lưu tin nhắn (transcript) đã được xuất và gửi về trung tâm điều hành.`
                  ].join('\n'))
                  .setTimestamp()
                  .setFooter({ text: thread.guild.name, iconURL: thread.guild.iconURL() });
                
                await thread.send({ embeds: [closeEmbed] }).catch(() => null);

                // Xuất transcript
                const transcriptResult = await exportTicketTranscript(thread).catch(() => null);
                if (transcriptResult) {
                  await deliverTranscript({ guild: interaction.guild, ticket, transcriptResult, closedById: interaction.client.user.id });
                }

                // Xóa thread hoặc lưu trữ
                setTimeout(async () => {
                  await thread.delete('Tự động xóa sau 1 phút duyệt thành công').catch(async () => {
                    await thread.setArchived(true, 'Tự động lưu trữ sau 1 phút duyệt thành công').catch(() => null);
                  });
                }, 2000);
              }
            } catch (e) {
              console.error('[AUTO-CLOSE-APPEAL] Lỗi tự động đóng:', e.message);
            }
          }, 60000);

        } catch (err) {
          console.error('[YTB-APPEAL-APPROVE] Error:', err.message);
          await safeReply(interaction, { content: E('status_cross') + ' Lỗi: ' + err.message, ephemeral: true });
        }
        return;
      }

      // Xử lý duyệt kháng 12 tháng - Thất Bại / Yêu Cầu Đổi Mail
      if (interaction.customId.startsWith('ytb:appeal:reject:')) {
        const parts = interaction.customId.split(':');
        const ticketId = parseInt(parts[3], 10);

        const E = createEmojiResolver(interaction.guildId);
        const guildConfig = getGuildConfig(interaction.guildId);
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        
        if (!isStaffMember(member, guildConfig)) {
          await interaction.reply({ content: E('status_cross') + ' Chỉ Staff mới có quyền thao tác.', ephemeral: true }).catch(() => null);
          return;
        }

        await interaction.deferUpdate().catch(() => null);

        try {
          const ticket = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
          if (!ticket) {
            await interaction.reply({ content: E('status_cross') + ' Không tìm thấy ticket tương ứng trong database.', ephemeral: true }).catch(() => null);
            return;
          }

          // Gửi tin nhắn thông báo thất bại cho khách hàng qua DM
          const customer = await interaction.client.users.fetch(ticket.customer_id).catch(() => null);
          if (customer) {
            const embedDm = new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle(`<a:tick_red51:1384069065626222632> KHÁNG CÁO 12 THÁNG THẤT BẠI`)
              .setDescription(
                `Chào <@${ticket.customer_id}>,\n\n` +
                `> <:cr_shop:1392749981332541501> **Mã Ticket:** \`${ticket.ticket_code}\`\n` +
                `> <a:tick_red51:1384069065626222632> **Trạng thái:** Thất bại / Yêu cầu đổi Mail\n\n` +
                `❌ Rất tiếc, lượt kháng cáo này không thành công.\n` +
                `Bạn bắt buộc phải **đổi sang Gmail mới** hoặc **chờ 7 - 15 ngày** để bắt đầu lượt kháng tiếp theo.`
              )
              .setTimestamp()
              .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() });

            await customer.send({ embeds: [embedDm] }).catch(() => null);
          }

          // Gửi thông báo vào kênh ticket
          const ticketChannel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
          if (ticketChannel?.isTextBased()) {
            const embedChannel = new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle(`<a:tick_red51:1384069065626222632> KHÁNG CÁO 12 THÁNG THẤT BẠI`)
              .setDescription(
                `Chào <@${ticket.customer_id}>,\n\n` +
                `> <:cr_shop:1392749981332541501> **Mã Ticket:** \`${ticket.ticket_code}\`\n` +
                `> <a:tick_red51:1384069065626222632> **Trạng thái:** Thất bại / Yêu cầu đổi Mail\n\n` +
                `❌ Rất tiếc, lượt kháng cáo này không thành công.\n` +
                `Bạn bắt buộc phải **đổi sang Gmail mới** hoặc **chờ 7 - 15 ngày** để bắt đầu lượt kháng tiếp theo.`
              )
              .setTimestamp()
              .setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() });

            await ticketChannel.send({ content: `<@${ticket.customer_id}>`, embeds: [embedChannel] }).catch(() => null);
          }

          // Cập nhật nút bấm thành trạng thái đã từ chối
          await interaction.editReply({
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId('disabled_rejected')
                  .setLabel('Đã Từ Chối / Yêu Cầu Đổi Mail')
                  .setStyle(ButtonStyle.Danger)
                  .setEmoji('1384069065626222632')
                  .setDisabled(true)
              )
            ]
          }).catch(() => null);

         } catch (err) {
          console.error('[YTB-APPEAL-REJECT] Error:', err.message);
          await safeReply(interaction, { content: E('status_cross') + ' Lỗi: ' + err.message, ephemeral: true });
        }
        return;
      }

      // Xử lý khi khách bấm nút sao feedback đơn boost
      if (interaction.customId.startsWith('boost:feedback:start:')) {
        const parts = interaction.customId.split(':');
        const orderCode = parts[3];
        const starsRaw = parts[4];
        const stars = parseInt(starsRaw, 10) || 5;

        const E = createEmojiResolver(interaction.guildId);
        const { getBoostOrderByCode } = await import('../services/boostServerService.js');
        const order = getBoostOrderByCode(orderCode);

        if (!order) {
          await interaction.reply({ content: E('status_cross') + ' Không tìm thấy đơn hàng boost.', ephemeral: true }).catch(() => null);
          return;
        }

        if (order.customer_id !== interaction.user.id) {
          await interaction.reply({ content: E('status_cross') + ' Bạn không phải chủ sở hữu đơn hàng này.', ephemeral: true }).catch(() => null);
          return;
        }

        if (order.note && order.note.includes('[FEEDBACK_SUBMITTED]')) {
          await interaction.reply({ content: E('status_info') + ' Đơn hàng này đã được đánh giá rồi. Cảm ơn bạn!', ephemeral: true }).catch(() => null);
          return;
        }

        // Hiện modal đánh giá
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
        const modal = new ModalBuilder()
          .setCustomId(`boost:feedback:modal:${orderCode}:${stars}`)
          .setTitle(`Đánh Giá Đơn Boost ${orderCode}`);

        const textInput = new TextInputBuilder()
          .setCustomId('feedback_content')
          .setLabel(`Cảm nhận của bạn (${stars}/5 sao)`)
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Nhập ý kiến đóng góp của bạn về dịch vụ...')
          .setRequired(true)
          .setMaxLength(500);

        modal.addComponents(new ActionRowBuilder().addComponents(textInput));
        await interaction.showModal(modal).catch(console.error);
        return;
      }

      if (interaction.customId === 'ytb:warranty:apply') {
        const E_wl = createEmojiResolver(interaction.guildId);
        try {
          const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
          const modal = new ModalBuilder()
            .setCustomId('ytb:warranty:modal')
            .setTitle('Yêu Cầu Bảo Hành YouTube');

          const orderInput = new TextInputBuilder()
            .setCustomId('warranty_order_code')
            .setLabel('Mã đơn hàng (ví dụ: CN_123456)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('CN_xxxxxx hoặc BST_xxxxxx')
            .setMaxLength(20);

          const gmailInput = new TextInputBuilder()
            .setCustomId('warranty_customer_gmail')
            .setLabel('Gmail cần bảo hành của bạn')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('gmailcua-ban@gmail.com')
            .setMaxLength(100);

          const familyInput = new TextInputBuilder()
            .setCustomId('warranty_family_owner_gmail')
            .setLabel('Gmail chủ Family cũ (nếu có)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('gmail-chu-family@gmail.com')
            .setMaxLength(100);

          modal.addComponents(
            new ActionRowBuilder().addComponents(orderInput),
            new ActionRowBuilder().addComponents(gmailInput),
            new ActionRowBuilder().addComponents(familyInput)
          );

          await interaction.showModal(modal);
        } catch (err) {
          console.error('[YOUTUBE-WARRANTY-CLICK] Error:', err.message);
          await interaction.reply({ content: E_wl('status_cross') + ' Không thể hiển thị modal bảo hành: ' + err.message, ephemeral: true }).catch(() => null);
        }
        return;
      }

      if (interaction.customId === 'partner:apply:start') {
        await handlePartnerApplyStart(interaction);
        return;
      }

      if (interaction.customId.startsWith('partner:approve:')) {
        const appId = interaction.customId.split(':')[2];
        await handlePartnerApprove(interaction, appId);
        return;
      }

      if (interaction.customId.startsWith('partner:reject:')) {
        const appId = interaction.customId.split(':')[2];
        await handlePartnerReject(interaction, appId);
        return;
      }

      if (interaction.customId === 'ctv:apply:start') {
        await handleCtvApplyStart(interaction);
        return;
      }

      if (interaction.customId.startsWith('ctv:approve-app:')) {
        const applicationId = interaction.customId.split(':')[2];
        await handleCtvApplicationApprove(interaction, applicationId);
        return;
      }

      if (interaction.customId.startsWith('ctv:reject-app:')) {
        const applicationId = interaction.customId.split(':')[2];
        await handleCtvApplicationReject(interaction, applicationId);
        return;
      }

      if (interaction.customId.startsWith('ctv:approve:')) {
        const applicantId = interaction.customId.split(':')[2];
        await handleCtvApprove(interaction, applicantId);
        return;
      }

      if (interaction.customId.startsWith('ctv:reject:')) {
        const applicantId = interaction.customId.split(':')[2];
        await handleCtvReject(interaction, applicantId);
        return;
      }

      if (interaction.customId === 'announcement:toggle_everyone' || interaction.customId === 'announcement:toggle_here') {
          const cacheData = announcementCache.get(interaction.message.id);
          if (!cacheData) {
              await interaction.update({ content: 'Phien thao tac da het han.', embeds: [], components: [] }).catch(() => null);
              return;
          }
          const isEveryone = interaction.customId === 'announcement:toggle_everyone';
          if (isEveryone) cacheData.tagEveryone = !cacheData.tagEveryone;
          else cacheData.tagHere = !cacheData.tagHere;
          
          // Cập nhật Embed hiển thị danh sách các role được tag
          const embed = EmbedBuilder.from(interaction.message.embeds[0]);
          const roleMentions = cacheData.roles.map(r => `<@&${r}>`).join(', ') || 'Không có';

          const tags = [];
          if (cacheData.tagEveryone) tags.push('@everyone');
          if (cacheData.tagHere) tags.push('@here');
          const tagSuffix = tags.length > 0 ? ` + ${tags.join(', ')}` : '';

          embed.setFields([
            { name: 'Các Role sẽ tag', value: `${roleMentions}${tagSuffix}`, inline: false }
          ]);

          const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId('announcement:roleselect')
            .setPlaceholder('Gõ phím để tìm role (Discord mặc định chỉ hiện 25 Role)...')
            .setMinValues(0)
            .setMaxValues(10);

          if (cacheData.roles && cacheData.roles.length > 0) {
            roleSelect.setDefaultRoles(...cacheData.roles);
          }

          const everyoneBtn = new ButtonBuilder()
            .setCustomId('announcement:toggle_everyone')
            .setLabel(cacheData.tagEveryone ? 'Đang Tag @everyone' : 'Không Tag @everyone')
            .setStyle(cacheData.tagEveryone ? ButtonStyle.Success : ButtonStyle.Secondary);

          const hereBtn = new ButtonBuilder()
            .setCustomId('announcement:toggle_here')
            .setLabel(cacheData.tagHere ? 'Đang Tag @here' : 'Không Tag @here')
            .setStyle(cacheData.tagHere ? ButtonStyle.Success : ButtonStyle.Secondary);

          const confirmBtn = new ButtonBuilder()
            .setCustomId('announcement:confirm')
            .setLabel('Xác Nhận Gửi')
            .setStyle(ButtonStyle.Success);

          const editBtn = new ButtonBuilder()
            .setCustomId('announcement:edit')
            .setLabel('Sửa nội dung')
            .setStyle(ButtonStyle.Primary);
            
          const cancelBtn = new ButtonBuilder()
            .setCustomId('announcement:cancel')
            .setLabel('Hủy')
            .setStyle(ButtonStyle.Danger);

          await interaction.update({
            embeds: [embed],
            components: [
              new ActionRowBuilder().addComponents(roleSelect),
              new ActionRowBuilder().addComponents(everyoneBtn, hereBtn),
              new ActionRowBuilder().addComponents(confirmBtn, editBtn, cancelBtn)
            ]
          }).catch(() => null);
          return;
      }

      ensureRateLimit({ guildId: interaction.guildId, userId: interaction.user.id, action: `BUTTON_${interaction.customId.split(':')[0]}`, limit: 1, windowSeconds: config.buttonCooldownSeconds, message: 'Bạn bấm nút quá nhanh, vui lòng chờ vài giây.' });

      if (interaction.customId === 'oauth:verify:button') {
        const E = createEmojiResolver(interaction.guildId);
        if (!String(process.env.CLIENT_SECRET || '').trim() || !String(process.env.ENCRYPTION_KEY || '').trim()) {
          await safeReply(interaction, buildVerificationUnavailableV2(interaction.guildId));
          return;
        }
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const verificationRole = resolveVerificationRole(interaction.guild);
        const hasRole = memberHasVerificationRole(member, verificationRole);
        const recovery = getRecoveryStatus(interaction.guildId, interaction.user.id);
        const recoveryActive = Boolean(recovery?.recovery_consent_at && String(recovery.scopes || '').includes('guilds.join'));
        const host = String(config.publicBaseUrl || '').trim().replace(/\/$/, '');

        if (!host && !recoveryActive) {
          await safeReply(interaction, {
            content: `${E('status_cross')} Hệ thống OAuth đang thiếu PUBLIC_BASE_URL. Vui lòng báo quản trị viên cấu hình trước khi xác minh.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await safeReply(interaction, buildVerificationPromptV2({
          guildId: interaction.guildId,
          username: interaction.user.username,
          loginUrl: host ? `${host}/oauth/login?guild_id=${interaction.guildId}` : null,
          hasRole,
          recoveryActive,
        }));
        return;
      }

      if (interaction.customId.startsWith('ticket:create:')) {
        const [, , ticketType] = interaction.customId.split(':');
        await handleTicketCreate(interaction, ticketType);
        return;
      }
      
      if (interaction.customId === 'ticket:credit_apply') {
        return await handleCreditApply(interaction);
      }

      if (interaction.customId === 'ticket:credit_rules') {
        return await handleCreditRules(interaction);
      }

      if (interaction.customId === 'ticket:create') {
        await handleTicketCreate(interaction, 'ORDER');
        return;
      }

      if (interaction.customId === 'ticket:warranty:panel') {
        // Thay vì modal, hiện SelectMenu với đơn hàng đã hoàn thành
        const completedOrders = getCompletedOrdersByCustomer(interaction.guildId, interaction.user.id, 25);
        if (!completedOrders.length) {
          const E_wp = createEmojiResolver(interaction.guildId);
          await safeReply(interaction, {
            content: `${E_wp('status_warn')} Bạn chưa có đơn hàng hoàn thành nào để bảo hành. Liên hệ staff nếu cần hỗ trợ.`,
            ephemeral: true,
          });
          return;
        }
        {
          const { container, flags } = buildWarrantySelectV2(interaction.guildId);
          await safeReply(interaction, {
            components: [container, ...buildWarrantyProductSelectComponents(completedOrders, interaction.guildId)],
            flags: flags | MessageFlags.Ephemeral,
          });
        }
        return;
      }

      if (interaction.customId === 'announcement:cancel') {
         announcementCache.delete(interaction.message.id);
         await interaction.update({ content: 'Đã huỷ đăng thông báo.', embeds: [], components: [] }).catch(() => null);
         return;
      }

      if (interaction.customId === 'announcement:confirm') {
         const cacheData = announcementCache.get(interaction.message.id);
         if (!cacheData) {
           await interaction.update({ content: 'Phiên thao tác này đã hết hạn. Vui lòng gõ lại lệnh `/thongbao`.', embeds: [], components: [] }).catch(() => null);
           return;
         }

         if (cacheData.publishing) {
           await interaction.deferUpdate().catch(() => null);
           return;
         }
         cacheData.publishing = true;

         // ACK ngay để tránh timeout 3 giây Discord
         await interaction.deferUpdate();

         try {
           const result = await publishAnnouncement({
             guild: interaction.guild,
             channelId: cacheData.channelId,
             content: cacheData.content,
             roleIds: cacheData.roles,
             tagEveryone: cacheData.tagEveryone,
             tagHere: cacheData.tagHere,
           });

           announcementCache.delete(interaction.message.id);
           const E = createEmojiResolver(interaction.guildId);
           const priceBoardLine = result.pricingRelated
             ? (result.priceBoard?.status === 'published' || result.priceBoard?.status === 'current'
               ? `\n${E('status_check')} Bảng giá đã được đồng bộ tại <#${result.priceBoard.channelId}>.`
               : `\n${E('status_warn')} Thông báo đã lên, nhưng bảng giá chưa thể đồng bộ (${result.priceBoard?.error || result.priceBoard?.status || 'không rõ lỗi'}).`)
             : '';
           await interaction.editReply({
             content: `${E('status_check')} Đã đăng thông báo thành công tại <#${result.channel.id}>.${priceBoardLine}`,
             embeds: [],
             components: [],
           });
         } catch (err) {
           cacheData.publishing = false;
           console.error('[ANNOUNCEMENT_CONFIRM] Không thể đăng thông báo:', {
             guildId: interaction.guildId,
             channelId: cacheData.channelId,
             userId: interaction.user.id,
             code: err?.code,
             message: err?.message,
             stack: err?.stack,
           });
           const E = createEmojiResolver(interaction.guildId);
           await interaction.editReply({
             content: `${E('status_cross')} Không thể đăng thông báo: ${err.message}\nBạn có thể bấm **Xác nhận gửi** để thử lại sau khi khắc phục.`,
             embeds: [],
             components: interaction.message.components,
           }).catch((replyError) => {
             console.error('[ANNOUNCEMENT_CONFIRM] Không thể trả lỗi cho người dùng:', replyError);
           });
         }
         return;
      }

      // Close ticket confirmation flow
      if (interaction.customId.startsWith('ticket:close:')) {
        const parts = interaction.customId.split(':');
        // ticket:close:confirm:${ticketId}
        if (parts[2] === 'confirm') {
          await handleTicketClose(interaction, parts[3]);
          return;
        }
        // ticket:close:cancel
        if (parts[2] === 'cancel') {
          const E_tc = createEmojiResolver(interaction.guildId);
          await interaction.update({ content: `${E_tc('status_cross')} Đã hủy đóng ticket.`, embeds: [], components: [] }).catch(() => null);
          return;
        }
        // ticket:close:${ticketId} → hiện confirmation
        await handleTicketCloseRequest(interaction, parts[2]);
        return;
      }

      // Mute ticket button
      if (interaction.customId.startsWith('ticket:mute:')) {
        const [, , customerId] = interaction.customId.split(':');
        const guildConfig = getGuildConfig(interaction.guildId);
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const E_tm = createEmojiResolver(interaction.guildId);
        if (!isManager(member, guildConfig)) {
          await safeReply(interaction, { content: `${E_tm('status_cross')} Chỉ **Admin / Manager** mới có thể mute user.`, ephemeral: true });
          return;
        }
        const current = getTicketMuteStatus(interaction.guildId, customerId);
        const newMuted = !current.is_ticket_muted;
        setTicketMuteStatus(interaction.guildId, customerId, newMuted, interaction.user.id, newMuted ? 'Admin mute từ ticket' : null);
        const target = await interaction.client.users.fetch(customerId).catch(() => null);
        if (target) {
          await safeReply(interaction, { embeds: [buildMuteTicketEmbed(target, newMuted, newMuted ? 'Admin mute từ ticket' : null, interaction.user.id)], ephemeral: true });
        } else {
          await safeReply(interaction, { content: newMuted ? `${E_tm('status_check')} Đã mute user \`${customerId}\` khỏi ticket.` : `${E_tm('status_check')} Đã bỏ mute user \`${customerId}\`.`, ephemeral: true });
        }
        return;
      }

      if (interaction.customId.startsWith('ticket:warranty:')) {
        const [, , orderCode] = interaction.customId.split(':');
        await handleWarrantyButton(interaction, orderCode);
        return;
      }

      if (interaction.customId.startsWith('delivery:claim:')) {
        const [, , orderCode] = interaction.customId.split(':');
        await handleDeliveryClaim(interaction, orderCode);
        return;
      }

      if (interaction.customId.startsWith('queue:view:')) {
        const [, , orderCode] = interaction.customId.split(':');
        await handleQueueView(interaction, orderCode);
        return;
      }

      if (interaction.customId.startsWith('payment:regen:')) {
        const [, , orderCode] = interaction.customId.split(':');
        await interaction.deferReply({ flags: 64 });
        try {
          const { regeneratePaymentQr } = await import('../services/paymentService.js');
          await regeneratePaymentQr({ guild: interaction.guild, orderCode });
          const E_pr = createEmojiResolver(interaction.guildId);
          await interaction.editReply(`${E_pr('status_check')} Đã tạo hoá đơn mới! Quét mã QR mới trong ticket để thanh toán nhé.`);
        } catch (err) {
          console.error('[PAYMENT REGEN]', err.message);
          const E_pr = createEmojiResolver(interaction.guildId);
          await interaction.editReply(`${E_pr('status_warn')} Không tạo được hoá đơn mới: ${err.message}`).catch(() => null);
        }
        return;
      }

      if (interaction.customId.startsWith('order:cancel:')) {
        const [, , orderCode] = interaction.customId.split(':');
        await handleOrderCancel(interaction, orderCode);
        return;
      }

      if (interaction.customId.startsWith('order:claim:')) {
        const [, , orderCode] = interaction.customId.split(':');
        await handleOrderClaim(interaction, orderCode);
        return;
      }

      if (interaction.customId.startsWith('ticket:keepopen:')) {
        const [, , ticketId] = interaction.customId.split(':');
        await handleKeepOpen(interaction, ticketId);
        return;
      }

      if (interaction.customId.startsWith('product:edit:')) {
        const [, , productId] = interaction.customId.split(':');
        await handleProductEditButton(interaction, productId);
        return;
      }

      if (interaction.customId.startsWith('feedback:quick:')) {
        const [, , orderCode, stars] = interaction.customId.split(':');
        await handleFeedbackButton(interaction, orderCode, stars);
        return;
      }

      // ═══════════════════════════════════════════════
      // ═══════ BOOST SERVER BUTTON HANDLERS ══════════
      // ═══════════════════════════════════════════════

      if (interaction.customId === 'boost:buy') {
        await handleBoostBuy(interaction);
        return;
      }

      if (interaction.customId === 'boost:check') {
        await handleBoostCheck(interaction);
        return;
      }

      if (interaction.customId === 'boost:warranty') {
        await handleBoostWarrantyPanel(interaction);
        return;
      }

      if (interaction.customId.startsWith('boost:cancel:')) {
        const code = interaction.customId.split(':').slice(2).join(':');
        await handleBoostCancelButton(interaction, code);
        return;
      }

      if (interaction.customId.startsWith('boost:cancel_confirm:')) {
        const code = interaction.customId.split(':').slice(2).join(':');
        await handleBoostCancelConfirm(interaction, code);
        return;
      }

      if (interaction.customId.startsWith('boost:complete:')) {
        const code = interaction.customId.split(':').slice(2).join(':');
        await handleBoostCompleteButton(interaction, code);
        return;
      }

      if (interaction.customId.startsWith('boost:activate:')) {
        const code = interaction.customId.split(':').slice(2).join(':');
        await handleBoostActivateButton(interaction, code);
        return;
      }

      if (interaction.customId.startsWith('boost:warranty_req:')) {
        const code = interaction.customId.split(':').slice(2).join(':');
        await handleBoostWarrantyReq(interaction, code);
        return;
      }

      // Nút bảo hành cũ (panel đời trước) — customId đã đổi, chuyển hướng sang luồng mới
      if (
        interaction.customId === 'ytb:warranty' ||
        interaction.customId === 'youtube:warranty' ||
        interaction.customId === 'warranty:apply' ||
        interaction.customId === 'warranty:request' ||
        interaction.customId.startsWith('warranty:') ||
        (interaction.customId.includes('warranty') && interaction.customId.includes('apply'))
      ) {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
        const E_lw = createEmojiResolver(interaction.guildId);
        try {
          const modal = new ModalBuilder()
            .setCustomId('ytb:warranty:modal')
            .setTitle('Yêu Cầu Bảo Hành YouTube');
          const orderInput = new TextInputBuilder()
            .setCustomId('warranty_order_code')
            .setLabel('Mã đơn hàng (ví dụ: CN_123456)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('CN_xxxxxx hoặc BST_xxxxxx')
            .setMaxLength(20);
          const gmailInput = new TextInputBuilder()
            .setCustomId('warranty_customer_gmail')
            .setLabel('Gmail cần bảo hành của bạn')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('gmailcua-ban@gmail.com')
            .setMaxLength(100);
          const familyInput = new TextInputBuilder()
            .setCustomId('warranty_family_owner_gmail')
            .setLabel('Gmail chủ Family cũ (nếu có)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('gmail-chu-family@gmail.com')
            .setMaxLength(100);
          modal.addComponents(
            new ActionRowBuilder().addComponents(orderInput),
            new ActionRowBuilder().addComponents(gmailInput),
            new ActionRowBuilder().addComponents(familyInput)
          );
          await interaction.showModal(modal);
        } catch (err) {
          console.error('[WARRANTY-LEGACY-CLICK] Error:', err.message);
          await interaction.reply({ content: `${E_lw('status_cross')} Không thể mở form bảo hành: ${err.message}`, ephemeral: true }).catch(() => null);
        }
        return;
      }

      // Fallback cho mọi nút không khớp handler — ACK để tránh "Tương tác này không thành công"
      {
        const E_fb = createEmojiResolver(interaction.guildId);
        console.warn(`[INTERACTION] Nút không có handler: ${interaction.customId} (user ${interaction.user.tag})`);
        await interaction.reply({
          content: `${E_fb('status_warn')} Nút này thuộc bảng cũ và không còn hoạt động. Vui lòng dùng bảng mới hoặc lệnh tương ứng. Nếu cần hỗ trợ, hãy mở ticket.`,
          ephemeral: true,
        }).catch(() => null);
        return;
      }

    } catch (error) {
      if (error.code === 'RATE_LIMITED') {
        const E_rl = createEmojiResolver(interaction.guildId);
        const payload = { content: `${E_rl('status_warn')} ${error.message}`, ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => null);
        } else {
          await interaction.reply(payload).catch(() => null);
        }
        return; // Không ghi log spam
      }

      console.error('[INTERACTION] Lỗi:', error);
      import('../services/errorLogService.js').then(({ sendErrorLog }) => {
        sendErrorLog('Interaction Error', error, interaction);
      }).catch(() => null);

      const E_ge = createEmojiResolver(interaction.guildId);
      const payload = {
        content: `${E_ge('status_cross')} Có lỗi xảy ra khi xử lý thao tác này. Hãy kiểm tra log console.`,
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!message.inGuild() || message.author.bot) return;
      const parsed = parsePrefixCommand(message.content);
      if (!parsed) return;

      if (isPublicPrefixCommand(parsed.command)) {
        await handlePrefixThanhChu(message);
        return;
      }

      const guildConfig = getGuildConfig(message.guild.id);
      const member = message.member;
      if (!isStaffMember(member, guildConfig)) return;

      if (parsed.command === '+qr') {
        await handlePrefixQr(message, parsed.args);
        return;
      }

      if (parsed.command === '+done') {
        await handlePrefixDone(message, parsed.args);
        return;
      }
    } catch (error) {
      console.error('[MESSAGE PREFIX] Lỗi:', error);
    }
  });
}

export function getClientOptions() {
  return {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Channel],
  };
}




