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
