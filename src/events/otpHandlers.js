import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder
} from 'discord.js';
import QRCode from 'qrcode';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getBalance, getServices, requestOtp, checkSession } from '../services/viotpService.js';
import { getWalletBalance, addWalletBalance } from '../services/walletService.js';
import { applyCustomerRoles } from '../services/roleService.js';
import { completeOtpOrder, expireOtpOrder, failOtpOrder } from '../services/otpLifecycleService.js';
import { emitAutomationLog, maskPhone } from '../services/automationLogService.js';

// Các dịch vụ phổ biến ưu tiên hiển thị trên cùng
const PREFERRED_SERVICE_IDS = [7, 3, 19, 4, 29, 36, 49, 1, 2]; 

function otpNotice(E, {
  title,
  summary,
  lines = [],
  status = 'info',
  footer = 'Cenar OTP · Dữ liệu riêng tư chỉ hiển thị cho bạn',
}) {
  const palette = {
    success: { color: 0x57f287, emoji: E('status_check') },
    warning: { color: 0xfee75c, emoji: E('status_warn') },
    danger: { color: 0xed4245, emoji: E('status_cross') },
    info: { color: 0x5865f2, emoji: E('status_info') },
  };
  const tone = palette[status] || palette.info;
  const container = new ContainerBuilder().setAccentColor(tone.color);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${tone.emoji} ${title}`,
    summary ? `> ${summary}` : null,
    lines.length ? '' : null,
    ...lines,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${E('cenar_verified')} ${footer}`),
  );
  return container;
}

function otpReply(E, options) {
  return { components: [otpNotice(E, options)], flags: MessageFlags.IsComponentsV2 };
}

export async function handleOtpInteraction(interaction) {
  const E = createEmojiResolver(interaction.guildId);

  try {
    if (interaction.customId === 'otp:open_menu') {
      await interaction.deferReply({ ephemeral: true });

      // Lấy danh sách dịch vụ từ ViOTP
      const services = await getServices('vn');
      if (services) services.forEach(s => s.price += 3000);
      if (!services || services.length === 0) {
        return await interaction.editReply(otpReply(E, { title: 'DỊCH VỤ TẠM GIÁN ĐOẠN', summary: 'Không tải được danh sách dịch vụ từ ViOTP.', status: 'danger', lines: [`${E('cenar_support')} Vui lòng thử lại sau ít phút; ví của bạn chưa bị thay đổi.`] }));
      }

      // Sắp xếp: Ưu tiên các dịch vụ trong list, sau đó đến các dịch vụ giá rẻ
      const sortedServices = services.sort((a, b) => {
        const aPref = PREFERRED_SERVICE_IDS.includes(a.id);
        const bPref = PREFERRED_SERVICE_IDS.includes(b.id);
        if (aPref && !bPref) return -1;
        if (!aPref && bPref) return 1;
        return a.price - b.price;
      }).slice(0, 25);

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('otp:select_service')
        .setPlaceholder('Chọn dịch vụ bạn muốn thuê OTP...')
        .addOptions(sortedServices.map(s => ({
          label: `${s.name} - ${s.price.toLocaleString('vi-VN')}đ`,
          description: `Thuê số nhận OTP ${s.name}`,
          value: String(s.id),
          emoji: E.component('panel_order') || undefined
        })));

      const row = new ActionRowBuilder().addComponents(selectMenu);
      const balance = getWalletBalance(interaction.guildId, interaction.user.id);
      const container = otpNotice(E, {
        title: 'CHỌN DỊCH VỤ THUÊ OTP',
        summary: 'Chọn đúng nền tảng cần xác minh; hệ thống sẽ cấp số Việt Nam còn khả dụng.',
        lines: [
          `${E('icon_wallet')} **Số dư khả dụng** — ${balance.toLocaleString('vi-VN')}đ`,
          `${E('status_loading')} **Thời gian chờ** — tối đa 10 phút`,
          `${E('payment_refund')} **Bảo vệ số dư** — tự động hoàn tiền nếu không cấp được số hoặc phiên hết hạn`,
          `${E('customer_patron')} **Quyền lợi** — tự động ghi nhận Cenar Patron sau khi cấp số thành công`,
        ],
      });

      await interaction.editReply({
        components: [container, row],
        flags: MessageFlags.IsComponentsV2
      });
      return;
    }

    if (interaction.customId === 'otp:select_service') {
      await interaction.deferReply({ ephemeral: true });
      const serviceId = parseInt(interaction.values[0]);

      const services = await getServices('vn');
      if (services) services.forEach(s => s.price += 3000);
      const service = services.find(s => s.id === serviceId);
      
      if (!service) {
        return await interaction.editReply(otpReply(E, { title: 'DỊCH VỤ KHÔNG CÒN KHẢ DỤNG', summary: 'Danh sách ViOTP vừa thay đổi. Hãy mở lại menu và chọn dịch vụ khác.', status: 'warning' }));
      }

      const userBalance = getWalletBalance(interaction.guildId, interaction.user.id);
      if (userBalance < service.price) {
        return await interaction.editReply(otpReply(E, {
          title: 'SỐ DƯ CHƯA ĐỦ',
          summary: `Bạn cần thêm ${(service.price - userBalance).toLocaleString('vi-VN')}đ để thuê ${service.name}.`,
          status: 'warning',
          lines: [
            `${E('icon_price')} **Giá dịch vụ** — ${service.price.toLocaleString('vi-VN')}đ`,
            `${E('icon_wallet')} **Số dư hiện tại** — ${userBalance.toLocaleString('vi-VN')}đ`,
          ],
        }));
      }

      // Trừ tiền trước
      addWalletBalance(interaction.guildId, interaction.user.id, -service.price, 'PAYMENT', `Thuê OTP ${service.name}`);

      // Request OTP
      try {
        const otpData = await requestOtp(serviceId, null, 'vn');
        
        // Lưu vào DB
        const stmt = db.prepare(`
          INSERT INTO viotp_orders (guild_id, customer_id, service_id, service_name, price, request_id, phone_number, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
        `);
        stmt.run(interaction.guildId, interaction.user.id, service.id, service.name, service.price, otpData.request_id, otpData.phone_number);

        // Một số điện thoại đã được cấp đồng nghĩa khách đã sử dụng dịch vụ Cenar.
        // Cấp Patron ngay; dữ liệu website đọc cùng nguồn activity nên được đồng bộ tức thì.
        await applyCustomerRoles(interaction.guild, interaction.user.id).catch((error) => {
          console.error('[PATRON] Không thể đồng bộ role sau khi thuê OTP:', error.message);
        });

        const container = otpNotice(E, {
          title: 'ĐÃ CẤP SỐ THUÊ OTP',
          summary: 'Số đã sẵn sàng. Hãy dùng ngay trên dịch vụ đã chọn và không chia sẻ cho người khác.',
          status: 'success',
          lines: [
            `${E('panel_order')} **Dịch vụ** — ${service.name}`,
            `${E('icon_id')} **Số điện thoại** — \`${otpData.phone_number}\``,
            `${E('icon_price')} **Đã thanh toán** — ${service.price.toLocaleString('vi-VN')}đ`,
            `${E('status_loading')} **Trạng thái** — đang chờ tin nhắn OTP`,
            `${E('customer_patron')} **Cenar Patron** — đã đồng bộ với hồ sơ website`,
          ],
        });

        const btnGetCode = new ButtonBuilder()
          .setCustomId(`otp:get_code:${otpData.request_id}`)
          .setLabel('Lấy Mã OTP')
          .setStyle(ButtonStyle.Success);
        
        const btnEmoji = E.component('payment_success');
        if (btnEmoji) btnGetCode.setEmoji(btnEmoji);

        const row = new ActionRowBuilder().addComponents(btnGetCode);

        await interaction.editReply({
          components: [container, row],
          flags: MessageFlags.IsComponentsV2
        });

        await emitAutomationLog(interaction.client, {
          guildId: interaction.guildId,
          customerId: interaction.user.id,
          action: 'OTP_NUMBER_ASSIGNED',
          title: 'ĐÃ CẤP SỐ THUÊ OTP',
          summary: 'ViOTP đã cấp số; phiên đang chờ tin nhắn xác minh.',
          reference: otpData.request_id,
          status: 'warning',
          fields: [
            { label: 'Dịch vụ', value: service.name, emoji: 'panel_order' },
            { label: 'Số thuê', value: `\`${maskPhone(otpData.phone_number)}\``, emoji: 'icon_id' },
            { label: 'Giá', value: `${service.price.toLocaleString('vi-VN')}đ`, emoji: 'icon_price' },
          ],
        });

      } catch (err) {
        // Hoàn tiền nếu request lỗi
        addWalletBalance(interaction.guildId, interaction.user.id, service.price, 'REFUND', `Hoàn tiền lỗi thuê OTP ${service.name}`);
        await interaction.editReply(otpReply(E, {
          title: 'CHƯA CẤP ĐƯỢC SỐ',
          summary: err.message,
          status: 'danger',
          lines: [
            `${E('payment_refund')} **Hoàn tiền** — ${service.price.toLocaleString('vi-VN')}đ đã được trả lại ví`,
            `${E('status_info')} Hãy chọn dịch vụ khác hoặc thử lại khi nhà cung cấp bổ sung số.`,
          ],
        }));
        await emitAutomationLog(interaction.client, {
          guildId: interaction.guildId,
          customerId: interaction.user.id,
          action: 'OTP_ASSIGNMENT_FAILED',
          title: 'KHÔNG CẤP ĐƯỢC SỐ OTP',
          summary: err.message,
          status: 'danger',
          fields: [{ label: 'Đã hoàn ví', value: `${service.price.toLocaleString('vi-VN')}đ`, emoji: 'payment_refund' }],
        });
      }
      return;
    }

    if (interaction.customId.startsWith('otp:get_code:')) {
      await interaction.deferReply({ ephemeral: true });
      const requestId = interaction.customId.split(':')[2];

      const orderRow = db.prepare('SELECT * FROM viotp_orders WHERE request_id = ?').get(requestId);
      if (!orderRow) {
        return await interaction.editReply({ content: `${E('status_cross')} Không tìm thấy phiên giao dịch này trong hệ thống.` });
      }

      if (String(orderRow.customer_id) !== String(interaction.user.id)) {
        return await interaction.editReply(otpReply(E, { title: 'KHÔNG CÓ QUYỀN XEM PHIÊN', summary: 'Phiên OTP này thuộc về khách hàng khác.', status: 'danger' }));
      }

      if (orderRow.status === 'COMPLETED') {
        return await interaction.editReply({ content: `${E('status_check')} Mã OTP của bạn là: **${orderRow.otp_code}**` });
      }
      if (orderRow.status === 'EXPIRED' || orderRow.status === 'FAILED') {
        return await interaction.editReply({ content: `${E('status_cross')} Phiên thuê này đã kết thúc hoặc quá hạn.` });
      }

      try {
        const sessionData = await checkSession(requestId);
        // Status: 0 = Đợi tin nhắn, 1 = Hoàn thành, 2 = Hết hạn
        if (sessionData.Status === 1) {
          const completed = completeOtpOrder(requestId, sessionData.Code);
          if (!completed.transitioned && completed.order?.status !== 'COMPLETED') {
            return await interaction.editReply(otpReply(E, { title: 'PHIÊN ĐÃ KẾT THÚC', summary: 'Trạng thái phiên vừa được tiến trình tự động cập nhật.', status: 'warning' }));
          }
          
          const container = new ContainerBuilder().setAccentColor(0x2ECC71);
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${E('icon_sparkle')} ĐÃ NHẬN ĐƯỢC MÃ OTP!\n\n**Dịch vụ:** ${orderRow.service_name}\n**Số điện thoại:** \`${orderRow.phone_number}\`\n**Mã OTP:** \`${sessionData.Code}\`\n\n> ${E('status_info')} **Nội dung tin nhắn:**\n> *${sessionData.SmsContent}*`)
          );

          await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
          if (completed.transitioned) await emitAutomationLog(interaction.client, {
            guildId: orderRow.guild_id,
            customerId: orderRow.customer_id,
            action: 'OTP_COMPLETED',
            title: 'ĐÃ NHẬN MÃ OTP',
            summary: 'Phiên hoàn tất; mã OTP chỉ được gửi riêng cho khách hàng.',
            reference: requestId,
            status: 'success',
            fields: [
              { label: 'Dịch vụ', value: orderRow.service_name, emoji: 'status_check' },
              { label: 'Số thuê', value: `\`${maskPhone(orderRow.phone_number)}\``, emoji: 'icon_id' },
            ],
          });
        } else if (sessionData.Status === 2) {
          // Hết hạn -> Hoàn tiền
          const expired = expireOtpOrder(requestId, `Hoàn tiền OTP hết hạn (${orderRow.service_name})`);
          
          await interaction.editReply(otpReply(E, { title: 'PHIÊN OTP ĐÃ HẾT HẠN', summary: 'Không nhận được mã trong thời gian cho phép.', status: 'warning', lines: [`${E('payment_refund')} **Đã hoàn ví** — ${Number(orderRow.price).toLocaleString('vi-VN')}đ`, `${E('icon_wallet')} Bạn có thể thuê lại ngay bằng số dư vừa hoàn.`] }));
          if (expired.transitioned) await emitAutomationLog(interaction.client, { guildId: orderRow.guild_id, customerId: orderRow.customer_id, action: 'OTP_EXPIRED_REFUNDED', title: 'OTP HẾT HẠN · ĐÃ HOÀN TIỀN', summary: 'Phiên được khóa idempotent và hoàn ví đúng một lần.', reference: requestId, status: 'warning', fields: [{ label: 'Đã hoàn', value: `${Number(orderRow.price).toLocaleString('vi-VN')}đ`, emoji: 'payment_refund' }] });
        } else {
          // Đang đợi (Status === 0)
          await interaction.editReply({ content: `${E('status_loading')} Đang đợi mã OTP từ nhà mạng... Vui lòng chờ thêm vài giây rồi nhấn lại nút Lấy Mã OTP nhé.` });
        }
      } catch (err) {
        if (err.message.includes('Mã phiên không đúng') || err.message.includes('-2')) {
          const failed = failOtpOrder(requestId, `Hoàn tiền OTP lỗi phiên (${orderRow.service_name})`);
          await interaction.editReply(otpReply(E, { title: 'NHÀ CUNG CẤP BÁO LỖI PHIÊN', summary: 'Phiên đã được đóng an toàn và số dư đã hoàn tự động.', status: 'danger', lines: [`${E('payment_refund')} **Đã hoàn ví** — ${Number(orderRow.price).toLocaleString('vi-VN')}đ`] }));
          if (failed.transitioned) await emitAutomationLog(interaction.client, { guildId: orderRow.guild_id, customerId: orderRow.customer_id, action: 'OTP_FAILED_REFUNDED', title: 'OTP LỖI PHIÊN · ĐÃ HOÀN TIỀN', summary: err.message, reference: requestId, status: 'danger' });
        } else {
          await interaction.editReply({ content: `${E('status_cross')} Lỗi kiểm tra mã: \`${err.message}\`` });
        }
      }
      return;
    }

    
    if (interaction.customId === 'otp:topup_menu') {
      const modal = new ModalBuilder()
        .setCustomId('otp:topup_modal')
        .setTitle('Nạp Tiền Vào Ví');
      const amountInput = new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Số tiền muốn nạp (VND)')
        .setPlaceholder('Ví dụ: 10000')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'otp:topup_modal') {
      await interaction.deferReply({ ephemeral: true });
      const amountStr = interaction.fields.getTextInputValue('amount');
      const amount = parseInt(amountStr.replace(/\D/g, ''));
      if (isNaN(amount) || amount < 10000) {
        return interaction.editReply({ content: `${E('status_cross')} Số tiền không hợp lệ. Vui lòng nạp tối thiểu 10,000đ.` });
      }

      const { createTopupCheckout } = await import('../services/walletService.js');
      try {
        const topupData = await createTopupCheckout(interaction.guildId, interaction.user.id, amount);
        const container = new ContainerBuilder().setAccentColor(0x3498db);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`### ${E('payment_payos')} QUÉT MÃ QR ĐỂ NẠP TIỀN\n> Vui lòng quét mã QR bên dưới bằng ứng dụng ngân hàng hoặc Momo để nạp **${amount.toLocaleString('vi-VN')}đ** vào ví.\n> Nội dung chuyển khoản: \`${topupData.topupCode}\`\n\n*Hệ thống sẽ tự động cộng tiền trong 3-10 giây sau khi chuyển khoản thành công.*`)
        );
        
        const qrBuffer = await QRCode.toBuffer(topupData.qrCode, { width: 400, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
        const qrAttachment = { attachment: qrBuffer, name: 'qr.png' };
        
        container.addMediaGalleryComponents(
          new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL('attachment://qr.png')
          )
        );

        const btnLink = new ButtonBuilder()
          .setLabel('Mở Link Thanh Toán')
          .setStyle(ButtonStyle.Link)
          .setURL(topupData.checkoutUrl);
        const row = new ActionRowBuilder().addComponents(btnLink);

        const payload = { components: [container, row], flags: MessageFlags.IsComponentsV2 };
        if (qrAttachment) payload.files = [qrAttachment];

        await interaction.editReply(payload);
      } catch (err) {
        await interaction.editReply({ content: `${E('status_cross')} Không thể tạo mã nạp tiền lúc này: ${err.message}` });
      }
      return;
    }

    if (interaction.customId === 'otp:check_balance') {
      await interaction.deferReply({ ephemeral: true });
      const userBalance = getWalletBalance(interaction.guildId, interaction.user.id);
      
      // Lấy danh sách các OTP đang chờ
      const pendingOrders = db.prepare('SELECT * FROM viotp_orders WHERE customer_id = ? AND status = ?').all(interaction.user.id, 'PENDING');
      const completedOrders = db.prepare('SELECT * FROM viotp_orders WHERE customer_id = ? AND status = ? ORDER BY id DESC LIMIT 3').all(interaction.user.id, 'COMPLETED');

      const container = new ContainerBuilder().setAccentColor(0x9B59B6);
      let content = `### ${E('money')} THÔNG TIN VÍ & OTP\n\n**Số dư ví hiện tại:** ${userBalance.toLocaleString('vi-VN')}đ\n\n`;

      if (pendingOrders.length > 0) {
        content += `**Các phiên thuê OTP đang chờ:**\n`;
        pendingOrders.forEach(o => {
          content += `> ${E('phone')} **${o.service_name}** - \`${o.phone_number}\` (Đang chờ mã OTP...)\n`;
        });
        content += `\n`;
      } else {
        content += `*Bạn không có phiên thuê OTP nào đang chờ mã.*\n\n`;
      }

      if (completedOrders.length > 0) {
        content += `**Các phiên OTP gần đây:**\n`;
        completedOrders.forEach(o => {
          content += `> ${E('status_check')} **${o.service_name}** (\`${o.phone_number}\`): \`${o.otp_code}\`\n`;
        });
      }

      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      return;
    }

  } catch (error) {
    console.error('[OTP Handler] Error:', error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `${E('status_cross')} Đã xảy ra lỗi: ${error.message}`, ephemeral: true });
      } else {
        await interaction.editReply({ content: `${E('status_cross')} Đã xảy ra lỗi: ${error.message}` });
      }
    } catch {}
  }
}
