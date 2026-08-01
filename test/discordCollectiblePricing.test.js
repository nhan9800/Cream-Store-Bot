import { describe, expect, it } from 'vitest';
import { getDiscordCollectibleShopPrice } from '../src/services/discordCollectiblePricing.js';

describe('Discord collectible pricing', () => {
  it('uses the Nitro Boost table supplied by the store', () => {
    expect(getDiscordCollectibleShopPrice(66_000, true)).toBe(25_000);
    expect(getDiscordCollectibleShopPrice(146_000, true)).toBe(105_000);
    expect(getDiscordCollectibleShopPrice(189_000, true)).toBe(125_000);
  });

  it('rejects an unconfigured standard tier instead of guessing a price', () => {
    expect(getDiscordCollectibleShopPrice(79_000, false)).toBe(35_000);
    expect(getDiscordCollectibleShopPrice(146_000, false)).toBe(115_000);
    expect(getDiscordCollectibleShopPrice(66_000, false)).toBeNull();
  });
});
