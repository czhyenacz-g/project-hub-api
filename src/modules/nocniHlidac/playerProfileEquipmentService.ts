import { Prisma } from '@prisma/client';
import { db } from '../../db.js';
import { Object13PlayerProfileDto, normalizeObject13PlayerProfileData, toObject13PlayerProfileDto } from './playerProfileTypes.js';
import { unlockWeapon, WeaponId } from './playerProfileEquipment.js';

export type Object13PlayerProfileWeaponUnlockResult =
  | { outcome: 'updated'; profile: Object13PlayerProfileDto }
  | { outcome: 'unchanged'; profile: Object13PlayerProfileDto }
  | { outcome: 'not_found' }
  | { outcome: 'revision_conflict'; currentRevision: number; profile: Object13PlayerProfileDto };

/**
 * POST /nocni-hlidac/player-profile/equipment/weapon/unlock — same
 * optimistic-locking shape as playerProfileInventoryService.ts (read once,
 * compute the next profileData from that read, single atomic `updateMany`
 * conditioned on `discordUserId AND revision = expectedRevision`).
 *
 * Idempotence (task spec "7. ... Preferuji: Pokud už je zbraň vlastněná a
 * správně vybavená, vrať profil beze změny revision"): `unlockWeapon`
 * (playerProfileEquipment.ts) returns the SAME object reference when nothing
 * would actually change — this function uses that as the signal to skip the
 * write entirely (`outcome: 'unchanged'`, revision untouched) rather than
 * writing an identical value and bumping revision for no reason. If the
 * weapon is owned but not correctly auto-equipped (e.g. a future manual
 * un-equip feature could produce that state), `unlockWeapon` returns a
 * genuinely different object and this function performs the (single)
 * needed write, revision +1 — never a duplicate `ownedWeapons` entry.
 */
export async function unlockObject13PlayerProfileWeapon(
  discordUserId: string,
  weaponId: WeaponId,
  expectedRevision: number,
): Promise<Object13PlayerProfileWeaponUnlockResult> {
  const current = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
  if (!current) return { outcome: 'not_found' };

  const currentProfileData = normalizeObject13PlayerProfileData(current.profileData);
  const nextEquipment = unlockWeapon(currentProfileData.equipment, weaponId);

  if (nextEquipment === currentProfileData.equipment) {
    // True no-op — already owned and correctly equipped. Revision check is
    // still meaningful for the CALLER's optimistic-locking expectations
    // (an out-of-date client shouldn't be told "success" against a revision
    // it never actually saw), so this only short-circuits when the caller's
    // expectedRevision also matches the current one; otherwise fall through
    // to the normal conflict reporting below.
    if (current.revision === expectedRevision) {
      return { outcome: 'unchanged', profile: toObject13PlayerProfileDto(current) };
    }
  }

  const now = new Date();
  const result = await db.object13PlayerProfile.updateMany({
    where: { discordUserId, revision: expectedRevision },
    data: {
      profileData: { ...currentProfileData, equipment: nextEquipment } as unknown as Prisma.InputJsonValue,
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
