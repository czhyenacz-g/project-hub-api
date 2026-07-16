// Object13PlayerProfile — general, mode-agnostic player profile (step 1A of
// the profile/inventory work, see the technical audit report). Deliberately
// separate from NocniHlidacPlayer (leaderboard identity + bestRun/currentRun,
// see service.ts) and from Object13HardcorePlayerProfile (Hardcore-only
// reward/stats, see hardcoreProfileService.ts) — no shared code, no shared
// table, connected only by the same discordUserId string convention.

export const OBJECT13_PLAYER_PROFILE_VERSION = 1;

// Every profileVersion this server currently knows how to read/write. A PUT
// with a profileVersion outside this list is rejected (400
// unsupported_profile_version) rather than silently accepted — see
// playerProfileValidation.ts.
export const OBJECT13_PLAYER_PROFILE_SUPPORTED_VERSIONS: readonly number[] = [OBJECT13_PLAYER_PROFILE_VERSION];

export function isSupportedObject13PlayerProfileVersion(version: number): boolean {
  return OBJECT13_PLAYER_PROFILE_SUPPORTED_VERSIONS.includes(version);
}

// Conservative MVP cap on the serialized (JSON.stringify, UTF-8 byte length)
// size of profileData — named constant so it's easy to find/tune later, see
// playerProfileValidation.ts#validateObject13PlayerProfileData.
export const OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES = 32 * 1024; // 32 KB

export type Object13PlayerProfileData = Record<string, unknown>;

// Single source of truth for "what a brand new profile looks like" — step 1A
// intentionally ships this EMPTY. Bulbs/weapons/settings/officeEquipment/
// progression are a later step (1B+), never invented here.
export function createDefaultObject13PlayerProfileData(): Object13PlayerProfileData {
  return {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whatever Prisma's `Json` column returns (`Prisma.JsonValue`, effectively
 * `unknown`) coerced into a safe plain object — `null`/array/string/number/
 * boolean/anything that isn't a plain object becomes `{}`. Defense-in-depth
 * for a row written by a future/older app version or edited by hand — a
 * value written through updateObject13PlayerProfile is already known-good
 * (see playerProfileValidation.ts), but reading must never trust the DB
 * blindly either, same principle as hardcoreProfileMerge.ts#sanitizeHardcoreDeathsByNight.
 */
export function normalizeObject13PlayerProfileData(value: unknown): Object13PlayerProfileData {
  return isPlainObject(value) ? value : createDefaultObject13PlayerProfileData();
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
