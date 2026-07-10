// Pure merge/clamp logic for the Object13 Hardcore profile — kept separate
// from Prisma access (hardcoreProfileService.ts) so it can be unit-tested
// without a database, same split as runTransitions.ts/service.ts above.
//
// Mirrors the reference spec already shipped in nocni-hlidac
// (game/core/hardcorePlayerProfileSnapshot.ts#mergeHardcoreProfileSnapshot) —
// this is the actual server-side implementation of that spec, scoped to
// exactly the five Hardcore fields this model covers (hasDefeatedMonster,
// doubleBarrelUnlocked, monsterDefeatsCount, bestNight, deathsByNight).
// Normal-mode fields (totalDeaths, totalRunsStarted, ...) are intentionally
// NOT part of this model — see hardcoreProfileValidation.ts, they're
// ignored at the request boundary, never reach here.

export const HARDCORE_MONSTER_DEFEATS_MAX = 100_000;
export const HARDCORE_BEST_NIGHT_MAX = 10_000;
export const HARDCORE_DEATHS_BY_NIGHT_NIGHT_MAX = 10_000;
export const HARDCORE_DEATHS_BY_NIGHT_COUNT_MAX = 1_000_000;

export interface HardcoreProfileSnapshot {
  hardcoreHasDefeatedMonster: boolean;
  hardcoreDoubleBarrelUnlocked: boolean;
  hardcoreMonsterDefeatsCount: number;
  hardcoreBestNight: number;
  hardcoreDeathsByNight: Record<string, number>;
}

/** Trusted numeric input (already known to be a finite number) — floors and clamps into [0, max]. */
export function clampHardcoreInt(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), max);
}

/**
 * Whitelist + validate + clamp an UNTRUSTED death-by-night histogram —
 * shared by the request-boundary sanitizer (hardcoreProfileValidation.ts)
 * AND here as defense-in-depth for values coming back out of Postgres
 * (Prisma's `Json` column type is `Prisma.JsonValue`, effectively
 * `unknown` — a value written by a future/older app version, or edited by
 * hand, isn't guaranteed to already be clean). Night key must be a positive
 * integer (as a string) `1..HARDCORE_DEATHS_BY_NIGHT_NIGHT_MAX`; count must
 * be a non-negative integer `0..HARDCORE_DEATHS_BY_NIGHT_COUNT_MAX`. Invalid
 * entries are silently dropped, not defaulted — one bad key must not
 * discard an otherwise valid histogram. `null`/array/string/anything that
 * isn't a plain object becomes `{}`.
 */
export function sanitizeHardcoreDeathsByNight(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const result: Record<string, number> = {};

  for (const [key, rawCount] of Object.entries(raw)) {
    const night = Number(key);
    if (!Number.isInteger(night) || night < 1 || night > HARDCORE_DEATHS_BY_NIGHT_NIGHT_MAX) continue;
    if (typeof rawCount !== "number" || !Number.isInteger(rawCount) || rawCount < 0) continue;
    result[String(night)] = Math.min(rawCount, HARDCORE_DEATHS_BY_NIGHT_COUNT_MAX);
  }

  return result;
}

/**
 * Merges two death-by-night histograms PER NIGHT KEY —
 * `max(existing[night], incoming[night])` for every night, never a sum.
 * Example: existing `{ "1": 2, "3": 1 }` + incoming `{ "1": 1, "2": 4 }` →
 * `{ "1": 2, "2": 4, "3": 1 }`. Inputs are expected already-sanitized (see
 * `mergeHardcoreProfileSnapshot` below) — the result is clamped again
 * regardless (defense-in-depth, same pattern as `clampHardcoreInt` for the
 * other counters).
 */
export function mergeHardcoreDeathsByNight(
  existing: Record<string, number>,
  incoming: Record<string, number>,
): Record<string, number> {
  const nights = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
  const result: Record<string, number> = {};
  for (const night of nights) {
    const merged = Math.max(existing[night] ?? 0, incoming[night] ?? 0);
    result[night] = clampHardcoreInt(merged, HARDCORE_DEATHS_BY_NIGHT_COUNT_MAX);
  }
  return result;
}

/**
 * Snapshot merge: boolean reward fields via OR (once true, stays true
 * forever), counters via max — NEVER sum, NEVER lower an existing stored
 * value. `hardcoreDeathsByNight` merges per night key (see
 * `mergeHardcoreDeathsByNight`). Sync is an idempotent snapshot merge, not
 * event sourcing — a repeated sync of the same local snapshot must be a
 * safe no-op, not a double-count.
 */
export function mergeHardcoreProfileSnapshot(
  existing: HardcoreProfileSnapshot,
  incoming: HardcoreProfileSnapshot,
): HardcoreProfileSnapshot {
  return {
    hardcoreHasDefeatedMonster: existing.hardcoreHasDefeatedMonster || incoming.hardcoreHasDefeatedMonster,
    hardcoreDoubleBarrelUnlocked: existing.hardcoreDoubleBarrelUnlocked || incoming.hardcoreDoubleBarrelUnlocked,
    hardcoreMonsterDefeatsCount: clampHardcoreInt(
      Math.max(existing.hardcoreMonsterDefeatsCount, incoming.hardcoreMonsterDefeatsCount),
      HARDCORE_MONSTER_DEFEATS_MAX,
    ),
    hardcoreBestNight: clampHardcoreInt(Math.max(existing.hardcoreBestNight, incoming.hardcoreBestNight), HARDCORE_BEST_NIGHT_MAX),
    hardcoreDeathsByNight: mergeHardcoreDeathsByNight(
      sanitizeHardcoreDeathsByNight(existing.hardcoreDeathsByNight),
      sanitizeHardcoreDeathsByNight(incoming.hardcoreDeathsByNight),
    ),
  };
}
