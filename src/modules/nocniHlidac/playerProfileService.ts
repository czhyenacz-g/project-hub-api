import { Prisma } from '@prisma/client';
import { db } from '../../db.js';
import {
  createDefaultObject13PlayerProfileData,
  Object13PlayerProfileData,
  Object13PlayerProfileDto,
  OBJECT13_PLAYER_PROFILE_VERSION,
  toObject13PlayerProfileDto,
} from './playerProfileTypes.js';

/**
 * GET /nocni-hlidac/player-profile — find-or-create a default profile, touch
 * `lastSeenAt`. Same "upsert keyed on the unique discordUserId" shape as
 * hardcoreProfileService.ts#getOrCreateHardcoreProfile, but for the general,
 * mode-agnostic Object13PlayerProfile — a completely separate table, no
 * shared code path with the Hardcore profile or the leaderboard.
 */
export async function getOrCreateObject13PlayerProfile(discordUserId: string): Promise<Object13PlayerProfileDto> {
  const now = new Date();
  const row = await db.object13PlayerProfile.upsert({
    where: { discordUserId },
    update: { lastSeenAt: now },
    create: {
      discordUserId,
      profileVersion: OBJECT13_PLAYER_PROFILE_VERSION,
      profileData: createDefaultObject13PlayerProfileData() as Prisma.InputJsonValue,
      lastSeenAt: now,
    },
  });
  return toObject13PlayerProfileDto(row);
}

export type UpdateObject13PlayerProfileResult =
  | { outcome: 'updated'; profile: Object13PlayerProfileDto }
  | { outcome: 'not_found' }
  | { outcome: 'revision_conflict'; currentRevision: number; profile: Object13PlayerProfileDto };

/**
 * PUT /nocni-hlidac/player-profile — optimistic-locked update.
 *
 * Deliberately NOT `findUnique` followed by an unconditional `update` (that
 * shape is a lost-update race — two concurrent callers can both read the
 * same "current" row before either writes, and the second write silently
 * clobbers the first, see the technical audit report's finding on
 * hardcoreProfileService.ts#syncHardcoreProfile). Instead this uses a single
 * atomic, conditional `updateMany` whose WHERE clause matches on
 * `discordUserId` AND `revision` together: Postgres serializes concurrent
 * UPDATE statements against the same row via its own row lock, so only ONE
 * of two truly-simultaneous callers with the same `expectedRevision` can
 * ever have its WHERE clause still match by the time it actually executes —
 * the loser's `updateMany` reports `{ count: 0 }`, never a silently
 * overwritten row.
 *
 * `updateMany` (not `update`) is used specifically because Prisma's
 * `update` throws (P2025 "record not found") when a compound `where`
 * matches zero rows — that would force exception-based control flow for an
 * expected, ordinary outcome (a real revision conflict). `updateMany` just
 * reports `{ count: 0 }` instead, which this function can branch on
 * normally.
 *
 * Only AFTER a `count: 0` does this function read the row again — purely to
 * classify WHY it didn't match (profile doesn't exist at all vs. a stale
 * revision) for the HTTP response. That second read is never fed back into
 * a write decision, so it can't reintroduce the race this function exists
 * to avoid.
 */
export async function updateObject13PlayerProfile(
  discordUserId: string,
  expectedRevision: number,
  profileVersion: number,
  profileData: Object13PlayerProfileData,
): Promise<UpdateObject13PlayerProfileResult> {
  const now = new Date();
  const result = await db.object13PlayerProfile.updateMany({
    where: { discordUserId, revision: expectedRevision },
    data: {
      profileVersion,
      profileData: profileData as Prisma.InputJsonValue,
      revision: { increment: 1 },
      lastSeenAt: now,
    },
  });

  if (result.count === 1) {
    const row = await db.object13PlayerProfile.findUniqueOrThrow({ where: { discordUserId } });
    return { outcome: 'updated', profile: toObject13PlayerProfileDto(row) };
  }

  const current = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
  if (!current) return { outcome: 'not_found' };
  return {
    outcome: 'revision_conflict',
    currentRevision: current.revision,
    profile: toObject13PlayerProfileDto(current),
  };
}
