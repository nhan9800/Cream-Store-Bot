import Database from 'better-sqlite3';
import { ChannelType, MessageFlags } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookingProfileTemplate, createBookingProfileService } from '../src/services/bookingProfileService.js';
import { buildBookingProfilePost, publishBookingHost, unpublishBookingHost } from '../src/services/bookingProfilePublication.js';
import { STORE_TWO_GUILD_ID } from '../src/utils/locale.js';

const validDraft = { name: 'Ánh <@123>', tagline: 'Chơi vui & lịch sự', games: 'Valorant', availability: '21–23h', service: 'game', consent: true };
const session = { ticket_id: 12, guild_id: STORE_TWO_GUILD_ID, customer_id: 'guest', host_id: 'host', status: 'COMPLETED' };

function forumFixture() {
  const threads = new Map();
  const starter = { author: { id: 'bot' }, edit: vi.fn() };
  const makeThread = (name, appliedTags) => ({
    id: 'threadId', ownerId: 'bot', parentId: 'forumId', name, archived: false, appliedTags,
    fetchStarterMessage: async () => starter,
  });
  const forum = {
    id: 'forumId', type: ChannelType.GuildForum, guildId: STORE_TWO_GUILD_ID,
    availableTags: [{ id: 'game', name: 'Chơi game' }],
    threads: {
      fetchActive: async () => ({ threads }),
      fetchArchived: async () => ({ threads: new Map(), hasMore: false }),
      create: vi.fn(async ({ name, appliedTags }) => {
        const thread = makeThread(name, appliedTags);
        threads.set(thread.id, thread);
        return thread;
      }),
    },
  };
  const guild = { id: STORE_TWO_GUILD_ID, client: { user: { id: 'bot' } },
    channels: { fetch: async id => id === forum.id ? forum : threads.get(id) } };
  return { guild, forum, starter, portal: { profiles: forum.id, emoji: {} } };
}

describe('Cenar host profiles and completed booking reviews', () => {
  let db;
  let profiles;
  beforeEach(() => {
    db = new Database(':memory:');
    profiles = createBookingProfileService(db);
  });
  afterEach(() => db.close());

  it('separates the reviewed profile and draft, rejecting missing consent and stale versions', () => {
    profiles.saveDraft('host', { ...validDraft, consent: false });
    expect(() => profiles.approve('host', 1)).toThrow(/đồng ý/);
    profiles.saveDraft('host', validDraft);
    expect(() => profiles.approve('host', 1)).toThrow(/Bản nháp/);
    expect(profiles.approve('host', 2).profile_number).toBe(1);
    profiles.saveDraft('host', { ...validDraft, name: 'Tên mới' });
    expect(profiles.get('host').approved.name).toBe(validDraft.name);
    expect(profiles.get('host').draft.name).toBe('Tên mới');
    expect(profiles.approve('host', 3).profile_number).toBe(1);
  });

  it('allocates the smallest available host number and reloads persisted data', () => {
    profiles.saveDraft('host', validDraft);
    profiles.approve('host', 1);
    db.prepare('UPDATE booking_host_profiles SET profile_number=3 WHERE host_id=?').run('host');
    profiles.saveDraft('new-host', validDraft);
    expect(profiles.approve('new-host', 1).profile_number).toBe(1);
    expect(createBookingProfileService(db).get('host').approved.name).toBe(validDraft.name);
  });

  it('revokes approval and requires fresh consent before the stable number can be republished', () => {
    profiles.saveDraft('host', validDraft);
    profiles.approve('host', 1);
    expect(() => profiles.saveDraft('host', { ...validDraft, consent: false })).toThrow(/ẩn hồ sơ/);
    profiles.hide('host');
    expect(profiles.get('host').approved).toBeNull();
    expect(() => profiles.approve('host', 2)).toThrow(/đồng ý/);
    profiles.saveDraft('host', validDraft);
    expect(profiles.approve('host', 3).profile_number).toBe(1);
  });

  it('accepts one rating only from the customer of a completed Store2 session', () => {
    const feedback = { rating: 5, feedback: 'Rất đúng giờ', consent: true };
    expect(() => profiles.createReview(session, 'stranger', feedback)).toThrow(/Chỉ khách/);
    expect(() => profiles.createReview({ ...session, guild_id: 'other' }, 'guest', feedback)).toThrow(/Chỉ khách/);
    expect(() => profiles.createReview({ ...session, status: 'ACTIVE' }, 'guest', feedback)).toThrow(/Chỉ khách/);
    expect(() => profiles.createReview(session, 'guest', { ...feedback, rating: 6 })).toThrow(/điểm/);
    expect(() => profiles.createReview(session, 'guest', { ...feedback, feedback: '' })).toThrow(/nhận xét/);
    profiles.createReview(session, 'guest', feedback);
    profiles.createReview({ ...session, ticket_id: 13 }, 'guest', { rating: 2 });
    expect(() => profiles.createReview(session, 'guest', feedback)).toThrow(/đã đánh giá/);
    expect(profiles.ratingFor('host')).toEqual({ count: 2, average: 3.5 });
    expect(profiles.getReview(12).consent).toBe(1);
    expect(profiles.getReview(13).consent).toBe(0);
  });

  it('renders the Cenar card in memory with accessible text and suppressed mentions', async () => {
    profiles.saveDraft('host', validDraft);
    const profile = profiles.approve('host', 1);
    profiles.setTemplate('Cenar · Thẻ host', '#685acd');
    expect(() => profiles.setTemplate('Cenar', 'blue')).toThrow(/dạng/);
    const payload = await buildBookingProfilePost(profile, { count: 1, average: 5 }, profiles.getTemplate(), {});
    const card = payload.components[0].toJSON();
    expect(card.accent_color).toBe(0x685acd);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(JSON.stringify(card)).not.toContain('<@123>');
    expect(JSON.stringify(card)).toContain('5/5');
    expect(payload.files[0].attachment.subarray(1, 4).toString()).toBe('PNG');
  });

  it('reuses a bot-owned thread after a lost acknowledgement and strips attachments when hidden', async () => {
    const { forum, guild, portal, starter } = forumFixture();
    profiles.saveDraft('host', validDraft);
    const profile = profiles.approve('host', 1);
    const request = { guild, portal, profile, rating: { count: 0 }, template: bookingProfileTemplate };
    const first = await publishBookingHost(request);
    const recovered = await publishBookingHost(request);
    expect(first.id).toBe(recovered.id);
    expect(forum.threads.create).toHaveBeenCalledTimes(1);
    expect(first.appliedTags).toEqual(['game']);
    expect(starter.edit).toHaveBeenCalledTimes(1);
    await unpublishBookingHost({ guild, portal, profile: { ...profile, forum_thread_id: first.id } });
    expect(starter.edit.mock.lastCall[0].attachments).toEqual([]);
    expect(JSON.stringify(starter.edit.mock.lastCall[0].components)).not.toContain('Valorant');
  });

  it('refuses to edit an unrelated thread using a stale saved ID', async () => {
    const { guild, portal, forum } = forumFixture();
    profiles.saveDraft('host', validDraft);
    const profile = profiles.approve('host', 1);
    const unrelated = await forum.threads.create({ name: 'Bài đăng khác', appliedTags: [] });
    await expect(publishBookingHost({ guild, portal, profile: { ...profile, forum_thread_id: unrelated.id },
      rating: { count: 0 }, template: bookingProfileTemplate })).rejects.toThrow(/liên kết hoặc tiêu đề/);
    expect(forum.threads.create).toHaveBeenCalledTimes(1);
  });
});
