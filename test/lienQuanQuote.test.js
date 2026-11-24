import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelType, Collection, ComponentType, ContainerComponent } from 'discord.js';
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID } from '../src/utils/locale.js';
import {
  buildLienQuanAccountCard, lienQuanImageName, LIEN_QUAN_ACCOUNTS, LIEN_QUAN_BUTTON_PREFIX,
  LIEN_QUAN_ATTACHMENT_LIMIT, LIEN_QUAN_CATEGORY_ID, LIEN_QUAN_CHANNEL, LIEN_QUAN_PRICE,
} from '../src/utils/lienQuanCatalog.js';

const mockTicket = vi.hoisted(() => vi.fn());
vi.mock('../src/events/ticketHandlers.js', () => ({ handleTicketCreate: mockTicket }));
import { handleLienQuanQuote } from '../src/events/lienQuanQuoteHandler.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const attachmentId = '1574741468852260894';
function button(account, { guildId = STORE_ONE_GUILD_ID, author = 'bot', photoName = lienQuanImageName(account),
  origin = 'https://cdn.discordapp.com', parentId = LIEN_QUAN_CATEGORY_ID } = {}) {
  const photo = { attachment_id: attachmentId, content_type: 'image/jpeg',
    url: `${origin}/attachments/shop/${attachmentId}/${photoName}?signature=example` };
  const container = new ContainerComponent({ type: ComponentType.Container, components: [{
    type: ComponentType.MediaGallery, items: [{ media: photo }],
  }] });
  return {
    customId: LIEN_QUAN_BUTTON_PREFIX + account.code,
    guildId, client: { user: { id: 'bot' } }, isButton: () => true,
    channel: { id: 'shop', name: LIEN_QUAN_CHANNEL, parentId, type: ChannelType.GuildText },
    message: { author: { id: author }, attachments: new Collection(), components: [container] },
    deferReply: vi.fn(), reply: vi.fn(), editReply: vi.fn(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Liên Quân purchase cards', () => {
  it.each(LIEN_QUAN_ACCOUNTS)('renders and sends the exact attachment for $code', async account => {
    const card = buildLienQuanAccountCard(account, { buyId: '123456789012345678' });
    const source = button(account);
    const parts = card.components[0].components;
    expect(parts.flatMap(p => p.components || []).map(c => c.custom_id)).toEqual([source.customId]);
    expect(parts.flatMap(p => p.items || [])[0].media.url).toBe(`attachment://${lienQuanImageName(account)}`);
    expect(parts.map(p => p.content).join('\n')).toContain(LIEN_QUAN_PRICE);
    const fetch = vi.fn(async () => new Response(jpeg));
    vi.stubGlobal('fetch', fetch);
    await handleLienQuanQuote(source);
    expect(source.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(fetch.mock.lastCall[0].href).toBe(source.message.components[0].components[0].items[0].media.url);
    expect(mockTicket).toHaveBeenCalledWith(source, 'ORDER', null, { intake: {
      title: `Acc Liên Quân · ${account.code}`,
      text: expect.stringContaining(`${account.heroes} tướng`),
      attachment: { attachment: jpeg, name: lienQuanImageName(account), description: expect.any(String) },
    } });
  });

  it('rejects another guild, wrong location, another author, wrong photo and untrusted hosts before any download', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const override of [{ guildId: STORE_TWO_GUILD_ID }, { parentId: 'elsewhere' }, { author: 'other' },
      { photoName: 'acc-lien-quan-03.jpg' }, { origin: 'https://invalid.example' }]) {
      const target = button(LIEN_QUAN_ACCOUNTS[0], override);
      await handleLienQuanQuote(target);
      expect(target.reply).toHaveBeenCalled();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(mockTicket).not.toHaveBeenCalled();
  });

  it.each([
    ['unavailable', () => new Response(null, { status: 404 })],
    ['oversized', () => new Response(Buffer.alloc(LIEN_QUAN_ATTACHMENT_LIMIT + 1))],
    ['invalid', () => new Response('not a JPEG')],
  ])('returns a private retry prompt when the photo is %s', async (_reason, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    const target = button(LIEN_QUAN_ACCOUNTS[0]);
    await handleLienQuanQuote(target);
    expect(target.editReply.mock.lastCall[0].content).toContain('LQ-01');
    expect(mockTicket).not.toHaveBeenCalled();
  });
});
