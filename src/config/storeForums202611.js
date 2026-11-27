// Owner-authorized forum consolidation. Legacy channels remain archived so
// existing links, attachments and private support threads retain their history.
export const STORE_FORUMS = Object.freeze({
  guildId: '1282637033340403754',
  guideForumId: '1568246893236985898',
  priceForumId: '1568246895812280350',
  pricePosts: Object.freeze({ locket: '1568249645497450606' }),
  guidePosts: Object.freeze({
    nitro: '1568246897754513518',
    youtube: '1568246979128074280',
    spotify: '1568246983473373264',
    netflix: '1568246985725841519',
    boost: '1568246987554295854',
  }),
});

/** Where customers should go to see prices: the Store1 price forum, otherwise the guild's configured list. */
export function priceBoardChannelId(guildId, guildConfig = null) {
  if (guildId === STORE_FORUMS.guildId) return STORE_FORUMS.priceForumId;
  return guildConfig?.price_list_channel_id || null;
}
