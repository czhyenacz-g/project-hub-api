// Pure merge/clamp logic for the Object13 Hardcore profile — kept separate
// from Prisma access (hardcoreProfileService.ts) so it can be unit-tested
// without a database, same split as runTransitions.ts/service.ts above.
//
// Mirrors the reference spec already shipped in nocni-hlidac
// (game/core/hardcorePlayerProfileSnapshot.ts#mergeHardcoreProfileSnapshot) —
// this is the actual server-side implementation of that spec, scoped to
// exactly the four Hardcore fields this step covers (hasDefeatedMonster,
// doubleBarrelUnlocked, monsterDefeatsCount, bestNight). Normal-mode fields
// (totalDeaths, totalRunsStarted, ...) are intentionally NOT part of this
// model — see hardcoreProfileValidation.ts, they're ignored at the request
// boundary, never reach here.

export const HARDCORE_MONSTER_DEFEATS_MAX = 100_000;
export const HARDCORE_BEST_NIGHT_MAX = 10_000;

export interface HardcoreProfileSnapshot {
  hardcoreHasDefeatedMonster: boolean;
  hardcoreDoubleBarrelUnlocked: boolean;
  hardcoreMonsterDefeatsCount: number;
  hardcoreBestNight: number;
}

/** Trusted numeric input (already known to be a finite number) — floors and clamps into [0, max]. */
export function clampHardcoreInt(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), max);
}

/**
 * Snapshot merge: boolean reward fields via OR (once true, stays true
 * forever), counters via max — NEVER sum, NEVER lower an existing stored
 * value. Sync is an idempotent snapshot merge, not event sourcing — a
 * repeated sync of the same local snapshot must be a safe no-op, not a
 * double-count.
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
  };
}
