import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import { buildTicketPanelV2, buildTicketWelcomeV2 } from '../src/utils/embeds.js';
import { normalizeV2Text } from '../src/utils/uiKit.js';
import { STORE_ONE_GUILD_ID } from '../src/utils/locale.js';

const DEFAULT_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

function textBlocks(container) {
  return container.toJSON().components
    .filter((component) => component.type === 10)
    .map((component) => component.content);
}

function buttonLabels(rows) {
  return rows.flatMap((row) => row.toJSON().components.map((button) => button.label));
}

describe('Components V2 layout policy', () => {
  it('normalizes text to a compact, predictable rhythm', () => {
    expect(normalizeV2Text('  title  \n\n\nbody  ')).toBe('title\n\nbody');
  });

  it('keeps the ticket panel aligned and custom-emoji only', () => {
    const view = buildTicketPanelV2({});
    const blocks = textBlocks(view.container);

    expect(view.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(blocks).toHaveLength(3);
    expect(blocks.every((content) => !/\n{3,}/.test(content))).toBe(true);
    expect(blocks.join('\n')).not.toMatch(DEFAULT_EMOJI);
    expect(buttonLabels(view.rows)).toEqual([
      'Mua Hàng',
      'Hỗ Trợ',
      'Khiếu Nại',
      'Hợp Tác',
      'Bảo Hành Sản Phẩm',
      'Kháng 12 Tháng YT',
      'Sửa Panel',
    ]);
  });

  it('keeps ticket welcome content compact for every V2 ticket type', () => {
    for (const type of ['ORDER', 'SUPPORT', 'COMPLAINT', 'PARTNERSHIP', 'WARRANTY', 'APPEAL']) {
      const view = buildTicketWelcomeV2('CN_TEST', '123', type);
      const content = textBlocks(view.container).join('\n');
      expect(view.flags & MessageFlags.IsComponentsV2).toBeTruthy();
      expect(content).not.toMatch(DEFAULT_EMOJI);
      expect(content).not.toMatch(/\n{3,}/);
    }
  });

  it('shows just three gray intake buttons with distinct custom emoji in Store 1', () => {
    const client = global.discordClient;
    const emojis = ['cenar_ui27_cart', 'cenar_ui27_support', 'cenar_ui27_shield'];
    try {
      global.discordClient = { application: { emojis: { cache: new Map(emojis.map((name, index) => {
        const id = String(1569000000000000000n + BigInt(index));
        return [id, { name, id, available: true }];
      })) } } };
      const { container, rows } = buildTicketPanelV2({ guild_id: STORE_ONE_GUILD_ID });
      const buttons = rows.flatMap(row => row.toJSON().components);
      expect(buttonLabels(rows)).toEqual(['Mua hàng', 'Hỗ trợ', 'Bảo hành']);
      expect(buttons.map(action => action.style)).toEqual([2, 2, 2]);
      expect(buttons.map(action => action.emoji.name)).toEqual(emojis);
      expect(buttons.map(action => action.custom_id)).toEqual([
        'ticket:intake:open:order', 'ticket:intake:open:support', 'ticket:intake:open:warranty',
      ]);
      expect(textBlocks(container).join('\n')).not.toMatch(/Khiếu nại|Hợp tác/);
    } finally {
      global.discordClient = client;
    }
  });
});
