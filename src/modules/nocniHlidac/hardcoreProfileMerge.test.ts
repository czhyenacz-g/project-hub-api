import { describe, expect, it } from 'vitest';
import {
  HARDCORE_BEST_NIGHT_MAX,
  HARDCORE_DEATHS_BY_NIGHT_COUNT_MAX,
  HARDCORE_MONSTER_DEFEATS_MAX,
  clampHardcoreInt,
  mergeHardcoreDeathsByNight,
  mergeHardcoreProfileSnapshot,
  sanitizeHardcoreDeathsByNight,
  HardcoreProfileSnapshot,
} from './hardcoreProfileMerge.js';

const ZERO: HardcoreProfileSnapshot = {
  hardcoreHasDefeatedMonster: false,
  hardcoreDoubleBarrelUnlocked: false,
  hardcoreMonsterDefeatsCount: 0,
  hardcoreBestNight: 0,
  hardcoreDeathsByNight: {},
};

describe('clampHardcoreInt', () => {
  it('clamps negative values to 0', () => {
    expect(clampHardcoreInt(-5, 100)).toBe(0);
  });

  it('clamps NaN/Infinity to 0', () => {
    expect(clampHardcoreInt(NaN, 100)).toBe(0);
    expect(clampHardcoreInt(Infinity, 100)).toBe(0);
    expect(clampHardcoreInt(-Infinity, 100)).toBe(0);
  });

  it('floors non-integer values', () => {
    expect(clampHardcoreInt(3.9, 100)).toBe(3);
  });

  it('clamps values above max down to max', () => {
    expect(clampHardcoreInt(999, 100)).toBe(100);
  });

  it('passes valid in-range integers through unchanged', () => {
    expect(clampHardcoreInt(42, 100)).toBe(42);
  });
});

describe('mergeHardcoreProfileSnapshot — boolean OR', () => {
  it('true incoming sets a false existing to true', () => {
    const merged = mergeHardcoreProfileSnapshot(ZERO, { ...ZERO, hardcoreHasDefeatedMonster: true });
    expect(merged.hardcoreHasDefeatedMonster).toBe(true);
  });

  it('false incoming never lowers a true existing back to false', () => {
    const existing: HardcoreProfileSnapshot = { ...ZERO, hardcoreHasDefeatedMonster: true, hardcoreDoubleBarrelUnlocked: true };
    const merged = mergeHardcoreProfileSnapshot(existing, ZERO);
    expect(merged.hardcoreHasDefeatedMonster).toBe(true);
    expect(merged.hardcoreDoubleBarrelUnlocked).toBe(true);
  });

  it('hardcoreDoubleBarrelUnlocked follows the same OR rule independently', () => {
    const merged = mergeHardcoreProfileSnapshot(ZERO, { ...ZERO, hardcoreDoubleBarrelUnlocked: true });
    expect(merged.hardcoreDoubleBarrelUnlocked).toBe(true);
    expect(merged.hardcoreHasDefeatedMonster).toBe(false);
  });
});

describe('mergeHardcoreProfileSnapshot — numeric max, never sum', () => {
  it('a higher incoming value replaces a lower existing value', () => {
    const existing: HardcoreProfileSnapshot = { ...ZERO, hardcoreMonsterDefeatsCount: 3 };
    const merged = mergeHardcoreProfileSnapshot(existing, { ...ZERO, hardcoreMonsterDefeatsCount: 7 });
    expect(merged.hardcoreMonsterDefeatsCount).toBe(7);
  });

  it('a lower incoming value never lowers a higher existing value', () => {
    const existing: HardcoreProfileSnapshot = { ...ZERO, hardcoreMonsterDefeatsCount: 3 };
    const merged = mergeHardcoreProfileSnapshot(existing, { ...ZERO, hardcoreMonsterDefeatsCount: 1 });
    expect(merged.hardcoreMonsterDefeatsCount).toBe(3);
  });

  it('never sums two syncs of the same snapshot (idempotent)', () => {
    const existing: HardcoreProfileSnapshot = { ...ZERO, hardcoreMonsterDefeatsCount: 5 };
    const incoming: HardcoreProfileSnapshot = { ...ZERO, hardcoreMonsterDefeatsCount: 5 };
    const merged = mergeHardcoreProfileSnapshot(existing, incoming);
    expect(merged.hardcoreMonsterDefeatsCount).toBe(5);
  });

  it('hardcoreBestNight follows the same max rule independently', () => {
    const existing: HardcoreProfileSnapshot = { ...ZERO, hardcoreBestNight: 10 };
    expect(mergeHardcoreProfileSnapshot(existing, { ...ZERO, hardcoreBestNight: 5 }).hardcoreBestNight).toBe(10);
    expect(mergeHardcoreProfileSnapshot(existing, { ...ZERO, hardcoreBestNight: 15 }).hardcoreBestNight).toBe(15);
  });
});

describe('mergeHardcoreProfileSnapshot — clamp limits (defense in depth)', () => {
  it('clamps hardcoreMonsterDefeatsCount at HARDCORE_MONSTER_DEFEATS_MAX even if inputs exceed it', () => {
    const merged = mergeHardcoreProfileSnapshot(ZERO, { ...ZERO, hardcoreMonsterDefeatsCount: HARDCORE_MONSTER_DEFEATS_MAX + 1000 });
    expect(merged.hardcoreMonsterDefeatsCount).toBe(HARDCORE_MONSTER_DEFEATS_MAX);
  });

  it('clamps hardcoreBestNight at HARDCORE_BEST_NIGHT_MAX even if inputs exceed it', () => {
    const merged = mergeHardcoreProfileSnapshot(ZERO, { ...ZERO, hardcoreBestNight: HARDCORE_BEST_NIGHT_MAX + 1000 });
    expect(merged.hardcoreBestNight).toBe(HARDCORE_BEST_NIGHT_MAX);
  });

  it('preserves an existing OR/max merge for booleans and hardcoreBestNight when hardcoreDeathsByNight is also present', () => {
    const existing: HardcoreProfileSnapshot = {
      ...ZERO,
      hardcoreHasDefeatedMonster: true,
      hardcoreBestNight: 9,
      hardcoreDeathsByNight: { '1': 2 },
    };
    const merged = mergeHardcoreProfileSnapshot(existing, {
      ...ZERO,
      hardcoreHasDefeatedMonster: false,
      hardcoreBestNight: 3,
      hardcoreDeathsByNight: { '2': 5 },
    });
    expect(merged.hardcoreHasDefeatedMonster).toBe(true);
    expect(merged.hardcoreBestNight).toBe(9);
  });
});

describe('sanitizeHardcoreDeathsByNight', () => {
  it('default profile equivalent (empty input) is {}', () => {
    expect(sanitizeHardcoreDeathsByNight({})).toEqual({});
  });

  it('null/string/array instead of object becomes {}', () => {
    expect(sanitizeHardcoreDeathsByNight(null)).toEqual({});
    expect(sanitizeHardcoreDeathsByNight('nope')).toEqual({});
    expect(sanitizeHardcoreDeathsByNight([1, 2, 3])).toEqual({});
    expect(sanitizeHardcoreDeathsByNight(undefined)).toEqual({});
  });

  it('ignores invalid night keys (0, negative, non-numeric)', () => {
    const result = sanitizeHardcoreDeathsByNight({ '0': 5, '-1': 3, abc: 2, '1': 1 });
    expect(result).toEqual({ '1': 1 });
  });

  it('ignores a negative count', () => {
    expect(sanitizeHardcoreDeathsByNight({ '1': -5 })).toEqual({});
  });

  it('ignores a non-numeric count', () => {
    expect(sanitizeHardcoreDeathsByNight({ '1': 'lots' })).toEqual({});
  });

  it('clamps an extreme count to HARDCORE_DEATHS_BY_NIGHT_COUNT_MAX', () => {
    expect(sanitizeHardcoreDeathsByNight({ '1': 999_999_999 })).toEqual({ '1': HARDCORE_DEATHS_BY_NIGHT_COUNT_MAX });
  });
});

describe('mergeHardcoreDeathsByNight — per-night max merge', () => {
  it('matches the exact example from the spec', () => {
    const existing = { '1': 2, '3': 1 };
    const incoming = { '1': 1, '2': 4 };
    expect(mergeHardcoreDeathsByNight(existing, incoming)).toEqual({ '1': 2, '2': 4, '3': 1 });
  });

  it('a first sync of { "1": 1 } stores { "1": 1 }', () => {
    expect(mergeHardcoreDeathsByNight({}, { '1': 1 })).toEqual({ '1': 1 });
  });

  it('a second sync of { "1": 2 } after existing { "1": 1 } raises it to { "1": 2 }', () => {
    expect(mergeHardcoreDeathsByNight({ '1': 1 }, { '1': 2 })).toEqual({ '1': 2 });
  });

  it('a sync of { "1": 1 } after existing { "1": 2 } never lowers it', () => {
    expect(mergeHardcoreDeathsByNight({ '1': 2 }, { '1': 1 })).toEqual({ '1': 2 });
  });

  it('a sync of { "2": 3 } adds a new night without touching night 1', () => {
    expect(mergeHardcoreDeathsByNight({ '1': 1 }, { '2': 3 })).toEqual({ '1': 1, '2': 3 });
  });

  it('never sums two syncs of the same snapshot (idempotent)', () => {
    expect(mergeHardcoreDeathsByNight({ '1': 4 }, { '1': 4 })).toEqual({ '1': 4 });
  });
});
