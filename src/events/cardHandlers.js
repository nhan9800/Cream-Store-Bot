import { 
  ActionRowBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  StringSelectMenuBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { 
  saveCardSwapConfig, 
  getChargingFees, 
  submitChargingCard, 
  checkAvailableCard, 
  buyCard,
  getCardSwapConfig
} from '../services/cardSwapService.js';
import { getCustomerProfile, getWalletBalance, addWalletBalance } from '../services/customerService.js';

export async function handleCardSwapInteractions(interaction) {
  const E = createEmojiResolver(interaction.guild.id);
  const { customId } = interaction;

  if (interaction.isModalSubmit() && customId === 'cardswap:setup_api_modal') {
    const domain = interaction.fields.getTextInputValue('cardswap:domain');
    const partnerId = interaction.fields.getTextInputValue('cardswap:partner_id');
    const partnerKey = interaction.fields.getTextInputValue('cardswap:partner_key');
    const chargingFeeAdd = parseFloat(interaction.fields.getTextInputValue('cardswap:charging_fee_add'));
    const buyProfitAdd = parseInt(interaction.fields.getTextInputValue('cardswap:buy_profit_add'));

    saveCardSwapConfig(interaction.guild.id, {
      cardswap_domain: domain,
      cardswap_partner_id: partnerId,
      cardswap_partner_key: partnerKey,
      cardswap_charging_fee_add: isNaN(chargingFeeAdd) ? 5.0 : chargingFeeAdd,
      cardswap_buy_profit_add: isNaN(buyProfitAdd) ? 3000 : buyProfitAdd
    });

    await interaction.reply({ content: 'Đã lưu cấu hình API CardSwap thành công!', ephemeral: true });
    return true;
  }

  // --- NÚT ĐỔI THẺ (CHARGING) ---
  if (interaction.isButton() && customId === 'cardswap:btn_charge') {
    const config = getCardSwapConfig(interaction.guild.id);
    if (!config || !config.cardswap_partner_id) {
      return interaction.reply({ content: 'Admin chưa cài đặt API Đổi Thẻ.', ephemeral: true });
    }

    try {
      // Lấy fee để hiện menu
      const fees = await getChargingFees(interaction.guild.id);
      
      const telcos = [...new Set(fees.map(f => f.telco))];
      
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('cardswap:charge_select_telco')
        .setPlaceholder('Chọn nhà mạng cần gạch')
        .addOptions(telcos.map(t => ({
          label: t,
          value: t
        })));
        
      const container = new ContainerBuilder().setAccentColor(0x3498DB);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${E('card') || '💳'} ĐỔI THẺ CÀO LẤY SỐ DƯ VÍ\nVui lòng chọn nhà mạng của thẻ bạn muốn gạch:`)
      );
      
      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({ 
        components: [container, row], 
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true 
      });
    } catch (e) {
      await interaction.reply({ content: 'Lỗi khi lấy thông tin nhà mạng: ' + e.message, ephemeral: true });
    }
    return true;
  }

  if (interaction.isStringSelectMenu() && customId === 'cardswap:charge_select_telco') {
    const telco = interaction.values[0];
    
    const modal = new ModalBuilder()
      .setCustomId(`cardswap:charge_modal_${telco}`)
      .setTitle(`Đổi Thẻ Cào ${telco}`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('amount').setLabel('Mệnh giá thẻ (VND)').setPlaceholder('VD: 50000').setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('serial').setLabel('Số Serial').setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('code').setLabel('Mã Thẻ').setStyle(TextInputStyle.Short).setRequired(true)
      )
    );

    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && customId.startsWith('cardswap:charge_modal_')) {
    const telco = customId.replace('cardswap:charge_modal_', '');
    const amountStr = interaction.fields.getTextInputValue('amount');
    const serial = interaction.fields.getTextInputValue('serial').trim();
    const code = interaction.fields.getTextInputValue('code').trim();
    
    const amount = parseInt(amountStr.replace(/[^0-9]/g, ''));
    if (isNaN(amount) || amount <= 0) {
      return interaction.reply({ content: 'Mệnh giá không hợp lệ.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const result = await submitChargingCard(interaction.guild.id, interaction.user.id, telco, code, serial, amount);
      await interaction.editReply({
        content: `### ${E('tick_green') || '✅'} ĐÃ GỬI THẺ THÀNH CÔNG!\n> Yêu cầu của bạn đang được xử lý (Request ID: \`${result.request_id}\`).\n> Hệ thống sẽ gửi thông báo cho bạn khi thẻ được duyệt xong.`,
        flags: MessageFlags.IsComponentsV2
      });
    } catch (e) {
      await interaction.editReply(`Lỗi: ${e.message}`);
    }
    return true;
  }

  // --- NÚT MUA THẺ (BUY CARD) ---
  if (interaction.isButton() && customId === 'cardswap:btn_buy') {
    const config = getCardSwapConfig(interaction.guild.id);
    if (!config || !config.cardswap_partner_id) {
      return interaction.reply({ content: 'Admin chưa cài đặt API Mua Thẻ.', ephemeral: true });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('cardswap:buy_select_telco')
      .setPlaceholder('Chọn loại thẻ cần mua')
      .addOptions(
        { label: 'Viettel', value: 'Viettel' },
        { label: 'Vinaphone', value: 'Vinaphone' },
        { label: 'Mobifone', value: 'Mobifone' },
        { label: 'Zing', value: 'Zing' },
        { label: 'Garena', value: 'Garena' },
        { label: 'Vcoin', value: 'Vcoin' }
      );
      
    const container = new ContainerBuilder().setAccentColor(0x3498DB);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E('cart') || '🛒'} MUA THẺ CÀO\nVui lòng chọn loại thẻ bạn muốn mua:`)
    );
      
    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.reply({ 
      components: [container, row], 
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true 
    });
    return true;
  }

  if (interaction.isStringSelectMenu() && customId === 'cardswap:buy_select_telco') {
    const telco = interaction.values[0];
    
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`cardswap:buy_select_amount_${telco}`)
      .setPlaceholder('Chọn mệnh giá')
      .addOptions(
        { label: '10.000đ', value: '10000' },
        { label: '20.000đ', value: '20000' },
        { label: '50.000đ', value: '50000' },
        { label: '100.000đ', value: '100000' },
        { label: '200.000đ', value: '200000' },
        { label: '500.000đ', value: '500000' }
      );
      
    const container = new ContainerBuilder().setAccentColor(0x3498DB);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ${E('cart') || '🛒'} MUA THẺ ${telco.toUpperCase()}\nVui lòng chọn mệnh giá:`)
    );
      
    const row = new ActionRowBuilder().addComponents(selectMenu);
    await interaction.update({ 
      components: [container, row],
      flags: MessageFlags.IsComponentsV2
    });
    return true;
  }

  if (interaction.isStringSelectMenu() && customId.startsWith('cardswap:buy_select_amount_')) {
    const telco = customId.replace('cardswap:buy_select_amount_', '');
    const amount = parseInt(interaction.values[0]);
    
    const config = getCardSwapConfig(interaction.guild.id);
    const priceToPay = amount + (config.cardswap_buy_profit_add || 3000); // Lãi cộng thêm

    const modal = new ModalBuilder()
      .setCustomId(`cardswap:buy_modal_${telco}_${amount}_${priceToPay}`)
      .setTitle(`Mua thẻ ${telco} ${amount.toLocaleString('vi-VN')}đ`);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('qty')
          .setLabel(`Số lượng (Giá: ${priceToPay.toLocaleString('vi-VN')}đ/thẻ)`)
          .setStyle(TextInputStyle.Short)
          .setValue('1')
          .setRequired(true)
      )
    );

    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && customId.startsWith('cardswap:buy_modal_')) {
    const parts = customId.split('_');
    const priceToPay = parseInt(parts.pop());
    const amount = parseInt(parts.pop());
    const telco = parts.pop();
    const qtyStr = interaction.fields.getTextInputValue('qty');
    const qty = parseInt(qtyStr);

    if (isNaN(qty) || qty <= 0 || qty > 10) {
      return interaction.reply({ content: 'Số lượng mua tối đa là 10 thẻ mỗi lần và phải lớn hơn 0.', ephemeral: true });
    }

    const totalToPay = priceToPay * qty;
    const currentBalance = getWalletBalance(interaction.guild.id, interaction.user.id);
    if (currentBalance < totalToPay) {
      return interaction.reply({ 
        content: `❌ Số dư không đủ! Bạn cần **${totalToPay.toLocaleString('vi-VN')}đ** để mua ${qty} thẻ ${telco} ${amount.toLocaleString('vi-VN')}đ.\nSố dư hiện tại: **${currentBalance.toLocaleString('vi-VN')}đ**.`, 
        ephemeral: true 
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Gọi API mua thẻ
      const cards = await buyCard(interaction.guild.id, interaction.user.id, telco, amount, qty, totalToPay);
      
      // Trừ tiền
      addWalletBalance(
        interaction.guild.id, 
        interaction.user.id, 
        -totalToPay, 
        'BUY_CARD', 
        `Mua ${qty} thẻ ${telco} ${amount.toLocaleString('vi-VN')}đ`, 
        null
      );

      // Gửi danh sách mã thẻ
      let cardsText = cards.map(c => `> **Serial:** \`${c.serial}\` | **Mã thẻ:** \`${c.code}\``).join('\n');
      
      const container = new ContainerBuilder().setAccentColor(0x2ECC71);
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`### ${E('tick_green') || '✅'} GIAO DỊCH MUA THẺ THÀNH CÔNG\nBạn đã mua thành công **${qty} thẻ ${telco} ${amount.toLocaleString('vi-VN')}đ**.\nTổng thanh toán: **${totalToPay.toLocaleString('vi-VN')}đ**\n\n**THÔNG TIN THẺ:**\n${cardsText}`)
      );

      await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });

    } catch (e) {
      await interaction.editReply(`Lỗi: ${e.message}`);
    }
    return true;
  }

  return false;
}
