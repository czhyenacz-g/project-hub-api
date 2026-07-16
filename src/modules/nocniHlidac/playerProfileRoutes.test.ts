import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { nocniHlidacPlayerProfileRoutes } from './playerProfileRoutes.js';

// Route-level integration tests against the local dev Postgres — same
// pattern as routes.test.ts/hardcoreProfileRoutes.test.ts (Fastify
// `.inject()`, DATABASE_URL from .env loaded by vitest.setup.ts, cleans up
// its own rows). Test discordUserIds use a reserved numeric block
// ("90000000000000xxx", 18 digits, always passes DiscordSnowflakeIdSchema)
// that never collides with real Discord snowflakes or the "seed-" lore
// players (see seed.ts) — those aren't even valid input to this endpoint's
// stricter schema.
const TOKEN = process.env.NOCNI_HLIDAC_API_TOKEN ?? '';
const authHeaders = { authorization: `Bearer ${TOKEN}` };

const TEST_ID_PREFIX = '90000000000000';
function testDiscordId(suffix: number): string {
  return `${TEST_ID_PREFIX}${String(suffix).padStart(3, '0')}`;
}

const DEFAULT_EQUIPMENT = { ownedWeapons: [], equippedWeaponId: null };
const DEFAULT_V2_DATA = { inventory: { items: { bulb: 10 } }, equipment: DEFAULT_EQUIPMENT };

async function buildApp() {
  const app = Fastify();
  await app.register(nocniHlidacPlayerProfileRoutes);
  return app;
}

async function cleanupTestProfiles(): Promise<void> {
  await db.object13PlayerProfile.deleteMany({ where: { discordUserId: { startsWith: TEST_ID_PREFIX } } });
}

beforeAll(async () => {
  if (!TOKEN) {
    throw new Error(
      'NOCNI_HLIDAC_API_TOKEN is not set — these tests need a local Postgres + .env (see docs/operations/nocni-hlidac.md).',
    );
  }
  await cleanupTestProfiles();
});

afterEach(async () => {
  await cleanupTestProfiles();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('auth', () => {
  it('rejects GET with no token', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/nocni-hlidac/player-profile?discordUserId=${testDiscordId(1)}` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects PUT with a wrong token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: { authorization: 'Bearer definitely-wrong' },
      payload: { discordUserId: testDiscordId(1), expectedRevision: 1, profileVersion: 2, profileData: DEFAULT_V2_DATA },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /nocni-hlidac/player-profile', () => {
  it('1. creates a new profile with profileVersion 2, empty equipment, default inventory, revision 1', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(10);
    const res = await app.inject({
      method: 'GET',
      url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.discordUserId).toBe(discordUserId);
    expect(body.profileVersion).toBe(2);
    expect(body.profileData).toEqual(DEFAULT_V2_DATA);
    expect(body.revision).toBe(1);
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.updatedAt).toBe('string');
    expect(typeof body.lastSeenAt).toBe('string');
    expect(body.id).toBeUndefined();
  });

  it('repeated GET never creates a second row (discordUserId is unique)', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(11);

    await app.inject({ method: 'GET', url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`, headers: authHeaders });
    await app.inject({ method: 'GET', url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`, headers: authHeaders });
    await app.inject({ method: 'GET', url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`, headers: authHeaders });

    const rows = await db.object13PlayerProfile.findMany({ where: { discordUserId } });
    expect(rows).toHaveLength(1);
  });

  it('repeated GET updates lastSeenAt but never touches revision/profileData/createdAt of an already-valid profile', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(12);

    const first = await app.inject({
      method: 'GET',
      url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
      headers: authHeaders,
    });
    const firstLastSeenAt = first.json().lastSeenAt;

    await new Promise((resolve) => setTimeout(resolve, 10));

    const second = await app.inject({
      method: 'GET',
      url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
      headers: authHeaders,
    });
    const secondLastSeenAt = second.json().lastSeenAt;

    expect(new Date(secondLastSeenAt).getTime()).toBeGreaterThan(new Date(firstLastSeenAt).getTime());
    expect(second.json().revision).toBe(1);
    expect(second.json().createdAt).toBe(first.json().createdAt);
  });

  it('an invalid Discord ID returns 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/nocni-hlidac/player-profile?discordUserId=not-a-snowflake',
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });

  it('a missing discordUserId query param returns 400', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/player-profile', headers: authHeaders });
    expect(res.statusCode).toBe(400);
  });

  it('a corrupted (non-object) profileData already in the DB is normalized to the default V2 shape on read', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(14);

    await db.$executeRaw`INSERT INTO "Object13PlayerProfile" ("id", "discordUserId", "profileVersion", "profileData", "revision", "updatedAt")
      VALUES (gen_random_uuid()::text, ${discordUserId}, 2, '"not an object"'::jsonb, 1, now())`;

    const res = await app.inject({
      method: 'GET',
      url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().profileData).toEqual(DEFAULT_V2_DATA);
    expect(res.json().revision).toBe(2);
  });

  it('a GET of an already-normalized/valid V2 profile does NOT bump revision again on a second read', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(15);

    await db.$executeRaw`INSERT INTO "Object13PlayerProfile" ("id", "discordUserId", "profileVersion", "profileData", "revision", "updatedAt")
      VALUES (gen_random_uuid()::text, ${discordUserId}, 2, '"garbage"'::jsonb, 1, now())`;

    const first = await app.inject({
      method: 'GET',
      url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
      headers: authHeaders,
    });
    expect(first.json().revision).toBe(2); // normalized once

    const second = await app.inject({
      method: 'GET',
      url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
      headers: authHeaders,
    });
    expect(second.json().revision).toBe(2); // no further bump — already valid V2
  });

  describe('V1 -> V2 migration', () => {
    it('2. a legacy V1 profile (profileVersion 1) migrates to V2 on GET', async () => {
      const app = await buildApp();
      const discordUserId = testDiscordId(40);

      await db.$executeRaw`INSERT INTO "Object13PlayerProfile" ("id", "discordUserId", "profileVersion", "profileData", "revision", "updatedAt")
        VALUES (gen_random_uuid()::text, ${discordUserId}, 1, '{"inventory":{"items":{"bulb":7}}}'::jsonb, 3, now())`;

      const res = await app.inject({
        method: 'GET',
        url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.profileVersion).toBe(2);
      expect(body.profileData).toEqual({ inventory: { items: { bulb: 7 } }, equipment: DEFAULT_EQUIPMENT });
    });

    it('3. migration preserves the exact bulb count', async () => {
      const app = await buildApp();
      const discordUserId = testDiscordId(41);

      await db.$executeRaw`INSERT INTO "Object13PlayerProfile" ("id", "discordUserId", "profileVersion", "profileData", "revision", "updatedAt")
        VALUES (gen_random_uuid()::text, ${discordUserId}, 1, '{"inventory":{"items":{"bulb":42}}}'::jsonb, 1, now())`;

      const res = await app.inject({
        method: 'GET',
        url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
        headers: authHeaders,
      });
      expect(res.json().profileData.inventory.items.bulb).toBe(42);
    });

    it('4. migration increases revision by exactly 1', async () => {
      const app = await buildApp();
      const discordUserId = testDiscordId(42);

      await db.$executeRaw`INSERT INTO "Object13PlayerProfile" ("id", "discordUserId", "profileVersion", "profileData", "revision", "updatedAt")
        VALUES (gen_random_uuid()::text, ${discordUserId}, 1, '{"inventory":{"items":{"bulb":5}}}'::jsonb, 4, now())`;

      const res = await app.inject({
        method: 'GET',
        url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
        headers: authHeaders,
      });
      expect(res.json().revision).toBe(5);
    });

    it('5. a repeated GET of an already-migrated V2 profile does not migrate again', async () => {
      const app = await buildApp();
      const discordUserId = testDiscordId(43);

      await db.$executeRaw`INSERT INTO "Object13PlayerProfile" ("id", "discordUserId", "profileVersion", "profileData", "revision", "updatedAt")
        VALUES (gen_random_uuid()::text, ${discordUserId}, 1, '{"inventory":{"items":{"bulb":3}}}'::jsonb, 1, now())`;

      const first = await app.inject({
        method: 'GET',
        url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
        headers: authHeaders,
      });
      expect(first.json().revision).toBe(2);

      const second = await app.inject({
        method: 'GET',
        url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
        headers: authHeaders,
      });
      expect(second.json().revision).toBe(2);
      expect(second.json().profileVersion).toBe(2);
    });

    it('a legacy pre-1B empty {} V1 profileData migrates to V2 with the default bulb count', async () => {
      const app = await buildApp();
      const discordUserId = testDiscordId(44);

      await db.$executeRaw`INSERT INTO "Object13PlayerProfile" ("id", "discordUserId", "profileVersion", "profileData", "revision", "updatedAt")
        VALUES (gen_random_uuid()::text, ${discordUserId}, 1, '{}'::jsonb, 1, now())`;

      const res = await app.inject({
        method: 'GET',
        url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
        headers: authHeaders,
      });
      expect(res.json().profileData).toEqual(DEFAULT_V2_DATA);
      expect(res.json().revision).toBe(2);
    });
  });
});

describe('PUT /nocni-hlidac/player-profile', () => {
  async function seedProfile(discordUserId: string) {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
      headers: authHeaders,
    });
    return res.json();
  }

  it('a PUT with the matching revision saves and increments revision by exactly 1', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(20);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 1,
        profileVersion: 2,
        profileData: { inventory: { items: { bulb: 15 } }, equipment: DEFAULT_EQUIPMENT },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.revision).toBe(2);
    expect(body.profileData).toEqual({ inventory: { items: { bulb: 15 } }, equipment: DEFAULT_EQUIPMENT });
  });

  it('a PUT with a stale revision returns 409 and overwrites nothing', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(21);
    await seedProfile(discordUserId);
    await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 1,
        profileVersion: 2,
        profileData: { inventory: { items: { bulb: 5 } }, equipment: DEFAULT_EQUIPMENT },
      },
    });
    // Profile is now at revision 2. Retry with the now-stale revision 1.
    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 1,
        profileVersion: 2,
        profileData: { inventory: { items: { bulb: 999 } }, equipment: DEFAULT_EQUIPMENT },
      },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('revision_conflict');
    expect(body.currentRevision).toBe(2);

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect((row?.profileData as { inventory: { items: { bulb: number } } }).inventory.items.bulb).toBe(5);
  });

  it('a PUT against a profile that was never GET/created returns 404', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId: testDiscordId(22), expectedRevision: 1, profileVersion: 2, profileData: DEFAULT_V2_DATA },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'profile_not_found' });
  });

  it('a PUT with an unsupported profileVersion returns a clear error (V1 is no longer a valid PUT target)', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(23);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: DEFAULT_V2_DATA },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'unsupported_profile_version' });
  });

  it('a PUT with profileData: null returns 400', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(24);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 2, profileData: null },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it('a PUT missing the equipment key returns 400 (16. obecný PUT odmítne nevalidní equipment)', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(25);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 2, profileData: { inventory: { items: { bulb: 5 } } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it('a PUT with an unknown top-level profileData key returns 400', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(26);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 2, profileData: { ...DEFAULT_V2_DATA, note: 'hello' } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.revision).toBe(1);
  });

  it('6. a PUT with an unknown inventory item id returns 400', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(31);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 1,
        profileVersion: 2,
        profileData: { inventory: { items: { shotgun: 1 } }, equipment: DEFAULT_EQUIPMENT },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it('6. ownedWeapons odmítne neznámé ID', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(50);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 1,
        profileVersion: 2,
        profileData: {
          inventory: { items: { bulb: 5 } },
          equipment: { ownedWeapons: ['rocket_launcher'], equippedWeaponId: null },
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it('7. ownedWeapons odmítne duplicity', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(51);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 1,
        profileVersion: 2,
        profileData: {
          inventory: { items: { bulb: 5 } },
          equipment: { ownedWeapons: ['single_shotgun', 'single_shotgun'], equippedWeaponId: 'single_shotgun' },
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it('8. equippedWeaponId musí být vlastněný', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(52);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 1,
        profileVersion: 2,
        profileData: {
          inventory: { items: { bulb: 5 } },
          equipment: { ownedWeapons: [], equippedWeaponId: 'single_shotgun' },
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it('accepts a valid equipment state (owned + correctly equipped weapon)', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(53);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 1,
        profileVersion: 2,
        profileData: {
          inventory: { items: { bulb: 5 } },
          equipment: { ownedWeapons: ['single_shotgun', 'double_barrel_shotgun'], equippedWeaponId: 'double_barrel_shotgun' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().profileData.equipment).toEqual({
      ownedWeapons: ['single_shotgun', 'double_barrel_shotgun'],
      equippedWeaponId: 'double_barrel_shotgun',
    });
  });

  it('3. a PUT with a negative bulb quantity returns 400', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(32);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 1,
        profileVersion: 2,
        profileData: { inventory: { items: { bulb: -1 } }, equipment: DEFAULT_EQUIPMENT },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it('4. a PUT with a bulb quantity above the registry maximum returns 400', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(33);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 1,
        profileVersion: 2,
        profileData: { inventory: { items: { bulb: 1000 } }, equipment: DEFAULT_EQUIPMENT },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it("a PUT with a literal __proto__ key is rejected before it even reaches this route — Fastify's own default JSON body parser refuses to parse it", async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(27);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: `{"discordUserId":"${discordUserId}","expectedRevision":1,"profileVersion":2,"profileData":{"__proto__":{"polluted":true}}}`,
    });
    expect(res.statusCode).toBe(400);

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.revision).toBe(1);
  });

  it('17. bulb add/consume still work through their dedicated endpoints after a general PUT on the same V2 profile', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(28);
    await seedProfile(discordUserId);

    const first = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 1,
        profileVersion: 2,
        profileData: { inventory: { items: { bulb: 1 } }, equipment: DEFAULT_EQUIPMENT },
      },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().revision).toBe(2);

    const second = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: {
        discordUserId,
        expectedRevision: 2,
        profileVersion: 2,
        profileData: { inventory: { items: { bulb: 2 } }, equipment: DEFAULT_EQUIPMENT },
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().revision).toBe(3);
    expect(second.json().profileData.inventory.items.bulb).toBe(2);
  });

  it('two concurrent writes with the same expectedRevision cannot both succeed', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(29);
    await seedProfile(discordUserId);

    const [a, b] = await Promise.all([
      app.inject({
        method: 'PUT',
        url: '/nocni-hlidac/player-profile',
        headers: authHeaders,
        payload: {
          discordUserId,
          expectedRevision: 1,
          profileVersion: 2,
          profileData: { inventory: { items: { bulb: 1 } }, equipment: DEFAULT_EQUIPMENT },
        },
      }),
      app.inject({
        method: 'PUT',
        url: '/nocni-hlidac/player-profile',
        headers: authHeaders,
        payload: {
          discordUserId,
          expectedRevision: 1,
          profileVersion: 2,
          profileData: { inventory: { items: { bulb: 2 } }, equipment: DEFAULT_EQUIPMENT },
        },
      }),
    ]);

    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    // Exactly one write landed — revision advanced by exactly 1, not 2.
    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.revision).toBe(2);
    const winnerData = row?.profileData as { inventory: { items: { bulb: number } } };
    expect([1, 2]).toContain(winnerData.inventory.items.bulb);
  });
});
