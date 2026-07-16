import { z } from 'zod';
import { OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES, Object13PlayerProfileData } from './playerProfileTypes.js';

// Stricter than the existing NocniHlidacDiscordUserIdSchema (validation.ts,
// `z.string().min(1)`) / HardcoreProfileGetQuerySchema (hardcoreProfileValidation.ts,
// same) — a NEW, reusable, more precise rule for this new endpoint. The
// existing schemas are untouched on purpose: this step must not risk
// breaking survive-night/death/upsert/leaderboard/hardcore-profile, so the
// stricter rule only applies where it's newly introduced (player-profile),
// not retrofitted onto working endpoints.
//
// Discord snowflakes are 64-bit unsigned integers rendered as decimal
// strings — today's real IDs are 17-19 digits; 20 is a small safety margin
// for future growth without allowing an arbitrary-length string through.
export const DiscordSnowflakeIdSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'invalid_discord_id');

export const Object13PlayerProfileGetQuerySchema = z.object({
  discordUserId: DiscordSnowflakeIdSchema,
});
export type Object13PlayerProfileGetQueryInput = z.infer<typeof Object13PlayerProfileGetQuerySchema>;

// Envelope only — profileVersion support and profileData itself each get
// their own dedicated check below/in the route (see
// isSupportedObject13PlayerProfileVersion, validateObject13PlayerProfileData).
// zod's built-in object/record validators don't reject arrays or recurse for
// prototype-pollution keys the way this endpoint needs, so profileData is
// deliberately left as `z.unknown()` here and validated separately.
const Object13PlayerProfileSyncEnvelopeSchema = z.object({
  discordUserId: DiscordSnowflakeIdSchema,
  expectedRevision: z.number().int().positive(),
  profileVersion: z.number().int().positive(),
  profileData: z.unknown(),
});
export type Object13PlayerProfileSyncEnvelopeInput = z.infer<typeof Object13PlayerProfileSyncEnvelopeSchema>;

/**
 * Parses the PUT body's envelope (identity + revision + version — NOT
 * profileData's contents). zod's default "unrecognized keys are stripped,
 * not rejected" behavior already satisfies "never persist unknown top-level
 * fields" — only the four named fields are ever read out of the parsed
 * result, nothing is ever spread from the raw body.
 */
export function parseObject13PlayerProfileSyncEnvelope(raw: unknown): z.SafeParseReturnType<unknown, Object13PlayerProfileSyncEnvelopeInput> {
  return Object13PlayerProfileSyncEnvelopeSchema.safeParse(raw);
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively looks for `__proto__`/`constructor`/`prototype` as an OWN key
 * anywhere in a JSON value (object keys and array elements) — a JSON body
 * parsed via `JSON.parse` (which Fastify's body parser uses internally)
 * assigns `"__proto__"` as a normal own property, not the actual prototype
 * pollution vector, but this endpoint blocks it anyway on principle (see
 * task spec) since `profileData` will eventually be read back and merged
 * into real objects by future (1B+) code this step can't see yet.
 * `seen` guards against cycles — defense-in-depth; a value that reached this
 * point already passed through `JSON.parse`, which can't produce cycles.
 */
function findDangerousKey(value: unknown, seen: WeakSet<object> = new WeakSet()): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDangerousKey(item, seen);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  if (seen.has(value)) return null;
  seen.add(value);

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) return key;
    const found = findDangerousKey((value as Record<string, unknown>)[key], seen);
    if (found) return found;
  }
  return null;
}

export type Object13PlayerProfileDataValidationError =
  | { code: 'not_object' }
  | { code: 'dangerous_key'; key: string }
  | { code: 'not_serializable' }
  | { code: 'too_large'; sizeBytes: number };

export type Object13PlayerProfileDataValidationResult =
  | { ok: true; data: Object13PlayerProfileData; sizeBytes: number }
  | { ok: false; error: Object13PlayerProfileDataValidationError };

/**
 * Strict validation for the actual `profileData` payload — deliberately NOT
 * a lenient silent-fallback like hardcoreProfileValidation.ts#sanitizeIncomingHardcoreSnapshot
 * (per the task spec: "nepoužívat lenientní silent fallback jako Hardcore
 * sync"). Any failure here must become a real 400/413, never a quietly
 * substituted default.
 *
 * Order: plain-object shape -> dangerous keys -> JSON-serializability ->
 * size. `JSON.stringify` doubles as both the serializability check (it
 * returns `undefined`, not a string, for values it silently drops — e.g. a
 * bare function/symbol/`undefined` at the top level — and throws on
 * circular references, which a same-process object literal from a parsed
 * JSON body can't have but a future caller passing something else in theory
 * could) and the exact byte size measurement the route needs to enforce
 * `OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES`.
 */
export function validateObject13PlayerProfileData(raw: unknown): Object13PlayerProfileDataValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: { code: 'not_object' } };
  }

  const dangerousKey = findDangerousKey(raw);
  if (dangerousKey) {
    return { ok: false, error: { code: 'dangerous_key', key: dangerousKey } };
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return { ok: false, error: { code: 'not_serializable' } };
  }
  if (serialized === undefined) {
    return { ok: false, error: { code: 'not_serializable' } };
  }

  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  if (sizeBytes > OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES) {
    return { ok: false, error: { code: 'too_large', sizeBytes } };
  }

  return { ok: true, data: raw as Object13PlayerProfileData, sizeBytes };
}
