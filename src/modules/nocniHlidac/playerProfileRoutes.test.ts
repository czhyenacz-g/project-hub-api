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

const DEFAULT_V1_DATA = { inventory: { items: { bulb: 10 } } };

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
      payload: { discordUserId: testDiscordId(1), expectedRevision: 1, profileVersion: 1, profileData: DEFAULT_V1_DATA },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /nocni-hlidac/player-profile', () => {
  it('1/2/3/4. creates a new profile with profileVersion 1, the default V1 inventory, revision 1', async () => {
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
    expect(body.profileVersion).toBe(1);
    expect(body.profileData).toEqual(DEFAULT_V1_DATA);
    expect(body.revision).toBe(1);
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.updatedAt).toBe('string');
    expect(typeof body.lastSeenAt).toBe('string');
    expect(body.id).toBeUndefined();
  });

  it('5/7. repeated GET never creates a second row (discordUserId is unique)', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(11);

    await app.inject({ method: 'GET', url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`, headers: authHeaders });
    await app.inject({ method: 'GET', url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`, headers: authHeaders });
    await app.inject({ method: 'GET', url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`, headers: authHeaders });

    const rows = await db.object13PlayerProfile.findMany({ where: { discordUserId } });
    expect(rows).toHaveLength(1);
  });

  it('6. repeated GET updates lastSeenAt but never touches revision/profileData/createdAt of an already-valid profile', async () => {
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

  it('8. an invalid Discord ID returns 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/nocni-hlidac/player-profile?discordUserId=not-a-snowflake',
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });

  it('8b. a missing discordUserId query param returns 400', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/player-profile', headers: authHeaders });
    expect(res.statusCode).toBe(400);
  });

  it('7. a legacy pre-1B empty {} profileData in the DB is normalized to the default V1 inventory on read, and the fix is persisted (revision bumps)', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(13);

    await db.$executeRaw`INSERT INTO "Object13PlayerProfile" ("id", "discordUserId", "profileVersion", "profileData", "revision", "updatedAt")
      VALUES (gen_random_uuid()::text, ${discordUserId}, 1, '{}'::jsonb, 1, now())`;

    const res = await app.inject({
      method: 'GET',
      url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().profileData).toEqual(DEFAULT_V1_DATA);
    expect(res.json().revision).toBe(2);

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.profileData).toEqual(DEFAULT_V1_DATA);
    expect(row?.revision).toBe(2);
  });

  it('a corrupted (non-object) profileData already in the DB is normalized to the default V1 inventory on read', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(14);

    await db.$executeRaw`INSERT INTO "Object13PlayerProfile" ("id", "discordUserId", "profileVersion", "profileData", "revision", "updatedAt")
      VALUES (gen_random_uuid()::text, ${discordUserId}, 1, '"not an object"'::jsonb, 1, now())`;

    const res = await app.inject({
      method: 'GET',
      url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().profileData).toEqual(DEFAULT_V1_DATA);
  });

  it('8. a GET of an already-normalized/valid V1 profile does NOT bump revision again on a second read', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(15);

    await db.$executeRaw`INSERT INTO "Object13PlayerProfile" ("id", "discordUserId", "profileVersion", "profileData", "revision", "updatedAt")
      VALUES (gen_random_uuid()::text, ${discordUserId}, 1, '{}'::jsonb, 1, now())`;

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
    expect(second.json().revision).toBe(2); // no further bump — already valid V1
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

  it('11/12. a PUT with the matching revision saves and increments revision by exactly 1', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(20);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: { inventory: { items: { bulb: 15 } } } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.revision).toBe(2);
    expect(body.profileData).toEqual({ inventory: { items: { bulb: 15 } } });
  });

  it('13/14. a PUT with a stale revision returns 409 and overwrites nothing', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(21);
    await seedProfile(discordUserId);
    await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: { inventory: { items: { bulb: 5 } } } },
    });
    // Profile is now at revision 2. Retry with the now-stale revision 1.
    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: { inventory: { items: { bulb: 999 } } } },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('revision_conflict');
    expect(body.currentRevision).toBe(2);

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.revision).toBe(2);
    expect(row?.profileData).toEqual({ inventory: { items: { bulb: 5 } } });
  });

  it('a PUT against a profile that was never GET/created returns 404', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId: testDiscordId(22), expectedRevision: 1, profileVersion: 1, profileData: DEFAULT_V1_DATA },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'profile_not_found' });
  });

  it('15. a PUT with an unsupported profileVersion returns a clear error', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(23);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 999, profileData: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'unsupported_profile_version' });
  });

  it('16. a PUT with profileData: null returns 400', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(24);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: null },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it('17. a PUT with profileData as an array returns 400', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(25);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: [1, 2, 3] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it('17. a PUT with an unknown top-level profileData key (legacy free-form shape) returns 400', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(26);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: { note: 'hello' } },
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
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: { inventory: { items: { shotgun: 1 } } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it('3. a PUT with a negative bulb quantity returns 400', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(32);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: { inventory: { items: { bulb: -1 } } } },
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
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: { inventory: { items: { bulb: 1000 } } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });
  });

  it("a PUT with a literal __proto__ key is rejected before it even reaches this route — Fastify's own default JSON body parser refuses to parse it", async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(27);
    await seedProfile(discordUserId);

    // Sent as a raw JSON string (not a JS object payload) on purpose: a real
    // HTTP request body is always raw bytes, and light-my-request (Fastify's
    // `.inject()`) mangles a literal `__proto__` key if it's handed a live
    // JS object instead — this is the faithful way to simulate what an
    // actual malicious/careless client sends over the wire. Confirmed
    // empirically: Fastify's default `application/json` content-type parser
    // already refuses to parse a body containing a top-level `__proto__` key
    // ANYWHERE in the JSON, returning `FST_ERR_CTP_INVALID_JSON_BODY` — this
    // request never reaches playerProfileRoutes.ts at all.
    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      payload: `{"discordUserId":"${discordUserId}","expectedRevision":1,"profileVersion":1,"profileData":{"__proto__":{"polluted":true}}}`,
    });
    expect(res.statusCode).toBe(400);

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.revision).toBe(1);
  });

  it('a PUT with a nested "constructor" key (not blocked by Fastify itself) is rejected by validateObject13PlayerProfileDataV1 — "nested" is simply not an allowed top-level key', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(30);
    await seedProfile(discordUserId);

    const res = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: { nested: { constructor: 'x' } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_profile_data' });

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.revision).toBe(1);
  });

  it('21. two sequential writes with the correct revisions each work', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(28);
    await seedProfile(discordUserId);

    const first = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: { inventory: { items: { bulb: 1 } } } },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().revision).toBe(2);

    const second = await app.inject({
      method: 'PUT',
      url: '/nocni-hlidac/player-profile',
      headers: authHeaders,
      payload: { discordUserId, expectedRevision: 2, profileVersion: 1, profileData: { inventory: { items: { bulb: 2 } } } },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().revision).toBe(3);
    expect(second.json().profileData).toEqual({ inventory: { items: { bulb: 2 } } });
  });

  it('22. two concurrent writes with the same expectedRevision cannot both succeed', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(29);
    await seedProfile(discordUserId);

    const [a, b] = await Promise.all([
      app.inject({
        method: 'PUT',
        url: '/nocni-hlidac/player-profile',
        headers: authHeaders,
        payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: { inventory: { items: { bulb: 1 } } } },
      }),
      app.inject({
        method: 'PUT',
        url: '/nocni-hlidac/player-profile',
        headers: authHeaders,
        payload: { discordUserId, expectedRevision: 1, profileVersion: 1, profileData: { inventory: { items: { bulb: 2 } } } },
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
