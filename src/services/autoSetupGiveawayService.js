// Automatic giveaway creation is intentionally disabled. Giveaways must only
// be created explicitly through the /giveaway command.
export async function autoSetupGiveawayChannel() {
  console.log('[AUTO-SETUP-GIVEAWAY] Disabled; skipping automatic giveaway creation.');
  return { enabled: false, created: 0 };
}
