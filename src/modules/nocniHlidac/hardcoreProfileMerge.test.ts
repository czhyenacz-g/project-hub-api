import { describe, expect, it } from 'vitest';
import {
  HARDCORE_BEST_NIGHT_MAX,
  HARDCORE_MONSTER_DEFEATS_MAX,
  clampHardcoreInt,
  mergeHardcoreProfileSnapshot,
  HardcoreProfileSnapshot,
} from './hardcoreProfileMerge.js';

const ZERO: HardcoreProfileSnapshot = {
  hardcoreHasDefeatedMonster: false,
  hardcoreDoubleBarrelUnlocked: false,
  hardcoreMonsterDefeatsCount: 0,
  hardcoreBestNight: 0,
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
});
