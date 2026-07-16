import { describe, expect, it } from 'vitest';
import {
  createDefaultEquipmentState,
  equipWeapon,
  getEquippedWeapon,
  hasOwnedWeapon,
  isWeaponId,
  normalizeOwnedWeapons,
  Object13EquipmentState,
  unlockWeapon,
  validateEquipmentState,
  WEAPON_REGISTRY,
} from './playerProfileEquipment.js';

describe('WEAPON_REGISTRY', () => {
  it('single_shotgun has ammoCapacity 1', () => {
    expect(WEAPON_REGISTRY.single_shotgun).toEqual({ id: 'single_shotgun', ammoCapacity: 1 });
  });

  it('double_barrel_shotgun has ammoCapacity 2', () => {
    expect(WEAPON_REGISTRY.double_barrel_shotgun).toEqual({ id: 'double_barrel_shotgun', ammoCapacity: 2 });
  });
});

describe('isWeaponId', () => {
  it('accepts known weapon ids', () => {
    expect(isWeaponId('single_shotgun')).toBe(true);
    expect(isWeaponId('double_barrel_shotgun')).toBe(true);
  });

  it('rejects unknown ids', () => {
    expect(isWeaponId('rocket_launcher')).toBe(false);
    expect(isWeaponId('')).toBe(false);
  });
});

describe('createDefaultEquipmentState', () => {
  it('is empty ownership, nothing equipped', () => {
    expect(createDefaultEquipmentState()).toEqual({ ownedWeapons: [], equippedWeaponId: null });
  });
});

describe('hasOwnedWeapon / getEquippedWeapon', () => {
  it('reads ownership and equipped weapon', () => {
    const equipment: Object13EquipmentState = { ownedWeapons: ['single_shotgun'], equippedWeaponId: 'single_shotgun' };
    expect(hasOwnedWeapon(equipment, 'single_shotgun')).toBe(true);
    expect(hasOwnedWeapon(equipment, 'double_barrel_shotgun')).toBe(false);
    expect(getEquippedWeapon(equipment)).toBe('single_shotgun');
  });
});

describe('unlockWeapon', () => {
  it('9. unlocking single_shotgun from empty equipment adds and equips it', () => {
    const result = unlockWeapon(createDefaultEquipmentState(), 'single_shotgun');
    expect(result).toEqual({ ownedWeapons: ['single_shotgun'], equippedWeaponId: 'single_shotgun' });
  });

  it('does not auto-equip single_shotgun if something is already equipped', () => {
    const equipment: Object13EquipmentState = { ownedWeapons: ['double_barrel_shotgun'], equippedWeaponId: 'double_barrel_shotgun' };
    // Hypothetical: unlocking single after double (not a normal game flow, but the pure function must still behave per the rule).
    const result = unlockWeapon(equipment, 'single_shotgun');
    expect(result.ownedWeapons).toEqual(['double_barrel_shotgun', 'single_shotgun']);
    expect(result.equippedWeaponId).toBe('double_barrel_shotgun');
  });

  it('10. unlocking single_shotgun twice is idempotent — same reference returned, no duplicate', () => {
    const first = unlockWeapon(createDefaultEquipmentState(), 'single_shotgun');
    const second = unlockWeapon(first, 'single_shotgun');
    expect(second).toBe(first); // same object reference — a true no-op
    expect(second.ownedWeapons).toEqual(['single_shotgun']);
  });

  it('11. unlocking double_barrel_shotgun adds and auto-equips it', () => {
    const result = unlockWeapon(createDefaultEquipmentState(), 'double_barrel_shotgun');
    expect(result).toEqual({ ownedWeapons: ['double_barrel_shotgun'], equippedWeaponId: 'double_barrel_shotgun' });
  });

  it('12. double_barrel_shotgun unlock keeps single_shotgun in ownedWeapons if already owned', () => {
    const withSingle = unlockWeapon(createDefaultEquipmentState(), 'single_shotgun');
    const result = unlockWeapon(withSingle, 'double_barrel_shotgun');
    expect(result.ownedWeapons).toEqual(['single_shotgun', 'double_barrel_shotgun']);
    expect(result.equippedWeaponId).toBe('double_barrel_shotgun');
  });

  it('double_barrel_shotgun always auto-equips, even overriding an already-equipped single_shotgun', () => {
    const equipment: Object13EquipmentState = { ownedWeapons: ['single_shotgun'], equippedWeaponId: 'single_shotgun' };
    const result = unlockWeapon(equipment, 'double_barrel_shotgun');
    expect(result.equippedWeaponId).toBe('double_barrel_shotgun');
  });

  it('a repeated double_barrel_shotgun unlock (already owned + equipped) is a true no-op', () => {
    const first = unlockWeapon(createDefaultEquipmentState(), 'double_barrel_shotgun');
    const second = unlockWeapon(first, 'double_barrel_shotgun');
    expect(second).toBe(first);
  });
});

describe('equipWeapon', () => {
  it('rejects equipping a weapon that is not owned', () => {
    const result = equipWeapon(createDefaultEquipmentState(), 'single_shotgun');
    expect(result).toEqual({ ok: false, error: 'not_owned' });
  });

  it('equips an owned weapon', () => {
    const equipment: Object13EquipmentState = { ownedWeapons: ['single_shotgun', 'double_barrel_shotgun'], equippedWeaponId: 'double_barrel_shotgun' };
    const result = equipWeapon(equipment, 'single_shotgun');
    expect(result).toEqual({ ok: true, equipment: { ownedWeapons: ['single_shotgun', 'double_barrel_shotgun'], equippedWeaponId: 'single_shotgun' } });
  });

  it('equipping the already-equipped weapon is a no-op (same reference)', () => {
    const equipment: Object13EquipmentState = { ownedWeapons: ['single_shotgun'], equippedWeaponId: 'single_shotgun' };
    const result = equipWeapon(equipment, 'single_shotgun');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.equipment).toBe(equipment);
  });
});

describe('normalizeOwnedWeapons', () => {
  it('drops unknown ids and duplicates, keeps order of first occurrence', () => {
    expect(normalizeOwnedWeapons(['single_shotgun', 'rocket_launcher', 'single_shotgun', 'double_barrel_shotgun'])).toEqual([
      'single_shotgun',
      'double_barrel_shotgun',
    ]);
  });

  it('returns an empty array for non-array input', () => {
    expect(normalizeOwnedWeapons('not an array')).toEqual([]);
    expect(normalizeOwnedWeapons(null)).toEqual([]);
    expect(normalizeOwnedWeapons(undefined)).toEqual([]);
  });
});

describe('validateEquipmentState', () => {
  it('accepts a well-formed empty equipment state', () => {
    const result = validateEquipmentState({ ownedWeapons: [], equippedWeaponId: null });
    expect(result).toEqual({ ok: true, equipment: { ownedWeapons: [], equippedWeaponId: null } });
  });

  it('accepts a well-formed populated equipment state', () => {
    const result = validateEquipmentState({ ownedWeapons: ['single_shotgun'], equippedWeaponId: 'single_shotgun' });
    expect(result.ok).toBe(true);
  });

  it('rejects null/array/primitive', () => {
    expect(validateEquipmentState(null).ok).toBe(false);
    expect(validateEquipmentState([]).ok).toBe(false);
    expect(validateEquipmentState('x').ok).toBe(false);
  });

  it('rejects an unknown top-level equipment key', () => {
    const result = validateEquipmentState({ ownedWeapons: [], equippedWeaponId: null, extra: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_equipment_key');
  });

  it('rejects ownedWeapons that is not an array', () => {
    const result = validateEquipmentState({ ownedWeapons: 'single_shotgun', equippedWeaponId: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ownedWeapons_not_array');
  });

  it('6. rejects an unknown weapon id in ownedWeapons', () => {
    const result = validateEquipmentState({ ownedWeapons: ['rocket_launcher'], equippedWeaponId: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_weapon_id');
  });

  it('7. rejects duplicate weapon ids in ownedWeapons', () => {
    const result = validateEquipmentState({ ownedWeapons: ['single_shotgun', 'single_shotgun'], equippedWeaponId: 'single_shotgun' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_weapon_id');
  });

  it('rejects a non-null, non-string equippedWeaponId', () => {
    const result = validateEquipmentState({ ownedWeapons: [], equippedWeaponId: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_equipped_weapon_id');
  });

  it('rejects an unknown equippedWeaponId', () => {
    const result = validateEquipmentState({ ownedWeapons: [], equippedWeaponId: 'rocket_launcher' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_equipped_weapon_id');
  });

  it('8. rejects an equippedWeaponId that is not in ownedWeapons', () => {
    const result = validateEquipmentState({ ownedWeapons: ['single_shotgun'], equippedWeaponId: 'double_barrel_shotgun' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('equipped_weapon_not_owned');
  });

  it('accepts equippedWeaponId: null even with owned weapons', () => {
    const result = validateEquipmentState({ ownedWeapons: ['single_shotgun'], equippedWeaponId: null });
    expect(result.ok).toBe(true);
  });
});
