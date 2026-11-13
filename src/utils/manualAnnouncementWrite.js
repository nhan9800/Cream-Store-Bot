import { AsyncLocalStorage } from 'node:async_hooks';

const manualWrite = new AsyncLocalStorage();

// A permission-checked /thongbao confirmation or a dated owner-authorized
// campaign release grants this one send. Historical automatic jobs do not.
// Keep the grant local to its async task, REST client, channel and draft nonce.
export async function withManualAnnouncementWrite({ rest, channelId, nonce }, operation) {
  const grant = { rest, channelId: String(channelId), nonce: String(nonce), method: 'POST', active: true, used: false };
  try {
    return await manualWrite.run(grant, operation);
  } finally {
    grant.active = false;
  }
}

/** An owner-reviewed, silent edit of one exact existing message. */
export async function withOwnerMessageEdit({ rest, channelId, messageId }, operation) {
  const grant = { rest, channelId: String(channelId), messageId: String(messageId),
    method: 'PATCH', active: true, used: false };
  try { return await manualWrite.run(grant, operation); }
  finally { grant.active = false; }
}

export function consumeManualAnnouncementWrite(rest, options) {
  const grant = manualWrite.getStore();
  if (!grant?.active || grant.used || !grant.rest || grant.rest !== rest
    || String(options?.method).toUpperCase() !== grant.method) return false;
  if (grant.method === 'PATCH') {
    const mentions = options?.body?.allowed_mentions;
    if (!/^\d{17,20}$/.test(grant.messageId)
      || String(options?.fullRoute) !== `/channels/${grant.channelId}/messages/${grant.messageId}`
      || !mentions || !['parse', 'roles', 'users'].every(key => Array.isArray(mentions[key]) && mentions[key].length === 0)) return false;
  } else if (String(options?.fullRoute) !== `/channels/${grant.channelId}/messages`
    || !options?.body?.nonce || String(options.body.nonce) !== grant.nonce
    || options.body.enforce_nonce !== true) return false;
  grant.used = true;
  return true;
}
