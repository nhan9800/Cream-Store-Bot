import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_WEB_PREFIX,
  parseWebsiteRelay,
  presentArchivedSupportMessages,
  presentSupportMessage,
  SUPPORT_TEAM_NAME,
  SUPPORT_TEAM_PREFIX,
  websiteRelayPrefix,
} from '../src/services/supportIdentity.js';

describe('support public identity', () => {
  it('uses one team identity for staff relays and keeps customers identifiable', () => {
    expect(websiteRelayPrefix('admin')).toBe(SUPPORT_TEAM_PREFIX);
    expect(websiteRelayPrefix('staff')).toBe(SUPPORT_TEAM_PREFIX);
    expect(websiteRelayPrefix('member')).toBe(CUSTOMER_WEB_PREFIX);
  });

  it('parses current and legacy website relay messages', () => {
    expect(parseWebsiteRelay(`${SUPPORT_TEAM_PREFIX}: Xin chào`)).toEqual({
      authorType: 'staff',
      authorName: SUPPORT_TEAM_NAME,
      content: 'Xin chào',
    });
    expect(parseWebsiteRelay('**[Staff Admin A từ Web]**: Đang kiểm tra')).toMatchObject({
      authorType: 'staff',
      authorName: 'Admin A',
      content: 'Đang kiểm tra',
    });
  });

  it('removes staff identity for customers but preserves it for internal staff', () => {
    const message = { authorType: 'staff', authorName: 'Admin A', authorAvatar: 'private.png', content: 'OK' };
    expect(presentSupportMessage(message, 'member')).toEqual({
      ...message,
      authorName: SUPPORT_TEAM_NAME,
      authorAvatar: null,
    });
    expect(presentSupportMessage(message, 'admin')).toBe(message);
  });

  it('replays archived website relays without exposing individual staff identity', () => {
    const messages = presentArchivedSupportMessages([
      {
        id: '1',
        createdAt: '2026-09-28T02:30:00.000Z',
        content: `${CUSTOMER_WEB_PREFIX}: Em cần kiểm tra đơn`,
        author: { id: 'bot', username: 'Cenar Store', bot: true },
        attachments: [],
        embeds: [],
      },
      {
        id: '2',
        createdAt: '2026-09-28T02:31:00.000Z',
        content: '**[Staff Nhân từ Web]**: Bên mình đang kiểm tra',
        author: { id: 'bot', username: 'Cenar Store', bot: true },
        attachments: [{ name: 'bien-nhan.png' }],
        embeds: [],
      },
    ], { customerId: 'customer', audienceRole: 'member' });

    expect(messages).toEqual([
      expect.objectContaining({ authorType: 'customer', authorName: 'Khách hàng', content: 'Em cần kiểm tra đơn' }),
      expect.objectContaining({
        authorType: 'staff',
        authorName: SUPPORT_TEAM_NAME,
        authorAvatar: null,
        content: 'Bên mình đang kiểm tra\nTệp đính kèm: bien-nhan.png',
      }),
    ]);
  });
});
