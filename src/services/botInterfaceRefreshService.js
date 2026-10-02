import { config } from '../config.js';
import { autoSetupPriceBoard } from './autoSetupPriceBoardService.js';
import { refreshBoostPanel } from './boostServerService.js';
import { startHistoricalBoostPresentationRepair } from './historicalBoostPresentationRepairService.js';
import { getCoreEmojiPackStatus } from './coreEmojiPackService.js';

const summaries=new WeakMap();
const priceArtwork=new WeakMap();
export function getBotInterfaceRefreshStatus(client) {
  return summaries.get(client) || {status:'not_started'};
}
export async function refreshBotInterfaces(client) {
  summaries.set(client,{status:'in_progress'});
  try {
    // The log channel can still be repaired when a removed public panel or
    // catalog channel requires operational recovery.
    startHistoricalBoostPresentationRepair(client,{guildId:config.guildId});
    const artwork=getCoreEmojiPackStatus(client).created || 0;
    const products=await autoSetupPriceBoard(client,{
      targetGuildId:config.guildId,force:priceArtwork.get(client)!==artwork,
    });
    if (!products.length || products.some(result=>!['published','current'].includes(result.status))) throw new Error('PRICE_BOARD_REFRESH_FAILED');
    // A failed Boost panel must not republish an already refreshed catalog on
    // every retry. New icon uploads still require one new catalog refresh.
    priceArtwork.set(client,artwork);
    const panel=await refreshBoostPanel(client,config.guildId);
    if (!['updated','not_configured'].includes(panel?.status)) throw new Error('BOOST_PANEL_REFRESH_FAILED');
    const summary={status:'ready',priceBoard:products[0]?.status || 'not_configured',boostPanel:panel.status,updatedAt:new Date().toISOString()};
    summaries.set(client,summary);
    return summary;
  } catch {
    summaries.set(client,{status:'retry_required'});
    throw new Error('BOT_UI_REFRESH_FAILED');
  }
}
