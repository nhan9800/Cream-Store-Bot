// Owner revoked automatic campaigns on 2026-10-09. Keep this default closed;
// a new campaign requires a deliberate owner-authorized release.
export const AUTOMATIC_MARKETING_PAUSED = true;
export const PAUSED_MARKETING_CHANNEL_IDS = Object.freeze([
  '1514606987839672563', // Invite-event channel: owner requested full purge.
  '1515008584549797979', // Promotion channel: awaiting rebuilt sale.
  '1531206050383134842', // Automatically created profile-effect giveaway.
]);
export function isMarketingWritePaused(channelId) {
  return AUTOMATIC_MARKETING_PAUSED && PAUSED_MARKETING_CHANNEL_IDS.includes(String(channelId));
}
