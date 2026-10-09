# Automatic marketing paused · 2026-10-09

Owner revoked automatic giveaway posting and daily promotion pings because customers complained. This supersedes the earlier daily `@everyone` instruction.

`src/config/marketingAutomationPolicy.js` defaults closed. Public campaign publishers return `paused` before Discord access; the daily promotion timer is not started. Invite campaign setup, join enrollment and reward notifications are paused. `pauseAutomaticMarketing()` cancels active giveaways only in the three configured campaign channels and pauses the specific invite event without deleting participation/reward history or changing commerce data.

The existing Discord REST message boundary rejects POST/PATCH message writes in event1514606987839672563, promotion1515008584549797979 and automatic profile giveaway1531206050383134842. Read/delete requests and ordinary order/support/music channels still work. This prevents legacy publishers, startup repair and manual force options from recreating cleared content. The old promotion board status is PAUSED, so AI does not advertise it as an active campaign. Health exposes aggregate paused status and active campaign counts.

Owner authorized deleting every message in event1514606987839672563, including human posts. Promotion cleanup removes the bot's sale/story/notice messages; other authors' posts are retained. Use full paginated history, preserve an owner-only local recovery snapshot before deletion, and verify both channels after deployment. Do not recreate a replacement campaign or send an announcement until explicitly requested by the owner.

Historical campaign mechanics remain tested with a fixture-only policy override. `marketingPause.test.js` uses the real closed default and proves force/mention options cannot enable publication. Boundary tests prove blocked writes and permitted deletion/commerce. New manual giveaways in unrelated channels are unaffected.
