import { db } from '../../db.js';

// Lore/anonymous "starter" guards for the nocni-hlidac leaderboard — never
// real Discord players. Every discordUserId here MUST start with this
// prefix; real Discord snowflake IDs are always numeric and can never
// collide with it, so seeding can never touch a real player's row.
export const SEED_PREFIX = 'seed-';

export interface SeedPlayer {
  discordUserId: string;
  username: string;
  displayName: string;
  bestRun: number;
  currentRun: number;
}

export const SEED_PLAYERS: SeedPlayer[] = [
  { discordUserId: 'seed-strazny-novak', username: 'strazny-novak', displayName: 'Strážný Novák', bestRun: 5, currentRun: 3 },
  { discordUserId: 'seed-hlidac-13', username: 'hlidac-13', displayName: 'Hlídač #13', bestRun: 4, currentRun: 2 },
  { discordUserId: 'seed-nocni-pepa', username: 'nocni-pepa', displayName: 'NočníPepa', bestRun: 4, currentRun: 1 },
  { discordUserId: 'seed-zamestnanec-042', username: 'zamestnanec-042', displayName: 'Zaměstnanec 042', bestRun: 2, currentRun: 1 },
  { discordUserId: 'seed-kandidat-smeny', username: 'kandidat-smeny', displayName: 'Kandidát směny', bestRun: 1, currentRun: 0 },
];

/**
 * Idempotent: upserts by discordUserId (unique), so repeated runs update the
 * same 5 rows to the same values instead of creating duplicates. Only ever
 * touches rows whose discordUserId starts with SEED_PREFIX — real players
 * (upserted via POST /nocni-hlidac/player/upsert with a real Discord ID) are
 * never read or written by this function.
 */
export async function seedNocniHlidac(): Promise<void> {
  for (const player of SEED_PLAYERS) {
    if (!player.discordUserId.startsWith(SEED_PREFIX)) {
      throw new Error(`Refusing to seed a non-"${SEED_PREFIX}" discordUserId: ${player.discordUserId}`);
    }

    await db.nocniHlidacPlayer.upsert({
      where: { discordUserId: player.discordUserId },
      update: {
        displayName: player.displayName,
        bestRun: player.bestRun,
        currentRun: player.currentRun,
      },
      create: {
        discordUserId: player.discordUserId,
        username: player.username,
        displayName: player.displayName,
        bestRun: player.bestRun,
        currentRun: player.currentRun,
      },
    });
  }
}
