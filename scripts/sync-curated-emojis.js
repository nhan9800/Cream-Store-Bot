import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits } from 'discord.js';

const assets = [
  ['cenar_warranty_shield', 'cenar_warranty_shield.png'],
  ['cenar_purchase_date', 'cenar_purchase_date.png'],
  ['cenar_expiry_date', 'cenar_expiry_date.png'],
  ['cenar_transcript_web', 'cenar_transcript_web.png'],
  ['cenar_activity_search', 'cenar_activity_search.png'],
  ['cenar_otp_loading', 'cenar_otp_loading.gif'],
  ['cenar_card_success', 'cenar_card_success.gif'],
  ['cenar_ctv_crystal', 'cenar_ctv_crystal.gif'],
  ['cenar_partner_rules', 'cenar_partner_rules.png'],
  ['cenar_partner_guide', 'cenar_partner_guide.png'],
  ['cenar_verify_shield', 'cenar_verify_shield.png'],
  ['cenar_recovery_backup', 'cenar_recovery_backup.gif'],
  ['cenar_recovery_restore', 'cenar_recovery_restore.png'],
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await guild.emojis.fetch();
    const result = [];

    for (const [name, fileName] of assets) {
      const existing = guild.emojis.cache.find((emoji) => emoji.name === name);
      if (existing) {
        result.push({ name, id: existing.id, action: 'reused' });
        continue;
      }

      const filePath = path.resolve('assets', 'emojis', fileName);
      if (!fs.existsSync(filePath)) throw new Error(`Thiếu asset ${filePath}`);
      const emoji = await guild.emojis.create({
        attachment: filePath,
        name,
        reason: 'Cenar curated static and animated UI refresh',
      });
      result.push({ name, id: emoji.id, action: 'created' });
    }

    console.log(JSON.stringify({ guild: guild.name, emojis: result }, null, 2));
  } finally {
    client.destroy();
  }
});

client.login(process.env.BOT_TOKEN);
