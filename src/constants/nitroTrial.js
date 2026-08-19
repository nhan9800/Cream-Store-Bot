export const NITRO_TRIAL_ELIGIBILITY_VI = Object.freeze([
  'Tài khoản được tạo trên 1 tháng và chưa từng sử dụng Nitro.',
  'Tài khoản đã từng sử dụng Nitro nhưng không dùng lại Nitro trong ít nhất 12 tháng liên tục.',
]);

export const NITRO_TRIAL_ELIGIBILITY_EN = Object.freeze([
  'The account is over one month old and has never used Nitro.',
  'The account used Nitro before but has not used Nitro again for at least 12 consecutive months.',
]);

export function isNitroTrialProduct(product) {
  return /nitro/i.test(String(product?.name || ''))
    && /trial|trail/i.test(String(product?.name || ''))
    && Number(product?.duration_months) === 3;
}

export function getNitroTrialEligibility(international = false) {
  return international ? NITRO_TRIAL_ELIGIBILITY_EN : NITRO_TRIAL_ELIGIBILITY_VI;
}
