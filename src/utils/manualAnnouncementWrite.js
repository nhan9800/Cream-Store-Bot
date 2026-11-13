import { AsyncLocalStorage } from 'node:async_hooks';

const manualWrite = new AsyncLocalStorage();

// Only the permission-checked /thongbao confirmation grants this one send.
// Keep the grant local to its async task, REST client, channel and draft nonce.
export async function withManualAnnouncementWrite({ rest, channelId, nonce }, operation) {
  const grant = { rest, channelId: String(channelId), nonce: String(nonce), active: true, used: false };
  try {
    return await manualWrite.run(grant, operation);
  } finally {
    grant.active = false;
  }
}

export function consumeManualAnnouncementWrite(rest, options) {
  const grant = manualWrite.getStore();
  if (!grant?.active || grant.used || !grant.rest || grant.rest !== rest
    || String(options?.method).toUpperCase() !== 'POST'
    || String(options?.fullRoute) !== `/channels/${grant.channelId}/messages`
    || !options?.body?.nonce || String(options.body.nonce) !== grant.nonce
    || options.body.enforce_nonce !== true) return false;
  grant.used = true;
  return true;
}
