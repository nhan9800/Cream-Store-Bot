import { db } from '../database/db.js';

export function runTempKeySetup(client) {
  try {
    const guilds = client.guilds.cache;
    if (guilds.size === 0) return;
    const guildId = guilds.first().id;

    // Ensure the row exists
    db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)').run(guildId);

    db.prepare(`
      UPDATE guild_settings
      SET cardswap_partner_id = ?, cardswap_partner_key = ?, cardswap_domain = ?,
          cardswap_buy_partner_id = ?, cardswap_buy_partner_key = ?
      WHERE guild_id = ?
    `).run(
      '1643275450',
      'qxTwdOVykmtsQMYmBR9DtTrnTxO2YCRZ',
      'card2k.com',
      '24921116879',
      'nQFj6bG0dAFi0iSs4utHxJLOMSvRLCX0',
      guildId
    );
    console.log('[TEMP SETUP] API keys for card2k have been set successfully for guild', guildId);
  } catch (e) {
    console.error('[TEMP SETUP] Error setting keys:', e);
  }
}
