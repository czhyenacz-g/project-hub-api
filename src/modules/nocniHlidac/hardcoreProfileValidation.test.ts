import { describe, expect, it } from 'vitest';
import {
  HardcoreProfileGetQuerySchema,
  HardcoreProfileSyncIdentitySchema,
  sanitizeIncomingHardcoreSnapshot,
} from './hardcoreProfileValidation.js';

describe('HardcoreProfileGetQuerySchema', () => {
  it('accepts a non-empty discordUserId', () => {
    expect(HardcoreProfileGetQuerySchema.safeParse({ discordUserId: '123' }).success).toBe(true);
  });

  it('rejects a missing or empty discordUserId', () => {
    expect(HardcoreProfileGetQuerySchema.safeParse({}).success).toBe(false);
    expect(HardcoreProfileGetQuerySchema.safeParse({ discordUserId: '' }).success).toBe(false);
  });
});

describe('HardcoreProfileSyncIdentitySchema', () => {
  it('accepts discordUserId alone (displayName/avatarUrl optional)', () => {
    expect(HardcoreProfileSyncIdentitySchema.safeParse({ discordUserId: '123' }).success).toBe(true);
  });

  it('accepts null displayName/avatarUrl', () => {
    expect(HardcoreProfileSyncIdentitySchema.safeParse({ discordUserId: '123', displayName: null, avatarUrl: null }).success).toBe(
      true,
    );
  });

  it('rejects a missing or empty discordUserId', () => {
    expect(HardcoreProfileSyncIdentitySchema.safeParse({}).success).toBe(false);
    expect(HardcoreProfileSyncIdentitySchema.safeParse({ discordUserId: '' }).success).toBe(false);
  });
});

describe('sanitizeIncomingHardcoreSnapshot', () => {
  it('reads all five known hardcore fields when valid', () => {
    const snapshot = sanitizeIncomingHardcoreSnapshot({
      hardcoreHasDefeatedMonster: true,
      hardcoreDoubleBarrelUnlocked: true,
      hardcoreMonsterDefeatsCount: 3,
      hardcoreBestNight: 7,
      hardcoreDeathsByNight: { '1': 2 },
    });
    expect(snapshot).toEqual({
      hardcoreHasDefeatedMonster: true,
      hardcoreDoubleBarrelUnlocked: true,
      hardcoreMonsterDefeatsCount: 3,
      hardcoreBestNight: 7,
      hardcoreDeathsByNight: { '1': 2 },
    });
  });

  it('defaults to a safe zero snapshot for non-object input (null, array, primitive)', () => {
    const empty = {
      hardcoreHasDefeatedMonster: false,
      hardcoreDoubleBarrelUnlocked: false,
      hardcoreMonsterDefeatsCount: 0,
      hardcoreBestNight: 0,
      hardcoreDeathsByNight: {},
    };
    expect(sanitizeIncomingHardcoreSnapshot(null)).toEqual(empty);
    expect(sanitizeIncomingHardcoreSnapshot(undefined)).toEqual(empty);
    expect(sanitizeIncomingHardcoreSnapshot('not an object')).toEqual(empty);
    expect(sanitizeIncomingHardcoreSnapshot(42)).toEqual(empty);
  });

  it('booleans: a non-boolean value silently becomes false, never rejects', () => {
    const snapshot = sanitizeIncomingHardcoreSnapshot({
      hardcoreHasDefeatedMonster: 'true',
      hardcoreDoubleBarrelUnlocked: 1,
    });
    expect(snapshot.hardcoreHasDefeatedMonster).toBe(false);
    expect(snapshot.hardcoreDoubleBarrelUnlocked).toBe(false);
  });

  it('numbers: negative values are clamped to 0, never stored as negative', () => {
    const snapshot = sanitizeIncomingHardcoreSnapshot({ hardcoreMonsterDefeatsCount: -5, hardcoreBestNight: -1 });
    expect(snapshot.hardcoreMonsterDefeatsCount).toBe(0);
    expect(snapshot.hardcoreBestNight).toBe(0);
  });

  it('numbers: NaN/Infinity/string are ignored and default to 0', () => {
    expect(sanitizeIncomingHardcoreSnapshot({ hardcoreBestNight: NaN }).hardcoreBestNight).toBe(0);
    expect(sanitizeIncomingHardcoreSnapshot({ hardcoreBestNight: Infinity }).hardcoreBestNight).toBe(0);
    expect(sanitizeIncomingHardcoreSnapshot({ hardcoreBestNight: '10' }).hardcoreBestNight).toBe(0);
  });

  it('numbers: extreme values are clamped to the documented max', () => {
    expect(sanitizeIncomingHardcoreSnapshot({ hardcoreMonsterDefeatsCount: 999_999_999 }).hardcoreMonsterDefeatsCount).toBe(100_000);
    expect(sanitizeIncomingHardcoreSnapshot({ hardcoreBestNight: 999_999_999 }).hardcoreBestNight).toBe(10_000);
  });

  it('ignores unknown fields and Normal-mode-like fields entirely', () => {
    const snapshot = sanitizeIncomingHardcoreSnapshot({
      hardcoreBestNight: 4,
      totalDeaths: 999,
      totalRunsStarted: 999,
      totalNightsSurvived: 999,
      bulbsReplaced: 999,
      generatorsRestarted: 999,
      expeditionsStarted: 999,
      expeditionsReturned: 999,
      monsterHitsConfirmed: 999,
      monsterKills: 999,
      someRandomUnknownField: 'whatever',
    });
    expect(snapshot).toEqual({
      hardcoreHasDefeatedMonster: false,
      hardcoreDoubleBarrelUnlocked: false,
      hardcoreMonsterDefeatsCount: 0,
      hardcoreBestNight: 4,
      hardcoreDeathsByNight: {},
    });
  });

  it('reads hardcoreDeathsByNight and keeps only valid per-night entries', () => {
    const snapshot = sanitizeIncomingHardcoreSnapshot({
      hardcoreDeathsByNight: { '1': 2, '0': 5, '-1': 3, abc: 1, '2': -4, '3': 'lots' },
    });
    expect(snapshot.hardcoreDeathsByNight).toEqual({ '1': 2 });
  });

  it('ignores a Normal death histogram field name — only hardcoreDeathsByNight is ever read', () => {
    const snapshot = sanitizeIncomingHardcoreSnapshot({
      deathsByNight: { '1': 999 },
      normalDeathsByNight: { '1': 999 },
    });
    expect(snapshot.hardcoreDeathsByNight).toEqual({});
  });
});
