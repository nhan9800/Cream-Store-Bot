import crypto from 'node:crypto';
import { db, nowIso } from '../database/db.js';
import { addWalletBalance } from './walletService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { applyCustomerRoles } from './roleService.js';
import { emitAutomationLog, maskSerial } from './automationLogService.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';

export const CARD_TOPUP_PROFIT_MARGIN_PERCENT = 3;
export const CARD_TOPUP_MIN_PROFIT_MARGIN_PERCENT = 2;
export const CARD_TOPUP_MAX_PROFIT_MARGIN_PERCENT = 3;
export const CARD_TOPUP_LEGACY_FEE_PERCENT = 20;
export const CARD_TOPUP_TELCOS = ['VIETTEL', 'VINAPHONE', 'MOBIFONE', 'ZING', 'GARENA'];

const CARD_TOPUP_LABELS = {
  VIETTEL: 'Viettel',
  VINAPHONE: 'VinaPhone',
  MOBIFONE: 'MobiFone',
  ZING: 'Zing',
  GARENA: 'Garena',
};

export function calculateCardTopupCredit(value, feePercent) {
  const safeValue = Math.max(0, Math.floor(Number(value) || 0));
  const safeFee = Math.min(100, Math.max(0, Number(feePercent) || 0));
  return Math.floor(safeValue * (100 - safeFee) / 100);
}

export function normalizeCardTopupProfitMargin(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return CARD_TOPUP_PROFIT_MARGIN_PERCENT;
  return Math.min(
    CARD_TOPUP_MAX_PROFIT_MARGIN_PERCENT,
    Math.max(CARD_TOPUP_MIN_PROFIT_MARGIN_PERCENT, parsed),
  );
}

function parseProviderFeePercent(item) {
  const raw = item?.fees ?? item?.fee ?? item?.fee_percent ?? item?.discount;
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const parsed = Number(String(raw).replace(',', '.').replace('%', '').trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 100) return null;
  return parsed;
}

export function buildCardTopupCatalog(fees, profitMarginPercent = CARD_TOPUP_PROFIT_MARGIN_PERCENT) {
  const margin = normalizeCardTopupProfitMargin(profitMarginPercent);
  const grouped = new Map(CARD_TOPUP_TELCOS.map((telco) => [telco, new Map()]));
  for (const item of Array.isArray(fees) ? fees : []) {
    const telco = String(item?.telco || '').trim().toUpperCase();
    const value = Math.floor(Number(item?.value) || 0);
    const providerFeePercent = parseProviderFeePercent(item);
    if (
      !grouped.has(telco)
      || value < 10_000
      || value > 10_000_000
      || providerFeePercent === null
    ) continue;

    // Nếu API trả trùng mệnh giá, dùng mức phí cao hơn để không báo giá thấp hơn
    // số tiền nhà cung cấp thực tế khấu trừ.
    const currentFee = grouped.get(telco).get(value);
    grouped.get(telco).set(value, Math.max(currentFee ?? 0, providerFeePercent));
  }

  const telcos = CARD_TOPUP_TELCOS.map((code) => ({
    code,
    label: CARD_TOPUP_LABELS[code],
    denominations: [...grouped.get(code).entries()]
      .sort(([left], [right]) => left - right)
      .map(([value, providerFeePercent]) => {
        const feePercent = Number((providerFeePercent + margin).toFixed(2));
        return {
          value,
          provider_fee_percent: providerFeePercent,
          profit_margin_percent: margin,
          fee_percent: feePercent,
          received_amount: calculateCardTopupCredit(value, feePercent),
        };
      }),
  })).filter((telco) => telco.denominations.length > 0);
  const allFees = telcos.flatMap((telco) => telco.denominations.map((item) => item.fee_percent));

  return {
    // Giữ fee_percent để client cũ vẫn có một mức phí bảo thủ trong lúc rolling deploy.
    fee_percent: allFees.length ? Math.max(...allFees) : null,
    fee_percent_min: allFees.length ? Math.min(...allFees) : null,
    fee_percent_max: allFees.length ? Math.max(...allFees) : null,
    profit_margin_percent: margin,
    telcos,
    updated_at: nowIso(),
  };
}

export function getCardSwapConfig(guildId) {
  const row = db.prepare('SELECT cardswap_partner_id, cardswap_partner_key, cardswap_buy_partner_id, cardswap_buy_partner_key, cardswap_domain, cardswap_charging_fee_add, cardswap_buy_profit_add FROM guild_settings WHERE guild_id = ?').get(guildId);
  const partnerId = String(process.env.CARDSWAP_PARTNER_ID || row?.cardswap_partner_id || '').trim();
  const partnerKey = String(process.env.CARDSWAP_PARTNER_KEY || decrypt(row?.cardswap_partner_key) || '').trim();
  if (!row && !partnerId && !partnerKey) return null;
  return {
    ...(row || {}),
    cardswap_partner_id: partnerId || null,
    cardswap_partner_key: partnerKey || null,
    cardswap_buy_partner_id: String(process.env.CARDSWAP_BUY_PARTNER_ID || row?.cardswap_buy_partner_id || '').trim() || null,
    cardswap_buy_partner_key: String(process.env.CARDSWAP_BUY_PARTNER_KEY || decrypt(row?.cardswap_buy_partner_key) || '').trim() || null,
    cardswap_domain: String(process.env.CARDSWAP_DOMAIN || row?.cardswap_domain || 'card2k.net')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/$/, '')
      .toLowerCase(),
    cardswap_charging_fee_add: Number(process.env.CARDSWAP_CHARGING_FEE_ADD ?? row?.cardswap_charging_fee_add ?? 3),
    cardswap_buy_profit_add: Number(process.env.CARDSWAP_BUY_PROFIT_ADD ?? row?.cardswap_buy_profit_add ?? 3000),
  };
}

export function saveCardSwapConfig(guildId, configData) {
  const stmt = db.prepare(`
    UPDATE guild_settings
    SET cardswap_partner_id = ?, cardswap_partner_key = ?, cardswap_domain = ?, cardswap_charging_fee_add = ?, cardswap_buy_profit_add = ?
    WHERE guild_id = ?
  `);
  stmt.run(
    configData.cardswap_partner_id, 
    encrypt(configData.cardswap_partner_key),
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
    encrypt(configData.cardswap_buy_partner_key),
    guildId
  );
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function safeHashEqual(left, right) {
  const a = Buffer.from(String(left || '').toLowerCase(), 'utf8');
  const b = Buffer.from(String(right || '').toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function getChargingFees(guildId) {
  const config = getCardSwapConfig(guildId);
  if (!config || !config.cardswap_partner_id) throw new Error('Chưa cấu hình CardSwap API');
  
  const domain = config.cardswap_domain || 'card2k.net';
  const url = `https://${domain}/chargingws/v2/getfee?partner_id=${config.cardswap_partner_id}`;
  
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Nhà cung cấp trả về HTTP ${res.status}`);
  const data = await res.json();
  if (data.status === 100) throw new Error(data.message || 'Lỗi lấy phí');
  const feeRows = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.fees)
        ? data.fees
        : null;
  if (!feeRows) throw new Error('Nhà cung cấp trả về bảng phí không hợp lệ');
  return feeRows;
}

export async function submitChargingCard(
  guildId,
  customerId,
  telco,
  code,
  serial,
  declared_value,
  { source = 'DISCORD', feePercent = null } = {},
) {
  const config = getCardSwapConfig(guildId);
  if (!config || !config.cardswap_partner_id) throw new Error('Chưa cấu hình CardSwap API');

  const normalizedTelco = String(telco || '').trim().toUpperCase();
  const normalizedCode = String(code || '').trim();
  const normalizedSerial = String(serial || '').trim();
  const normalizedValue = Math.floor(Number(declared_value) || 0);
  if (!CARD_TOPUP_TELCOS.includes(normalizedTelco)) throw new Error('Nhà mạng không được hỗ trợ');
  if (!/^[A-Za-z0-9]{6,32}$/.test(normalizedCode) || !/^[A-Za-z0-9]{6,32}$/.test(normalizedSerial)) {
    throw new Error('Mã thẻ hoặc số serial không hợp lệ');
  }
  if (!Number.isSafeInteger(normalizedValue) || normalizedValue < 10_000 || normalizedValue > 10_000_000) {
    throw new Error('Mệnh giá thẻ không hợp lệ');
  }

  let normalizedFee = feePercent === null || feePercent === undefined ? Number.NaN : Number(feePercent);
  if (!Number.isFinite(normalizedFee)) {
    const options = await getCardTopupOptions(guildId);
    const denomination = options.telcos
      .find((item) => item.code === normalizedTelco)
      ?.denominations.find((item) => item.value === normalizedValue);
    if (!denomination) throw new Error('Nhà mạng hoặc mệnh giá không được hỗ trợ');
    normalizedFee = denomination.fee_percent;
  }
  if (!Number.isFinite(normalizedFee) || normalizedFee < 0 || normalizedFee >= 100) {
    throw new Error('Bảng phí nhà cung cấp không hợp lệ');
  }

  const duplicate = db.prepare(`
    SELECT request_id FROM card_charging_orders
    WHERE guild_id = ? AND telco = ? AND code = ? AND serial = ?
      AND status IN ('PENDING', 'PROCESSING', 'COMPLETED')
    LIMIT 1
  `).get(guildId, normalizedTelco, normalizedCode, normalizedSerial);
  if (duplicate) throw new Error('Thẻ này đã được gửi trước đó');
  
  const domain = config.cardswap_domain || 'card2k.net';
  const requestId = crypto.randomUUID().replace(/-/g, '').substring(0, 20);
  
  const sign = md5(config.cardswap_partner_key + normalizedCode + normalizedSerial);
  
  const body = new URLSearchParams({
    telco: normalizedTelco,
    code: normalizedCode,
    serial: normalizedSerial,
    amount: normalizedValue.toString(),
    request_id: requestId,
    partner_id: config.cardswap_partner_id,
    sign: sign,
    command: 'charging'
  });

  // Lưu database trước khi gửi
  db.prepare(`
    INSERT INTO card_charging_orders (
      request_id, guild_id, customer_id, telco, code, serial, declared_value,
      status, source, fee_percent, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
  `).run(
    requestId,
    guildId,
    customerId,
    normalizedTelco,
    normalizedCode,
    normalizedSerial,
    normalizedValue,
    String(source || 'DISCORD').toUpperCase(),
    normalizedFee,
    nowIso(),
    nowIso(),
  );

  let data;
  try {
    const res = await fetch(`https://${domain}/chargingws/v2`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(12_000),
    });
    data = await res.json();
  } catch {
    db.prepare("UPDATE card_charging_orders SET status = 'FAILED', message = ?, updated_at = ? WHERE request_id = ?")
      .run('Không thể kết nối nhà cung cấp', nowIso(), requestId);
    throw new Error('Nhà cung cấp thẻ đang tạm thời gián đoạn');
  }
  
  // Update order status if immediate failure
  const providerStatus = Number(data?.status);
  if (providerStatus === 100) {
    db.prepare("UPDATE card_charging_orders SET status = 'FAILED', message = ?, updated_at = ? WHERE request_id = ?").run(data.message, nowIso(), requestId);
    throw new Error(data.message || 'Gửi thẻ thất bại');
  }
  
  // Pending or success will be handled via webhook callback mostly, but wait!
  // Sanbox returns 99 for success/pending.
  if (![99, 1, 2].includes(providerStatus)) {
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
    SET status = ?, value = ?, amount = ?, credited_amount = ?, trans_id = ?, message = ?, updated_at = ?
    WHERE request_id = ?
  `).run(data.status, data.value, data.amount, data.creditedAmount ?? null, data.trans_id, data.message, nowIso(), requestId);
}

export async function getCardTopupOptions(guildId) {
  const config = getCardSwapConfig(guildId);
  const catalog = buildCardTopupCatalog(
    await getChargingFees(guildId),
    config?.cardswap_charging_fee_add,
  );
  if (!catalog.telcos.length) throw new Error('Nhà cung cấp chưa trả về bảng phí hợp lệ');
  return catalog;
}

// Mua Thẻ
export async function getCardBalance(guildId) {
  const config = getCardSwapConfig(guildId);
  if (!config || !config.cardswap_partner_id) throw new Error('Chưa cấu hình CardSwap API');
  
  const domain = config.cardswap_domain || 'card2k.net';
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
  
  const domain = config.cardswap_domain || 'card2k.net';
  const sign = md5(config.cardswap_buy_partner_key + config.cardswap_buy_partner_id + 'checkavailable');
  const url = `https://${domain}/api/cardws?partner_id=${config.cardswap_buy_partner_id}&command=checkavailable&service_code=${serviceCode}&value=${value}&qty=${qty}&sign=${sign}`;
  
  const res = await fetch(url);
  const data = await res.json();
  return data; // {status: 1, message: "Còn hàng"} or 118 "Hết hàng"
}

export async function buyCard(guildId, customerId, serviceCode, value, qty, totalPrice) {
  const config = getCardSwapConfig(guildId);
  if (!config || !config.cardswap_buy_partner_id) throw new Error('Chưa cấu hình API Mua Thẻ');
  
  const domain = config.cardswap_domain || 'card2k.net';
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

export async function handleCardSwapCallback(query, discordClient) {
  const { status, message, request_id, declared_value, card_value, value, amount, code, serial, telco, trans_id, callback_sign } = query;
  if (!request_id || !code || !serial || !callback_sign) throw new Error('Missing callback fields');
  
  const order = getChargingOrder(request_id);
  if (!order) throw new Error('Order not found');
  if (order.status === 'COMPLETED' || order.status === 'FAILED') return;

  const config = getCardSwapConfig(order.guild_id);
  if (!config) throw new Error('Config not found');

  const expectedSign = md5(config.cardswap_partner_key + code + serial);
  if (!safeHashEqual(expectedSign, callback_sign)) throw new Error('Invalid signature');

  const statusNum = Number(status);
  
  if (statusNum === 1 || statusNum === 2) {
    // 1 = Thành công, 2 = Sai mệnh giá
    const actualAmount = Number(amount);
    
    const actualCardValue = Number(card_value) || Number(declared_value) || order.declared_value;
    const lockedFeePercent = order.fee_percent !== null
      && order.fee_percent !== undefined
      && Number.isFinite(Number(order.fee_percent))
      ? Number(order.fee_percent)
      : null;
    const configuredCredit = lockedFeePercent === null
      ? null
      : calculateCardTopupCredit(actualCardValue, lockedFeePercent);
    const declaredNum = Number(declared_value) || order.declared_value || 0;
    const adminFeeAmount = Math.floor(declaredNum * (config.cardswap_charging_fee_add || 0) / 100);
    const userReceives = configuredCredit ?? Math.max(0, actualAmount - adminFeeAmount);

    const completionMessage = message || (statusNum === 1 ? 'Thành công' : 'Sai mệnh giá');

    // Update the order and wallet in one SQLite transaction. The status check
    // makes repeated provider callbacks idempotent.
    const finalized = db.transaction(() => {
      const current = getChargingOrder(request_id);
      if (!current || current.status !== 'PENDING') return false;
      updateChargingOrder(request_id, {
        status: 'COMPLETED',
        value: card_value,
        amount: actualAmount,
        creditedAmount: userReceives,
        trans_id: trans_id,
        message: completionMessage,
      });
      addWalletBalance(
        order.guild_id,
        order.customer_id,
        userReceives,
        'TOPUP_CARD',
        'Đổi thẻ cào thành công',
        request_id,
      );
      return true;
    })();
    if (!finalized) return;

    await emitAutomationLog(discordClient, {
      guildId: order.guild_id,
      customerId: order.customer_id,
      action: 'CARD_TOPUP_COMPLETED',
      title: 'GẠCH THẺ ĐÃ HOÀN TẤT',
      summary: 'Callback đã được xác thực và số dư ví đã được cộng đúng một lần.',
      reference: request_id,
      status: 'success',
      fields: [
        { label: 'Nhà mạng', value: String(telco || order.telco), emoji: 'payment_success' },
        { label: 'Serial', value: `\`${maskSerial(serial || order.serial)}\``, emoji: 'icon_id' },
        { label: 'Giá trị thực', value: `${actualCardValue.toLocaleString('vi-VN')}đ`, emoji: 'payment_money' },
        { label: 'Đã cộng ví', value: `${userReceives.toLocaleString('vi-VN')}đ`, emoji: 'icon_wallet' },
      ],
    });

    const E = createEmojiResolver(order.guild_id);

    // Gửi tin nhắn
    if (discordClient) {
      try {
        const guild = discordClient.guilds.cache.get(order.guild_id)
          || await discordClient.guilds.fetch(order.guild_id).catch(() => null);
        if (guild) {
          await applyCustomerRoles(guild, order.customer_id).catch((error) => {
            console.error('[PATRON] Không thể đồng bộ role sau khi gạch thẻ:', error.message);
          });
        }

        const user = await discordClient.users.fetch(order.customer_id);
        if (user) {
          const container = new ContainerBuilder().setAccentColor(0x2ECC71);
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${E('card_success') || E('status_check')} ĐỔI THẺ THÀNH CÔNG!\n\nBạn đã đổi thẻ **${telco} ${Number(card_value).toLocaleString('vi-VN')}đ** thành công.\nBạn nhận được: **${userReceives.toLocaleString('vi-VN')}đ** vào ví.\n> ${E('customer_patron')} Quyền khách hàng Cenar đã được đồng bộ tự động.\n> ${E('status_check')} Trạng thái: ${message}`)
          );
          await user.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
      } catch (e) {
        console.error('Lỗi gửi DM đổi thẻ', e);
      }
    }
  } else if (statusNum === 3 || statusNum === 100) {
    // 3 = Thẻ lỗi, 100 = Gửi thẻ thất bại
    const failed = db.transaction(() => {
      const current = getChargingOrder(request_id);
      if (!current || current.status !== 'PENDING') return false;
      updateChargingOrder(request_id, {
        status: 'FAILED',
        value: card_value,
        amount: 0,
        creditedAmount: 0,
        trans_id: trans_id,
        message: message || 'Thẻ lỗi',
      });
      return true;
    })();
    if (!failed) return;

    await emitAutomationLog(discordClient, {
      guildId: order.guild_id,
      customerId: order.customer_id,
      action: 'CARD_TOPUP_FAILED',
      title: 'GẠCH THẺ BỊ TỪ CHỐI',
      summary: message || 'Nhà cung cấp từ chối thẻ.',
      reference: request_id,
      status: 'danger',
      fields: [
        { label: 'Nhà mạng', value: String(telco || order.telco), emoji: 'status_cross' },
        { label: 'Serial', value: `\`${maskSerial(serial || order.serial)}\``, emoji: 'icon_id' },
        { label: 'Mệnh giá khai báo', value: `${Number(declared_value || order.declared_value).toLocaleString('vi-VN')}đ`, emoji: 'payment_money' },
      ],
    });

    const E = createEmojiResolver(order.guild_id);
    if (discordClient) {
      try {
        const user = await discordClient.users.fetch(order.customer_id);
        if (user) {
          const container = new ContainerBuilder().setAccentColor(0xE74C3C);
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${E('status_cross')} ĐỔI THẺ THẤT BẠI!\n\nThẻ **${telco} ${Number(declared_value).toLocaleString('vi-VN')}đ** của bạn đã bị từ chối.\n> ${E('status_cross')} Lý do: ${message}`)
          );
          await user.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
      } catch (e) {
        console.error('Lỗi gửi DM báo lỗi thẻ', e);
      }
    }
  }
}

// --- Hỗ trợ render Discount Board ---

export async function buildDiscountBoardMarkdown(guildId) {
  const catalog = await getCardTopupOptions(guildId);
  const E = createEmojiResolver(guildId);
  
  const dateStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  let markdown = `### ${E('payment_money')} BẢNG CHIẾT KHẤU ĐỔI THẺ (TỰ ĐỘNG)\n`;
  markdown += `*Cập nhật lần cuối: **${dateStr}***\n`;
  markdown += `*Phí được đồng bộ từ đối tác và đã gồm **${catalog.profit_margin_percent}%** phí vận hành Cenar.*\n\n`;

  for (const telco of catalog.telcos) {
    markdown += `**${E('icon_star')} Nhà mạng ${telco.label}**\n`;
    for (const item of telco.denominations) {
      markdown += `- ${item.value.toLocaleString('vi-VN')}đ · phí **${item.fee_percent}%** → ví nhận **${item.received_amount.toLocaleString('vi-VN')}đ**\n`;
    }
    markdown += `\n`;
  }
  return markdown;
}

export function buildDiscountBoardRefreshButton(guildId) {
  const E = createEmojiResolver(guildId);
  const button = new ButtonBuilder()
    .setCustomId('cardswap:btn_refresh_discount')
    .setLabel('Cập Nhật Bảng Phí')
    .setStyle(ButtonStyle.Secondary);
  const refreshEmoji = E.component('icon_clock');
  if (refreshEmoji) button.setEmoji(refreshEmoji);
  return button;
}

export async function buildDiscountBoardComponents(guildId) {
  const markdown = await buildDiscountBoardMarkdown(guildId);
  
  const container = new ContainerBuilder().setAccentColor(0x3498DB);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(markdown)
  );
  
  const row = new ActionRowBuilder().addComponents(
    buildDiscountBoardRefreshButton(guildId),
  );
  
  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

export async function autoUpdateDiscountBoard(client) {
  const rows = db.prepare('SELECT guild_id, discount_board_channel_id, discount_board_message_id FROM guild_settings WHERE discount_board_channel_id IS NOT NULL AND discount_board_message_id IS NOT NULL').all();
  for (const row of rows) {
    try {
      const channel = await client.channels.fetch(row.discount_board_channel_id).catch(() => null);
      if (!channel) continue;
      
      const msg = await channel.messages.fetch(row.discount_board_message_id).catch(() => null);
      if (!msg) continue;
      
      const payload = await buildDiscountBoardComponents(row.guild_id);
      await msg.edit(payload);
    } catch (e) {
      console.error(`[DISCOUNT BOARD] Lỗi cập nhật bảng chiết khấu cho guild ${row.guild_id}:`, e);
    }
  }
}
