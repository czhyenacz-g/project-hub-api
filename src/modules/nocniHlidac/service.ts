import { db } from '../../db.js';
import { NocniHlidacPlayerUpsertInput } from './validation.js';
import { applySurviveNight } from './runTransitions.js';
import { guardName } from './guardName.js';
import { recordNightOutcomeActivity } from './activityService.js';

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

// Creates the player if missing, otherwise updates name/avatar — NEVER
// touches bestRun/currentRun (Prisma's field defaults only apply on
// `create`, the `update` branch below simply doesn't mention them).
//
// `lastLoginAt` is intentionally NOT touched here anymore (see activity
// logging task, "last_login_at má znamenat skutečné dokončení Discord OAuth
// loginu") — this upsert also runs from nocni-hlidac's `/api/auth/me`
// self-healing check (`ensureHubPlayer`), NOT just from a real login, so it
// must never look like a login by itself. The ONLY place that sets
// `lastLoginAt` now is `activityService.ts#recordLogin` (`POST
// /nocni-hlidac/player/login`), which the nocni-hlidac OAuth callback always
// calls right after this upsert on a real login — so a brand-new player's
// `lastLoginAt` stays `null` for the brief moment between the two calls, then
// gets set by the login call. If a caller ever upserts without a following
// login call, `lastLoginAt` simply stays whatever it was (null for a new
// player) — that's correct: no real login happened yet.
export async function upsertNocniHlidacPlayer(input: NocniHlidacPlayerUpsertInput): Promise<GuardLeaderboardEntry> {
  const player = await db.nocniHlidacPlayer.upsert({
    where: { discordUserId: input.discordUserId },
    update: {
      username: input.username,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
    },
    create: {
      discordUserId: input.discordUserId,
      username: input.username,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
    },
  });
  return toLeaderboardEntry(player);
}

// `null` when the player doesn't exist yet — the caller (routes.ts) turns
// that into 404. Player creation only happens via upsert (at login), not
// here, so a missing player at this point is a real "not found", not a race
// worth silently working around.
//
// `nightNumber` (optional, see validation.ts) is ONLY used for the
// `night_survived` audit event (activityService.ts) — bestRun/currentRun
// transitions (applySurviveNight, unchanged) never see it. The event insert
// + lastPlayedAt/lastActivityAt bump happen in the SAME transaction as the
// run-transition update, so a failed transaction never leaves a dangling
// event (see task "Nezapisuj událost, pokud příslušná herní operace
// selhala").
export async function recordSurvivedNight(discordUserId: string, nightNumber?: number): Promise<GuardLeaderboardEntry | null> {
  return db.$transaction(async (tx) => {
    const player = await tx.nocniHlidacPlayer.findUnique({ where: { discordUserId } });
    if (!player) return null;

    const next = applySurviveNight(player);
    const now = new Date();
    const updated = await tx.nocniHlidacPlayer.update({
      where: { discordUserId },
      data: { bestRun: next.bestRun, currentRun: next.currentRun, lastPlayedAt: now, lastActivityAt: now },
    });
    await recordNightOutcomeActivity(tx, updated.id, 'night_survived', nightNumber, updated.lastClient, updated.lastBuildVersion);
    return toLeaderboardEntry(updated);
  });
}

// Same nightNumber/transaction/event rules as recordSurvivedNight above —
// currentRun reset to 0 (unchanged), bestRun never touched.
export async function recordDeath(discordUserId: string, nightNumber?: number): Promise<GuardLeaderboardEntry | null> {
  return db.$transaction(async (tx) => {
    const player = await tx.nocniHlidacPlayer.findUnique({ where: { discordUserId } });
    if (!player) return null;

    const now = new Date();
    const updated = await tx.nocniHlidacPlayer.update({
      where: { discordUserId },
      data: { currentRun: 0, lastPlayedAt: now, lastActivityAt: now },
    });
    await recordNightOutcomeActivity(tx, updated.id, 'player_died', nightNumber, updated.lastClient, updated.lastBuildVersion);
    return toLeaderboardEntry(updated);
  });
}

const LEADERBOARD_LIMIT = 10;

export async function listNocniHlidacLeaderboard(): Promise<GuardLeaderboardEntry[]> {
  const players = await db.nocniHlidacPlayer.findMany({
    orderBy: [{ bestRun: 'desc' }, { currentRun: 'desc' }, { updatedAt: 'desc' }],
    take: LEADERBOARD_LIMIT,
  });
  return players.map(toLeaderboardEntry);
}
