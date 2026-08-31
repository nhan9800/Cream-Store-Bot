import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { config } from '../config.js';
import { db } from '../database/db.js';

function escapeHtml(input) {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TS_FMT = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

function formatDiscordTs(ms, style) {
  const d = new Date(ms);
  if (style === 'd') return d.toLocaleDateString('vi-VN');
  if (style === 'D') return d.toLocaleDateString('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' });
  if (style === 't') return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  if (style === 'T') return d.toLocaleTimeString('vi-VN');
  if (style === 'R') {
    const diff = ms - Date.now();
    const abs = Math.abs(diff);
    const mins = Math.round(abs / 60000);
    const hrs  = Math.round(abs / 3600000);
    const days = Math.round(abs / 86400000);
    let txt;
    if (mins < 60) txt = `${mins} phút`;
    else if (hrs < 24) txt = `${hrs} giờ`;
    else txt = `${days} ngày`;
    return diff >= 0 ? `trong ${txt} nữa` : `${txt} trước`;
  }
  return TS_FMT.format(d);
}

// Discord markup -> HTML
function mdToHtml(raw, message = null) {
  if (!raw) return '';
  const stash = [];
  const keep = (html) => ` §${stash.push(html) - 1}§ `;
  let s = String(raw);

  // Fenced code blocks
  s = s.replace(/```(?:[a-zA-Z0-9_+-]*\n)?([\s\S]*?)```/g, (_m, code) =>
    keep(`<pre class="code-block">${escapeHtml(code.replace(/\n$/, ''))}</pre>`));
  // Inline code
  s = s.replace(/`([^`\n]+)`/g, (_m, code) =>
    keep(`<code class="code-inline">${escapeHtml(code)}</code>`));
  // Custom emoji
  s = s.replace(/<(a)?:(\w+):(\d+)>/g, (_m, anim, name, id) =>
    keep(`<img class="emoji" src="https://cdn.discordapp.com/emojis/${id}.${anim ? 'gif' : 'png'}?size=48" alt=":${escapeHtml(name)}:" title=":${escapeHtml(name)}:" loading="lazy" />`));
  // Timestamps
  s = s.replace(/<t:(\d+)(?::([tTdDfFR]))?>/g, (_m, unix, style) =>
    keep(`<span class="ts-token">${escapeHtml(formatDiscordTs(Number(unix) * 1000, style))}</span>`));
  // User mentions
  s = s.replace(/<@!?(\d+)>/g, (_m, id) => {
    const u = message?.mentions?.users?.get?.(id);
    const name = u ? (u.globalName || u.username) : id;
    return keep(`<span class="mention">@${escapeHtml(name)}</span>`);
  });
  // Role mentions
  s = s.replace(/<@&(\d+)>/g, (_m, id) => {
    const r = message?.mentions?.roles?.get?.(id);
    return keep(`<span class="mention">@${escapeHtml(r?.name || 'role')}</span>`);
  });
  // Channel mentions
  s = s.replace(/<#(\d+)>/g, (_m, id) => {
    const c = message?.mentions?.channels?.get?.(id);
    return keep(`<span class="mention">#${escapeHtml(c?.name || 'channel')}</span>`);
  });

  s = escapeHtml(s);

  // Headers + subtext
  s = s.replace(/^### (.*)$/gm, '<div class="md-h3">$1</div>');
  s = s.replace(/^## (.*)$/gm,  '<div class="md-h2">$1</div>');
  s = s.replace(/^# (.*)$/gm,   '<div class="md-h1">$1</div>');
  s = s.replace(/^-# (.*)$/gm,  '<div class="md-subtext">$1</div>');
  // Blockquote
  s = s.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
  // Links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Bold-italic, bold, underline, italic, strikethrough
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<u>$1</u>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  // Newlines
  s = s.replace(/\n/g, '<br/>');
  s = s.replace(/(<\/(?:div|blockquote|pre)>)<br\/>/g, '$1');

  // Restore stash tokens
  s = s.replace(/ §(\d+)§ /g, (_m, i) => stash[Number(i)]);
  return s;
}

// ─── Components V2 renderer ─────────────────────────────────────────────────
const CT = {
  ACTION_ROW:    1,
  BUTTON:        2,
  SECTION:       9,
  TEXT_DISPLAY:  10,
  THUMBNAIL:     11,
  MEDIA_GALLERY: 12,
  SEPARATOR:     14,
  CONTAINER:     17,
};

function cp(comp, key, rawKey) {
  const v = comp?.[key];
  if (v !== undefined && v !== null) return v;
  return comp?.data?.[rawKey ?? key];
}
function cType(comp)     { return comp?.type     ?? comp?.data?.type; }
function cChildren(comp) { return comp?.components ?? comp?.data?.components ?? []; }

function renderEmojiV2(emoji) {
  if (!emoji) return '';
  if (emoji.id) {
    const ext = emoji.animated ? 'gif' : 'png';
    return `<img class="emoji btn-emoji" src="https://cdn.discordapp.com/emojis/${emoji.id}.${ext}?size=32" alt=":${escapeHtml(emoji.name ?? '')}:" loading="lazy" />`;
  }
  return emoji.name ? escapeHtml(emoji.name) : '';
}

function renderButtonV2(btn) {
  const label     = cp(btn, 'label')  ?? '';
  const url       = cp(btn, 'url')    ?? '';
  const style     = cp(btn, 'style')  ?? 2;
  const disabled  = cp(btn, 'disabled') ?? false;
  const emoji     = cp(btn, 'emoji');
  const cls       = { 1:'primary', 2:'secondary', 3:'success', 4:'danger', 5:'link' }[style] ?? 'secondary';
  const disClass  = disabled ? ' disabled' : '';
  const inner     = `${renderEmojiV2(emoji)}${label ? escapeHtml(label) : ''}`;
  if (url && !disabled) {
    return `<a class="v2-btn ${cls}${disClass}" href="${escapeHtml(url)}" target="_blank" rel="noopener">${inner}</a>`;
  }
  return `<span class="v2-btn ${cls}${disClass}">${inner}</span>`;
}

function renderComponentV2(comp, depth = 0) {
  if (!comp) return '';
  const t        = cType(comp);
  const children = cChildren(comp);

  switch (t) {
    case CT.CONTAINER: {
      const raw   = cp(comp, 'accentColor', 'accent_color');
      const color = typeof raw === 'number'
        ? `#${(raw >>> 0).toString(16).padStart(6, '0').slice(-6)}`
        : '#4f545c';
      const inner = children.map(c => renderComponentV2(c, depth + 1)).join('');
      return `<div class="v2-container" style="border-left-color:${color}">${inner}</div>`;
    }
    case CT.TEXT_DISPLAY: {
      const content = cp(comp, 'content') ?? '';
      return `<div class="v2-text">${mdToHtml(content)}</div>`;
    }
    case CT.SEPARATOR: {
      const divider = cp(comp, 'divider') ?? false;
      const spacing = cp(comp, 'spacing') ?? 1;
      const gap     = spacing >= 2 ? '16px' : '8px';
      return divider
        ? `<hr class="v2-sep" style="margin:${gap} 0" />`
        : `<div style="height:${gap}"></div>`;
    }
    case CT.MEDIA_GALLERY: {
      const items = cp(comp, 'items') ?? comp?.data?.items ?? [];
      const imgs  = items.map(item => {
        const mediaUrl = item?.media?.url ?? item?.url ?? '';
        if (!mediaUrl) return '';
        const isGif = /\.gif(\?|$)/i.test(mediaUrl);
        return `<img class="v2-gallery-img" src="${escapeHtml(mediaUrl)}" loading="lazy" alt="${isGif ? 'gif' : 'image'}" />`;
      }).filter(Boolean).join('');
      return imgs ? `<div class="v2-gallery">${imgs}</div>` : '';
    }
    case CT.SECTION: {
      const acc     = cp(comp, 'accessory');
      let thumbHtml = '';
      if (acc) {
        const media   = acc?.media ?? acc?.data?.media ?? null;
        const thumbUrl = media?.url ?? acc?.url ?? '';
        if (thumbUrl) {
          thumbHtml = `<img class="v2-thumb" src="${escapeHtml(thumbUrl)}" loading="lazy" />`;
        } else if (cType(acc) === CT.BUTTON) {
          thumbHtml = `<div class="v2-thumb-btn">${renderButtonV2(acc)}</div>`;
        }
      }
      const body = children.map(c => renderComponentV2(c, depth + 1)).join('');
      return `<div class="v2-section"><div class="v2-section-body">${body}</div>${thumbHtml}</div>`;
    }
    case CT.ACTION_ROW: {
      const btns = children.map(c => renderComponentV2(c, depth + 1)).join('');
      return btns ? `<div class="v2-row">${btns}</div>` : '';
    }
    case CT.BUTTON: {
      return renderButtonV2(comp);
    }
    default: {
      const content = cp(comp, 'content') ?? '';
      const childHtml = children.map(c => renderComponentV2(c, depth + 1)).join('');
      return (content ? `<div class="v2-text">${mdToHtml(content)}</div>` : '') + childHtml;
    }
  }
}

function isV2Message(message) {
  const first = message.components?.[0];
  if (!first) return false;
  // V2 messages have Container (17) as top-level component
  if (cType(first) === CT.CONTAINER) return true;
  // Or check IsComponentsV2 flag (bit 15 = 32768)
  return ((message.flags?.bitfield ?? 0) & 32768) !== 0;
}

// ─── Plain text extractor (fallback for old messages / .txt archive) ─────────
function extractComponentsText(message) {
  const out = [];
  const getContent  = (c) => c?.content ?? c?.data?.content ?? null;
  const getChildren = (c) => c?.components ?? c?.data?.components ?? null;
  const walk = (c) => {
    if (!c) return;
    const content = getContent(c);
    if (content && typeof content === 'string') out.push(content);
    const kids = getChildren(c);
    if (Array.isArray(kids)) kids.forEach(walk);
  };
  (message.components || []).forEach(walk);
  return out.join('\n');
}

// ─── Embed renderer ──────────────────────────────────────────────────────────
function renderEmbed(embed) {
  const color = Number.isFinite(embed.color)
    ? `#${(embed.color >>> 0).toString(16).padStart(6, '0').slice(-6)}`
    : '#4f545c';
  const parts = [];

  if (embed.author?.name) {
    const icon = embed.author.iconURL
      ? `<img class="embed-author-icon" src="${escapeHtml(embed.author.iconURL)}" loading="lazy" />`
      : '';
    parts.push(`<div class="embed-author">${icon}<span>${escapeHtml(embed.author.name)}</span></div>`);
  }
  if (embed.title) {
    const t = escapeHtml(embed.title);
    parts.push(embed.url
      ? `<div class="embed-title"><a href="${escapeHtml(embed.url)}" target="_blank" rel="noopener">${t}</a></div>`
      : `<div class="embed-title">${t}</div>`);
  }
  if (embed.description) parts.push(`<div class="embed-desc">${mdToHtml(embed.description)}</div>`);

  if (Array.isArray(embed.fields) && embed.fields.length) {
    const fieldsHtml = embed.fields.map(f =>
      `<div class="embed-field${f.inline ? ' inline' : ''}">
        <div class="embed-field-name">${mdToHtml(f.name)}</div>
        <div class="embed-field-value">${mdToHtml(f.value)}</div>
      </div>`
    ).join('');
    parts.push(`<div class="embed-fields">${fieldsHtml}</div>`);
  }
  if (embed.image?.url) {
    parts.push(`<a href="${escapeHtml(embed.image.url)}" target="_blank" rel="noopener"><img class="embed-image" src="${escapeHtml(embed.image.url)}" loading="lazy" /></a>`);
  }
  if (embed.thumbnail?.url) {
    parts.push(`<img class="embed-thumb" src="${escapeHtml(embed.thumbnail.url)}" loading="lazy" />`);
  }
  if (embed.footer?.text) {
    const ico = embed.footer.iconURL
      ? `<img class="embed-footer-icon" src="${escapeHtml(embed.footer.iconURL)}" loading="lazy" />`
      : '';
    parts.push(`<div class="embed-footer">${ico}<span>${escapeHtml(embed.footer.text)}</span></div>`);
  }

  return `<div class="embed" style="border-left-color:${color}">${parts.join('')}</div>`;
}

function renderAttachments(message) {
  const items = [...message.attachments.values()];
  if (!items.length) return '';
  return items.map(a => {
    const url  = escapeHtml(a.url);
    const name = escapeHtml(a.name ?? 'file');
    const ct   = a.contentType || '';
    const isImage = ct.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name ?? '');
    const isVideo = ct.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(a.name ?? '');
    if (isImage) return `<a href="${url}" target="_blank" rel="noopener"><img class="attach-image" src="${url}" alt="${name}" loading="lazy" /></a>`;
    if (isVideo) return `<video class="attach-video" controls src="${url}"></video>`;
    return `<a class="attach-file" href="${url}" target="_blank" rel="noopener">📎 ${name}</a>`;
  }).join('');
}

function renderMessageBody(message) {
  const parts = [];

  // Plain text content
  const text = message.content ? mdToHtml(message.content, message) : '';
  if (text) parts.push(`<div class="msg-text">${text}</div>`);

  // Components
  if (message.components?.length) {
    if (isV2Message(message)) {
      const v2Html = message.components.map(c => renderComponentV2(c)).join('');
      if (v2Html.trim()) parts.push(`<div class="msg-v2">${v2Html}</div>`);
    } else {
      // Old-style embed-like components — extract text
      const compText = extractComponentsText(message);
      if (compText.trim()) parts.push(`<div class="msg-v2-legacy">${mdToHtml(compText, message)}</div>`);
    }
  }

  // Classic embeds
  for (const embed of message.embeds || []) {
    const e = embed.data ?? embed;
    if (e && (e.title || e.description || e.fields?.length || e.author || e.image || e.footer)) {
      parts.push(renderEmbed(e));
    }
  }

  // Attachments
  const attach = renderAttachments(message);
  if (attach) parts.push(`<div class="attachments">${attach}</div>`);

  // Stickers
  if (message.stickers?.size) {
    for (const st of message.stickers.values()) {
      parts.push(`<div class="sticker"><img src="https://media.discordapp.net/stickers/${st.id}.png?size=160" alt="${escapeHtml(st.name)}" loading="lazy" /></div>`);
    }
  }

  if (!parts.length) parts.push('<div class="msg-text msg-empty">[không có nội dung văn bản]</div>');
  return parts.join('');
}

const GROUP_WINDOW_MS = 7 * 60 * 1000;

function renderTranscriptHtml(channel, messages) {
  const guildName = channel.guild?.name ?? 'Cenar Store';
  const guildIcon = channel.guild?.iconURL?.({ extension: 'png', size: 128 }) ?? '';
  const first     = messages[0];
  const last      = messages[messages.length - 1];
  const rangeText = first && last
    ? `${TS_FMT.format(new Date(first.createdTimestamp))} — ${TS_FMT.format(new Date(last.createdTimestamp))}`
    : '';

  const groups = [];
  for (const m of messages) {
    const prev = groups[groups.length - 1];
    if (prev && prev.authorId === m.author?.id && (m.createdTimestamp - prev.lastTs) < GROUP_WINDOW_MS) {
      prev.messages.push(m);
      prev.lastTs = m.createdTimestamp;
    } else {
      groups.push({ authorId: m.author?.id, lastTs: m.createdTimestamp, messages: [m] });
    }
  }

  const groupsHtml = groups.map(g => {
    const head       = g.messages[0];
    const authorName = escapeHtml(head.member?.displayName ?? head.author?.globalName ?? head.author?.username ?? 'Unknown');
    const avatar     = head.author?.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? '';
    const isBot      = head.author?.bot;
    const ts         = TS_FMT.format(new Date(head.createdTimestamp));

    const bodies = g.messages.map((m, idx) => {
      const stamp = idx === 0 ? '' : `<span class="inline-ts">${escapeHtml(new Date(m.createdTimestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }))}</span>`;
      return `<div class="msg">${stamp}${renderMessageBody(m)}</div>`;
    }).join('');

    return `<div class="group">
  <img class="avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" onerror="this.style.display='none'" />
  <div class="group-body">
    <div class="group-head">
      <span class="author-name${isBot ? ' author-bot' : ''}">${authorName}</span>
      ${isBot ? '<span class="bot-tag">BOT</span>' : ''}
      <span class="head-ts">${escapeHtml(ts)}</span>
    </div>
    ${bodies}
  </div>
</div>`;
  }).join('\n');

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Transcript • #${escapeHtml(channel.name)}</title>
<style>
/* ── Reset & base ─────────────────────────────────────────── */
:root { color-scheme: dark; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: #313338;
  color: #dbdee1;
  font-family: "gg sans","Noto Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size: 16px;
  line-height: 1.375;
}

/* ── Top bar ──────────────────────────────────────────────── */
.topbar {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; gap: 14px;
  background: #2b2d31; border-bottom: 1px solid #1f2023;
  padding: 12px 20px;
}
.topbar .server-icon {
  width: 36px; height: 36px; border-radius: 50%; background: #1e1f22; flex-shrink: 0;
}
.topbar .channel-hash {
  color: #949ba4; font-size: 22px; font-weight: 600; flex-shrink: 0;
}
.topbar .meta { min-width: 0; }
.topbar .meta h1 { font-size: 16px; font-weight: 700; color: #f2f3f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.topbar .meta p  { font-size: 12px; color: #949ba4; margin-top: 1px; }
.topbar .badge {
  margin-left: auto; flex-shrink: 0;
  background: #5865f2; color: #fff;
  font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
}

/* ── Message list ─────────────────────────────────────────── */
.messages { max-width: 900px; margin: 0 auto; padding: 20px 16px 80px; }

/* ── Message group ────────────────────────────────────────── */
.group { display: flex; gap: 16px; padding: 6px 8px; border-radius: 4px; margin-bottom: 2px; }
.group:hover { background: #2e3035; }
.avatar {
  width: 40px; height: 40px; border-radius: 50%;
  background: #4e5058; flex-shrink: 0; margin-top: 2px;
  object-fit: cover;
}
.group-body { flex: 1; min-width: 0; }
.group-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; flex-wrap: wrap; }
.author-name { font-weight: 600; color: #f2f3f5; font-size: 15px; }
.author-bot  { color: #c9cdfb; }
.bot-tag {
  background: #5865f2; color: #fff;
  font-size: 10px; font-weight: 700; letter-spacing: .3px;
  padding: 1px 5px; border-radius: 3px; text-transform: uppercase;
  position: relative; top: -1px; flex-shrink: 0;
}
.head-ts, .inline-ts { color: #949ba4; font-size: 12px; }
.inline-ts { float: left; margin-right: 8px; width: 40px; opacity: 0; font-size: 11px; }
.msg { position: relative; padding: 1px 0; }
.msg:hover .inline-ts { opacity: 1; }

/* ── Text content ─────────────────────────────────────────── */
.msg-text, .msg-v2-legacy { color: #dbdee1; word-break: break-word; overflow-wrap: anywhere; }
.msg-empty { color: #6d7178; font-style: italic; }
.emoji { width: 1.375em; height: 1.375em; vertical-align: -0.3em; object-fit: contain; }
.mention { background: rgba(88,101,242,.3); color: #c9cdfb; border-radius: 3px; padding: 0 3px; font-weight: 500; }
.ts-token { background: #3f4248; border-radius: 3px; padding: 0 4px; font-size: 14px; }
a { color: #00a8fc; text-decoration: none; }
a:hover { text-decoration: underline; }
blockquote { margin: 2px 0; padding: 4px 0 4px 12px; border-left: 4px solid #4e5058; color: #dbdee1; }
.code-inline {
  background: #1e1f22; border-radius: 4px; padding: 1px 5px;
  font-family: Consolas,"Courier New",monospace; font-size: 85%; color: #f2f3f5;
}
.code-block {
  background: #1e1f22; border: 1px solid #2b2d31; border-radius: 6px;
  padding: 10px 14px; margin: 6px 0;
  font-family: Consolas,"Courier New",monospace; font-size: 90%;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.md-h1 { font-size: 22px; font-weight: 700; margin: 8px 0 2px; color: #f2f3f5; }
.md-h2 { font-size: 18px; font-weight: 700; margin: 6px 0 2px; color: #f2f3f5; }
.md-h3 { font-size: 15px; font-weight: 700; margin: 4px 0 2px; color: #f2f3f5; }
.md-subtext { font-size: 12px; color: #949ba4; margin: 2px 0; }

/* ── Classic embeds ───────────────────────────────────────── */
.embed {
  margin: 4px 0; background: #2b2d31;
  border-left: 4px solid #4f545c; border-radius: 4px;
  padding: 10px 14px; max-width: 520px;
}
.embed-author { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: #f2f3f5; margin-bottom: 6px; }
.embed-author-icon { width: 20px; height: 20px; border-radius: 50%; }
.embed-title { font-weight: 700; color: #f2f3f5; margin-bottom: 4px; }
.embed-desc  { font-size: 14px; color: #dbdee1; }
.embed-fields { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.embed-field { flex: 1 1 100%; }
.embed-field.inline { flex: 1 1 30%; min-width: 140px; }
.embed-field-name  { font-weight: 600; color: #f2f3f5; font-size: 13px; }
.embed-field-value { font-size: 13px; color: #dbdee1; }
.embed-image { max-width: 100%; border-radius: 4px; margin-top: 8px; display: block; }
.embed-thumb { max-width: 80px; border-radius: 4px; float: right; margin: 0 0 4px 12px; }
.embed-footer { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #949ba4; margin-top: 10px; clear: both; }
.embed-footer-icon { width: 18px; height: 18px; border-radius: 50%; }

/* ── Attachments ──────────────────────────────────────────── */
.attachments { margin-top: 6px; }
.attach-image { max-width: 400px; max-height: 300px; border-radius: 8px; margin-top: 4px; display: block; }
.attach-video { max-width: 400px; border-radius: 8px; margin-top: 4px; }
.attach-file  { display: inline-block; background: #2b2d31; border: 1px solid #1f2023; border-radius: 8px; padding: 8px 12px; margin-top: 4px; }
.sticker img  { max-width: 160px; margin-top: 4px; }

/* ── Components V2 ────────────────────────────────────────── */
.msg-v2 { margin-top: 2px; }

.v2-container {
  border-left: 4px solid #4f545c;
  background: #2b2d31;
  border-radius: 4px;
  padding: 12px 16px;
  margin: 4px 0;
  max-width: 680px;
}
.v2-text {
  color: #dbdee1;
  line-height: 1.4;
  margin: 2px 0;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.v2-sep {
  border: none;
  border-top: 1px solid #3f4248;
}
.v2-gallery {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 6px 0;
}
.v2-gallery-img {
  max-width: 420px;
  max-height: 300px;
  border-radius: 8px;
  display: block;
  object-fit: contain;
  background: #1e1f22;
}
.v2-section {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 2px 0;
}
.v2-section-body { flex: 1; min-width: 0; }
.v2-thumb {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  background: #1e1f22;
}
.v2-thumb-btn { flex-shrink: 0; }
.v2-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 4px;
}
.v2-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 16px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  cursor: default;
  line-height: 1.4;
}
.v2-btn:hover { text-decoration: none; filter: brightness(1.1); }
.v2-btn.primary   { background: #5865f2; color: #fff; }
.v2-btn.secondary { background: #4e5058; color: #dbdee1; }
.v2-btn.success   { background: #248046; color: #fff; }
.v2-btn.danger    { background: #c0392b; color: #fff; }
.v2-btn.link      { background: #4e5058; color: #00a8fc; }
.v2-btn.disabled  { opacity: 0.5; }
.btn-emoji { width: 1.1em; height: 1.1em; vertical-align: middle; object-fit: contain; }

/* ── Date divider ─────────────────────────────────────────── */
.date-divider {
  display: flex; align-items: center; gap: 12px;
  margin: 20px 0 16px; color: #949ba4; font-size: 12px; font-weight: 600;
}
.date-divider::before, .date-divider::after {
  content: ''; flex: 1; height: 1px; background: #3f4248;
}

/* ── Footer ───────────────────────────────────────────────── */
.footer-note {
  text-align: center; color: #6d7178; font-size: 12px;
  margin-top: 40px; padding-top: 16px; border-top: 1px solid #2b2d31;
}
</style>
</head>
<body>
<div class="topbar">
  ${guildIcon ? `<img class="server-icon" src="${escapeHtml(guildIcon)}" alt=""/>` : ''}
  <span class="channel-hash">#</span>
  <div class="meta">
    <h1>${escapeHtml(channel.name)}</h1>
    <p>${escapeHtml(guildName)} &nbsp;•&nbsp; ${messages.length} tin nhắn${rangeText ? ` &nbsp;•&nbsp; ${escapeHtml(rangeText)}` : ''}</p>
  </div>
  <span class="badge">TRANSCRIPT</span>
</div>

<div class="messages">
  ${groupsHtml || '<p style="color:#949ba4;text-align:center;padding:40px">Ticket không có tin nhắn nào.</p>'}
  <div class="footer-note">Transcript được tạo tự động bởi Cenar Store Bot</div>
</div>
</body>
</html>`;
}

const ARCHIVE_FORMAT_VERSION = 2;
const DEFAULT_ARCHIVE_DIRECTORY = path.join(process.cwd(), 'data', 'transcript-archive');
const DEFAULT_LEGACY_DIRECTORY = path.join(process.cwd(), 'data', 'transcripts');
const ACCESS_TOKEN_PATTERN = /^[a-f0-9]{48}$/;
const ARCHIVE_FILE_PATTERN = /^transcript_[a-z0-9_-]{4,96}\.json\.gz$/;

function ensureTranscriptArchiveSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_transcript_archives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      archive_code TEXT UNIQUE NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      guild_id TEXT NOT NULL,
      ticket_id INTEGER,
      ticket_code TEXT,
      ticket_type TEXT,
      channel_id TEXT,
      channel_name TEXT NOT NULL,
      customer_id TEXT,
      closed_by_id TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      format_version INTEGER NOT NULL DEFAULT 2,
      compression TEXT NOT NULL DEFAULT 'GZIP',
      storage_backend TEXT NOT NULL DEFAULT 'LOCAL_GZIP',
      local_file_name TEXT,
      original_bytes INTEGER NOT NULL DEFAULT 0,
      compressed_bytes INTEGER NOT NULL DEFAULT 0,
      checksum_sha256 TEXT NOT NULL,
      partial INTEGER NOT NULL DEFAULT 0,
      fetch_error TEXT,
      discord_channel_id TEXT,
      discord_message_id TEXT,
      discord_attachment_id TEXT,
      discord_attachment_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );
    CREATE INDEX IF NOT EXISTS idx_transcript_archives_token_hash ON ticket_transcript_archives(token_hash);
    CREATE INDEX IF NOT EXISTS idx_transcript_archives_ticket ON ticket_transcript_archives(ticket_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transcript_archives_expiry ON ticket_transcript_archives(status, expires_at);
  `);
}

export function hashTranscriptAccessToken(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function archiveCode() {
  return `TA_${Date.now().toString(36).toUpperCase()}_${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

function collectionValues(value) {
  if (!value) return [];
  if (typeof value.values === 'function') return [...value.values()];
  if (Array.isArray(value)) return value;
  return [];
}

function safeJson(value) {
  try {
    if (typeof value?.toJSON === 'function') return value.toJSON();
    if (value?.data && typeof value.data === 'object') return value.data;
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function avatarUrl(author) {
  try {
    return author?.displayAvatarURL?.({ size: 128, extension: 'webp' }) || author?.avatarURL?.({ size: 128 }) || null;
  } catch {
    return null;
  }
}

function serializeMessage(message) {
  const attachments = collectionValues(message?.attachments).map((item) => ({
    id: String(item?.id || ''),
    name: item?.name || null,
    description: item?.description || null,
    contentType: item?.contentType || null,
    size: Number(item?.size) || 0,
    url: item?.url || null,
    proxyUrl: item?.proxyURL || null,
    width: Number(item?.width) || null,
    height: Number(item?.height) || null,
    spoiler: Boolean(item?.spoiler),
  }));
  const reactions = collectionValues(message?.reactions?.cache).map((reaction) => ({
    count: Number(reaction?.count) || 0,
    me: Boolean(reaction?.me),
    emoji: {
      id: reaction?.emoji?.id || null,
      name: reaction?.emoji?.name || null,
      animated: Boolean(reaction?.emoji?.animated),
    },
  }));
  const users = collectionValues(message?.mentions?.users).map((user) => ({
    id: String(user?.id || ''),
    name: user?.globalName || user?.username || String(user?.id || ''),
  }));
  const roles = collectionValues(message?.mentions?.roles).map((role) => ({ id: String(role?.id || ''), name: role?.name || 'role' }));
  const channels = collectionValues(message?.mentions?.channels).map((mentioned) => ({ id: String(mentioned?.id || ''), name: mentioned?.name || 'channel' }));
  return {
    id: String(message?.id || ''),
    type: Number(message?.type) || 0,
    createdAt: new Date(message?.createdTimestamp || Date.now()).toISOString(),
    editedAt: message?.editedTimestamp ? new Date(message.editedTimestamp).toISOString() : null,
    content: String(message?.content || ''),
    author: {
      id: String(message?.author?.id || ''),
      username: message?.author?.username || 'Unknown',
      displayName: message?.member?.displayName || message?.author?.globalName || message?.author?.username || 'Unknown',
      avatarUrl: avatarUrl(message?.author),
      bot: Boolean(message?.author?.bot),
    },
    pinned: Boolean(message?.pinned),
    system: Boolean(message?.system),
    webhookId: message?.webhookId || null,
    replyTo: message?.reference?.messageId || message?.reference?.message_id || null,
    mentions: { users, roles, channels },
    attachments,
    embeds: collectionValues(message?.embeds).map(safeJson).filter(Boolean),
    components: collectionValues(message?.components).map(safeJson).filter(Boolean),
    stickers: collectionValues(message?.stickers).map((sticker) => ({
      id: String(sticker?.id || ''), name: sticker?.name || 'sticker', format: Number(sticker?.format) || null,
    })),
    reactions,
  };
}

function resolveTicket(channel) {
  try {
    return db.prepare('SELECT * FROM tickets WHERE channel_id = ? LIMIT 1').get(String(channel?.id || '')) || null;
  } catch {
    return null;
  }
}

function atomicWrite(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let handle;
  try {
    handle = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(handle, data);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.renameSync(temporary, filePath);
  } finally {
    if (handle !== null && handle !== undefined) fs.closeSync(handle);
    fs.rmSync(temporary, { force: true });
  }
}

function parseArchiveBuffer(compressed, expectedChecksum) {
  const checksum = crypto.createHash('sha256').update(compressed).digest('hex');
  if (expectedChecksum && checksum !== expectedChecksum) throw new Error('Transcript archive checksum mismatch');
  const json = zlib.gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8');
  const payload = JSON.parse(json);
  if (payload?.schemaVersion !== ARCHIVE_FORMAT_VERSION || !Array.isArray(payload?.messages)) {
    throw new Error('Unsupported transcript archive format');
  }
  return payload;
}

export function migrateLegacyTranscriptsToGzip({ directory = DEFAULT_LEGACY_DIRECTORY } = {}) {
  if (!fs.existsSync(directory)) return { scanned: 0, migrated: 0, bytesSaved: 0 };
  let scanned = 0;
  let migrated = 0;
  let bytesSaved = 0;
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return { scanned: 0, migrated: 0, bytesSaved: 0 };
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.html')) continue;
    scanned++;
    const source = path.join(directory, entry.name);
    const destination = `${source}.gz`;
    try {
      if (fs.existsSync(destination)) continue;
      const stat = fs.statSync(source);
      const original = fs.readFileSync(source);
      const compressed = zlib.gzipSync(original, { level: 9 });
      if (compressed.length >= original.length) continue;
      atomicWrite(destination, compressed);
      fs.utimesSync(destination, stat.atime, stat.mtime);
      fs.rmSync(source, { force: true });
      migrated++;
      bytesSaved += original.length - compressed.length;
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn(`[TRANSCRIPT-MIGRATE] Bỏ qua ${entry.name}:`, error.message);
    }
  }
  return { scanned, migrated, bytesSaved };
}

export function cleanupExpiredTranscripts({
  directory = DEFAULT_LEGACY_DIRECTORY,
  retentionDays = config.transcriptArchiveRetentionDays,
  now = Date.now(),
} = {}) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0 || !fs.existsSync(directory)) return { scanned: 0, removed: 0 };
  const cutoff = now - days * 86_400_000;
  let scanned = 0;
  let removed = 0;
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(`[TRANSCRIPT-CLEANUP] Không thể đọc thư mục ${directory}:`, error.message);
    return { scanned: 0, removed: 0 };
  }
  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    if (!entry.isFile() || (!lowerName.endsWith('.html') && !lowerName.endsWith('.html.gz'))) continue;
    scanned++;
    const filePath = path.join(directory, entry.name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs >= cutoff) continue;
      fs.rmSync(filePath, { force: true });
      removed++;
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn(`[TRANSCRIPT-CLEANUP] Bỏ qua file ${filePath}:`, error.message);
    }
  }
  return { scanned, removed };
}

export function cleanupTranscriptArchiveStorage({
  directory = DEFAULT_ARCHIVE_DIRECTORY,
  now = Date.now(),
  hotCacheDays = config.transcriptHotCacheDays,
} = {}) {
  ensureTranscriptArchiveSchema();
  const nowIso = new Date(now).toISOString();
  const hotCutoff = new Date(now - Math.max(1, Number(hotCacheDays) || 90) * 86_400_000).toISOString();
  const expired = db.prepare(`SELECT id, local_file_name FROM ticket_transcript_archives
    WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= ?`).all(nowIso);
  const cold = db.prepare(`SELECT id, local_file_name FROM ticket_transcript_archives
    WHERE status = 'ACTIVE' AND local_file_name IS NOT NULL AND created_at <= ?
      AND discord_channel_id IS NOT NULL AND discord_message_id IS NOT NULL AND discord_attachment_id IS NOT NULL`).all(hotCutoff);
  let expiredCount = 0;
  let cacheRemoved = 0;
  const removeLocal = (row) => {
    if (!row.local_file_name || path.basename(row.local_file_name) !== row.local_file_name || !ARCHIVE_FILE_PATTERN.test(row.local_file_name)) return;
    fs.rmSync(path.join(directory, row.local_file_name), { force: true });
  };
  for (const row of expired) {
    try { removeLocal(row); } catch (error) { if (error?.code !== 'ENOENT') continue; }
    db.prepare("UPDATE ticket_transcript_archives SET status = 'EXPIRED', local_file_name = NULL WHERE id = ?").run(row.id);
    expiredCount++;
  }
  for (const row of cold) {
    if (expired.some((item) => item.id === row.id)) continue;
    try { removeLocal(row); } catch (error) { if (error?.code !== 'ENOENT') continue; }
    db.prepare("UPDATE ticket_transcript_archives SET storage_backend = 'DISCORD_GZIP', local_file_name = NULL WHERE id = ?").run(row.id);
    cacheRemoved++;
  }
  return { expired: expiredCount, cacheRemoved };
}

export async function exportTicketTranscript(channel, { directory = DEFAULT_ARCHIVE_DIRECTORY } = {}) {
  ensureTranscriptArchiveSchema();
  let lastId;
  const allMessages = [];
  let fetchCount = 0;
  let fetchError = null;
  while (fetchCount < 15) {
    try {
      const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
      if (!batch.size) break;
      allMessages.push(...batch.values());
      lastId = batch.last?.()?.id || [...batch.values()].at(-1)?.id;
      fetchCount++;
      if (batch.size < 100) break;
    } catch (error) {
      fetchError = error;
      console.error(`[TRANSCRIPT] Lỗi khi tải tin nhắn (#${channel?.name ?? '?'}) sau ${allMessages.length} tin:`, error.message);
      break;
    }
  }
  allMessages.sort((a, b) => Number(a?.createdTimestamp || 0) - Number(b?.createdTimestamp || 0));

  const ticket = resolveTicket(channel);
  const code = archiveCode();
  const accessToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashTranscriptAccessToken(accessToken);
  const createdAt = new Date().toISOString();
  const retentionDays = Math.max(1, Number(config.transcriptArchiveRetentionDays) || 3650);
  const expiresAt = new Date(Date.now() + retentionDays * 86_400_000).toISOString();
  const payload = {
    schemaVersion: ARCHIVE_FORMAT_VERSION,
    archive: { code, createdAt, expiresAt, partial: Boolean(fetchError) },
    ticket: {
      id: ticket?.id || null,
      code: ticket?.ticket_code || channel?.name || code,
      type: ticket?.ticket_type || null,
      subject: ticket?.ticket_subject || null,
      customerId: ticket?.customer_id || null,
      relatedOrderCode: ticket?.related_order_code || null,
    },
    server: {
      id: String(channel?.guild?.id || ticket?.guild_id || config.guildId || ''),
      name: channel?.guild?.name || config.storeName || 'Cenar Store',
      iconUrl: channel?.guild?.iconURL?.({ size: 128, extension: 'webp' }) || null,
    },
    channel: { id: String(channel?.id || ticket?.channel_id || ''), name: channel?.name || 'ticket' },
    messages: allMessages.map(serializeMessage),
  };
  const jsonBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
  const compressed = zlib.gzipSync(jsonBuffer, { level: 9 });
  const checksum = crypto.createHash('sha256').update(compressed).digest('hex');
  const safeCode = code.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const archiveFileName = `transcript_${safeCode}.json.gz`;
  const savedArchivePath = path.join(directory, archiveFileName);

  try {
    atomicWrite(savedArchivePath, compressed);
    const result = db.prepare(`INSERT INTO ticket_transcript_archives (
      archive_code, token_hash, guild_id, ticket_id, ticket_code, ticket_type,
      channel_id, channel_name, customer_id, message_count, format_version,
      compression, storage_backend, local_file_name, original_bytes, compressed_bytes,
      checksum_sha256, partial, fetch_error, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GZIP', 'LOCAL_GZIP', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      code, tokenHash, payload.server.id || 'UNKNOWN', ticket?.id || null, payload.ticket.code,
      payload.ticket.type, payload.channel.id || null, payload.channel.name, payload.ticket.customerId,
      payload.messages.length, ARCHIVE_FORMAT_VERSION, archiveFileName, jsonBuffer.length,
      compressed.length, checksum, fetchError ? 1 : 0, fetchError?.message || null, createdAt, expiresAt,
    );
    return {
      archiveId: Number(result.lastInsertRowid), archiveCode: code, accessToken, archiveFileName,
      messageCount: allMessages.length, savedToDisk: true, savedArchivePath,
      originalBytes: jsonBuffer.length, compressedBytes: compressed.length,
      partial: fetchError !== null, fetchErrorMessage: fetchError?.message || null,
    };
  } catch (error) {
    fs.rmSync(savedArchivePath, { force: true });
    console.error('[TRANSCRIPT] Không thể lưu archive nén:', error.message);
    return {
      archiveId: null, archiveCode: code, accessToken: null, archiveFileName,
      messageCount: allMessages.length, savedToDisk: false, savedArchivePath: null,
      originalBytes: jsonBuffer.length, compressedBytes: compressed.length,
      partial: fetchError !== null, fetchErrorMessage: fetchError?.message || null,
    };
  }
}

export function recordTranscriptDiscordMirror({ archiveId, closedById, channelId, messageId, attachmentId, attachmentUrl }) {
  if (!archiveId) return false;
  ensureTranscriptArchiveSchema();
  const result = db.prepare(`UPDATE ticket_transcript_archives SET
    closed_by_id = COALESCE(?, closed_by_id), discord_channel_id = ?, discord_message_id = ?,
    discord_attachment_id = ?, discord_attachment_url = ?, storage_backend = 'LOCAL_GZIP+DISCORD'
    WHERE id = ?`).run(closedById || null, channelId, messageId, attachmentId, attachmentUrl || null, archiveId);
  return result.changes > 0;
}

async function downloadDiscordMirror(row, client, fetchImpl, maxBytes) {
  let url = row.discord_attachment_url || null;
  if (client && row.discord_channel_id && row.discord_message_id) {
    const channel = await client.channels.fetch(row.discord_channel_id).catch(() => null);
    const message = await channel?.messages?.fetch?.(row.discord_message_id).catch(() => null);
    const attachment = message?.attachments?.get?.(row.discord_attachment_id)
      || collectionValues(message?.attachments).find((item) => item?.id === row.discord_attachment_id)
      || collectionValues(message?.attachments).find((item) => String(item?.name || '').endsWith('.json.gz'));
    if (attachment?.url) url = attachment.url;
  }
  if (!url || typeof fetchImpl !== 'function') throw new Error('Transcript archive is temporarily unavailable');
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Discord mirror returned HTTP ${response.status}`);
  const declared = Number(response.headers?.get?.('content-length')) || 0;
  if (declared > maxBytes) throw new Error('Transcript archive exceeds the configured size limit');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error('Transcript archive exceeds the configured size limit');
  return buffer;
}

export async function readTranscriptArchive(accessToken, {
  directory = DEFAULT_ARCHIVE_DIRECTORY,
  client = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const token = String(accessToken || '').trim().toLowerCase();
  if (!ACCESS_TOKEN_PATTERN.test(token)) return null;
  ensureTranscriptArchiveSchema();
  const row = db.prepare('SELECT * FROM ticket_transcript_archives WHERE token_hash = ? LIMIT 1').get(hashTranscriptAccessToken(token));
  if (!row || row.status !== 'ACTIVE' || row.revoked_at) return null;
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null;

  const maxBytes = Math.max(1_048_576, Number(config.transcriptArchiveMaxBytes) || 26_214_400);
  let compressed = null;
  if (row.local_file_name && path.basename(row.local_file_name) === row.local_file_name && ARCHIVE_FILE_PATTERN.test(row.local_file_name)) {
    try {
      const localPath = path.join(directory, row.local_file_name);
      const stat = fs.statSync(localPath);
      if (stat.size > maxBytes) throw new Error('Transcript archive exceeds the configured size limit');
      compressed = fs.readFileSync(localPath);
      parseArchiveBuffer(compressed, row.checksum_sha256);
    } catch (error) {
      compressed = null;
      console.warn(`[TRANSCRIPT] Local cache unavailable for ${row.archive_code}:`, error.message);
    }
  }

  if (!compressed) {
    compressed = await downloadDiscordMirror(row, client, fetchImpl, maxBytes);
    parseArchiveBuffer(compressed, row.checksum_sha256);
    const restoredName = `transcript_${String(row.archive_code).toLowerCase().replace(/[^a-z0-9_-]/g, '')}.json.gz`;
    atomicWrite(path.join(directory, restoredName), compressed);
    db.prepare(`UPDATE ticket_transcript_archives SET local_file_name = ?, storage_backend = 'LOCAL_GZIP+DISCORD',
      discord_attachment_url = COALESCE(discord_attachment_url, ?) WHERE id = ?`).run(restoredName, row.discord_attachment_url || null, row.id);
  }

  const payload = parseArchiveBuffer(compressed, row.checksum_sha256);
  db.prepare('UPDATE ticket_transcript_archives SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?')
    .run(new Date().toISOString(), row.id);
  return {
    ...payload,
    archive: {
      ...payload.archive,
      code: row.archive_code,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      messageCount: row.message_count,
      partial: Boolean(row.partial),
    },
    storage: {
      format: `JSON_V${row.format_version}`,
      compression: row.compression,
      originalBytes: row.original_bytes,
      compressedBytes: row.compressed_bytes,
      mirrored: Boolean(row.discord_attachment_id),
    },
  };
}
