import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { nocniHlidacPlayerProfileRoutes } from './playerProfileRoutes.js';
import { nocniHlidacPlayerProfileInventoryRoutes } from './playerProfileInventoryRoutes.js';

const TOKEN = process.env.NOCNI_HLIDAC_API_TOKEN ?? '';
const authHeaders = { authorization: `Bearer ${TOKEN}` };

const TEST_ID_PREFIX = '90000000000001';
function testDiscordId(suffix: number): string {
  return `${TEST_ID_PREFIX}${String(suffix).padStart(3, '0')}`;
}

async function buildApp() {
  const app = Fastify();
  await app.register(nocniHlidacPlayerProfileRoutes);
  await app.register(nocniHlidacPlayerProfileInventoryRoutes);
  return app;
}

async function cleanupTestProfiles(): Promise<void> {
  await db.object13PlayerProfile.deleteMany({ where: { discordUserId: { startsWith: TEST_ID_PREFIX } } });
}

async function seedProfile(app: Awaited<ReturnType<typeof buildApp>>, discordUserId: string) {
  const res = await app.inject({ method: 'GET', url: `/nocni-hlidac/player-profile?discordUserId=${discordUserId}`, headers: authHeaders });
  return res.json();
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
  it('rejects add with no token', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/nocni-hlidac/player-profile/inventory/bulb/add', payload: { discordUserId: testDiscordId(1), amount: 1, expectedRevision: 1 } });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /nocni-hlidac/player-profile/inventory/bulb/add', () => {
  it('9. increases the bulb quantity by amount', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(10);
    await seedProfile(app, discordUserId); // starts at bulb: 10, revision 1

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/add',
      headers: authHeaders,
      payload: { discordUserId, amount: 5, expectedRevision: 1 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profileData.inventory.items.bulb).toBe(15);
  });

  it('13. increases revision by exactly 1', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(11);
    await seedProfile(app, discordUserId);

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/add',
      headers: authHeaders,
      payload: { discordUserId, amount: 1, expectedRevision: 1 },
    });
    expect(res.json().revision).toBe(2);
  });

  it('12. an add that would exceed the maximum returns 409 exceeds_maximum, and changes nothing', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(12);
    await seedProfile(app, discordUserId);

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/add',
      headers: authHeaders,
      payload: { discordUserId, amount: 990, expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'exceeds_maximum' });

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.revision).toBe(1);
  });

  it('14. a stale expectedRevision returns 409 revision_conflict with the current profile', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(13);
    await seedProfile(app, discordUserId);
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/add',
      headers: authHeaders,
      payload: { discordUserId, amount: 1, expectedRevision: 1 },
    }); // now at revision 2

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/add',
      headers: authHeaders,
      payload: { discordUserId, amount: 1, expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('revision_conflict');
    expect(body.currentRevision).toBe(2);
    expect(body.profile.profileData.inventory.items.bulb).toBe(11);
  });

  it('16. a non-positive amount returns 400 without calling the DB write path', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(14);
    await seedProfile(app, discordUserId);

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/add',
      headers: authHeaders,
      payload: { discordUserId, amount: 0, expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(400);

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.revision).toBe(1);
  });

  it('a non-integer amount returns 400', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(15);
    await seedProfile(app, discordUserId);

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/add',
      headers: authHeaders,
      payload: { discordUserId, amount: 1.5, expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('an add against a profile that does not exist returns 404', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/add',
      headers: authHeaders,
      payload: { discordUserId: testDiscordId(16), amount: 1, expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'profile_not_found' });
  });
});

describe('POST /nocni-hlidac/player-profile/inventory/bulb/consume', () => {
  it('10. decreases the bulb quantity by amount', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(20);
    await seedProfile(app, discordUserId); // starts at bulb: 10

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/consume',
      headers: authHeaders,
      payload: { discordUserId, amount: 4, expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().profileData.inventory.items.bulb).toBe(6);
  });

  it('11. a consume that would go below zero returns 409 insufficient_inventory, and changes nothing', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(21);
    await seedProfile(app, discordUserId); // bulb: 10

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/consume',
      headers: authHeaders,
      payload: { discordUserId, amount: 11, expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'insufficient_inventory' });

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.revision).toBe(1);
    expect((row?.profileData as { inventory: { items: { bulb: number } } }).inventory.items.bulb).toBe(10);
  });

  it('13. increases revision by exactly 1 on success', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(22);
    await seedProfile(app, discordUserId);

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/consume',
      headers: authHeaders,
      payload: { discordUserId, amount: 1, expectedRevision: 1 },
    });
    expect(res.json().revision).toBe(2);
  });

  it('15. two concurrent consumes with the same expectedRevision cannot both succeed', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(23);
    await seedProfile(app, discordUserId); // bulb: 10

    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/nocni-hlidac/player-profile/inventory/bulb/consume',
        headers: authHeaders,
        payload: { discordUserId, amount: 1, expectedRevision: 1 },
      }),
      app.inject({
        method: 'POST',
        url: '/nocni-hlidac/player-profile/inventory/bulb/consume',
        headers: authHeaders,
        payload: { discordUserId, amount: 1, expectedRevision: 1 },
      }),
    ]);

    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.revision).toBe(2);
    expect((row?.profileData as { inventory: { items: { bulb: number } } }).inventory.items.bulb).toBe(9);
  });

  it('a consume against a profile that does not exist returns 404', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/inventory/bulb/consume',
      headers: authHeaders,
      payload: { discordUserId: testDiscordId(24), amount: 1, expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'profile_not_found' });
  });
});
