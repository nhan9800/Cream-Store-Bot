export const NITRO_TRIAL_ELIGIBILITY_VI = Object.freeze([
  'Tài khoản được tạo trên 1 tháng và chưa từng sử dụng Nitro.',
]);

export const NITRO_TRIAL_ELIGIBILITY_EN = Object.freeze([
  'The account is over one month old and has never used Nitro.',
]);

export function isNitroTrialProduct(product) {
  return /nitro/i.test(String(product?.name || ''))
    && /trial|trail/i.test(String(product?.name || ''))
    && Number(product?.duration_months) === 3;
}

export function getNitroTrialEligibility(international = false) {
  return international ? NITRO_TRIAL_ELIGIBILITY_EN : NITRO_TRIAL_ELIGIBILITY_VI;
}
