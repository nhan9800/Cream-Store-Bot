import sharp from 'sharp';
import { AttachmentBuilder } from 'discord.js';

const limit = 512 * 1024;
const sources = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

export async function importBookingExpression(guild, { kind, name, attachment, tag }) {
  if (!/^[a-z0-9_]{2,30}$/i.test(name) || !['emoji', 'sticker'].includes(kind)
    || (kind === 'sticker' && !/^\p{Extended_Pictographic}\uFE0F?$/u.test(tag))) {
    throw new RangeError('BOOKING_EXPRESSION_NAME');
  }
  const source = new URL(attachment.url);
  if (source.protocol !== 'https:' || !sources.has(source.hostname) || !source.pathname.startsWith('/attachments/')
    || !Number.isInteger(attachment.size) || attachment.size <= 0 || attachment.size > limit) {
    throw new RangeError('BOOKING_EXPRESSION_FILE');
  }
  const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok || !response.body) throw new Error('BOOKING_EXPRESSION_DOWNLOAD');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) throw new RangeError('BOOKING_EXPRESSION_FILE');
    chunks.push(chunk);
  }
  const original = Buffer.concat(chunks);
  const image = sharp(original, { limitInputPixels: 4_194_304 });
  const meta = await image.metadata();
  if (!['png', 'webp', 'gif', 'jpeg'].includes(meta.format)) throw new RangeError('BOOKING_EXPRESSION_FORMAT');
  const reason = 'Cenar Booking · nhập biểu tượng do quản lý cung cấp';
  if (kind === 'emoji') {
    const animated = meta.format === 'gif' && original.length < 256 * 1024;
    const data = animated ? original : await image.resize(128, 128, { fit: 'contain', background: '#00000000' }).png().toBuffer();
    return guild.emojis.create({ attachment: data, name, reason });
  }
  const file = await image.resize(320, 320, { fit: 'contain', background: '#00000000' }).png({ palette: true }).toBuffer();
  return guild.stickers.create({ file: new AttachmentBuilder(file, { name: 'cenar-sticker.png' }), name, tags: tag, reason });
}
