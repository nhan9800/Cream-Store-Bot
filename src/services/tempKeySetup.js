import { db } from '../database/db.js';

export function runTempKeySetup() {
  try {
    const row = db.prepare('SELECT guild_id FROM guild_settings LIMIT 1').get();
    if (!row) return;

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
      row.guild_id
    );
    console.log('[TEMP SETUP] API keys for card2k have been set successfully.');
  } catch (e) {
    console.error('[TEMP SETUP] Error setting keys:', e);
  }
}
