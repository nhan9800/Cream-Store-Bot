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

// Các dịch vụ phổ biến ưu tiên hiển thị trên cùng
const PREFERRED_SERVICE_IDS = [7, 3, 19, 4, 29, 36, 49, 1, 2]; 

export async function handleOtpInteraction(interaction) {
  const E = createEmojiResolver(interaction.guildId);

  try {
    if (interaction.customId === 'otp:open_menu') {
      await interaction.deferReply({ ephemeral: true });

      // Lấy danh sách dịch vụ từ ViOTP
      const services = await getServices('vn');
      if (services) services.forEach(s => s.price += 3000);
      if (!services || services.length === 0) {
        return await interaction.editReply({ content: `${E('tick_red51')} Hệ thống thuê số đang bảo trì (không tải được dịch vụ).` });
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
      const container = new ContainerBuilder().setAccentColor(0x3498db);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${E('starxoay')} CHỌN DỊCH VỤ THUÊ OTP\n> Số tiền sẽ được trừ vào số dư ví của bạn.\n> Nếu không nhận được mã trong 5 phút, tiền sẽ được hoàn lại tự động.`)
      );

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
        return await interaction.editReply({ content: `${E('tick_red51')} Không tìm thấy thông tin dịch vụ này.` });
      }

      const userBalance = getWalletBalance(interaction.guildId, interaction.user.id);
      if (userBalance < service.price) {
        return await interaction.editReply({ 
          content: `${E('tick_red51')} Bạn không đủ số dư để thuê dịch vụ này.\n> **Giá:** ${service.price.toLocaleString('vi-VN')}đ\n> **Số dư của bạn:** ${userBalance.toLocaleString('vi-VN')}đ\n\n*Vui lòng nạp thêm tiền vào ví để tiếp tục.*` 
        });
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

        const container = new ContainerBuilder().setAccentColor(0x2ECC71);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${E('tickgreen')} THUÊ SỐ THÀNH CÔNG!\n\n**Dịch vụ:** ${service.name}\n**Số điện thoại:** \`${otpData.phone_number}\`\n**Giá:** ${service.price.toLocaleString('vi-VN')}đ\n\n> ${E('chamxanh')} Hãy sử dụng số điện thoại này để đăng ký.\n> Sau khi hệ thống gửi mã xác nhận, hãy nhấn nút **Lấy Mã OTP** bên dưới.`)
        );

        const btnGetCode = new ButtonBuilder()
          .setCustomId(`otp:get_code:${otpData.request_id}`)
          .setLabel('Lấy Mã OTP')
          .setStyle(ButtonStyle.Success);
        
        const btnEmoji = E.component('cr_pay');
        if (btnEmoji) btnGetCode.setEmoji(btnEmoji);

        const row = new ActionRowBuilder().addComponents(btnGetCode);

        await interaction.editReply({
          components: [container, row],
          flags: MessageFlags.IsComponentsV2
        });

      } catch (err) {
        // Hoàn tiền nếu request lỗi
        addWalletBalance(interaction.guildId, interaction.user.id, service.price, 'REFUND', `Hoàn tiền lỗi thuê OTP ${service.name}`);
        await interaction.editReply({ content: `${E('tick_red51')} Lỗi khi yêu cầu số: \`${err.message}\`. Tiền đã được hoàn lại vào ví.` });
      }
      return;
    }

    if (interaction.customId.startsWith('otp:get_code:')) {
      await interaction.deferReply({ ephemeral: true });
      const requestId = interaction.customId.split(':')[2];

      const orderRow = db.prepare('SELECT * FROM viotp_orders WHERE request_id = ?').get(requestId);
      if (!orderRow) {
        return await interaction.editReply({ content: `${E('tick_red51')} Không tìm thấy phiên giao dịch này trong hệ thống.` });
      }

      if (orderRow.status === 'COMPLETED') {
        return await interaction.editReply({ content: `${E('tickgreen')} Mã OTP của bạn là: **${orderRow.otp_code}**` });
      }
      if (orderRow.status === 'EXPIRED' || orderRow.status === 'FAILED') {
        return await interaction.editReply({ content: `${E('tick_red51')} Phiên thuê này đã kết thúc hoặc quá hạn.` });
      }

      try {
        const sessionData = await checkSession(requestId);
        // Status: 0 = Đợi tin nhắn, 1 = Hoàn thành, 2 = Hết hạn
        if (sessionData.Status === 1) {
          db.prepare('UPDATE viotp_orders SET status = ?, otp_code = ? WHERE request_id = ?').run('COMPLETED', sessionData.Code, requestId);
          
          const container = new ContainerBuilder().setAccentColor(0x2ECC71);
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${E('starxoay')} ĐÃ NHẬN ĐƯỢC MÃ OTP!\n\n**Dịch vụ:** ${orderRow.service_name}\n**Số điện thoại:** \`${orderRow.phone_number}\`\n**Mã OTP:** \`${sessionData.Code}\`\n\n> ${E('status_info')} **Nội dung tin nhắn:**\n> *${sessionData.SmsContent}*`)
          );

          await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } else if (sessionData.Status === 2) {
          // Hết hạn -> Hoàn tiền
          db.prepare('UPDATE viotp_orders SET status = ? WHERE request_id = ?').run('EXPIRED', requestId);
          addWalletBalance(interaction.guildId, interaction.user.id, orderRow.price, 'REFUND', `Hoàn tiền OTP hết hạn (${orderRow.service_name})`);
          
          await interaction.editReply({ content: `${E('tick_red51')} Phiên chờ OTP đã hết hạn. Hệ thống đã tự động **hoàn lại ${orderRow.price.toLocaleString('vi-VN')}đ** vào ví của bạn.` });
        } else {
          // Đang đợi (Status === 0)
          await interaction.editReply({ content: `${E('chamxanh')} Đang đợi mã OTP từ nhà mạng... Vui lòng chờ thêm vài giây rồi nhấn lại nút Lấy Mã OTP nhé.` });
        }
      } catch (err) {
        if (err.message.includes('Mã phiên không đúng') || err.message.includes('-2')) {
          db.prepare('UPDATE viotp_orders SET status = ? WHERE request_id = ?').run('FAILED', requestId);
          addWalletBalance(interaction.guildId, interaction.user.id, orderRow.price, 'REFUND', `Hoàn tiền OTP lỗi phiên (${orderRow.service_name})`);
          await interaction.editReply({ content: `${E('tick_red51')} Phiên giao dịch bị lỗi từ ViOTP. Đã tự động hoàn tiền.` });
        } else {
          await interaction.editReply({ content: `${E('tick_red51')} Lỗi kiểm tra mã: \`${err.message}\`` });
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
        return interaction.editReply({ content: `${E('tick_red51')} Số tiền không hợp lệ. Vui lòng nạp tối thiểu 10,000đ.` });
      }

      const { createTopupCheckout } = await import('../services/walletService.js');
      try {
        const topupData = await createTopupCheckout(interaction.guildId, interaction.user.id, amount);
        const container = new ContainerBuilder().setAccentColor(0x3498db);
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`### ${E('payment_payos') || '💰'} QUÉT MÃ QR ĐỂ NẠP TIỀN\n> Vui lòng quét mã QR bên dưới bằng ứng dụng ngân hàng hoặc Momo để nạp **${amount.toLocaleString('vi-VN')}đ** vào ví.\n> Nội dung chuyển khoản: \`${topupData.topupCode}\`\n\n*Hệ thống sẽ tự động cộng tiền trong 3-10 giây sau khi chuyển khoản thành công.*`)
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
        await interaction.editReply({ content: `${E('tick_red51')} Không thể tạo mã nạp tiền lúc này: ${err.message}` });
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
          content += `> ${E('tickgreen') || '✅'} **${o.service_name}** (\`${o.phone_number}\`): \`${o.otp_code}\`\n`;
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
        await interaction.reply({ content: `${E('tick_red51')} Đã xảy ra lỗi: ${error.message}`, ephemeral: true });
      } else {
        await interaction.editReply({ content: `${E('tick_red51')} Đã xảy ra lỗi: ${error.message}` });
      }
    } catch {}
  }
}
