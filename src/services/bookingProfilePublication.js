import { createHash } from 'node:crypto';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder,
  escapeMarkdown, MediaGalleryBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';
import sharp from 'sharp';
import { BookingProfileError, createBookingProfileService } from './bookingProfileService.js';
import { listForumPosts } from './forumPublicationService.js';
import { STORE_TWO_GUILD_ID } from '../utils/locale.js';

export const bookingProfileServices = { game: 'Chơi game', voice: 'Trò chuyện', both: 'Chơi game và trò chuyện' };
const fileName = 'cenar-host.png';
const bookingIndigo = 0x7167db;
const bookingMint = 0x65c4b0;
const publishingHosts = new Set();
const hostHeadline = '-# HỒ SƠ HOST · ';
const reviewHeadline = '-# PHIÊN ĐÃ HOÀN THÀNH · ĐÁNH GIÁ ẨN DANH';
const portraitSide = 154;
const portraitMask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${portraitSide}" height="${portraitSide}"><rect width="${portraitSide}" height="${portraitSide}" rx="27" fill="white"/></svg>`);

export async function withBookingHostUpdate(hostId, update) {
  if (publishingHosts.has(hostId)) throw new BookingProfileError('Đang cập nhật nội dung này. Vui lòng thử lại sau.');
  publishingHosts.add(hostId);
  try {
    return await update();
  } finally {
    publishingHosts.delete(hostId);
  }
}

export const hostNumber = value => String(value).padStart(4, '0');
const artworkName = number => `Hồ sơ Cenar #${hostNumber(number)}`;

export function bookingProfileText(text) {
  return escapeMarkdown(String(text).replace(/[<>]/g, s => s === '<' ? '‹' : '›'));
}

const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const segmenter = new Intl.Segmenter('vi', { granularity: 'grapheme' });
const graphemes = text => Array.from(segmenter.segment(text), part => part.segment);
const ratingLabel = ({ count, average }) => count > 0
  ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(average)}/5 · ${count} đánh giá` : 'Chưa có đánh giá';

function short(text, limit) {
  const parts = graphemes(text);
  return parts.length > limit ? `${parts.slice(0, limit - 1).join('')}…` : text;
}

export async function renderBookingHostCard(profile, rating, template) {
  const number = hostNumber(profile.profile_number);
  const { name, service } = profile.approved;
  const accent = /^#[\da-f]{6}$/i.test(template.accent) ? template.accent : '#7167db';
  const words = name.match(/[\p{L}\p{M}\p{N}]+/gu) ?? ['C'];
  const initials = words.slice(0, 2).map(word => graphemes(word)[0]).join('').toLocaleUpperCase('vi-VN');
  const nameParts = graphemes(name);
  const wideName = nameParts.some(part => /\p{Script=Han}|\p{Script=Hangul}|\p{Script=Katakana}|\p{Script=Hiragana}|\p{Extended_Pictographic}/u.test(part));
  const limit = wideName ? 11 : 19;
  const displayName = short(name, limit);
  const nameSize = nameParts.length <= 12 && !wideName ? 56 : 41;
  const hasPhoto = profile.approved.consent === true && Boolean(profile.approvedPhoto);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 384" width="960" height="384">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
        <stop stop-color="#11182f"/><stop offset=".55" stop-color="#25254d"/><stop offset="1" stop-color="#332b68"/>
      </linearGradient>
      <radialGradient id="light"><stop stop-color="${accent}" stop-opacity=".66"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
      <linearGradient id="edge"><stop stop-color="#b3acfc" stop-opacity=".6"/><stop offset="1" stop-color="#b8f0e1" stop-opacity=".2"/></linearGradient>
      <linearGradient id="crest" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#454181"/><stop offset="1" stop-color="#231f58"/></linearGradient>
      <clipPath id="frame"><rect x="8" y="8" width="944" height="368" rx="26"/></clipPath>
      <clipPath id="name"><rect x="58" y="122" width="570" height="91"/></clipPath>
    </defs>
    <g clip-path="url(#frame)">
      <rect width="960" height="384" fill="url(#sky)"/>
      <ellipse cx="775" cy="188" rx="297" ry="220" fill="url(#light)"/>
      <path d="M546 373 747 0h99L647 373zm147 0L892 0h88L785 373z" fill="#b3acfc" opacity=".07"/>
      <ellipse cx="778" cy="193" rx="169" ry="73" transform="rotate(-35 778 193)" fill="none" stroke="#d6d0ff" stroke-width="1.4" opacity=".48"/>
      <ellipse cx="778" cy="193" rx="178" ry="81" transform="rotate(-35 778 193)" fill="none" stroke="#aacfcf" stroke-width="1.1" opacity=".25"/>
      <path d="M778 104q18 0 86 62v55q-44 40-86 62-42-22-86-62v-55q68-62 86-62z" fill="url(#crest)" stroke="url(#edge)" stroke-width="1.5"/>
      <circle cx="883" cy="101" r="4.5" fill="#b9f3e6"/><circle cx="662" cy="276" r="3.5" fill="#c6bbff"/>
      <path d="M903 188v20m-10-10h20M643 100v14m-7-7h14" stroke="#d0c9ff" stroke-width="1.5" stroke-linecap="round"/>
      ${hasPhoto ? '<rect x="695" y="110" width="166" height="166" rx="32" fill="#221d46" stroke="#a6a0ef" stroke-width="2"/>'
        : `<text x="778" y="215" fill="#f6f5ff" text-anchor="middle" font-family="Georgia, DejaVu Serif, serif" font-size="65" font-weight="bold">${xml(initials)}</text>`}
      <rect x="58" y="48" width="38" height="3" rx="1.5" fill="#b8f0e1"/>
      <text x="58" y="88" fill="#c9c2ff" font-family="Arial, DejaVu Sans, sans-serif" font-size="23" font-weight="bold">${xml(short(template.title, 30))}</text>
      <text x="58" y="190" fill="#f7f8ff" clip-path="url(#name)" font-family="Georgia, DejaVu Serif, serif" font-size="${nameSize}" font-weight="bold">${xml(displayName)}</text>
      <text x="60" y="242" fill="#d6d2ef" font-family="Arial, DejaVu Sans, sans-serif" font-size="27">${xml(bookingProfileServices[service])}</text>
      <path d="M60 283h548" stroke="url(#edge)"/>
      <text x="60" y="326" fill="#b8f0e1" font-family="Arial, DejaVu Sans, sans-serif" font-size="22" font-weight="bold">${xml(ratingLabel(rating))}</text>
      <text x="900" y="326" fill="#ece8ff" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="23">#${number}</text>
    </g>
    <rect x="9" y="9" width="942" height="366" rx="25" fill="none" stroke="url(#edge)" stroke-width="2"/>
  </svg>`;
  const card = sharp(Buffer.from(svg));
  if (hasPhoto) {
    const portrait = await sharp(profile.approvedPhoto, { limitInputPixels: 40_000 }).resize(portraitSide, portraitSide)
      .ensureAlpha().composite([{ input: portraitMask, blend: 'dest-in' }]).png().toBuffer();
    card.composite([{ input: portrait, left: 701, top: 116 }]);
  }
  return card.png().toBuffer();
}

const safeMentions = { parse: [], repliedUser: false };
const marker = (emoji, key) => emoji?.[key]?.id ? `<${emoji[key].animated ? 'a' : ''}:${emoji[key].name}:${emoji[key].id}> ` : '';
const block = content => new TextDisplayBuilder().setContent(content);
const divider = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);
const discordId = id => typeof id === 'string' && /^\d{17,20}$/.test(id);

function linkRow(guildId, links, emoji) {
  if (!discordId(guildId)) return null;
  const buttons = links.filter(({ target }) => discordId(target)).map(({ target, label, icon }) => {
    const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label)
      .setURL(`https://discord.com/channels/${guildId}/${target}`);
    if (emoji?.[icon]?.id) button.setEmoji({ id: emoji[icon].id });
    return button;
  });
  return buttons.length ? new ActionRowBuilder().addComponents(buttons) : null;
}

export function buildBookingProfileResponse({ title, detail, sections = [], accent = bookingIndigo }) {
  const card = new ContainerBuilder().setAccentColor(accent).addTextDisplayComponents(block(`## ${title}${detail ? `\n${detail}` : ''}`));
  for (const line of sections) card.addSeparatorComponents(divider()).addTextDisplayComponents(block(line));
  return { flags: MessageFlags.IsComponentsV2, components: [card], allowedMentions: safeMentions };
}

export async function buildBookingProfilePost(profile, rating, template, emoji, { guildId, request, reviews } = {}) {
  const { name, tagline, service, games, availability } = profile.approved;
  const number = hostNumber(profile.profile_number);
  const image = await renderBookingHostCard(profile, rating, template);
  const imageDescription = profile.approved.consent && profile.approvedPhoto ? 'ảnh host đã được duyệt' : 'chữ viết tắt của biệt danh';
  const card = new ContainerBuilder().setAccentColor(parseInt(template.accent.slice(1), 16))
    .addTextDisplayComponents(block(`${hostHeadline}#${number}\n## ${marker(emoji, 'profiles')}${bookingProfileText(name)}\n${bookingProfileText(tagline)}`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(item =>
      item.setURL(`attachment://${fileName}`).setDescription(`Thẻ nhận diện Cenar số ${number}, có ${imageDescription}.`)))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(block(`### ${marker(emoji, service === 'game' ? 'game' : 'voice')}${bookingProfileServices[service]}\n${bookingProfileText(games)}`))
    .addTextDisplayComponents(block(`**Giờ thường rảnh**\n${bookingProfileText(availability)} (UTC+7)`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(block(`${marker(emoji, 'reviews')}**${ratingLabel(rating)}**`));
  const navigation = linkRow(guildId, [
    { target: request, label: 'Đặt lịch', icon: 'calendar' },
    { target: reviews, label: 'Xem đánh giá', icon: 'reviews' },
  ], emoji);
  if (navigation) card.addActionRowComponents(navigation);
  return { flags: MessageFlags.IsComponentsV2, components: [card], files: [new AttachmentBuilder(image, { name: fileName })], allowedMentions: safeMentions };
}

export function buildBookingReviewPost(review, profile, emoji, guildId) {
  const number = hostNumber(profile.profile_number);
  const feedback = bookingProfileText(review.feedback.replace(/<@(?:[!&])?\d{17,20}>/gu, '[thành viên]'));
  const card = new ContainerBuilder().setAccentColor(bookingMint)
    .addTextDisplayComponents(block(`${reviewHeadline}\n## ${marker(emoji, 'reviews')}${review.rating}/5\nHost Cenar **#${number}**`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(block(`### Nhận xét của khách\n> ${feedback}`));
  const navigation = linkRow(guildId, [{ target: profile.forum_thread_id, label: 'Xem hồ sơ host', icon: 'profiles' }], emoji);
  if (navigation) card.addActionRowComponents(navigation);
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
    makePayload: () => buildBookingProfilePost(profile, rating, template, portal.emoji,
      { guildId: guild.id, request: portal.request, reviews: portal.reviews }) });
}

export async function syncBookingPhotoRemoval({ guild, portal, profiles, hostId }) {
  const profile = profiles.get(hostId);
  if (!profile?.approved || !profile.profile_number) return false;
  const thread = await findOrUpdatePost({ guild, forumId: portal.profiles, threadId: profile.forum_thread_id,
    name: artworkName(profile.profile_number), existingOnly: true, service: profile.approved.service,
    makePayload: () => buildBookingProfilePost(profiles.withApprovedPhoto(profile), profiles.ratingFor(hostId), profiles.getTemplate(), portal.emoji,
      { guildId: guild.id, request: portal.request, reviews: portal.reviews }) });
  if (thread) profiles.setHostThread(hostId, thread.id);
  profiles.markPhotoSynced(hostId);
  return Boolean(thread);
}

export function unpublishBookingHost({ guild, portal, profile }) {
  return findOrUpdatePost({ guild, forumId: portal.profiles, threadId: profile.forum_thread_id,
    name: artworkName(profile.profile_number), existingOnly: true, makePayload: () => ({
      flags: MessageFlags.IsComponentsV2, allowedMentions: safeMentions,
      components: [new ContainerBuilder().addTextDisplayComponents(block('Hồ sơ này đã được ẩn theo yêu cầu của host.'))],
    }) });
}

export function publishBookingReview({ guild, portal, review, profile }) {
  return findOrUpdatePost({ guild, forumId: portal.reviews, threadId: review.forum_thread_id,
    name: reviewPostName(review), makePayload: () => buildBookingReviewPost(review, profile, portal.emoji, guild.id) });
}

function reviewPostName(review) {
  const ref = createHash('sha256').update(`cenar-review:${review.ticket_id}`).digest('hex').slice(0, 12);
  return `Đánh giá Cenar · ${ref}`;
}

async function refreshExistingPost(guild, { forumId, threadId, name, headline, makePayload }) {
  const thread = await guild.channels.fetch(threadId).catch(error => {
    if (error.code === 10003) return null;
    throw error;
  });
  const bot = guild.client.user.id;
  if (thread?.type !== ChannelType.PublicThread || thread.parentId !== forumId || thread.ownerId !== bot
    || thread.name !== name || thread.archived || thread.locked) return false;
  const starter = await thread.fetchStarterMessage();
  if (starter?.author.id !== bot || starter.components?.[0]?.components?.[0]?.content?.startsWith(headline)) return false;
  await starter.edit({ ...await makePayload(), attachments: [] });
  return true;
}

export async function refreshPublishedBookingProfileLayouts({ guild, portal, db }) {
  const report = { updated: 0, skipped: 0, failed: 0 };
  if (guild?.id !== STORE_TWO_GUILD_ID || !guild.client?.user?.id || !portal?.profiles || !portal?.reviews) return report;
  const profiles = createBookingProfileService(db);
  const template = profiles.getTemplate();
  const pendingPhotos = db.prepare('SELECT host_id FROM booking_host_profile_photos WHERE sync_removal=1 ORDER BY host_id LIMIT 20').all();
  for (const { host_id: hostId } of pendingPhotos) {
    try {
      const synced = await withBookingHostUpdate(hostId, () => syncBookingPhotoRemoval({ guild, portal, profiles, hostId }));
      report[synced ? 'updated' : 'skipped'] += 1;
    } catch (error) {
      report[error instanceof BookingProfileError ? 'skipped' : 'failed'] += 1;
    }
  }
  const hosts = db.prepare(`SELECT host_id FROM booking_host_profiles WHERE approved IS NOT NULL AND forum_thread_id IS NOT NULL
    ORDER BY profile_number LIMIT 20`).all();
  const reviews = db.prepare(`SELECT host_id, ticket_id FROM booking_host_reviews WHERE consent=1 AND forum_thread_id IS NOT NULL
    ORDER BY ticket_id DESC LIMIT 20`).all();

  for (const target of [...hosts, ...reviews]) {
    try {
      const updated = await withBookingHostUpdate(target.host_id, () => {
        const profile = profiles.get(target.host_id);
        if (!profile?.approved || !profile.forum_thread_id) return false;
        if (target.ticket_id == null) {
          return refreshExistingPost(guild, { forumId: portal.profiles, threadId: profile.forum_thread_id,
            name: artworkName(profile.profile_number), headline: hostHeadline,
            makePayload: () => buildBookingProfilePost(profiles.withApprovedPhoto(profile), profiles.ratingFor(target.host_id), template, portal.emoji,
              { guildId: guild.id, request: portal.request, reviews: portal.reviews }) });
        }
        const review = profiles.getReview(target.ticket_id);
        if (!review?.consent || !review.forum_thread_id) return false;
        return refreshExistingPost(guild, { forumId: portal.reviews, threadId: review.forum_thread_id,
          name: reviewPostName(review), headline: reviewHeadline,
          makePayload: () => buildBookingReviewPost(review, profile, portal.emoji, guild.id) });
      });
      report[updated ? 'updated' : 'skipped'] += 1;
    } catch (error) {
      // A command may be editing the same profile, or an inaccessible post may need staff review.
      report[error instanceof BookingProfileError ? 'skipped' : 'failed'] += 1;
    }
  }
  return report;
}
