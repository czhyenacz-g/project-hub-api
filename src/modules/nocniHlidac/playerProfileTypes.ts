// Object13PlayerProfile — general, mode-agnostic player profile (step 1A of
// the profile/inventory work, see the technical audit report). Deliberately
// separate from NocniHlidacPlayer (leaderboard identity + bestRun/currentRun,
// see service.ts) and from Object13HardcorePlayerProfile (Hardcore-only
// reward/stats, see hardcoreProfileService.ts) — no shared code, no shared
// table, connected only by the same discordUserId string convention.

import { createDefaultObject13PlayerProfileDataV2, Object13PlayerProfileDataV2 } from './playerProfileContractV2.js';
import { validateObject13PlayerProfileDataV2 } from './playerProfileValidation.js';

// V2 (see task spec "profilový kontrakt V2") — adds `equipment` (durable
// weapon ownership) alongside V1's `inventory`. V1 rows are migrated to V2
// on GET (see playerProfileService.ts#getOrCreateObject13PlayerProfile),
// never written fresh anymore — see playerProfileContractV2.ts for the
// current shape, playerProfileInventory.ts for the still-referenced V1 shape
// (kept only for migration-detection).
export const OBJECT13_PLAYER_PROFILE_VERSION = 2;

// Every profileVersion the general PUT currently accepts. A PUT with a
// profileVersion outside this list is rejected (400
// unsupported_profile_version) — see playerProfileValidation.ts. GET's V1->V2
// migration is a SEPARATE code path (playerProfileService.ts) that doesn't
// consult this list — it explicitly recognizes `profileVersion === 1` rows
// and migrates them, it never accepts a V1 PUT.
export const OBJECT13_PLAYER_PROFILE_SUPPORTED_VERSIONS: readonly number[] = [OBJECT13_PLAYER_PROFILE_VERSION];

export function isSupportedObject13PlayerProfileVersion(version: number): boolean {
  return OBJECT13_PLAYER_PROFILE_SUPPORTED_VERSIONS.includes(version);
}

// profileVersion 2's exact contract (see playerProfileContractV2.ts).
export type Object13PlayerProfileData = Object13PlayerProfileDataV2;

// Single source of truth for "what a brand new profile looks like" — never
// an empty `{}`, never a bare V1 shape without `equipment` (see task spec
// "Nepoužívej prázdný objekt jako nový výchozí profil").
export function createDefaultObject13PlayerProfileData(): Object13PlayerProfileData {
  return createDefaultObject13PlayerProfileDataV2();
}

/**
 * Whatever Prisma's `Json` column returns (`Prisma.JsonValue`, effectively
 * `unknown`) coerced into a valid V2 profile — anything that doesn't
 * strictly validate becomes the default V2 profile. Defense-in-depth for
 * reading, same principle as
 * hardcoreProfileMerge.ts#sanitizeHardcoreDeathsByNight. This function does
 * NOT perform V1->V2 migration (a V1 row is, by definition, not a valid V2
 * shape and would just become the default here, silently discarding its
 * bulb count) — the actual migration-with-preservation decision lives in
 * playerProfileService.ts#getOrCreateObject13PlayerProfile, which runs
 * BEFORE this function is reached on the final row. This is purely the
 * last-mile "the row is garbage, or already-migrated V2" safety net.
 */
export function normalizeObject13PlayerProfileData(value: unknown): Object13PlayerProfileData {
  const validated = validateObject13PlayerProfileDataV2(value);
  return validated.ok ? validated.data : createDefaultObject13PlayerProfileDataV2();
}

// Response contract for GET/PUT /nocni-hlidac/player-profile. No internal
// `id` (cuid primary key) — the client only ever needs discordUserId to
// address its own profile, same "don't leak internal id" pattern as
// hardcoreProfileService.ts#ServerHardcorePlayerProfile.
export interface Object13PlayerProfileDto {
  discordUserId: string;
  profileVersion: number;
  profileData: Object13PlayerProfileData;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

interface Object13PlayerProfileRowLike {
  discordUserId: string;
  profileVersion: number;
  profileData: unknown;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

export function toObject13PlayerProfileDto(row: Object13PlayerProfileRowLike): Object13PlayerProfileDto {
  return {
    discordUserId: row.discordUserId,
    profileVersion: row.profileVersion,
    profileData: normalizeObject13PlayerProfileData(row.profileData),
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}
