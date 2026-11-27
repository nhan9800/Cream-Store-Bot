// NAPAS VietQR account-transfer TLV; render locally, never send bank details to an image service.
const tlv = (id, value) => {
  if (!/^[\x20-\x7e]*$/.test(value) || value.length > 99) throw new Error('Invalid VietQR field');
  return id + String(value.length).padStart(2, '0') + value;
};
export function crc16(value) {
  let crc = 0xffff;
  for (const byte of Buffer.from(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
export function buildRefundVietQR({ bankBin, account, amount, orderCode }) {
  if (!/^\d{6}$/.test(bankBin) || !/^[A-Za-z0-9]{1,19}$/.test(account)
    || !Number.isSafeInteger(amount) || amount <= 0 || !/^(CN|CR)_\d{6}$/.test(orderCode)) throw new Error('Invalid refund QR');
  const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', bankBin) + tlv('01', account)) + tlv('02', 'QRIBFTTA');
  const payload = tlv('00', '01') + tlv('01', '12') + tlv('38', merchant) + tlv('53', '704')
    + tlv('54', String(amount)) + tlv('58', 'VN') + tlv('62', tlv('08', `HOAN ${orderCode.replace('_', '')}`)) + '6304';
  return payload + crc16(payload);
}

/** Parse a VietQR payload back into its fields and verify the CRC. Used to self-check before display. */
export function parseVietQR(payload) {
  const read = (text) => {
    const out = {};
    for (let i = 0; i < text.length;) {
      const id = text.slice(i, i + 2);
      const len = Number(text.slice(i + 2, i + 4));
      if (!/^\d{2}$/.test(id) || !Number.isInteger(len)) throw new Error('Malformed VietQR');
      out[id] = text.slice(i + 4, i + 4 + len);
      i += 4 + len;
    }
    return out;
  };
  if (typeof payload !== 'string' || !/6304[0-9A-F]{4}$/.test(payload)) throw new Error('Missing VietQR CRC');
  if (crc16(payload.slice(0, -4)) !== payload.slice(-4)) throw new Error('VietQR CRC mismatch');
  const top = read(payload.slice(0, -8));
  const merchant = read(top['38'] || '');
  const beneficiary = read(merchant['01'] || '');
  return {
    version: top['00'], method: top['01'], guid: merchant['00'], service: merchant['02'],
    bankBin: beneficiary['00'], account: beneficiary['01'], currency: top['53'],
    amount: Number(top['54']), country: top['58'], purpose: read(top['62'] || '')['08'] ?? null,
  };
}

/** Build and immediately verify the payload; throws if any field would not scan exactly as intended. */
export function buildVerifiedRefundVietQR(input) {
  const payload = buildRefundVietQR(input);
  const parsed = parseVietQR(payload);
  if (parsed.guid !== 'A000000727' || parsed.service !== 'QRIBFTTA' || parsed.currency !== '704'
    || parsed.country !== 'VN' || parsed.bankBin !== input.bankBin || parsed.account !== input.account
    || parsed.amount !== input.amount) throw new Error('VietQR self-check failed');
  return payload;
}
