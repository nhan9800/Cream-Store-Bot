const running = new Set();
const pending = new Map();

export function isAiResponseRunning(channelId) { return running.has(channelId); }

/** Keep at most the newest ticket follow-up while an answer is running. */
export async function runAiResponseTask(channelId, task, { coalesce = false } = {}) {
  if (running.has(channelId)) {
    if (coalesce) pending.set(channelId, task);
    return;
  }
  running.add(channelId);
  try {
    let next = task;
    while (next) {
      await next();
      next = pending.get(channelId);
      pending.delete(channelId);
    }
  } finally {
    running.delete(channelId);
    pending.delete(channelId);
  }
}
