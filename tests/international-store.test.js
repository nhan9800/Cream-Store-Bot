import crypto from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { isInternationalGuild, STORE_TWO_GUILD_ID } from '../src/utils/locale.js';
import { internationalStoreInternals } from '../src/services/internationalStoreSetupService.js';
import { signBinancePayload, binancePayInternals } from '../src/services/binancePayService.js';
import { localizeCommandsForInternationalStore } from '../src/utils/internationalCommands.js';
import { translateProductDescription, translateProductName } from '../src/utils/internationalCatalog.js';
import { priceBoardInternals } from '../src/services/autoSetupPriceBoardService.js';

describe('Store 2 international isolation', () => {
  test('activates only for the configured Store 2 guild', () => {
    expect(isInternationalGuild(STORE_TWO_GUILD_ID)).toBe(true);
    expect(isInternationalGuild('1282637033340403754')).toBe(false);
  });

  test('maps decorated Vietnamese channel and role names without changing IDs', () => {
    expect(internationalStoreInternals.resolveRule('🍇-hợp-tác-đối-tác', [
      [/^hop-tac-doi-tac$/, 'partner-apply'],
    ])).toBe('partner-apply');
    expect(internationalStoreInternals.resolveRule('🍃 ｜ Thành Viên Mới', [
      [/^thanh-vien-moi$/, 'Global Newcomer'],
    ])).toBe('Global Newcomer');
  });

  test('removes default emoji and translates common product duration terms', () => {
    expect(translateProductName('🚀 Gia hạn Discord Nitro 12 Tháng')).toBe('Renewal Discord Nitro 12 Months');
    expect(translateProductDescription('Đăng nhập gia hạn. Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng khi mua.'))
      .toBe('Login-based renewal. Please provide the account credentials and 4–5 backup codes after ordering.');
  });

  test('finds the canonical pricing channel after an international channel migration', async () => {
    const affiliatePricing = {
      name: 'affiliate-pricing',
      parent: { name: 'AFFILIATE PROGRAM' },
      isTextBased: () => true,
      isThread: () => false,
      send: () => null,
    };
    const pricing = {
      name: 'pricing',
      parent: { name: 'GLOBAL MARKETPLACE' },
      isTextBased: () => true,
      isThread: () => false,
      send: () => null,
    };
    const guild = {
      id: STORE_TWO_GUILD_ID,
      channels: {
        fetch: async () => null,
        cache: new Map([['affiliate', affiliatePricing], ['pricing', pricing]]),
      },
    };

    await expect(priceBoardInternals.findPriceChannel(guild, null)).resolves.toBe(pricing);
  });
});

describe('Binance Pay security primitives', () => {
  test('uses the documented HMAC-SHA512 uppercase request signature', () => {
    const timestamp = '1655979032000';
    const nonce = 'abcdefghijklmnopqrstuvwxyzABCDEF';
    const body = '{"merchantTradeNo":"TEST123"}';
    const secretKey = 'merchant-secret';
    const expected = crypto.createHmac('sha512', secretKey)
      .update(`${timestamp}\n${nonce}\n${body}\n`)
      .digest('hex').toUpperCase();
    expect(signBinancePayload({ timestamp, nonce, body, secretKey })).toBe(expected);
  });

  test('sanitizes merchant-visible goods names and keeps trade numbers within 32 chars', () => {
    expect(binancePayInternals.safeGoodsName('🎁 Claude "API" / Gói 100M')).not.toMatch(/[🎁"/]/u);
    expect(binancePayInternals.merchantTradeNo('CN_123456')).toMatch(/^[A-Za-z0-9]{1,32}$/);
  });

  test('parses Binance string webhook payloads without trusting outer fields', () => {
    expect(binancePayInternals.parseWebhookData({
      data: JSON.stringify({ merchantTradeNo: 'CN123', totalFee: '10.50', currency: 'USDT' }),
    })).toEqual({ merchantTradeNo: 'CN123', totalFee: '10.50', currency: 'USDT' });
  });
});

describe('English Discord command localizations', () => {
  test('keeps internal names stable while exposing English names and options', () => {
    const [localized] = localizeCommandsForInternationalStore([{
      name: 'baohanh',
      description: 'Bảo hành',
      options: [{ type: 3, name: 'ma_don', description: 'Mã đơn' }],
    }]);
    expect(localized.name).toBe('baohanh');
    expect(localized.name_localizations['en-US']).toBe('warranty');
    expect(localized.options[0].name).toBe('ma_don');
    expect(localized.options[0].name_localizations['en-US']).toBe('order-code');
  });
});
