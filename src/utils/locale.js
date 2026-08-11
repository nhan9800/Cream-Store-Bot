export const STORE_ONE_GUILD_ID = '1282637033340403754';
export const STORE_TWO_GUILD_ID = '1070676180103086132';

export function isInternationalGuild(guildId) {
  return String(guildId || '') === STORE_TWO_GUILD_ID;
}

export function localeForGuild(guildId) {
  return isInternationalGuild(guildId) ? 'en-US' : 'vi-VN';
}

export function pickGuildText(guildId, vietnamese, english) {
  return isInternationalGuild(guildId) ? english : vietnamese;
}

export function brandForGuild(guildId, fallback = 'Cenar Store') {
  return isInternationalGuild(guildId) ? 'Cenar Global' : fallback;
}
