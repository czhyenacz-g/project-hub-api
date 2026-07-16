import { z } from 'zod';
import {
  isObject13InventoryItemId,
  Object13InventoryItems,
  Object13PlayerProfileDataV1,
  OBJECT13_INVENTORY_ITEM_REGISTRY,
  OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES,
} from './playerProfileInventory.js';
import { Object13PlayerProfileDataV2 } from './playerProfileContractV2.js';
import { EquipmentValidationError, validateEquipmentState } from './playerProfileEquipment.js';

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

// Body schema for POST /nocni-hlidac/player-profile/inventory/:itemId/add|consume.
// `discordUserId` arrives here the same way as the general PUT — filled in
// by the server-to-server layer (the game client's own Next.js proxy, from
// its session), never trusted from a browser directly (see
// playerProfileInventoryRoutes.ts).
const Object13PlayerProfileInventoryOperationSchema = z.object({
  discordUserId: DiscordSnowflakeIdSchema,
  amount: z.number().int().positive(),
  expectedRevision: z.number().int().positive(),
});
export type Object13PlayerProfileInventoryOperationInput = z.infer<typeof Object13PlayerProfileInventoryOperationSchema>;

export function parseObject13PlayerProfileInventoryOperation(
  raw: unknown,
): z.SafeParseReturnType<unknown, Object13PlayerProfileInventoryOperationInput> {
  return Object13PlayerProfileInventoryOperationSchema.safeParse(raw);
}

export type Object13PlayerProfileDataV1ValidationError =
  | { code: 'not_object' }
  | { code: 'unknown_top_level_key'; key: string }
  | { code: 'missing_inventory' }
  | { code: 'inventory_not_object' }
  | { code: 'unknown_inventory_key'; key: string }
  | { code: 'missing_items' }
  | { code: 'items_not_object' }
  | { code: 'unknown_item_id'; itemId: string }
  | { code: 'invalid_quantity'; itemId: string }
  | { code: 'quantity_out_of_range'; itemId: string }
  | { code: 'too_large'; sizeBytes: number };

export type Object13PlayerProfileDataV1ValidationResult =
  | { ok: true; data: Object13PlayerProfileDataV1 }
  | { ok: false; error: Object13PlayerProfileDataV1ValidationError };

const ALLOWED_TOP_LEVEL_KEYS = new Set(['inventory']);
const ALLOWED_INVENTORY_KEYS = new Set(['items']);

/**
 * Strict, fully-whitelisted validation of `profileData` against the V1
 * contract (`Object13PlayerProfileDataV1` — see playerProfileInventory.ts).
 * Deliberately NOT a lenient silent-fallback (per the task spec: "žádný
 * silent fallback") — any shape mismatch is a real 400, never a quietly
 * substituted default. Replaces the earlier step-1A opaque
 * `validateObject13PlayerProfileData` (arbitrary-object + dangerous-key
 * scan) now that profileVersion 1 has one exact known shape: because every
 * accepted key is an explicit literal (`"inventory"`, `"items"`, a finite
 * set of item ids) a `__proto__`/`constructor`/`prototype` key can never
 * pass this validator — it's rejected as an unknown key long before any
 * recursive dangerous-key scan would be needed.
 */
export function validateObject13PlayerProfileDataV1(raw: unknown): Object13PlayerProfileDataV1ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: { code: 'not_object' } };
  }
  const rawObj = raw as Record<string, unknown>;

  for (const key of Object.keys(rawObj)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) return { ok: false, error: { code: 'unknown_top_level_key', key } };
  }
  if (!('inventory' in rawObj)) return { ok: false, error: { code: 'missing_inventory' } };

  const inventory = rawObj.inventory;
  if (typeof inventory !== 'object' || inventory === null || Array.isArray(inventory)) {
    return { ok: false, error: { code: 'inventory_not_object' } };
  }
  const inventoryObj = inventory as Record<string, unknown>;

  for (const key of Object.keys(inventoryObj)) {
    if (!ALLOWED_INVENTORY_KEYS.has(key)) return { ok: false, error: { code: 'unknown_inventory_key', key } };
  }
  if (!('items' in inventoryObj)) return { ok: false, error: { code: 'missing_items' } };

  const items = inventoryObj.items;
  if (typeof items !== 'object' || items === null || Array.isArray(items)) {
    return { ok: false, error: { code: 'items_not_object' } };
  }
  const itemsObj = items as Record<string, unknown>;

  const validatedItems: Object13InventoryItems = {};
  for (const [itemId, rawQuantity] of Object.entries(itemsObj)) {
    if (!isObject13InventoryItemId(itemId)) return { ok: false, error: { code: 'unknown_item_id', itemId } };
    if (typeof rawQuantity !== 'number' || !Number.isInteger(rawQuantity)) {
      return { ok: false, error: { code: 'invalid_quantity', itemId } };
    }
    const def = OBJECT13_INVENTORY_ITEM_REGISTRY[itemId];
    if (rawQuantity < def.minQuantity || rawQuantity > def.maxQuantity) {
      return { ok: false, error: { code: 'quantity_out_of_range', itemId } };
    }
    validatedItems[itemId] = rawQuantity;
  }

  const data: Object13PlayerProfileDataV1 = { inventory: { items: validatedItems } };
  const sizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (sizeBytes > OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES) {
    return { ok: false, error: { code: 'too_large', sizeBytes } };
  }

  return { ok: true, data };
}

// Body schema for POST /nocni-hlidac/player-profile/equipment/weapon/unlock|equip.
// Same `discordUserId`-from-server-to-server-layer convention as the
// inventory operation schema above.
const Object13PlayerProfileWeaponOperationSchema = z.object({
  discordUserId: DiscordSnowflakeIdSchema,
  weaponId: z.string().min(1),
  expectedRevision: z.number().int().positive(),
});
export type Object13PlayerProfileWeaponOperationInput = z.infer<typeof Object13PlayerProfileWeaponOperationSchema>;

/**
 * `weaponId` is only checked for "non-empty string" here — the ROUTE
 * validates it against `isWeaponId` (playerProfileEquipment.ts) separately,
 * same "envelope vs content" split as the inventory operation schema/route.
 */
export function parseObject13PlayerProfileWeaponOperation(
  raw: unknown,
): z.SafeParseReturnType<unknown, Object13PlayerProfileWeaponOperationInput> {
  return Object13PlayerProfileWeaponOperationSchema.safeParse(raw);
}

export type Object13PlayerProfileDataV2ValidationError =
  | { code: 'not_object' }
  | { code: 'unknown_top_level_key'; key: string }
  | { code: 'missing_inventory' }
  | { code: 'inventory_not_object' }
  | { code: 'unknown_inventory_key'; key: string }
  | { code: 'missing_items' }
  | { code: 'items_not_object' }
  | { code: 'unknown_item_id'; itemId: string }
  | { code: 'invalid_quantity'; itemId: string }
  | { code: 'quantity_out_of_range'; itemId: string }
  | { code: 'missing_equipment' }
  | { code: 'equipment_invalid'; error: EquipmentValidationError }
  | { code: 'too_large'; sizeBytes: number };

export type Object13PlayerProfileDataV2ValidationResult =
  | { ok: true; data: Object13PlayerProfileDataV2 }
  | { ok: false; error: Object13PlayerProfileDataV2ValidationError };

const ALLOWED_V2_TOP_LEVEL_KEYS = new Set(['inventory', 'equipment']);

/**
 * Strict, fully-whitelisted validation of `profileData` against the V2
 * contract (`Object13PlayerProfileDataV2` — see playerProfileContractV2.ts).
 * Same principle as `validateObject13PlayerProfileDataV1` above (inventory
 * checks are deliberately duplicated here rather than shared, so a future
 * change to V1-only migration-detection logic can never accidentally affect
 * V2 validation, and vice versa — V1 is now legacy/migration-only, V2 is the
 * live contract) — `equipment` is delegated to
 * `validateEquipmentState` (playerProfileEquipment.ts), the one place that
 * knows the weapon registry/invariants.
 */
export function validateObject13PlayerProfileDataV2(raw: unknown): Object13PlayerProfileDataV2ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: { code: 'not_object' } };
  }
  const rawObj = raw as Record<string, unknown>;

  for (const key of Object.keys(rawObj)) {
    if (!ALLOWED_V2_TOP_LEVEL_KEYS.has(key)) return { ok: false, error: { code: 'unknown_top_level_key', key } };
  }
  if (!('inventory' in rawObj)) return { ok: false, error: { code: 'missing_inventory' } };
  if (!('equipment' in rawObj)) return { ok: false, error: { code: 'missing_equipment' } };

  const inventory = rawObj.inventory;
  if (typeof inventory !== 'object' || inventory === null || Array.isArray(inventory)) {
    return { ok: false, error: { code: 'inventory_not_object' } };
  }
  const inventoryObj = inventory as Record<string, unknown>;

  for (const key of Object.keys(inventoryObj)) {
    if (!ALLOWED_INVENTORY_KEYS.has(key)) return { ok: false, error: { code: 'unknown_inventory_key', key } };
  }
  if (!('items' in inventoryObj)) return { ok: false, error: { code: 'missing_items' } };

  const items = inventoryObj.items;
  if (typeof items !== 'object' || items === null || Array.isArray(items)) {
    return { ok: false, error: { code: 'items_not_object' } };
  }
  const itemsObj = items as Record<string, unknown>;

  const validatedItems: Object13InventoryItems = {};
  for (const [itemId, rawQuantity] of Object.entries(itemsObj)) {
    if (!isObject13InventoryItemId(itemId)) return { ok: false, error: { code: 'unknown_item_id', itemId } };
    if (typeof rawQuantity !== 'number' || !Number.isInteger(rawQuantity)) {
      return { ok: false, error: { code: 'invalid_quantity', itemId } };
    }
    const def = OBJECT13_INVENTORY_ITEM_REGISTRY[itemId];
    if (rawQuantity < def.minQuantity || rawQuantity > def.maxQuantity) {
      return { ok: false, error: { code: 'quantity_out_of_range', itemId } };
    }
    validatedItems[itemId] = rawQuantity;
  }

  const equipmentResult = validateEquipmentState(rawObj.equipment);
  if (!equipmentResult.ok) return { ok: false, error: { code: 'equipment_invalid', error: equipmentResult.error } };

  const data: Object13PlayerProfileDataV2 = { inventory: { items: validatedItems }, equipment: equipmentResult.equipment };
  const sizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (sizeBytes > OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES) {
    return { ok: false, error: { code: 'too_large', sizeBytes } };
  }

  return { ok: true, data };
}
