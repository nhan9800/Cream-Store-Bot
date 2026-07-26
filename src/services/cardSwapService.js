import crypto from 'node:crypto';
import { db, nowIso } from '../database/db.js';

export function getCardSwapConfig(guildId) {
  const row = db.prepare('SELECT cardswap_partner_id, cardswap_partner_key, cardswap_buy_partner_id, cardswap_buy_partner_key, cardswap_domain, cardswap_charging_fee_add, cardswap_buy_profit_add FROM guild_settings WHERE guild_id = ?').get(guildId);
  if (!row) return null;
  return row;
}

export function saveCardSwapConfig(guildId, configData) {
  const stmt = db.prepare(`
    UPDATE guild_settings
    SET cardswap_partner_id = ?, cardswap_partner_key = ?, cardswap_domain = ?, cardswap_charging_fee_add = ?, cardswap_buy_profit_add = ?
    WHERE guild_id = ?
  `);
  stmt.run(
    configData.cardswap_partner_id, 
    configData.cardswap_partner_key, 
    configData.cardswap_domain, 
    configData.cardswap_charging_fee_add, 
    configData.cardswap_buy_profit_add, 
    guildId
  );
}

export function saveCardSwapBuyConfig(guildId, configData) {
  const stmt = db.prepare(`
    UPDATE guild_settings
    SET cardswap_buy_partner_id = ?, cardswap_buy_partner_key = ?
    WHERE guild_id = ?
  `);
  stmt.run(
    configData.cardswap_buy_partner_id, 
    configData.cardswap_buy_partner_key, 
    guildId
  );
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

export async function getChargingFees(guildId) {
  const config = getCardSwapConfig(guildId);
  if (!config || !config.cardswap_partner_id) throw new Error('Chưa cấu hình CardSwap API');
  
  const domain = config.cardswap_domain || 'card2k.com';
  const url = `https://${domain}/chargingws/v2/getfee?partner_id=${config.cardswap_partner_id}`;
  
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 100) throw new Error(data.message || 'Lỗi lấy phí');
  return data;
}

export async function submitChargingCard(guildId, customerId, telco, code, serial, declared_value) {
  const config = getCardSwapConfig(guildId);
  if (!config || !config.cardswap_partner_id) throw new Error('Chưa cấu hình CardSwap API');
  
  const domain = config.cardswap_domain || 'card2k.com';
  const requestId = crypto.randomUUID().replace(/-/g, '').substring(0, 20);
  
  const sign = md5(config.cardswap_partner_key + code + serial);
  
  const body = new URLSearchParams({
    telco: telco,
    code: code,
    serial: serial,
    amount: declared_value.toString(),
    request_id: requestId,
    partner_id: config.cardswap_partner_id,
    sign: sign,
    command: 'charging'
  });

  // Lưu database trước khi gửi
  db.prepare(`
    INSERT INTO card_charging_orders (request_id, guild_id, customer_id, telco, code, serial, declared_value, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
  `).run(requestId, guildId, customerId, telco, code, serial, declared_value, nowIso(), nowIso());

  const res = await fetch(`https://${domain}/chargingws/v2`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  
  const data = await res.json();
  
  // Update order status if immediate failure
  if (data.status === 100) {
    db.prepare("UPDATE card_charging_orders SET status = 'FAILED', message = ?, updated_at = ? WHERE request_id = ?").run(data.message, nowIso(), requestId);
    throw new Error(data.message || 'Gửi thẻ thất bại');
  }
  
  // Pending or success will be handled via webhook callback mostly, but wait!
  // Sanbox returns 99 for success/pending.
  if (data.status !== 99 && data.status !== 1 && data.status !== 2) {
    db.prepare("UPDATE card_charging_orders SET status = 'FAILED', message = ?, updated_at = ? WHERE request_id = ?").run(data.message || 'Lỗi không xác định', nowIso(), requestId);
    throw new Error(data.message || 'Lỗi xử lý thẻ');
  }

  return { request_id: requestId, data };
}

export function getChargingOrder(requestId) {
  return db.prepare('SELECT * FROM card_charging_orders WHERE request_id = ?').get(requestId);
}

export function updateChargingOrder(requestId, data) {
  db.prepare(`
    UPDATE card_charging_orders
    SET status = ?, value = ?, amount = ?, trans_id = ?, message = ?, updated_at = ?
    WHERE request_id = ?
  `).run(data.status, data.value, data.amount, data.trans_id, data.message, nowIso(), requestId);
}

// Mua Thẻ
export async function getCardBalance(guildId) {
  const config = getCardSwapConfig(guildId);
  if (!config || !config.cardswap_partner_id) throw new Error('Chưa cấu hình CardSwap API');
  
  const domain = config.cardswap_domain || 'card2k.com';
  const sign = md5(config.cardswap_partner_key + config.cardswap_partner_id + 'getbalance');
  const url = `https://${domain}/api/cardws?partner_id=${config.cardswap_partner_id}&sign=${sign}&command=getbalance`;
  
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 108 || data.status === 100) throw new Error(data.message || 'Lỗi API');
  return data.balance;
}

export async function checkAvailableCard(guildId, serviceCode, value, qty) {
  const config = getCardSwapConfig(guildId);
  if (!config || !config.cardswap_buy_partner_id) throw new Error('Chưa cấu hình API Mua Thẻ');
  
  const domain = config.cardswap_domain || 'card2k.com';
  const sign = md5(config.cardswap_buy_partner_key + config.cardswap_buy_partner_id + 'checkavailable');
  const url = `https://${domain}/api/cardws?partner_id=${config.cardswap_buy_partner_id}&command=checkavailable&service_code=${serviceCode}&value=${value}&qty=${qty}&sign=${sign}`;
  
  const res = await fetch(url);
  const data = await res.json();
  return data; // {status: 1, message: "Còn hàng"} or 118 "Hết hàng"
}

export async function buyCard(guildId, customerId, serviceCode, value, qty, totalPrice) {
  const config = getCardSwapConfig(guildId);
  if (!config || !config.cardswap_buy_partner_id) throw new Error('Chưa cấu hình API Mua Thẻ');
  
  const domain = config.cardswap_domain || 'card2k.com';
  const requestId = crypto.randomUUID().replace(/-/g, '').substring(0, 20);
  const command = 'buycard';
  const sign = md5(config.cardswap_buy_partner_key + config.cardswap_buy_partner_id + command + requestId);
  
  const body = new URLSearchParams({
    partner_id: config.cardswap_buy_partner_id,
    request_id: requestId,
    service_code: serviceCode,
    value: value.toString(),
    qty: qty.toString(),
    sign: sign,
    command: command
  });

  // DB Insert
  db.prepare(`
    INSERT INTO card_buy_orders (request_id, guild_id, customer_id, service_code, value, qty, total_price, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
  `).run(requestId, guildId, customerId, serviceCode, value, qty, totalPrice, nowIso(), nowIso());

  const res = await fetch(`https://${domain}/api/cardws`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  
  const data = await res.json();
  
  if (data.status === 1) {
    db.prepare("UPDATE card_buy_orders SET status = 'COMPLETED', cards_data = ?, message = ?, updated_at = ? WHERE request_id = ?")
      .run(JSON.stringify(data.data.cards), data.message, nowIso(), requestId);
    return data.data.cards; // Array of {name, serial, code, expired}
  } else {
    db.prepare("UPDATE card_buy_orders SET status = 'FAILED', message = ?, updated_at = ? WHERE request_id = ?")
      .run(data.message || 'Lỗi mua thẻ', nowIso(), requestId);
    throw new Error(data.message || 'Lỗi mua thẻ');
  }
}

import { addWalletBalance } from './walletService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';

export async function handleCardSwapCallback(query, discordClient) {
  const { status, message, request_id, declared_value, card_value, value, amount, code, serial, telco, trans_id, callback_sign } = query;
  
  const order = getChargingOrder(request_id);
  if (!order) throw new Error('Order not found');
  if (order.status === 'COMPLETED' || order.status === 'FAILED') return;

  const config = getCardSwapConfig(order.guild_id);
  if (!config) throw new Error('Config not found');

  const expectedSign = md5(config.cardswap_partner_key + code + serial);
  if (expectedSign !== callback_sign) throw new Error('Invalid signature');

  const statusNum = Number(status);
  
  if (statusNum === 1 || statusNum === 2) {
    // 1 = Thành công, 2 = Sai mệnh giá
    const actualAmount = Number(amount);
    
    updateChargingOrder(request_id, {
      status: 'COMPLETED',
      value: card_value,
      amount: actualAmount,
      trans_id: trans_id,
      message: message || (statusNum === 1 ? 'Thành công' : 'Sai mệnh giá')
    });

    const E = createEmojiResolver(order.guild_id);
    
    // Add wallet balance to customer
    // User needs to get the actualAmount (which is the money received by admin).
    // The admin wants to make a profit.
    // actualAmount is what Card2k pays admin.
    // Original formula: user gets = actualAmount, admin gets nothing.
    // Profit margin: admin wants to keep X% of the card value.
    // Wait, Card2k fee is e.g. 15%. actualAmount = 85k (for 100k card).
    // Admin configures cardswap_charging_fee_add = 5%. Total fee = 20%. User gets 80k.
    // So user receives = declared_value * (100 - (Card2K_Fee + Admin_Fee)) / 100.
    // We can deduce Card2K_Fee = ((declared_value - actualAmount) / declared_value) * 100.
    // So user receives = actualAmount - (declared_value * config.cardswap_charging_fee_add / 100).
    // Let's ensure it doesn't go below 0.
    const declaredNum = Number(declared_value) || 0;
    const adminFeeAmount = Math.floor(declaredNum * (config.cardswap_charging_fee_add || 0) / 100);
    const userReceives = Math.max(0, actualAmount - adminFeeAmount);

    addWalletBalance(
      order.guild_id, 
      order.customer_id, 
      userReceives, 
      'TOPUP_CARD', 
      'Đổi thẻ cào thành công', 
      request_id
    );

    // Gửi tin nhắn
    if (discordClient) {
      try {
        const user = await discordClient.users.fetch(order.customer_id);
        if (user) {
          const container = new ContainerBuilder().setAccentColor(0x2ECC71);
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${E('tickgreen') || '✅'} ĐỔI THẺ THÀNH CÔNG!\n\nBạn đã đổi thẻ **${telco} ${Number(card_value).toLocaleString('vi-VN')}đ** thành công.\nBạn nhận được: **${userReceives.toLocaleString('vi-VN')}đ** vào ví.\n> ${E('status_check') || '✅'} Trạng thái: ${message}`)
          );
          await user.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
      } catch (e) {
        console.error('Lỗi gửi DM đổi thẻ', e);
      }
    }
  } else if (statusNum === 3 || statusNum === 100) {
    // 3 = Thẻ lỗi, 100 = Gửi thẻ thất bại
    updateChargingOrder(request_id, {
      status: 'FAILED',
      value: card_value,
      amount: 0,
      trans_id: trans_id,
      message: message || 'Thẻ lỗi'
    });

    const E = createEmojiResolver(order.guild_id);
    if (discordClient) {
      try {
        const user = await discordClient.users.fetch(order.customer_id);
        if (user) {
          const container = new ContainerBuilder().setAccentColor(0xE74C3C);
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${E('cancel') || '❌'} ĐỔI THẺ THẤT BẠI!\n\nThẻ **${telco} ${Number(declared_value).toLocaleString('vi-VN')}đ** của bạn đã bị từ chối.\n> ${E('status_check') || '❌'} Lý do: ${message}`)
          );
          await user.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
      } catch (e) {
        console.error('Lỗi gửi DM báo lỗi thẻ', e);
      }
    }
  }
}
