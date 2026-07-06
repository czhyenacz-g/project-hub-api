// One-off seed for the nocni-hlidac leaderboard — lore/anonymous "starter"
// guards, not real Discord players, so the leaderboard doesn't look empty on
// a fresh deploy. Safe to run repeatedly (see seedNocniHlidac in
// src/modules/nocniHlidac/seed.ts for the idempotency/isolation guarantees).
//
// Run locally:  npx tsx scripts/seed-nocni-hlidac.ts
// Run in prod:  docker compose exec project-hub-api npx tsx scripts/seed-nocni-hlidac.ts
import { db } from '../src/db.js';
import { seedNocniHlidac, SEED_PLAYERS } from '../src/modules/nocniHlidac/seed.js';

console.log('[seed-nocni-hlidac] starting...');

seedNocniHlidac()
  .then(() => {
    for (const player of SEED_PLAYERS) {
      console.log(`[seed-nocni-hlidac] upserted: ${player.discordUserId} (${player.displayName})`);
    }
    console.log('[seed-nocni-hlidac] done.');
  })
  .catch((err) => {
    console.error('[seed-nocni-hlidac] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
