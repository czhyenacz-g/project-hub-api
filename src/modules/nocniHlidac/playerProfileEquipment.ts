// Equipment model — profile contract V2 (see task spec "profilový kontrakt
// V2"). Weapon OWNERSHIP is durable per-account profile state; loaded ammo
// and in-mission state stay in the game client's runtime GameState, never
// here. Same "small central registry" pattern as playerProfileInventory.ts,
// deliberately separate module (equipment is not an inventory item — no
// quantity, no add/consume, just owned/not-owned + which one is equipped).

export type WeaponId = 'single_shotgun' | 'double_barrel_shotgun';

export interface WeaponDefinition {
  id: WeaponId;
  /** How many shots the weapon holds when fully loaded — the game client derives runtime ammo capacity from this, never a second hardcoded 1/2. */
  ammoCapacity: number;
}

export const WEAPON_REGISTRY: Readonly<Record<WeaponId, WeaponDefinition>> = {
  single_shotgun: { id: 'single_shotgun', ammoCapacity: 1 },
  double_barrel_shotgun: { id: 'double_barrel_shotgun', ammoCapacity: 2 },
};

export const WEAPON_IDS = Object.keys(WEAPON_REGISTRY) as WeaponId[];

export function isWeaponId(value: string): value is WeaponId {
  return Object.prototype.hasOwnProperty.call(WEAPON_REGISTRY, value);
}

export interface Object13EquipmentState {
  ownedWeapons: WeaponId[];
  equippedWeaponId: WeaponId | null;
}

export function createDefaultEquipmentState(): Object13EquipmentState {
  return { ownedWeapons: [], equippedWeaponId: null };
}

export function hasOwnedWeapon(equipment: Object13EquipmentState, weaponId: WeaponId): boolean {
  return equipment.ownedWeapons.includes(weaponId);
}

export function getEquippedWeapon(equipment: Object13EquipmentState): WeaponId | null {
  return equipment.equippedWeaponId;
}

/**
 * Pure unlock — adds the weapon to `ownedWeapons` (idempotent, never a
 * duplicate) and applies the auto-equip rule (task spec "4. Pravidla
 * equipment modelu"):
 * - `single_shotgun`: equips it only if nothing is currently equipped.
 * - `double_barrel_shotgun`: ALWAYS auto-equips (strictly better than the
 *   single-barrel) — `single_shotgun` stays in `ownedWeapons` if already
 *   owned, just no longer equipped.
 *
 * Already-owned + already-correctly-equipped is a true no-op — the caller
 * (playerProfileEquipmentService.ts) uses reference/deep equality on the
 * result to decide whether this actually changed anything (and therefore
 * whether revision should advance at all — see task spec "7.").
 */
export function unlockWeapon(equipment: Object13EquipmentState, weaponId: WeaponId): Object13EquipmentState {
  const alreadyOwned = hasOwnedWeapon(equipment, weaponId);
  const ownedWeapons = alreadyOwned ? equipment.ownedWeapons : [...equipment.ownedWeapons, weaponId];

  let equippedWeaponId = equipment.equippedWeaponId;
  if (weaponId === 'double_barrel_shotgun') {
    equippedWeaponId = weaponId;
  } else if (equippedWeaponId === null) {
    equippedWeaponId = weaponId;
  }

  if (alreadyOwned && equippedWeaponId === equipment.equippedWeaponId) {
    return equipment; // true no-op — same reference, caller can compare with ===.
  }
  return { ownedWeapons, equippedWeaponId };
}

export type EquipWeaponResult = { ok: true; equipment: Object13EquipmentState } | { ok: false; error: 'not_owned' };

/**
 * Explicit equip of an ALREADY-owned weapon — rejects switching to a weapon
 * the player doesn't own. Not wired to any production UI yet (task spec "7.
 * ... Protože nemáme výběrové UI, není povinný") — kept for architectural
 * completeness so a future weapon-switch UI has a ready server contract,
 * see playerProfileEquipmentRoutes.ts.
 */
export function equipWeapon(equipment: Object13EquipmentState, weaponId: WeaponId): EquipWeaponResult {
  if (!hasOwnedWeapon(equipment, weaponId)) return { ok: false, error: 'not_owned' };
  if (equipment.equippedWeaponId === weaponId) return { ok: true, equipment }; // no-op, same reference
  return { ok: true, equipment: { ...equipment, equippedWeaponId: weaponId } };
}

/**
 * Lenient defensive normalization (mirrors
 * playerProfileInventory.ts#normalizeInventoryQuantity) — silently drops
 * unknown/duplicate entries. Used only for repairing a corrupted/legacy
 * stored value, NEVER for validating an incoming request body (that must
 * reject outright, see `validateEquipmentState` below).
 */
export function normalizeOwnedWeapons(raw: unknown): WeaponId[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<WeaponId>();
  const result: WeaponId[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && isWeaponId(item) && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

export type EquipmentValidationError =
  | { code: 'not_object' }
  | { code: 'unknown_equipment_key'; key: string }
  | { code: 'ownedWeapons_not_array' }
  | { code: 'unknown_weapon_id'; weaponId: string }
  | { code: 'duplicate_weapon_id'; weaponId: string }
  | { code: 'invalid_equipped_weapon_id' }
  | { code: 'equipped_weapon_not_owned' };

export type EquipmentValidationResult =
  | { ok: true; equipment: Object13EquipmentState }
  | { ok: false; error: EquipmentValidationError };

const ALLOWED_EQUIPMENT_KEYS = new Set(['ownedWeapons', 'equippedWeaponId']);

/**
 * Strict, fully-whitelisted validation of the `equipment` sub-object — same
 * "žádný silent fallback" principle as
 * playerProfileValidation.ts#validateObject13PlayerProfileDataV1. Enforces
 * every invariant from task spec "4.": no duplicates, unknown weapon ids
 * rejected, `equippedWeaponId` must be `null` or a value present in
 * `ownedWeapons`.
 */
export function validateEquipmentState(raw: unknown): EquipmentValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: { code: 'not_object' } };
  }
  const rawObj = raw as Record<string, unknown>;

  for (const key of Object.keys(rawObj)) {
    if (!ALLOWED_EQUIPMENT_KEYS.has(key)) return { ok: false, error: { code: 'unknown_equipment_key', key } };
  }

  const rawOwned = rawObj.ownedWeapons;
  if (!Array.isArray(rawOwned)) return { ok: false, error: { code: 'ownedWeapons_not_array' } };

  const ownedWeapons: WeaponId[] = [];
  const seen = new Set<string>();
  for (const item of rawOwned) {
    if (typeof item !== 'string' || !isWeaponId(item)) {
      return { ok: false, error: { code: 'unknown_weapon_id', weaponId: typeof item === 'string' ? item : String(item) } };
    }
    if (seen.has(item)) return { ok: false, error: { code: 'duplicate_weapon_id', weaponId: item } };
    seen.add(item);
    ownedWeapons.push(item);
  }

  const rawEquipped = rawObj.equippedWeaponId;
  if (rawEquipped !== null && (typeof rawEquipped !== 'string' || !isWeaponId(rawEquipped))) {
    return { ok: false, error: { code: 'invalid_equipped_weapon_id' } };
  }
  const equippedWeaponId = rawEquipped as WeaponId | null;
  if (equippedWeaponId !== null && !ownedWeapons.includes(equippedWeaponId)) {
    return { ok: false, error: { code: 'equipped_weapon_not_owned' } };
  }

  return { ok: true, equipment: { ownedWeapons, equippedWeaponId } };
}
