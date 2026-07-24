import { db } from '../../db.js';

const PLAYERS_LIMIT = 100;
const EVENTS_LIMIT = 100;

/**
 * Response shapes verified against nocni-hlidac's
 * lib/admin/adminOverview.ts#AdminPlayerSummary/AdminActivityEvent — FLAT
 * arrays (no `summary`/wrapper object), because that repo's app/admin/page.tsx
 * computes "Celkem hráčů"/"Hráli za 24h"/"poslední aktivita" itself from the
 * players array. No separate "summary" endpoint/shape is introduced here —
 * would be a duplicate contract nothing on the Next side actually calls
 * (see report "Nesoulad kontraktu").
 */
export interface AdminPlayerSummary {
  discordUserId: string;
  displayName: string | null;
  username: string;
  lastLoginAt: string | null;
  lastPlayedAt: string | null;
  lastActivityAt: string | null;
  lastClient: string | null;
  lastBuildVersion: string | null;
  hardcoreBestNight: number;
}

/**
 * GET /nocni-hlidac/admin/players — sorted by lastActivityAt desc, NULLs
 * last (players with no activity at all sink to the bottom, see task "10.
 * Řazení"). `hardcoreBestNight` comes from the separate
 * Object13HardcorePlayerProfile table (no FK relation between the two
 * tables — nocni-hlidac's own two "profile" concepts are intentionally
 * separate, see that repo's TECH_DESIGN.md) — joined here in a SECOND single
 * query (by discordUserId, in-memory map), not per-row, to avoid N+1.
 */
export async function listAdminPlayers(limit = PLAYERS_LIMIT): Promise<AdminPlayerSummary[]> {
  const take = Math.min(Math.max(limit, 1), PLAYERS_LIMIT);
  const players = await db.nocniHlidacPlayer.findMany({
    orderBy: [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }],
    take,
  });
  if (players.length === 0) return [];

  const discordUserIds = players.map((player) => player.discordUserId);
  const hardcoreProfiles = await db.object13HardcorePlayerProfile.findMany({
    where: { discordUserId: { in: discordUserIds } },
    select: { discordUserId: true, hardcoreBestNight: true },
  });
  const hardcoreBestNightByDiscordId = new Map(hardcoreProfiles.map((profile) => [profile.discordUserId, profile.hardcoreBestNight]));

  return players.map((player) => ({
    discordUserId: player.discordUserId,
    displayName: player.displayName,
    username: player.username,
    lastLoginAt: player.lastLoginAt?.toISOString() ?? null,
    lastPlayedAt: player.lastPlayedAt?.toISOString() ?? null,
    lastActivityAt: player.lastActivityAt?.toISOString() ?? null,
    lastClient: player.lastClient,
    lastBuildVersion: player.lastBuildVersion,
    hardcoreBestNight: hardcoreBestNightByDiscordId.get(player.discordUserId) ?? 0,
  }));
}

export interface AdminActivityEvent {
  id: string;
  discordUserId: string;
  displayName: string | null;
  username: string;
  eventType: string;
  nightNumber: number | null;
  gameMode: string | null;
  client: string | null;
  buildVersion: string | null;
  createdAt: string;
}

/**
 * GET /nocni-hlidac/admin/activity-events — sorted by createdAt desc.
 * `discordUserId`/`displayName`/`username` are denormalized from the related
 * player via Prisma's `include` (a single JOIN query — not per-row lookups),
 * since nocni-hlidac's Next.js side only ever knows `discordUserId`, never
 * this table's internal `playerId`.
 */
export async function listAdminActivityEvents(limit = EVENTS_LIMIT): Promise<AdminActivityEvent[]> {
  const take = Math.min(Math.max(limit, 1), EVENTS_LIMIT);
  const events = await db.nocniHlidacPlayerActivityEvent.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    include: { player: { select: { discordUserId: true, displayName: true, username: true } } },
  });

  return events.map((event) => ({
    id: event.id,
    discordUserId: event.player.discordUserId,
    displayName: event.player.displayName,
    username: event.player.username,
    eventType: event.eventType,
    nightNumber: event.nightNumber,
    gameMode: event.gameMode,
    client: event.client,
    buildVersion: event.buildVersion,
    createdAt: event.createdAt.toISOString(),
  }));
}
