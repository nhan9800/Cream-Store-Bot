/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       Embed Markdown Helpers                         ║
 * ║  Helpers tận dụng Discord markdown nâng cao:         ║
 * ║  - Heading (#, ##, ###)                              ║
 * ║  - Subtext (-#)                                      ║
 * ║  - Blockquote (>, >>>)                               ║
 * ║  - Time tags (<t:N:R>, <t:N:F>, <t:N:t>)            ║
 * ║  - Code, lists, dividers                             ║
 * ╚══════════════════════════════════════════════════════╝
 */

// ─── Time tags ──────────────────────────────────────────────
export const T = {
    /** Relative — "2 phút trước" / "trong 1 giờ" */
    rel: (date) => `<t:${unix(date)}:R>`,
    /** Full long — "Wednesday, May 21, 2026 12:00 AM" */
    full: (date) => `<t:${unix(date)}:F>`,
    /** Short date+time — "20/05/2026 12:00" */
    dateTime: (date) => `<t:${unix(date)}:f>`,
    /** Date only — "20/05/2026" */
    date: (date) => `<t:${unix(date)}:D>`,
    /** Time only — "12:00 AM" */
    time: (date) => `<t:${unix(date)}:t>`,
};
function unix(date) {
    if (!date) return Math.floor(Date.now() / 1000);
    if (typeof date === 'number') return date < 1e12 ? date : Math.floor(date / 1000);
    return Math.floor(new Date(date).getTime() / 1000);
}

// ─── Inline formatters ──────────────────────────────────────
export const fmt = {
    /** Bold — `**text**` */
    b: (text) => `**${text}**`,
    /** Italic — `*text*` */
    i: (text) => `*${text}*`,
    /** Bold italic */
    bi: (text) => `***${text}***`,
    /** Underline */
    u: (text) => `__${text}__`,
    /** Strikethrough */
    s: (text) => `~~${text}~~`,
    /** Spoiler */
    spoiler: (text) => `||${text}||`,
    /** Inline code — `` `text` `` */
    code: (text) => `\`${text}\``,
    /** Code block with language */
    codeBlock: (lang, text) => `\`\`\`${lang}\n${text}\n\`\`\``,
    /** Link — `[label](url)` */
    link: (label, url) => `[${label}](${url})`,
    /** Mention user */
    user: (id) => `<@${id}>`,
    /** Mention channel */
    channel: (id) => `<#${id}>`,
    /** Mention role */
    role: (id) => `<@&${id}>`,
};

// ─── Block formatters ───────────────────────────────────────

/** Heading 1 — `# text` */
export const h1 = (text) => `# ${text}`;
/** Heading 2 — `## text` */
export const h2 = (text) => `## ${text}`;
/** Heading 3 — `### text` */
export const h3 = (text) => `### ${text}`;

/** Subtext (chữ nhỏ mờ) — `-# text` */
export const subtext = (text) => `-# ${text}`;

/** Single-line blockquote — `> text` */
export const quote = (text) => `> ${text}`;
/** Multi-line blockquote (đến hết message) — `>>> text` */
export const quoteAll = (text) => `>>> ${text}`;

/** Bullet list */
export const bullets = (items) => items.filter(Boolean).map(i => `- ${i}`).join('\n');
/** Numbered list */
export const numbered = (items) => items.filter(Boolean).map((i, idx) => `${idx + 1}. ${i}`).join('\n');

/** Horizontal divider (visual line, dùng giữa sections) */
export const divider = () => `\n${'─'.repeat(20)}\n`;

/** Pretty section: heading + content + (optional) subtext footer */
export function section(title, content, footer = null) {
    const parts = [h2(title), content];
    if (footer) parts.push(subtext(footer));
    return parts.join('\n');
}

/** Field row: `> **Label:** value` */
export function fieldQ(label, value) {
    return `> ${fmt.b(label + ':')} ${value}`;
}

/** Multiple field rows trong blockquote */
export function fields(pairs) {
    return Object.entries(pairs)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => fieldQ(k, v))
        .join('\n');
}

/** Format VND currency với separator */
export function vnd(amount) {
    return new Intl.NumberFormat('vi-VN').format(Math.round(amount));
}

/** Format số với dấu phẩy */
export function num(value) {
    return new Intl.NumberFormat('vi-VN').format(Math.round(value));
}

/** Pretty progress bar (text-based) */
export function progressBar(current, total, width = 10) {
    if (!total) return '';
    const ratio = Math.min(1, Math.max(0, current / total));
    const filled = Math.round(ratio * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Status pill ─ trả về string với emoji + text */
export function statusPill(status, customLabels = {}, E = null) {
    const r = E || (() => '');
    const map = {
        PENDING_PAYMENT: { emoji: r('order_pending'),    text: 'Chờ thanh toán' },
        PROCESSING:      { emoji: r('order_processing'), text: 'Đang xử lý' },
        COMPLETED:       { emoji: r('order_complete'),   text: 'Hoàn thành' },
        CANCELLED:       { emoji: r('order_cancel'),     text: 'Đã huỷ' },
        REFUND_PENDING:  { emoji: r('payment_refund'),   text: 'Chờ hoàn tiền' },
        REFUNDED:        { emoji: r('order_cancel'),     text: 'Đã hoàn tiền' },
        OPEN:            { emoji: r('order_processing'), text: 'Đang mở' },
        CLOSED:          { emoji: r('icon_lock'),        text: 'Đã đóng' },
        PAID:            { emoji: r('status_check'),     text: 'Đã thanh toán' },
        FREE:            { emoji: r('icon_sparkle'),     text: 'Miễn phí' },
        WARRANTY_OPEN:   { emoji: r('panel_warranty'),   text: 'Đang bảo hành' },
        DELIVERED:       { emoji: r('order_product'),    text: 'Đã giao hàng' },
        ...customLabels,
    };
    const item = map[status] || { emoji: '', text: String(status) };
    const pill = [item.emoji, fmt.b(item.text)].filter(Boolean).join(' ');
    return pill;
}

/** Empty line / spacer (1 line trống an toàn) */
export const SP = '\u200b'; // zero-width space để Discord không trim line trống

/** Join lines + filter null/undefined/empty */
export function lines(...arr) {
    return arr.flat().filter(l => l !== null && l !== undefined && l !== '').join('\n');
}
