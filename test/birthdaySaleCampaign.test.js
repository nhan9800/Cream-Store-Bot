import { describe, expect, it } from 'vitest';
import {
  BIRTHDAY_SALE,
  buildBirthdaySaleComponents,
  isBirthdaySaleMessage,
} from '../src/campaigns/birthdaySale2026.js';

describe('birthday sale campaign', () => {
  it('renders the exact campaign pricing with Components V2', () => {
    const json = buildBirthdaySaleComponents().map((component) => component.toJSON());
    const payload = JSON.stringify(json);

    expect(BIRTHDAY_SALE.channelId).toBe('1515008584549797979');
    expect(payload).toContain(BIRTHDAY_SALE.marker);
    expect(payload).toContain('`02 tháng` **99.000đ**');
    expect(payload).toContain('`12 tháng` **520.000đ**');
    expect(payload).toContain('**Claude API**');
    expect(payload).toContain('`100M`');
    expect(payload).toContain('**Codex API**');
    expect(payload).toContain('`120M`');
    expect(payload).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(payload).toContain('<a:tickgreen:1384069022831874169>');
  });

  it('recognizes only the bot campaign message for idempotent publishing', () => {
    const components = buildBirthdaySaleComponents().map((component) => component.toJSON());
    expect(isBirthdaySaleMessage({ author: { id: 'bot' }, components }, 'bot')).toBe(true);
    expect(isBirthdaySaleMessage({ author: { id: 'other' }, components }, 'bot')).toBe(false);
  });
});
