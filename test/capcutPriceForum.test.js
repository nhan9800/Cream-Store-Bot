import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
const mocks = vi.hoisted(() => ({ products: [], posts: new Map(), upsert: vi.fn() }));
vi.mock('../src/services/productCatalogService.js', () => ({ getActiveProducts: () => mocks.products }));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: () => ({}) }));
vi.mock('../src/services/forumPublicationService.js', () => ({ listForumPosts: async () => mocks.posts, upsertForumPost: mocks.upsert }));
import { buildPriceForumEntries, buildPriceGroupPayload, refreshCapcutPriceForumPost } from '../src/services/autoSetupPriceBoardService.js';
const guildId = '1282637033340403754';
const product = { id: 1, product_key: 'capcut-pro-1-thang-2-thiet-bi-cap-acc', name: 'CapCut Pro 1 Tháng', price: 100000, duration_months: 1, service_type: 'AI', is_active: 1 };
const group = { key: 'creative_tools', title: 'CapCut Pro & Office 365', titleSlot: 'brand_capcut', note: 'Các gói hiện có' };
beforeEach(() => { vi.clearAllMocks(); mocks.products = [product]; mocks.posts = new Map(); mocks.upsert.mockResolvedValue({ id: 'existing' }); });
const buttons = payload => payload.components.flatMap(component => component.toJSON().components || []).filter(component => component.custom_id === 'capcut:price:edit');

describe('CapCut forum price controls', () => {
  it('adds the Admin control only to a Store1 creative page with current CapCut products', () => {
    expect(buttons(buildPriceGroupPayload(guildId, group, [product]))).toHaveLength(1);
    expect(buttons(buildPriceGroupPayload('999999999999999999', group, [product]))).toHaveLength(0);
    expect(buttons(buildPriceGroupPayload(guildId, group, [{ ...product, product_key: 'office-365', name: 'Office 365' }]))).toHaveLength(0);
  });
  it('updates the existing creative post only, with mentions disabled; never recreates a missing post', async () => {
    const guild = { id: guildId, client: { user: { id: 'bot' } }, channels: { fetch: vi.fn().mockResolvedValue({ type: ChannelType.GuildForum }) } };
    const entry = buildPriceForumEntries(guildId, {}, [product]).find(item => item.key === 'creative_tools');
    mocks.posts.set('existing', { id: 'existing', name: entry.name, ownerId: 'bot' });
    await refreshCapcutPriceForumPost(guild);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0][2].key).toBe('creative_tools');
    expect(mocks.upsert.mock.calls[0][2].payloads.every(payload => payload.allowedMentions.parse.length === 0)).toBe(true);
    mocks.posts.clear(); mocks.upsert.mockClear();
    await expect(refreshCapcutPriceForumPost(guild)).rejects.toThrow(/hiện có/);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
