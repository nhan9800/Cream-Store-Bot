import { describe, expect, it } from 'vitest';
import { consumeManualAnnouncementWrite, withOwnerMessageEdit } from '../src/utils/manualAnnouncementWrite.js';

const channelId = '1515008584549797979', messageId = '1570837979306528850';
const options = () => ({ method: 'PATCH', fullRoute: `/channels/${channelId}/messages/${messageId}`,
  body: { allowed_mentions: { parse: [], users: [], roles: [] }, components: [] } });
describe('owner-authorized silent message edit', () => {
  it('allows only one PATCH of the exact message by the same client with all mentions disabled', async () => {
    const rest = {};
    await withOwnerMessageEdit({ rest, channelId, messageId }, async () => {
      expect(consumeManualAnnouncementWrite({}, options())).toBe(false);
      expect(consumeManualAnnouncementWrite(rest, { ...options(), fullRoute: `/channels/${channelId}/messages/1570837982162853989` })).toBe(false);
      expect(consumeManualAnnouncementWrite(rest, { ...options(), method: 'POST' })).toBe(false);
      expect(consumeManualAnnouncementWrite(rest, { ...options(), body: { allowed_mentions: { parse: [], users: [], roles: ['1282638730812854345'] } } })).toBe(false);
      expect(consumeManualAnnouncementWrite(rest, options())).toBe(true);
      expect(consumeManualAnnouncementWrite(rest, options())).toBe(false);
    });
    expect(consumeManualAnnouncementWrite(rest, options())).toBe(false);
  });
  it('revokes an unused grant when the operation throws', async () => {
    const rest = {};
    await expect(withOwnerMessageEdit({ rest, channelId, messageId }, async () => { throw new Error('before dispatch'); })).rejects.toThrow('before dispatch');
    expect(consumeManualAnnouncementWrite(rest, options())).toBe(false);
  });
});
