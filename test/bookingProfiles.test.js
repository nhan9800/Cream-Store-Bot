import Database from 'better-sqlite3';
import { ChannelType, MessageFlags } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { bookingProfileTemplate, createBookingProfileService } from '../src/services/bookingProfileService.js';
import { buildBookingProfilePost, buildBookingReviewPost, publishBookingHost, refreshPublishedBookingProfileLayouts,
  unpublishBookingHost } from '../src/services/bookingProfilePublication.js';
import { STORE_TWO_GUILD_ID } from '../src/utils/locale.js';

const validDraft = { name: 'Ánh <@123>', tagline: 'Chơi vui & lịch sự', games: 'Valorant', availability: '21–23h', service: 'game', consent: true };
const session = { ticket_id: 12, guild_id: STORE_TWO_GUILD_ID, customer_id: 'guest', host_id: 'host', status: 'COMPLETED' };

function forumFixture() {
  const threads = new Map();
  const starter = { author: { id: 'bot' }, edit: vi.fn() };
  const makeThread = (name, appliedTags) => ({
    id: 'threadId', type: ChannelType.PublicThread, ownerId: 'bot', parentId: 'forumId', name, archived: false, appliedTags,
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

  it('keeps host images private until their reviewed revision and draws only the approved portrait', async () => {
    const makePhoto = background => sharp({ create: { width: 192, height: 192, channels: 3, background } }).webp().toBuffer();
    const first = await makePhoto('#dd7700');
    const replacement = await makePhoto('#2255bb');
    profiles.saveDraft('host', validDraft);
    profiles.approve('host', 1);
    profiles.setHostThread('host', 'threadId');

    const submitted = profiles.stagePhoto('host', first);
    expect(submitted.draft_revision).toBe(2);
    expect(profiles.getDraftPhoto('host')).toEqual(first);
    expect(profiles.getPublished(1)).not.toHaveProperty('approvedPhoto');
    expect(() => profiles.approve('host', 1)).toThrow(/Bản nháp/);
    profiles.approve('host', 2);
    profiles.stagePhoto('host', replacement);
    expect(createBookingProfileService(db).publishedPage(1).profile.approvedPhoto).toEqual(first);
    expect(profiles.hasPendingPhoto('host')).toBe(true);

    const card = await buildBookingProfilePost(profiles.getPublished(1), { count: 0 }, bookingProfileTemplate, {});
    const pixel = await sharp(card.files[0].attachment).extract({ left: 778, top: 192, width: 1, height: 1 }).raw().toBuffer();
    expect([pixel[0], pixel[1], pixel[2]]).toEqual([221, 119, 0].map(value => expect.closeTo(value, -1)));
    expect(JSON.stringify(card.components[0].toJSON())).toContain('ảnh host đã được duyệt');
    expect(card.files).toHaveLength(1);
    profiles.hide('host');
    expect(profiles.getDraftPhoto('host')).toBeNull();
    expect(profiles.getPublished(1)).toBeNull();
  });

  it('retries removing private photo bytes from a previously published card without replacing the thread', async () => {
    const { guild, forum, portal, starter } = forumFixture();
    const photo = await sharp({ create: { width: 192, height: 192, channels: 3, background: '#cc5633' } }).webp().toBuffer();
    profiles.saveDraft('host', validDraft);
    profiles.stagePhoto('host', photo);
    const approved = profiles.approve('host', 2);
    const thread = await publishBookingHost({ guild, portal, profile: profiles.withApprovedPhoto(approved), rating: { count: 0 }, template: bookingProfileTemplate });
    profiles.setHostThread('host', thread.id);
    expect(profiles.removePhoto('host')).toEqual({ removed: true, sync: true });
    expect(profiles.getDraftPhoto('host')).toBeNull();
    expect(profiles.publishedPage(1).profile.approvedPhoto).toBeUndefined();
    expect(profiles.removePhoto('host')).toEqual({ removed: false, sync: true });

    const args = { guild, portal: { ...portal, reviews: 'reviewsId' }, db };
    starter.edit.mockRejectedValueOnce(new Error('Discord busy'));
    starter.components = forum.threads.create.mock.calls[0][0].message.components.map(component => component.toJSON());
    expect((await refreshPublishedBookingProfileLayouts(args)).failed).toBe(1);
    expect(profiles.removePhoto('host').sync).toBe(true);
    expect((await refreshPublishedBookingProfileLayouts(args)).updated).toBe(1);
    expect(starter.edit.mock.lastCall[0].attachments).toEqual([]);
    expect(JSON.stringify(starter.edit.mock.lastCall[0].components)).not.toContain('ảnh host đã được duyệt');
    expect(profiles.removePhoto('host').sync).toBe(false);
    expect(forum.threads.create).toHaveBeenCalledTimes(1);
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
    const bookingChannel = '1573607352555405365';
    const reviewChannel = '1573607355235434537';
    const payload = await buildBookingProfilePost(profile, { count: 1, average: 5 }, profiles.getTemplate(), {},
      { guildId: STORE_TWO_GUILD_ID, request: bookingChannel, reviews: reviewChannel });
    const card = payload.components[0].toJSON();
    expect(card.accent_color).toBe(0x685acd);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(JSON.stringify(card)).not.toContain('<@123>');
    expect(JSON.stringify(card)).toContain('5/5');
    expect(card.components.at(-1).components.map(button => [button.label, button.url])).toEqual([
      ['Đặt lịch', `https://discord.com/channels/${STORE_TWO_GUILD_ID}/${bookingChannel}`],
      ['Xem đánh giá', `https://discord.com/channels/${STORE_TWO_GUILD_ID}/${reviewChannel}`],
    ]);
    expect(payload.files[0].attachment.subarray(1, 4).toString()).toBe('PNG');
    expect(payload.files[0].attachment.readUInt32BE(16)).toBe(960);
    expect(payload.files[0].attachment.readUInt32BE(20)).toBe(384);
  });

  it('shows a published review and profile link without rendering private identities', () => {
    const privateCustomer = '1555111888222666333';
    const forumThread = '1573607342555405365';
    const review = { ...session, customer_id: privateCustomer, rating: 4, feedback: 'Cùng chơi tốt <@1555111888222666333>' };
    const payload = buildBookingReviewPost(review, { profile_number: 7, forum_thread_id: forumThread }, {}, STORE_TWO_GUILD_ID);
    const card = payload.components[0].toJSON();
    expect(card.components[0].content).toContain('ĐÁNH GIÁ ẨN DANH');
    expect(card.components[0].content).toContain('4/5');
    expect(card.components[0].content).toContain('#0007');
    expect(JSON.stringify(card)).not.toContain(privateCustomer);
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(card.components.at(-1).components[0].url).toBe(`https://discord.com/channels/${STORE_TWO_GUILD_ID}/${forumThread}`);
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

  it('refreshes an old layout in place and skips current or archived posts', async () => {
    const { guild, forum, portal, starter } = forumFixture();
    profiles.saveDraft('host', validDraft);
    const profile = profiles.approve('host', 1);
    const thread = await publishBookingHost({ guild, portal, profile, rating: { count: 0 }, template: bookingProfileTemplate });
    profiles.setHostThread('host', thread.id);
    const args = { guild, portal: { ...portal, reviews: 'reviewsId' }, db };
    thread.archived = true;
    expect(await refreshPublishedBookingProfileLayouts(args)).toEqual({ updated: 0, skipped: 1, failed: 0 });
    expect(starter.edit).not.toHaveBeenCalled();
    thread.archived = false;
    expect(await refreshPublishedBookingProfileLayouts(args)).toEqual({ updated: 1, skipped: 0, failed: 0 });
    const [update] = starter.edit.mock.lastCall;
    expect(update.attachments).toEqual([]);
    starter.components = update.components.map(component => component.toJSON());
    expect(await refreshPublishedBookingProfileLayouts(args)).toEqual({ updated: 0, skipped: 1, failed: 0 });
    expect(starter.edit).toHaveBeenCalledTimes(1);
    expect(forum.threads.create).toHaveBeenCalledTimes(1);
  });
});
