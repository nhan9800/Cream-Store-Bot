import sharp from 'sharp';

const uploadLimit = 3 * 1024 * 1024;
const decodedPixelLimit = 8_000_000;
export const bookingPhotoBytes = 48 * 1024;
export const bookingPhotoSide = 192;
const cdnHosts = new Set(['cdn.discordapp.com', 'media.discordapp.net']);
const acceptedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const acceptedFormats = new Set(['png', 'jpeg', 'webp']);
let activeImports = 0;

function photoSource(attachment) {
  let url;
  try { url = new URL(attachment?.url); } catch { return null; }
  if (url.protocol !== 'https:' || !cdnHosts.has(url.hostname) || url.username || url.password || url.port
    || !/^\/attachments\/\d{17,20}\/\d{17,20}\/[^/]+$/u.test(url.pathname)
    || !Number.isInteger(attachment.size) || attachment.size <= 0 || attachment.size > uploadLimit
    || (attachment.contentType && !acceptedTypes.has(attachment.contentType))) return null;
  return url;
}

function beginsWithImageSignature(buffer) {
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const webp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return png || jpeg || webp;
}

export class BookingPhotoError extends Error {}

export async function importBookingProfilePhoto(attachment, { fetchFile = fetch } = {}) {
  const source = photoSource(attachment);
  if (!source) throw new BookingPhotoError('Tải ảnh JPG, PNG hoặc WebP tối đa 3 MB trực tiếp qua Discord.');
  if (activeImports >= 2) throw new BookingPhotoError('Bot đang xử lý ảnh. Vui lòng thử lại trong giây lát.');
  activeImports += 1;
  try {
    const response = await fetchFile(source, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => null);
      throw new BookingPhotoError('Không lấy được ảnh. Hãy tải lại ảnh vào Discord.');
    }
    if (Number(response.headers.get('content-length')) > uploadLimit) {
      await response.body.cancel().catch(() => null);
      throw new BookingPhotoError('Ảnh vượt quá 3 MB.');
    }
    const parts = [];
    let bytes = 0;
    for await (const part of response.body) {
      bytes += part.byteLength;
      if (bytes > uploadLimit) throw new BookingPhotoError('Ảnh vượt quá 3 MB.');
      parts.push(part);
    }
    const input = Buffer.concat(parts, bytes);
    if (!beginsWithImageSignature(input)) throw new BookingPhotoError('Tệp không phải ảnh JPG, PNG hoặc WebP.');
    const sourceImage = sharp(input, { limitInputPixels: decodedPixelLimit });
    const meta = await sourceImage.metadata();
    if (!acceptedFormats.has(meta.format) || (meta.pages ?? 1) > 1) {
      throw new BookingPhotoError('Chọn ảnh tĩnh dạng JPG, PNG hoặc WebP.');
    }
    const photo = await sourceImage.rotate().resize(bookingPhotoSide, bookingPhotoSide, { fit: 'cover' })
      .flatten({ background: '#272247' }).webp({ quality: 80 }).toBuffer();
    if (photo.length > bookingPhotoBytes) throw new BookingPhotoError('Ảnh không thể nén vừa giới hạn của thẻ. Thử ảnh khác.');
    return photo;
  } catch (error) {
    if (error instanceof BookingPhotoError) throw error;
    throw new BookingPhotoError('Không đọc được ảnh. Hãy thử tải lên một ảnh tĩnh khác.');
  } finally {
    activeImports -= 1;
  }
}
