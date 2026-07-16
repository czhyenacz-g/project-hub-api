// Object13PlayerProfile — general, mode-agnostic player profile (step 1A of
// the profile/inventory work, see the technical audit report). Deliberately
// separate from NocniHlidacPlayer (leaderboard identity + bestRun/currentRun,
// see service.ts) and from Object13HardcorePlayerProfile (Hardcore-only
// reward/stats, see hardcoreProfileService.ts) — no shared code, no shared
// table, connected only by the same discordUserId string convention.

import { createDefaultObject13PlayerProfileDataV1, Object13PlayerProfileDataV1 } from './playerProfileInventory.js';
import { validateObject13PlayerProfileDataV1 } from './playerProfileValidation.js';

export const OBJECT13_PLAYER_PROFILE_VERSION = 1;

// Every profileVersion this server currently knows how to read/write. A PUT
// with a profileVersion outside this list is rejected (400
// unsupported_profile_version) rather than silently accepted — see
// playerProfileValidation.ts.
export const OBJECT13_PLAYER_PROFILE_SUPPORTED_VERSIONS: readonly number[] = [OBJECT13_PLAYER_PROFILE_VERSION];

export function isSupportedObject13PlayerProfileVersion(version: number): boolean {
  return OBJECT13_PLAYER_PROFILE_SUPPORTED_VERSIONS.includes(version);
}

// profileVersion 1's exact contract (see playerProfileInventory.ts) — the
// opaque `Record<string, unknown>` shape from step 1A is gone now that
// there's a real, validated content for profileData.
export type Object13PlayerProfileData = Object13PlayerProfileDataV1;

// Single source of truth for "what a brand new profile looks like" — step 1B
// gives it real starting content (the default inventory, see
// playerProfileInventory.ts#createDefaultObject13PlayerProfileDataV1). Never
// an empty `{}` — see task spec "Nepoužívej prázdný objekt jako nový výchozí
// profil."
export function createDefaultObject13PlayerProfileData(): Object13PlayerProfileData {
  return createDefaultObject13PlayerProfileDataV1();
}

/**
 * Whatever Prisma's `Json` column returns (`Prisma.JsonValue`, effectively
 * `unknown`) coerced into a valid V1 profile — anything that doesn't
 * strictly validate (a pre-1B empty `{}` row, `null`/array/string/number/
 * boolean, or a hand-edited/corrupted row) becomes the default V1 profile.
 * Defense-in-depth for reading, same principle as
 * hardcoreProfileMerge.ts#sanitizeHardcoreDeathsByNight — but see
 * playerProfileService.ts#getOrCreateObject13PlayerProfile for where this
 * gets PERSISTED back (with a revision bump) rather than just silently
 * reshaped in the response.
 */
export function normalizeObject13PlayerProfileData(value: unknown): Object13PlayerProfileData {
  const validated = validateObject13PlayerProfileDataV1(value);
  return validated.ok ? validated.data : createDefaultObject13PlayerProfileDataV1();
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
