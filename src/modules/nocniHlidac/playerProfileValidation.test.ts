import { describe, expect, it } from 'vitest';
import { OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES } from './playerProfileTypes.js';
import {
  DiscordSnowflakeIdSchema,
  Object13PlayerProfileGetQuerySchema,
  parseObject13PlayerProfileSyncEnvelope,
  validateObject13PlayerProfileData,
} from './playerProfileValidation.js';

describe('DiscordSnowflakeIdSchema', () => {
  it('accepts a realistic 18-digit snowflake', () => {
    expect(DiscordSnowflakeIdSchema.safeParse('123456789012345678').success).toBe(true);
  });

  it('accepts the documented min (17) and max (20) digit lengths', () => {
    expect(DiscordSnowflakeIdSchema.safeParse('1'.repeat(17)).success).toBe(true);
    expect(DiscordSnowflakeIdSchema.safeParse('1'.repeat(20)).success).toBe(true);
  });

  it('rejects too short (16 digits) and too long (21 digits)', () => {
    expect(DiscordSnowflakeIdSchema.safeParse('1'.repeat(16)).success).toBe(false);
    expect(DiscordSnowflakeIdSchema.safeParse('1'.repeat(21)).success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(DiscordSnowflakeIdSchema.safeParse('').success).toBe(false);
  });

  it('rejects non-numeric characters', () => {
    expect(DiscordSnowflakeIdSchema.safeParse('12345678901234567a').success).toBe(false);
    expect(DiscordSnowflakeIdSchema.safeParse('seed-strazny-novak').success).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(DiscordSnowflakeIdSchema.safeParse(123456789012345678).success).toBe(false);
    expect(DiscordSnowflakeIdSchema.safeParse(null).success).toBe(false);
    expect(DiscordSnowflakeIdSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('Object13PlayerProfileGetQuerySchema', () => {
  it('accepts a valid discordUserId query', () => {
    expect(Object13PlayerProfileGetQuerySchema.safeParse({ discordUserId: '123456789012345678' }).success).toBe(true);
  });

  it('rejects a missing discordUserId', () => {
    expect(Object13PlayerProfileGetQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe('parseObject13PlayerProfileSyncEnvelope', () => {
  const valid = {
    discordUserId: '123456789012345678',
    expectedRevision: 1,
    profileVersion: 1,
    profileData: {},
  };

  it('accepts a well-formed envelope', () => {
    expect(parseObject13PlayerProfileSyncEnvelope(valid).success).toBe(true);
  });

  it('strips unknown top-level fields instead of storing them', () => {
    const result = parseObject13PlayerProfileSyncEnvelope({ ...valid, totalDeaths: 999, admin: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(valid);
      expect('totalDeaths' in result.data).toBe(false);
      expect('admin' in result.data).toBe(false);
    }
  });

  it('rejects a non-numeric discordUserId', () => {
    expect(parseObject13PlayerProfileSyncEnvelope({ ...valid, discordUserId: 'not-a-snowflake' }).success).toBe(false);
  });

  it('rejects expectedRevision <= 0', () => {
    expect(parseObject13PlayerProfileSyncEnvelope({ ...valid, expectedRevision: 0 }).success).toBe(false);
    expect(parseObject13PlayerProfileSyncEnvelope({ ...valid, expectedRevision: -1 }).success).toBe(false);
  });

  it('rejects a non-integer expectedRevision', () => {
    expect(parseObject13PlayerProfileSyncEnvelope({ ...valid, expectedRevision: 1.5 }).success).toBe(false);
  });

  it('rejects profileVersion <= 0', () => {
    expect(parseObject13PlayerProfileSyncEnvelope({ ...valid, profileVersion: 0 }).success).toBe(false);
  });

  it('lets a missing profileData key through as undefined at the envelope level — validateObject13PlayerProfileData rejects it downstream (see below)', () => {
    const { profileData: _omit, ...withoutProfileData } = valid;
    const result = parseObject13PlayerProfileSyncEnvelope(withoutProfileData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(validateObject13PlayerProfileData(result.data.profileData).ok).toBe(false);
    }
  });
});

describe('validateObject13PlayerProfileData', () => {
  it('accepts an empty object', () => {
    const result = validateObject13PlayerProfileData({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({});
  });

  it('accepts a small nested plain object', () => {
    const result = validateObject13PlayerProfileData({ a: 1, b: { c: 'x' }, d: [1, 2, 3] });
    expect(result.ok).toBe(true);
  });

  it('rejects null', () => {
    const result = validateObject13PlayerProfileData(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_object');
  });

  it('rejects an array', () => {
    const result = validateObject13PlayerProfileData([1, 2, 3]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_object');
  });

  it('rejects a string/number/boolean', () => {
    expect(validateObject13PlayerProfileData('x').ok).toBe(false);
    expect(validateObject13PlayerProfileData(42).ok).toBe(false);
    expect(validateObject13PlayerProfileData(true).ok).toBe(false);
  });

  it('rejects a top-level __proto__ key', () => {
    const raw = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    const result = validateObject13PlayerProfileData(raw);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'dangerous_key') expect(result.error.key).toBe('__proto__');
  });

  it('rejects a nested constructor key', () => {
    const result = validateObject13PlayerProfileData({ a: { b: { constructor: 'x' } } });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'dangerous_key') expect(result.error.key).toBe('constructor');
  });

  it('rejects a dangerous key inside an array element', () => {
    const result = validateObject13PlayerProfileData({ list: [{ prototype: 'x' }] });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === 'dangerous_key') expect(result.error.key).toBe('prototype');
  });

  it('allows a key that merely contains "proto" as a substring (not an exact dangerous key)', () => {
    const result = validateObject13PlayerProfileData({ myProtoField: 1 });
    expect(result.ok).toBe(true);
  });

  it('accepts data right at the size limit', () => {
    // Account for the {"padding":""} wrapper (14 bytes) so the total is
    // exactly at the boundary, not over it.
    const overhead = JSON.stringify({ padding: '' }).length;
    const padding = 'x'.repeat(OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES - overhead);
    const result = validateObject13PlayerProfileData({ padding });
    expect(result.ok).toBe(true);
  });

  it('rejects data one byte over the size limit', () => {
    const overhead = JSON.stringify({ padding: '' }).length;
    const padding = 'x'.repeat(OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES - overhead + 1);
    const result = validateObject13PlayerProfileData({ padding });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too_large');
  });
});
