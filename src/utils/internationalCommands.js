const COMMAND_NAMES = Object.freeze({
  baohanh: 'warranty',
  'chuyen-server': 'migrate-server',
  congno: 'customer-credit',
  'dac-quyen': 'benefits',
  dsbaohanh: 'warranty-list',
  giaohang: 'deliver-order',
  hoanthanh: 'complete-order',
  khachhang: 'customer-profile',
  'khoi-phuc-server': 'server-recovery',
  oder: 'legacy-order',
  'quanly-don': 'manage-order',
  'sua-don': 'edit-order',
  thongbao: 'announce',
  'thong-bao-bang-gia': 'price-update',
  thongke: 'statistics',
  'vinh-danh': 'leaderboard',
});

const OPTION_NAMES = Object.freeze({
  loai: 'type', kenh: 'channel', san_pham: 'product', gia: 'price', thoi_han: 'duration',
  nguoi_dung: 'user', khach_hang: 'customer', ly_do: 'reason', noi_dung: 'content',
  tieu_de: 'title', hinh_anh: 'image', vai_tro: 'role', trang_thai: 'status',
  ma_don: 'order-code', so_tien: 'amount', so_luong: 'quantity', tai_khoan: 'account',
  mat_khau: 'password', ghi_chu: 'note', han_su_dung: 'expiry', phan_tram: 'percent',
  dich_vu: 'service', hanh_dong: 'action', ten: 'name', mo_ta: 'description',
  them: 'add', sua: 'edit', xoa: 'delete', xem: 'view', duyet: 'approve',
  tu_choi: 'reject', gui: 'send', han_muc: 'quota', tao: 'create', cap_nhat: 'update',
});

function englishOptionName(name) {
  return OPTION_NAMES[name] || String(name || '').replace(/_/g, '-').slice(0, 32);
}

function localizeOption(option) {
  const copy = { ...option };
  if (copy.name) {
    const localizedName = englishOptionName(copy.name);
    copy.name_localizations = { ...(copy.name_localizations || {}), 'en-US': localizedName, 'en-GB': localizedName };
  }
  if (copy.description) {
    const description = `Cenar Global option: ${englishOptionName(copy.name)}.`.slice(0, 100);
    copy.description_localizations = { ...(copy.description_localizations || {}), 'en-US': description, 'en-GB': description };
  }
  if (Array.isArray(copy.options)) copy.options = copy.options.map(localizeOption);
  if (Array.isArray(copy.choices)) {
    copy.choices = copy.choices.map((choice) => ({
      ...choice,
      name_localizations: {
        ...(choice.name_localizations || {}),
        'en-US': String(choice.value ?? choice.name).replace(/[_-]+/g, ' ').slice(0, 100),
        'en-GB': String(choice.value ?? choice.name).replace(/[_-]+/g, ' ').slice(0, 100),
      },
    }));
  }
  return copy;
}

export function localizeCommandsForInternationalStore(commands) {
  return commands.map((command) => {
    const englishName = COMMAND_NAMES[command.name] || command.name;
    const description = `Cenar Global command: ${englishName.replace(/-/g, ' ')}.`.slice(0, 100);
    return {
      ...command,
      name_localizations: { ...(command.name_localizations || {}), 'en-US': englishName, 'en-GB': englishName },
      description_localizations: { ...(command.description_localizations || {}), 'en-US': description, 'en-GB': description },
      options: Array.isArray(command.options) ? command.options.map(localizeOption) : command.options,
    };
  });
}

export const internationalCommandNames = COMMAND_NAMES;
