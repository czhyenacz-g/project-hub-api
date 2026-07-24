import { db } from '../../db.js';
import { ActivityClient } from './activityValidation.js';

// Only "hardcore" runs ever reach survive-night/death on this hub — the
// nocni-hlidac Next.js client gates non-hardcore requests before they ever
// call this API (see its guardRunRequestHandlers.ts#isLeaderboardEligible),
// and never actually sends a `gameMode` field in the survive-night/death
// body (see its lib/leaderboard/remotePlayer.ts). This constant records that
// fact on the audit event instead of expecting a field that will never
// arrive — see report "Nesoulad kontraktu" for the verified reasoning.
const GAME_MODE_HARDCORE = 'hardcore';

export interface PlayerActivitySummary {
  lastLoginAt: string | null;
  lastPlayedAt: string | null;
  lastActivityAt: string | null;
  lastClient: string | null;
  lastBuildVersion: string | null;
}

interface ActivityRowLike {
  lastLoginAt: Date | null;
  lastPlayedAt: Date | null;
  lastActivityAt: Date | null;
  lastClient: string | null;
  lastBuildVersion: string | null;
}

function toActivitySummary(row: ActivityRowLike): PlayerActivitySummary {
  return {
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    lastPlayedAt: row.lastPlayedAt?.toISOString() ?? null,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    lastClient: row.lastClient,
    lastBuildVersion: row.lastBuildVersion,
  };
}

/**
 * POST /nocni-hlidac/player/login — called EXCLUSIVELY from the nocni-hlidac
 * Discord OAuth callback after a real completed login, never from its
 * `/api/auth/me` (session check) path — see that repo's
 * app/api/auth/callback/route.ts. The player must already exist (the
 * pre-existing `/nocni-hlidac/player/upsert` call always runs alongside/
 * just before this one in that callback) — `null` here means "not found",
 * same convention as recordSurvivedNight/recordDeath below, and the route
 * turns that into 404.
 *
 * Profile update + event insert happen in ONE transaction (see task
 * "proveď v jedné databázové transakci").
 */
export async function recordLogin(discordUserId: string): Promise<PlayerActivitySummary | null> {
  return db.$transaction(async (tx) => {
    const player = await tx.nocniHlidacPlayer.findUnique({ where: { discordUserId } });
    if (!player) return null;

    const now = new Date();
    const updated = await tx.nocniHlidacPlayer.update({
      where: { discordUserId },
      data: { lastLoginAt: now, lastActivityAt: now },
    });
    await tx.nocniHlidacPlayerActivityEvent.create({
      data: { playerId: updated.id, eventType: 'login' },
    });
    return toActivitySummary(updated);
  });
}

/**
 * POST /nocni-hlidac/player/activity/game-start — called once per real game
 * start from nocni-hlidac's app/play/page.tsx. `client`/`buildVersion` are
 * already sanitized (see activityValidation.ts) before this is called.
 */
export async function recordGameStart(
  discordUserId: string,
  client: ActivityClient,
  buildVersion: string | null,
): Promise<PlayerActivitySummary | null> {
  return db.$transaction(async (tx) => {
    const player = await tx.nocniHlidacPlayer.findUnique({ where: { discordUserId } });
    if (!player) return null;

    const now = new Date();
    const updated = await tx.nocniHlidacPlayer.update({
      where: { discordUserId },
      data: { lastPlayedAt: now, lastActivityAt: now, lastClient: client, lastBuildVersion: buildVersion },
    });
    await tx.nocniHlidacPlayerActivityEvent.create({
      data: { playerId: updated.id, eventType: 'game_started', client, buildVersion },
    });
    return toActivitySummary(updated);
  });
}

/**
 * Shared by service.ts's recordSurvivedNight/recordDeath — writes the
 * `night_survived`/`player_died` audit event AND bumps
 * `lastPlayedAt`/`lastActivityAt`, using the player's OWN last known
 * `lastClient`/`lastBuildVersion` (see task "night/death event použije
 * poslední client a build hráče") — the survive-night/death request bodies
 * never carry client/buildVersion themselves. MUST be called with the SAME
 * `tx` transaction client the caller is already using for the bestRun/
 * currentRun update, so a failed run-transition never leaves an orphaned
 * event (see task "Nezapisuj událost, pokud příslušná herní operace
 * selhala").
 */
export async function recordNightOutcomeActivity(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  playerId: string,
  eventType: 'night_survived' | 'player_died',
  nightNumber: number | undefined,
  currentClient: string | null,
  currentBuildVersion: string | null,
): Promise<void> {
  await tx.nocniHlidacPlayerActivityEvent.create({
    data: {
      playerId,
      eventType,
      nightNumber: nightNumber ?? null,
      gameMode: GAME_MODE_HARDCORE,
      client: currentClient,
      buildVersion: currentBuildVersion,
    },
  });
}
