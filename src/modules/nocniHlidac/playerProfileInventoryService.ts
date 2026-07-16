import { Prisma } from '@prisma/client';
import { db } from '../../db.js';
import { Object13PlayerProfileDto, normalizeObject13PlayerProfileData, toObject13PlayerProfileDto } from './playerProfileTypes.js';
import { addInventoryItem, consumeInventoryItem, Object13InventoryItemId } from './playerProfileInventory.js';
import { Object13PlayerProfileDataV2 } from './playerProfileContractV2.js';

export type Object13PlayerProfileInventoryOperationResult =
  | { outcome: 'updated'; profile: Object13PlayerProfileDto }
  | { outcome: 'not_found' }
  | { outcome: 'revision_conflict'; currentRevision: number; profile: Object13PlayerProfileDto }
  | { outcome: 'exceeds_maximum' }
  | { outcome: 'insufficient_inventory' };

type PureInventoryOp = (
  profileData: Object13PlayerProfileDataV2,
  itemId: Object13InventoryItemId,
  amount: number,
) => { ok: true; profileData: Object13PlayerProfileDataV2 } | { ok: false; error: 'exceeds_maximum' | 'insufficient_inventory' };

/**
 * Shared implementation for both add and consume — same optimistic-locking
 * shape as playerProfileService.ts#updateObject13PlayerProfile (read once,
 * compute the next profileData from that read, then a single atomic
 * `updateMany` conditioned on `discordUserId AND revision = expectedRevision`).
 * Correctness doesn't depend on the initial read being fresh: if the row's
 * actual revision no longer equals `expectedRevision` by the time the
 * `updateMany` executes, its WHERE clause simply matches zero rows and this
 * function reports a conflict with the (re-read) current profile — the same
 * "loser gets count: 0, never a silent overwrite" guarantee as the general
 * profile PUT. This means two concurrent calls with the same expectedRevision
 * can never both succeed (Postgres serializes the two UPDATE statements via
 * its own row lock).
 */
async function applyInventoryOperation(
  discordUserId: string,
  itemId: Object13InventoryItemId,
  amount: number,
  expectedRevision: number,
  op: PureInventoryOp,
): Promise<Object13PlayerProfileInventoryOperationResult> {
  const current = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
  if (!current) return { outcome: 'not_found' };

  const currentProfileData = normalizeObject13PlayerProfileData(current.profileData);
  const applied = op(currentProfileData, itemId, amount);
  if (!applied.ok) return { outcome: applied.error };

  const now = new Date();
  const result = await db.object13PlayerProfile.updateMany({
    where: { discordUserId, revision: expectedRevision },
    data: {
      profileData: applied.profileData as unknown as Prisma.InputJsonValue,
      revision: { increment: 1 },
      lastSeenAt: now,
    },
  });

  if (result.count === 1) {
    const row = await db.object13PlayerProfile.findUniqueOrThrow({ where: { discordUserId } });
    return { outcome: 'updated', profile: toObject13PlayerProfileDto(row) };
  }

  const latest = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
  if (!latest) return { outcome: 'not_found' };
  return { outcome: 'revision_conflict', currentRevision: latest.revision, profile: toObject13PlayerProfileDto(latest) };
}

/** POST /nocni-hlidac/player-profile/inventory/:itemId/add — amount must already be a validated positive integer (see playerProfileInventoryValidation.ts). */
export function addObject13PlayerProfileInventoryItem(
  discordUserId: string,
  itemId: Object13InventoryItemId,
  amount: number,
  expectedRevision: number,
): Promise<Object13PlayerProfileInventoryOperationResult> {
  return applyInventoryOperation(discordUserId, itemId, amount, expectedRevision, addInventoryItem);
}

/** POST /nocni-hlidac/player-profile/inventory/:itemId/consume — amount must already be a validated positive integer. */
export function consumeObject13PlayerProfileInventoryItem(
  discordUserId: string,
  itemId: Object13InventoryItemId,
  amount: number,
  expectedRevision: number,
): Promise<Object13PlayerProfileInventoryOperationResult> {
  return applyInventoryOperation(discordUserId, itemId, amount, expectedRevision, consumeInventoryItem);
}
