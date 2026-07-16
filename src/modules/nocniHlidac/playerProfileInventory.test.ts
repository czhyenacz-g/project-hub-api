import { describe, expect, it } from 'vitest';
import {
  addInventoryItem,
  consumeInventoryItem,
  createDefaultObject13PlayerProfileDataV1,
  getInventoryItemQuantity,
  isObject13InventoryItemId,
  normalizeInventoryQuantity,
  Object13PlayerProfileDataV1,
  OBJECT13_INVENTORY_ITEM_REGISTRY,
} from './playerProfileInventory.js';

describe('OBJECT13_INVENTORY_ITEM_REGISTRY', () => {
  it('2. bulb default/min/max come from a single central registry entry', () => {
    expect(OBJECT13_INVENTORY_ITEM_REGISTRY.bulb).toEqual({ id: 'bulb', defaultQuantity: 10, minQuantity: 0, maxQuantity: 999 });
  });
});

describe('isObject13InventoryItemId', () => {
  it('accepts "bulb"', () => {
    expect(isObject13InventoryItemId('bulb')).toBe(true);
  });

  it('rejects unknown ids', () => {
    expect(isObject13InventoryItemId('shotgun')).toBe(false);
    expect(isObject13InventoryItemId('')).toBe(false);
  });
});

describe('createDefaultObject13PlayerProfileDataV1', () => {
  it('1. a new profile has inventory.items.bulb at the registry default', () => {
    expect(createDefaultObject13PlayerProfileDataV1()).toEqual({ inventory: { items: { bulb: 10 } } });
  });

  it('is never an empty object', () => {
    const data = createDefaultObject13PlayerProfileDataV1();
    expect(Object.keys(data.inventory.items).length).toBeGreaterThan(0);
  });
});

describe('getInventoryItemQuantity', () => {
  it('reads the stored quantity', () => {
    const data: Object13PlayerProfileDataV1 = { inventory: { items: { bulb: 7 } } };
    expect(getInventoryItemQuantity(data, 'bulb')).toBe(7);
  });

  it('missing key reads as 0, not undefined', () => {
    const data: Object13PlayerProfileDataV1 = { inventory: { items: {} } };
    expect(getInventoryItemQuantity(data, 'bulb')).toBe(0);
  });
});

describe('normalizeInventoryQuantity', () => {
  it('clamps below minimum up to the minimum', () => {
    expect(normalizeInventoryQuantity('bulb', -5)).toBe(0);
  });

  it('clamps above maximum down to the maximum', () => {
    expect(normalizeInventoryQuantity('bulb', 10_000)).toBe(999);
  });

  it('passes an in-range integer through unchanged', () => {
    expect(normalizeInventoryQuantity('bulb', 42)).toBe(42);
  });

  it('a non-integer falls back to the registry default', () => {
    expect(normalizeInventoryQuantity('bulb', 1.5)).toBe(10);
    expect(normalizeInventoryQuantity('bulb', 'not a number')).toBe(10);
  });
});

describe('addInventoryItem', () => {
  it('9. increases the quantity by amount', () => {
    const data: Object13PlayerProfileDataV1 = { inventory: { items: { bulb: 5 } } };
    const result = addInventoryItem(data, 'bulb', 3);
    expect(result).toEqual({ ok: true, profileData: { inventory: { items: { bulb: 8 } } } });
  });

  it('12. rejects an add that would exceed the maximum', () => {
    const data: Object13PlayerProfileDataV1 = { inventory: { items: { bulb: 998 } } };
    const result = addInventoryItem(data, 'bulb', 5);
    expect(result).toEqual({ ok: false, error: 'exceeds_maximum' });
  });

  it('accepts an add that lands exactly on the maximum', () => {
    const data: Object13PlayerProfileDataV1 = { inventory: { items: { bulb: 998 } } };
    const result = addInventoryItem(data, 'bulb', 1);
    expect(result).toEqual({ ok: true, profileData: { inventory: { items: { bulb: 999 } } } });
  });

  it('does not mutate the input profileData', () => {
    const data: Object13PlayerProfileDataV1 = { inventory: { items: { bulb: 5 } } };
    addInventoryItem(data, 'bulb', 3);
    expect(data.inventory.items.bulb).toBe(5);
  });
});

describe('consumeInventoryItem', () => {
  it('10. decreases the quantity by amount', () => {
    const data: Object13PlayerProfileDataV1 = { inventory: { items: { bulb: 5 } } };
    const result = consumeInventoryItem(data, 'bulb', 2);
    expect(result).toEqual({ ok: true, profileData: { inventory: { items: { bulb: 3 } } } });
  });

  it('11. rejects a consume that would go below zero', () => {
    const data: Object13PlayerProfileDataV1 = { inventory: { items: { bulb: 1 } } };
    const result = consumeInventoryItem(data, 'bulb', 2);
    expect(result).toEqual({ ok: false, error: 'insufficient_inventory' });
  });

  it('accepts a consume that lands exactly on zero', () => {
    const data: Object13PlayerProfileDataV1 = { inventory: { items: { bulb: 2 } } };
    const result = consumeInventoryItem(data, 'bulb', 2);
    expect(result).toEqual({ ok: true, profileData: { inventory: { items: { bulb: 0 } } } });
  });

  it('does not mutate the input profileData', () => {
    const data: Object13PlayerProfileDataV1 = { inventory: { items: { bulb: 5 } } };
    consumeInventoryItem(data, 'bulb', 2);
    expect(data.inventory.items.bulb).toBe(5);
  });
});
