import { db } from '../database/db.js';
import { STORE_SERVICE_FORUM } from '../config/storeServiceForum202611.js';
import { RESTORED_FEEDBACK_MESSAGES } from '../config/restoredFeedbackMessages20261107.js';
let verifiedRestoration = false;

// Rebind verified copies without resubmitting a review or changing its data.
export function rebindRestoredFeedbackReferences(guildId) {
  if (String(guildId) !== STORE_SERVICE_FORUM.guildId) return { changed: 0 };
  const update = db.prepare(`UPDATE feedbacks SET feedback_channel_id = ?, feedback_message_id = ?
    WHERE guild_id = ? AND feedback_channel_id = ? AND feedback_message_id = ?`);
  const result = db.transaction(() => {
    let changed = 0;
    for (const [sourceMessage, reference] of Object.entries(RESTORED_FEEDBACK_MESSAGES)) {
      changed += update.run(STORE_SERVICE_FORUM.feedbackChannelId, reference.messageId,
        guildId, reference.sourceChannelId, sourceMessage)?.changes || 0;
    }
    return { changed };
  })();
  verifiedRestoration = true;
  return result;
}

export function restoredFeedbackReferenceHealth() {
  return { verified: verifiedRestoration, verifiedMessageMappings: Object.keys(RESTORED_FEEDBACK_MESSAGES).length };
}
