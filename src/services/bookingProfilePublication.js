import { createHash } from 'node:crypto';
import { AttachmentBuilder, ChannelType, ContainerBuilder, escapeMarkdown, MediaGalleryBuilder,
  MessageFlags, SeparatorBuilder, TextDisplayBuilder } from 'discord.js';
import sharp from 'sharp';
import { BookingProfileError } from './bookingProfileService.js';
import { listForumPosts } from './forumPublicationService.js';

export const bookingProfileServices = { game: 'Chơi game', voice: 'Trò chuyện', both: 'Chơi game và trò chuyện' };
const fileName = 'cenar-host.png';

export const hostNumber = value => String(value).padStart(4, '0');
const artworkName = number => `Hồ sơ Cenar #${hostNumber(number)}`;

export function bookingProfileText(text) {
  return escapeMarkdown(String(text).replace(/[<>]/g, s => s === '<' ? '‹' : '›'));
}

const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const short = (text, limit) => Array.from(text).length > limit ? `${Array.from(text).slice(0, limit - 1).join('')}…` : text;
const ratingLabel = ({ count, average }) => count > 0 ? `${average}/5 · ${count} đánh giá` : 'Chưa có đánh giá';

export async function renderBookingHostCard(profile, rating, template) {
  const number = hostNumber(profile.profile_number);
  const { name, service } = profile.approved;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 285" width="720" height="285">
    <rect width="720" height="285" rx="24" fill="#18152e"/>
    <rect x="0" y="30" width="7" height="225" rx="4" fill="${xml(template.accent)}"/>
    <path d="M610 0h110v285H560l150-285" fill="#221d3c"/>
    <text x="36" y="52" fill="#ddd8ff" font-family="sans-serif" font-size="20" font-weight="bold">${xml(short(template.title, 32))}</text>
    <text x="675" y="52" text-anchor="end" fill="#e8e2ff" font-family="sans-serif" font-size="22">#${number}</text>
    <text x="36" y="125" fill="white" font-family="sans-serif" font-size="40" font-weight="bold">${xml(short(name, 26))}</text>
    <text x="38" y="173" fill="#dcd5ff" font-family="sans-serif" font-size="22">${xml(bookingProfileServices[service])}</text>
    <path d="M38 205h644" stroke="#4b426e"/>
    <text x="38" y="249" fill="#eee9ff" font-family="sans-serif" font-size="20">${xml(ratingLabel(rating))}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const safeMentions = { parse: [], repliedUser: false };
const marker = (emoji, key) => emoji?.[key]?.id ? `<${emoji[key].animated ? 'a' : ''}:${emoji[key].name}:${emoji[key].id}> ` : '';
const block = content => new TextDisplayBuilder().setContent(content);

export async function buildBookingProfilePost(profile, rating, template, emoji) {
  const { name, tagline, service, games, availability } = profile.approved;
  const card = new ContainerBuilder().setAccentColor(parseInt(template.accent.slice(1), 16))
    .addTextDisplayComponents(block(`## ${marker(emoji, 'profiles')}${bookingProfileText(name)}\n-# Host Cenar #${hostNumber(profile.profile_number)}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(block(`${bookingProfileText(tagline)}\n\n**Dịch vụ** · ${bookingProfileServices[service]}\n**Game / chủ đề** · ${bookingProfileText(games)}\n**Giờ rảnh (UTC+7)** · ${bookingProfileText(availability)}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(block(`${marker(emoji, 'reviews')}**Đánh giá** · ${ratingLabel(rating)}`));
  const image = await renderBookingHostCard(profile, rating, template);
  card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(item =>
    item.setURL(`attachment://${fileName}`).setDescription(`Thẻ hồ sơ host Cenar #${hostNumber(profile.profile_number)}`)));
  return { flags: MessageFlags.IsComponentsV2, components: [card], files: [new AttachmentBuilder(image, { name: fileName })], allowedMentions: safeMentions };
}

function buildBookingReviewPost(review, profile, emoji) {
  const card = new ContainerBuilder().setAccentColor(0x4eac9d)
    .addTextDisplayComponents(block(`## ${marker(emoji, 'reviews')}Đánh giá phiên Cenar\n**Điểm** · ${review.rating}/5`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(block(`**Host** · #${hostNumber(profile.profile_number)}\n**Nhận xét của khách**\n${bookingProfileText(review.feedback)}`));
  return { flags: MessageFlags.IsComponentsV2, components: [card], allowedMentions: safeMentions };
}

async function loadForum(guild, forumId) {
  const forum = forumId ? await guild.channels.fetch(forumId) : null;
  if (forum?.type !== ChannelType.GuildForum || forum.guildId !== guild.id) {
    throw new BookingProfileError('Diễn đàn Cenar đang chưa sẵn sàng. Staff có thể thử lại sau.');
  }
  return forum;
}

async function findOrUpdatePost({ guild, forumId, threadId, name, makePayload, existingOnly = false, service }) {
  const forum = await loadForum(guild, forumId);
  const bot = guild.client.user.id;
  let thread = threadId && await guild.channels.fetch(threadId).catch(error => {
    if (error.code === 10003) return null;
    throw error;
  });
  if (!thread) {
    // The starter may have been created just before a timeout or restart.
    const found = [...(await listForumPosts(forum)).values()].filter(post => post.name === name && post.ownerId === bot);
    if (found.length > 1) throw new BookingProfileError('Có nhiều bài cùng mã. Staff cần đối chiếu trước khi đăng lại.');
    [thread] = found;
  }
  if (existingOnly && !thread) return null;
  const payload = await makePayload();
  const services = new Set(service === 'both' ? ['Chơi game', 'Trò chuyện'] : [bookingProfileServices[service]]);
  const serviceTags = forum.availableTags.filter(tag => services.has(tag.name)).map(tag => tag.id);
  if (!thread) {
    return forum.threads.create({ name, message: payload, appliedTags: serviceTags, reason: 'Cenar Booking · Staff duyệt nội dung' });
  }
  if (thread.parentId !== forum.id || thread.ownerId !== bot || thread.name !== name) {
    throw new BookingProfileError('Bài diễn đàn đã đổi liên kết hoặc tiêu đề. Staff cần kiểm tra trước khi sửa.');
  }
  const starter = await thread.fetchStarterMessage();
  if (starter?.author.id !== bot) throw new BookingProfileError('Bot không sở hữu bài diễn đàn này.');
  if (thread.archived) await thread.setArchived(false);
  await starter.edit({ ...payload, attachments: [] });
  if (service) {
    const bookingTagIds = new Set(forum.availableTags.filter(tag => ['Chơi game', 'Trò chuyện'].includes(tag.name)).map(tag => tag.id));
    const tags = [...new Set([...thread.appliedTags.filter(id => !bookingTagIds.has(id)), ...serviceTags])];
    if (tags.length <= 5 && (thread.appliedTags.length !== tags.length || tags.some(id => !thread.appliedTags.includes(id)))) {
      await thread.setAppliedTags(tags, 'Cenar Booking · Đồng bộ nhóm dịch vụ');
    }
  }
  return thread;
}

export function publishBookingHost({ guild, portal, profile, rating, template }) {
  return findOrUpdatePost({ guild, forumId: portal.profiles, threadId: profile.forum_thread_id,
    name: artworkName(profile.profile_number), service: profile.approved.service,
    makePayload: () => buildBookingProfilePost(profile, rating, template, portal.emoji) });
}

export function unpublishBookingHost({ guild, portal, profile }) {
  return findOrUpdatePost({ guild, forumId: portal.profiles, threadId: profile.forum_thread_id,
    name: artworkName(profile.profile_number), existingOnly: true, makePayload: () => ({
      flags: MessageFlags.IsComponentsV2, allowedMentions: safeMentions,
      components: [new ContainerBuilder().addTextDisplayComponents(block('Hồ sơ này đã được ẩn theo yêu cầu của host.'))],
    }) });
}

export function publishBookingReview({ guild, portal, review, profile }) {
  const ref = createHash('sha256').update(`cenar-review:${review.ticket_id}`).digest('hex').slice(0, 12);
  return findOrUpdatePost({ guild, forumId: portal.reviews, threadId: review.forum_thread_id,
    name: `Đánh giá Cenar · ${ref}`, makePayload: () => buildBookingReviewPost(review, profile, portal.emoji) });
}
