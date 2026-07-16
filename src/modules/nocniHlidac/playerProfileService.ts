import { Prisma } from '@prisma/client';
import { db } from '../../db.js';
import {
  createDefaultObject13PlayerProfileData,
  Object13PlayerProfileData,
  Object13PlayerProfileDto,
  OBJECT13_PLAYER_PROFILE_VERSION,
  toObject13PlayerProfileDto,
} from './playerProfileTypes.js';
import { validateObject13PlayerProfileDataV1 } from './playerProfileValidation.js';

/**
 * GET /nocni-hlidac/player-profile — find-or-create a default profile, touch
 * `lastSeenAt`. Same "upsert keyed on the unique discordUserId" shape as
 * hardcoreProfileService.ts#getOrCreateHardcoreProfile, but for the general,
 * mode-agnostic Object13PlayerProfile — a completely separate table, no
 * shared code path with the Hardcore profile or the leaderboard.
 *
 * Also normalizes a legacy/invalid stored profileData (a pre-1B empty `{}`
 * row, or any row that no longer strictly validates as V1) to the current
 * default V1 shape AND PERSISTS that fix — but only when the stored value
 * actually fails validation, so revision never churns on a GET of an
 * already-valid profile (see task spec "revision zvyš pouze tehdy, pokud se
 * profil skutečně mění"). Uses the same optimistic-locked `updateMany` as
 * updateObject13PlayerProfile below; losing a race here just means another
 * caller already normalized (or moved past) this row, so the loss is
 * harmless and the row is simply re-read.
 */
export async function getOrCreateObject13PlayerProfile(discordUserId: string): Promise<Object13PlayerProfileDto> {
  const now = new Date();
  let row = await db.object13PlayerProfile.upsert({
    where: { discordUserId },
    update: { lastSeenAt: now },
    create: {
      discordUserId,
      profileVersion: OBJECT13_PLAYER_PROFILE_VERSION,
      profileData: createDefaultObject13PlayerProfileData() as unknown as Prisma.InputJsonValue,
      lastSeenAt: now,
    },
  });

  if (row.profileVersion === OBJECT13_PLAYER_PROFILE_VERSION && !validateObject13PlayerProfileDataV1(row.profileData).ok) {
    const normalized = await db.object13PlayerProfile.updateMany({
      where: { discordUserId, revision: row.revision },
      data: {
        profileData: createDefaultObject13PlayerProfileData() as unknown as Prisma.InputJsonValue,
        revision: { increment: 1 },
        lastSeenAt: now,
      },
    });
    // Whether this call won the race (count === 1) or lost it to a
    // concurrent normalizer (count === 0), the row must be re-read either
    // way — this call's `row` is stale either as the pre-normalization value
    // or as the value at the moment just before the winner committed.
    row = await db.object13PlayerProfile.findUniqueOrThrow({ where: { discordUserId } });
  }

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
      profileData: profileData as unknown as Prisma.InputJsonValue,
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
