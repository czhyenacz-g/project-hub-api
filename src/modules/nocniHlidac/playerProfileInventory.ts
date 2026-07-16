// Object13PlayerProfileDataV1 — profile contract v1, first (and so far only)
// real content of the previously-opaque profileData (see playerProfileTypes.ts
// step 1A history). Deliberately narrow: inventory of countable items, first
// supported item is `bulb` (spare bulbs — see nocni-hlidac game/core/bulbsConfig.ts).
// No weapons/ammo/batteries/office equipment yet — adding a new item id is a
// registry entry here, not a new profile shape.

// Conservative MVP cap on the serialized (JSON.stringify, UTF-8 byte length)
// size of profileData — named constant so it's easy to find/tune later, see
// playerProfileValidation.ts#validateObject13PlayerProfileDataV1. Lives here
// (not playerProfileTypes.ts) so that module can depend on this one without
// a cycle back.
export const OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES = 32 * 1024; // 32 KB

export type Object13InventoryItemId = 'bulb';

export type Object13InventoryItems = Partial<Record<Object13InventoryItemId, number>>;

export interface Object13PlayerProfileDataV1 {
  inventory: {
    items: Object13InventoryItems;
  };
}

export interface Object13InventoryItemDefinition {
  id: Object13InventoryItemId;
  /** Starting quantity for a brand new profile — see createDefaultObject13PlayerProfileDataV1. */
  defaultQuantity: number;
  minQuantity: number;
  /**
   * A technical safety cap on stored quantity (prevents a corrupted/adversarial
   * value from growing unbounded), NOT a game-balance limit — the game itself
   * has no inventory cap today. Chosen as a conservative round number, not
   * derived from any gameplay constant.
   */
  maxQuantity: number;
}

// Must mirror nocni-hlidac's game/core/bulbsConfig.ts#BULBS_CONFIG.startingCount
// (the game repo is the actual source of truth for "what a new campaign starts
// with" today; this server has no way to import that repo's TS at build time,
// so the number is duplicated here deliberately — see docs/operations/nocni-hlidac.md
// for the cross-repo note). Changing this constant only affects PROFILES CREATED
// AFTER the change — existing rows keep whatever quantity they already have,
// see playerProfileService.ts#getOrCreateObject13PlayerProfile.
const BULB_STARTING_COUNT = 10;

const BULB_TECHNICAL_MAX_QUANTITY = 999;

export const OBJECT13_INVENTORY_ITEM_REGISTRY: Readonly<Record<Object13InventoryItemId, Object13InventoryItemDefinition>> = {
  bulb: {
    id: 'bulb',
    defaultQuantity: BULB_STARTING_COUNT,
    minQuantity: 0,
    maxQuantity: BULB_TECHNICAL_MAX_QUANTITY,
  },
};

export const OBJECT13_INVENTORY_ITEM_IDS = Object.keys(OBJECT13_INVENTORY_ITEM_REGISTRY) as Object13InventoryItemId[];

export function isObject13InventoryItemId(value: string): value is Object13InventoryItemId {
  return Object.prototype.hasOwnProperty.call(OBJECT13_INVENTORY_ITEM_REGISTRY, value);
}

/**
 * Single factory for "what a brand new V1 profile looks like" — every
 * registered item at its `defaultQuantity`. Never an empty `{}` (see task
 * spec) — a profile without this shape is not a valid V1 profile.
 */
export function createDefaultObject13PlayerProfileDataV1(): Object13PlayerProfileDataV1 {
  const items: Object13InventoryItems = {};
  for (const id of OBJECT13_INVENTORY_ITEM_IDS) {
    items[id] = OBJECT13_INVENTORY_ITEM_REGISTRY[id].defaultQuantity;
  }
  return { inventory: { items } };
}

// A shape with at least an `inventory.items` bag — both
// `Object13PlayerProfileDataV1` (this file) and
// `Object13PlayerProfileDataV2` (playerProfileContractV2.ts, adds
// `equipment`) satisfy this structurally. The functions below are typed
// against this narrower shape (not the V1 interface specifically) and use a
// generic `<T extends ...>` so they can operate on a V2 profile WITHOUT this
// module importing anything about equipment (no cycle back) — the caller's
// extra fields (like `equipment`) are preserved via `...profileData` spread,
// never dropped.
interface WithInventoryItems {
  inventory: { items: Object13InventoryItems };
}

/** Missing key = 0, never `undefined` propagated into arithmetic. */
export function getInventoryItemQuantity(profileData: WithInventoryItems, itemId: Object13InventoryItemId): number {
  return profileData.inventory.items[itemId] ?? 0;
}

/** Clamps a raw quantity into the registry's [min, max] range; a non-integer falls back to the item's default. Used when repairing/normalizing data, never for validating a caller's request (which must be rejected outright, see playerProfileValidation.ts). */
export function normalizeInventoryQuantity(itemId: Object13InventoryItemId, rawQuantity: unknown): number {
  const def = OBJECT13_INVENTORY_ITEM_REGISTRY[itemId];
  if (typeof rawQuantity !== 'number' || !Number.isInteger(rawQuantity)) return def.defaultQuantity;
  return Math.min(def.maxQuantity, Math.max(def.minQuantity, rawQuantity));
}

export type AddInventoryItemResult<T> = { ok: true; profileData: T } | { ok: false; error: 'exceeds_maximum' };

/** Pure — does not touch the DB. amount must already be validated as a positive integer by the caller (see playerProfileInventoryValidation.ts). Generic over `T` so calling it with a V2 profile preserves `equipment` untouched. */
export function addInventoryItem<T extends WithInventoryItems>(
  profileData: T,
  itemId: Object13InventoryItemId,
  amount: number,
): AddInventoryItemResult<T> {
  const def = OBJECT13_INVENTORY_ITEM_REGISTRY[itemId];
  const next = getInventoryItemQuantity(profileData, itemId) + amount;
  if (next > def.maxQuantity) return { ok: false, error: 'exceeds_maximum' };
  return {
    ok: true,
    profileData: { ...profileData, inventory: { items: { ...profileData.inventory.items, [itemId]: next } } },
  };
}

export type ConsumeInventoryItemResult<T> = { ok: true; profileData: T } | { ok: false; error: 'insufficient_inventory' };

/** Pure — does not touch the DB. amount must already be validated as a positive integer by the caller. Generic over `T`, see addInventoryItem. */
export function consumeInventoryItem<T extends WithInventoryItems>(
  profileData: T,
  itemId: Object13InventoryItemId,
  amount: number,
): ConsumeInventoryItemResult<T> {
  const def = OBJECT13_INVENTORY_ITEM_REGISTRY[itemId];
  const next = getInventoryItemQuantity(profileData, itemId) - amount;
  if (next < def.minQuantity) return { ok: false, error: 'insufficient_inventory' };
  return {
    ok: true,
    profileData: { ...profileData, inventory: { items: { ...profileData.inventory.items, [itemId]: next } } },
  };
}
