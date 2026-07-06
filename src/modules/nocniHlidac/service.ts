import { db } from '../../db.js';
import { NocniHlidacPlayerUpsertInput } from './validation.js';
import { applySurviveNight } from './runTransitions.js';
import { guardName } from './guardName.js';

export interface GuardLeaderboardEntry {
  guardName: string;
  bestRun: number;
  currentRun: number;
}

interface PlayerLike {
  displayName: string | null;
  username: string;
  bestRun: number;
  currentRun: number;
}

function toLeaderboardEntry(player: PlayerLike): GuardLeaderboardEntry {
  return { guardName: guardName(player), bestRun: player.bestRun, currentRun: player.currentRun };
}

// Creates the player if missing, otherwise updates name/avatar/lastLoginAt —
// NEVER touches bestRun/currentRun (Prisma's field defaults only apply on
// `create`, the `update` branch below simply doesn't mention them).
export async function upsertNocniHlidacPlayer(input: NocniHlidacPlayerUpsertInput): Promise<GuardLeaderboardEntry> {
  const player = await db.nocniHlidacPlayer.upsert({
    where: { discordUserId: input.discordUserId },
    update: {
      username: input.username,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
      lastLoginAt: new Date(),
    },
    create: {
      discordUserId: input.discordUserId,
      username: input.username,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
      lastLoginAt: new Date(),
    },
  });
  return toLeaderboardEntry(player);
}

// `null` when the player doesn't exist yet — the caller (routes.ts) turns
// that into 404. Player creation only happens via upsert (at login), not
// here, so a missing player at this point is a real "not found", not a race
// worth silently working around.
export async function recordSurvivedNight(discordUserId: string): Promise<GuardLeaderboardEntry | null> {
  return db.$transaction(async (tx) => {
    const player = await tx.nocniHlidacPlayer.findUnique({ where: { discordUserId } });
    if (!player) return null;

    const next = applySurviveNight(player);
    const updated = await tx.nocniHlidacPlayer.update({
      where: { discordUserId },
      data: { bestRun: next.bestRun, currentRun: next.currentRun },
    });
    return toLeaderboardEntry(updated);
  });
}

export async function recordDeath(discordUserId: string): Promise<GuardLeaderboardEntry | null> {
  const player = await db.nocniHlidacPlayer.findUnique({ where: { discordUserId } });
  if (!player) return null;

  const updated = await db.nocniHlidacPlayer.update({
    where: { discordUserId },
    data: { currentRun: 0 },
  });
  return toLeaderboardEntry(updated);
}

const LEADERBOARD_LIMIT = 10;

export async function listNocniHlidacLeaderboard(): Promise<GuardLeaderboardEntry[]> {
  const players = await db.nocniHlidacPlayer.findMany({
    orderBy: [{ bestRun: 'desc' }, { currentRun: 'desc' }, { updatedAt: 'desc' }],
    take: LEADERBOARD_LIMIT,
  });
  return players.map(toLeaderboardEntry);
}
