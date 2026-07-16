import { describe, expect, it } from 'vitest';
import {
  DiscordSnowflakeIdSchema,
  Object13PlayerProfileGetQuerySchema,
  parseObject13PlayerProfileInventoryOperation,
  parseObject13PlayerProfileSyncEnvelope,
  parseObject13PlayerProfileWeaponOperation,
  validateObject13PlayerProfileDataV1,
  validateObject13PlayerProfileDataV2,
} from './playerProfileValidation.js';
import { OBJECT13_INVENTORY_ITEM_REGISTRY, OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES } from './playerProfileInventory.js';

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

const VALID_V1_DATA = { inventory: { items: { bulb: 10 } } };

describe('parseObject13PlayerProfileSyncEnvelope', () => {
  const valid = {
    discordUserId: '123456789012345678',
    expectedRevision: 1,
    profileVersion: 1,
    profileData: VALID_V1_DATA,
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

  it('lets a missing profileData key through as undefined at the envelope level — validateObject13PlayerProfileDataV1 rejects it downstream (see below)', () => {
    const { profileData: _omit, ...withoutProfileData } = valid;
    const result = parseObject13PlayerProfileSyncEnvelope(withoutProfileData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(validateObject13PlayerProfileDataV1(result.data.profileData).ok).toBe(false);
    }
  });
});

describe('parseObject13PlayerProfileInventoryOperation', () => {
  const valid = { discordUserId: '123456789012345678', amount: 1, expectedRevision: 1 };

  it('accepts a well-formed body', () => {
    expect(parseObject13PlayerProfileInventoryOperation(valid).success).toBe(true);
  });

  it('rejects amount <= 0', () => {
    expect(parseObject13PlayerProfileInventoryOperation({ ...valid, amount: 0 }).success).toBe(false);
    expect(parseObject13PlayerProfileInventoryOperation({ ...valid, amount: -1 }).success).toBe(false);
  });

  it('rejects a non-integer amount', () => {
    expect(parseObject13PlayerProfileInventoryOperation({ ...valid, amount: 1.5 }).success).toBe(false);
  });

  it('rejects expectedRevision <= 0', () => {
    expect(parseObject13PlayerProfileInventoryOperation({ ...valid, expectedRevision: 0 }).success).toBe(false);
  });

  it('rejects an invalid discordUserId', () => {
    expect(parseObject13PlayerProfileInventoryOperation({ ...valid, discordUserId: 'not-a-snowflake' }).success).toBe(false);
  });
});

describe('validateObject13PlayerProfileDataV1', () => {
  it('1. accepts a well-formed profile with the bulb item', () => {
    const result = validateObject13PlayerProfileDataV1(VALID_V1_DATA);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(VALID_V1_DATA);
  });

  it('accepts an empty items object (no items at all is a valid, if unusual, V1 profile)', () => {
    const result = validateObject13PlayerProfileDataV1({ inventory: { items: {} } });
    expect(result.ok).toBe(true);
  });

  it('rejects null/array/string/number/boolean', () => {
    expect(validateObject13PlayerProfileDataV1(null).ok).toBe(false);
    expect(validateObject13PlayerProfileDataV1([]).ok).toBe(false);
    expect(validateObject13PlayerProfileDataV1('x').ok).toBe(false);
    expect(validateObject13PlayerProfileDataV1(42).ok).toBe(false);
    expect(validateObject13PlayerProfileDataV1(true).ok).toBe(false);
  });

  it('5. rejects an unknown top-level key (e.g. an old free-form field)', () => {
    const result = validateObject13PlayerProfileDataV1({ inventory: { items: { bulb: 10 } }, totalDeaths: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_top_level_key');
  });

  it('rejects a legacy empty object {} (missing inventory)', () => {
    const result = validateObject13PlayerProfileDataV1({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('missing_inventory');
  });

  it('rejects inventory that is not an object', () => {
    expect(validateObject13PlayerProfileDataV1({ inventory: 'nope' }).ok).toBe(false);
    expect(validateObject13PlayerProfileDataV1({ inventory: [] }).ok).toBe(false);
  });

  it('rejects an unknown key inside inventory', () => {
    const result = validateObject13PlayerProfileDataV1({ inventory: { items: {}, extra: 1 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_inventory_key');
  });

  it('rejects items that is not an object', () => {
    expect(validateObject13PlayerProfileDataV1({ inventory: { items: 'nope' } }).ok).toBe(false);
    expect(validateObject13PlayerProfileDataV1({ inventory: { items: [1, 2] } }).ok).toBe(false);
  });

  it('6. rejects an unknown item id', () => {
    const result = validateObject13PlayerProfileDataV1({ inventory: { items: { shotgun: 1 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_item_id');
  });

  it('rejects a non-integer bulb quantity', () => {
    const result = validateObject13PlayerProfileDataV1({ inventory: { items: { bulb: 1.5 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_quantity');
  });

  it('3. rejects a negative bulb quantity', () => {
    const result = validateObject13PlayerProfileDataV1({ inventory: { items: { bulb: -1 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('quantity_out_of_range');
  });

  it('4. rejects a bulb quantity above the registry maximum', () => {
    const over = OBJECT13_INVENTORY_ITEM_REGISTRY.bulb.maxQuantity + 1;
    const result = validateObject13PlayerProfileDataV1({ inventory: { items: { bulb: over } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('quantity_out_of_range');
  });

  it('accepts a bulb quantity right at the registry maximum', () => {
    const result = validateObject13PlayerProfileDataV1({ inventory: { items: { bulb: OBJECT13_INVENTORY_ITEM_REGISTRY.bulb.maxQuantity } } });
    expect(result.ok).toBe(true);
  });

  it('a top-level __proto__ key is rejected as an unknown top-level key, never reaches a dangerous-key path', () => {
    const raw = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    const result = validateObject13PlayerProfileDataV1(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_top_level_key');
  });

  it('stays well under the size limit for any realistic inventory', () => {
    expect(JSON.stringify(VALID_V1_DATA).length).toBeLessThan(OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES);
  });
});

describe('parseObject13PlayerProfileWeaponOperation', () => {
  const valid = { discordUserId: '123456789012345678', weaponId: 'single_shotgun', expectedRevision: 1 };

  it('accepts a well-formed body', () => {
    expect(parseObject13PlayerProfileWeaponOperation(valid).success).toBe(true);
  });

  it('rejects a missing/empty weaponId', () => {
    expect(parseObject13PlayerProfileWeaponOperation({ ...valid, weaponId: '' }).success).toBe(false);
    const { weaponId: _omit, ...withoutWeaponId } = valid;
    expect(parseObject13PlayerProfileWeaponOperation(withoutWeaponId).success).toBe(false);
  });

  it('rejects expectedRevision <= 0', () => {
    expect(parseObject13PlayerProfileWeaponOperation({ ...valid, expectedRevision: 0 }).success).toBe(false);
  });

  it('rejects an invalid discordUserId', () => {
    expect(parseObject13PlayerProfileWeaponOperation({ ...valid, discordUserId: 'not-a-snowflake' }).success).toBe(false);
  });
});

const VALID_V2_DATA = { inventory: { items: { bulb: 10 } }, equipment: { ownedWeapons: [], equippedWeaponId: null } };

describe('validateObject13PlayerProfileDataV2', () => {
  it('accepts a well-formed empty-equipment profile', () => {
    const result = validateObject13PlayerProfileDataV2(VALID_V2_DATA);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(VALID_V2_DATA);
  });

  it('accepts a profile with owned + equipped weapons', () => {
    const data = {
      inventory: { items: { bulb: 5 } },
      equipment: { ownedWeapons: ['single_shotgun', 'double_barrel_shotgun'], equippedWeaponId: 'double_barrel_shotgun' },
    };
    expect(validateObject13PlayerProfileDataV2(data).ok).toBe(true);
  });

  it('rejects null/array/primitive', () => {
    expect(validateObject13PlayerProfileDataV2(null).ok).toBe(false);
    expect(validateObject13PlayerProfileDataV2([]).ok).toBe(false);
    expect(validateObject13PlayerProfileDataV2('x').ok).toBe(false);
  });

  it('rejects a legacy V1 shape (missing equipment)', () => {
    const result = validateObject13PlayerProfileDataV2({ inventory: { items: { bulb: 10 } } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('missing_equipment');
  });

  it('rejects a legacy empty {} object entirely', () => {
    const result = validateObject13PlayerProfileDataV2({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('missing_inventory');
  });

  it('rejects an unknown top-level key', () => {
    const result = validateObject13PlayerProfileDataV2({ ...VALID_V2_DATA, extra: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_top_level_key');
  });

  it('rejects invalid inventory the same way V1 does', () => {
    const result = validateObject13PlayerProfileDataV2({ inventory: { items: { bulb: -1 } }, equipment: { ownedWeapons: [], equippedWeaponId: null } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('quantity_out_of_range');
  });

  it('rejects invalid equipment, wrapping the underlying equipment error', () => {
    const result = validateObject13PlayerProfileDataV2({
      inventory: { items: { bulb: 5 } },
      equipment: { ownedWeapons: ['rocket_launcher'], equippedWeaponId: null },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('equipment_invalid');
      if (result.error.code === 'equipment_invalid') expect(result.error.error.code).toBe('unknown_weapon_id');
    }
  });

  it('a top-level __proto__ key is rejected as an unknown key', () => {
    const raw = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    const result = validateObject13PlayerProfileDataV2(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_top_level_key');
  });
});
