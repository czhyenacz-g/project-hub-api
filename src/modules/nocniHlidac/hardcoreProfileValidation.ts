import { z } from 'zod';
import { HARDCORE_BEST_NIGHT_MAX, HARDCORE_MONSTER_DEFEATS_MAX, HardcoreProfileSnapshot } from './hardcoreProfileMerge.js';

// Identity is validated STRICTLY (same "required non-empty discordUserId"
// rule as NocniHlidacPlayerUpsertSchema/NocniHlidacDiscordUserIdSchema in
// validation.ts) — a malformed identity is a genuine client bug and should
// 400, same as the existing nocni-hlidac endpoints.
export const HardcoreProfileGetQuerySchema = z.object({
  discordUserId: z.string().min(1),
});
export type HardcoreProfileGetQueryInput = z.infer<typeof HardcoreProfileGetQuerySchema>;

export const HardcoreProfileSyncIdentitySchema = z.object({
  discordUserId: z.string().min(1),
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});
export type HardcoreProfileSyncIdentityInput = z.infer<typeof HardcoreProfileSyncIdentitySchema>;

function clampIncomingInt(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), max);
}

function toIncomingBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

const DEFAULT_INCOMING_SNAPSHOT: HardcoreProfileSnapshot = {
  hardcoreHasDefeatedMonster: false,
  hardcoreDoubleBarrelUnlocked: false,
  hardcoreMonsterDefeatsCount: 0,
  hardcoreBestNight: 0,
};

/**
 * Whitelist + lenient sanitize of the sync body's Hardcore snapshot fields —
 * NOT a strict zod schema on purpose: an invalid/missing hardcore field
 * (wrong type, NaN, negative, a stray Normal-mode field like `totalDeaths`)
 * must never reject the whole request, it must just be silently ignored (see
 * the task's "Nepřijímej / ignoruj" list). Mirrors nocni-hlidac's own
 * client-side `sanitizeHardcoreProfileSnapshot` — this is the
 * defense-in-depth server-side twin of it; the hub never trusts client
 * sanitization alone since this endpoint is reachable by anything holding
 * the shared bearer token, not just the current nocni-hlidac client code.
 * Only the four named `hardcore*` keys are ever read out of `raw` — every
 * other key (unknown or Normal-like) is never even looked at, let alone
 * stored.
 */
export function sanitizeIncomingHardcoreSnapshot(raw: unknown): HardcoreProfileSnapshot {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_INCOMING_SNAPSHOT };
  const input = raw as Record<string, unknown>;

  return {
    hardcoreHasDefeatedMonster: toIncomingBoolean(input.hardcoreHasDefeatedMonster),
    hardcoreDoubleBarrelUnlocked: toIncomingBoolean(input.hardcoreDoubleBarrelUnlocked),
    hardcoreMonsterDefeatsCount: clampIncomingInt(input.hardcoreMonsterDefeatsCount, HARDCORE_MONSTER_DEFEATS_MAX),
    hardcoreBestNight: clampIncomingInt(input.hardcoreBestNight, HARDCORE_BEST_NIGHT_MAX),
  };
}
