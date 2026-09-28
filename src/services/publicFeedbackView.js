/**
 * Public review responses must not expose order, guild, or customer identity
 * fields from the feedback table. Admin callers use the original row through
 * the separate admin API and do not pass through this allowlist.
 */
export function buildPublicFeedbackView(feedback = {}) {
  return {
    id: Number(feedback.id) || 0,
    stars: Number(feedback.stars) || 0,
    content: String(feedback.content || '').slice(0, 1_000),
    created_at: feedback.created_at || null,
    updated_at: feedback.updated_at || null,
    customer_name: String(feedback.customer_name || 'Khách hàng').slice(0, 100),
    customer_avatar: /^https:\/\//i.test(String(feedback.customer_avatar || ''))
      ? String(feedback.customer_avatar).slice(0, 1_000)
      : null,
    product_id: Number(feedback.product_id) || null,
    product_name: feedback.product_name ? String(feedback.product_name).slice(0, 240) : null,
  };
}
