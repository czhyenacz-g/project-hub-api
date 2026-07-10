import { db } from '../../db.js';
import { HardcoreProfileSnapshot, mergeHardcoreProfileSnapshot } from './hardcoreProfileMerge.js';

// Response contract verified against nocni-hlidac's
// game/core/hardcorePlayerProfileSnapshot.ts#ServerHardcorePlayerProfile —
// this is the four-field subset this step covers (hasDefeatedMonster,
// doubleBarrelUnlocked, monsterDefeatsCount, bestNight); see the report for
// the Normal-mode/counter fields nocni-hlidac's client type additionally
// declares that this step deliberately does not implement.
export interface ServerHardcorePlayerProfile {
  discordUserId: string;
  displayName: string | null;
  avatarUrl: string | null;

  hardcoreHasDefeatedMonster: boolean;
  hardcoreDoubleBarrelUnlocked: boolean;
  hardcoreMonsterDefeatsCount: number;
  hardcoreBestNight: number;

  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

const EMPTY_SNAPSHOT: HardcoreProfileSnapshot = {
  hardcoreHasDefeatedMonster: false,
  hardcoreDoubleBarrelUnlocked: false,
  hardcoreMonsterDefeatsCount: 0,
  hardcoreBestNight: 0,
};

interface ProfileRowLike {
  discordUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  hardcoreHasDefeatedMonster: boolean;
  hardcoreDoubleBarrelUnlocked: boolean;
  hardcoreMonsterDefeatsCount: number;
  hardcoreBestNight: number;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

function toResponse(row: ProfileRowLike): ServerHardcorePlayerProfile {
  return {
    discordUserId: row.discordUserId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    hardcoreHasDefeatedMonster: row.hardcoreHasDefeatedMonster,
    hardcoreDoubleBarrelUnlocked: row.hardcoreDoubleBarrelUnlocked,
    hardcoreMonsterDefeatsCount: row.hardcoreMonsterDefeatsCount,
    hardcoreBestNight: row.hardcoreBestNight,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/**
 * GET /nocni-hlidac/hardcore-profile — find-or-create a default profile,
 * touch `lastSeenAt`. The GET request only ever carries `discordUserId`
 * (see hardcoreProfileRoutes.ts / the verified nocni-hlidac hubClient call,
 * `fetchRemoteHardcoreProfile`) — there's no `displayName`/`avatarUrl` in a
 * GET to refresh from, those only ever arrive via the sync body below.
 */
export async function getOrCreateHardcoreProfile(discordUserId: string): Promise<ServerHardcorePlayerProfile> {
  const now = new Date();
  const row = await db.object13HardcorePlayerProfile.upsert({
    where: { discordUserId },
    update: { lastSeenAt: now },
    create: { discordUserId, lastSeenAt: now },
  });
  return toResponse(row);
}

/**
 * POST /nocni-hlidac/hardcore-profile/sync — find-or-create, then
 * OR/max-merge the incoming (already sanitized, see
 * hardcoreProfileValidation.ts#sanitizeIncomingHardcoreSnapshot) snapshot
 * onto whatever is already stored. Read + merge + write happens inside one
 * transaction so two concurrent syncs for the same player can't race each
 * other into losing an update. `displayName`/`avatarUrl`/`lastSeenAt` are
 * always refreshed from the request identity — `updatedAt` is Prisma's
 * `@updatedAt`, bumped automatically by the `update`/`create` call itself.
 */
export async function syncHardcoreProfile(
  discordUserId: string,
  identity: { displayName: string | null; avatarUrl: string | null },
  incoming: HardcoreProfileSnapshot,
): Promise<ServerHardcorePlayerProfile> {
  const now = new Date();

  return db.$transaction(async (tx) => {
    const existing = await tx.object13HardcorePlayerProfile.findUnique({ where: { discordUserId } });
    const merged = mergeHardcoreProfileSnapshot(existing ?? EMPTY_SNAPSHOT, incoming);

    const row = await tx.object13HardcorePlayerProfile.upsert({
      where: { discordUserId },
      update: {
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        lastSeenAt: now,
        ...merged,
      },
      create: {
        discordUserId,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        lastSeenAt: now,
        ...merged,
      },
    });
    return toResponse(row);
  });
}
