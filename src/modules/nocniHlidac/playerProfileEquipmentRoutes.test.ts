import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { nocniHlidacPlayerProfileRoutes } from './playerProfileRoutes.js';
import { nocniHlidacPlayerProfileEquipmentRoutes } from './playerProfileEquipmentRoutes.js';

const TOKEN = process.env.NOCNI_HLIDAC_API_TOKEN ?? '';
const authHeaders = { authorization: `Bearer ${TOKEN}` };

const TEST_ID_PREFIX = '90000000000002';
function testDiscordId(suffix: number): string {
  return `${TEST_ID_PREFIX}${String(suffix).padStart(3, '0')}`;
}

async function buildApp() {
  const app = Fastify();
  await app.register(nocniHlidacPlayerProfileRoutes);
  await app.register(nocniHlidacPlayerProfileEquipmentRoutes);
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
  it('rejects unlock with no token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
      payload: { discordUserId: testDiscordId(1), weaponId: 'single_shotgun', expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /nocni-hlidac/player-profile/equipment/weapon/unlock', () => {
  it('9. unlocking single_shotgun adds and equips it', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(10);
    await seedProfile(app, discordUserId);

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
      headers: authHeaders,
      payload: { discordUserId, weaponId: 'single_shotgun', expectedRevision: 1 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profileData.equipment).toEqual({ ownedWeapons: ['single_shotgun'], equippedWeaponId: 'single_shotgun' });
    expect(body.revision).toBe(2);
  });

  it('10. a repeated unlock of the same already-owned+equipped weapon is idempotent — revision unchanged', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(11);
    await seedProfile(app, discordUserId);

    const first = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
      headers: authHeaders,
      payload: { discordUserId, weaponId: 'single_shotgun', expectedRevision: 1 },
    });
    expect(first.json().revision).toBe(2);

    const second = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
      headers: authHeaders,
      payload: { discordUserId, weaponId: 'single_shotgun', expectedRevision: 2 },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().revision).toBe(2); // unchanged — true no-op
    expect(second.json().profileData.equipment).toEqual({ ownedWeapons: ['single_shotgun'], equippedWeaponId: 'single_shotgun' });
  });

  it('11. unlocking double_barrel_shotgun adds and auto-equips it', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(12);
    await seedProfile(app, discordUserId);

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
      headers: authHeaders,
      payload: { discordUserId, weaponId: 'double_barrel_shotgun', expectedRevision: 1 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().profileData.equipment).toEqual({ ownedWeapons: ['double_barrel_shotgun'], equippedWeaponId: 'double_barrel_shotgun' });
  });

  it('12. double_barrel_shotgun unlock keeps single_shotgun in ownedWeapons', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(13);
    await seedProfile(app, discordUserId);

    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
      headers: authHeaders,
      payload: { discordUserId, weaponId: 'single_shotgun', expectedRevision: 1 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
      headers: authHeaders,
      payload: { discordUserId, weaponId: 'double_barrel_shotgun', expectedRevision: 2 },
    });

    expect(res.json().profileData.equipment).toEqual({
      ownedWeapons: ['single_shotgun', 'double_barrel_shotgun'],
      equippedWeaponId: 'double_barrel_shotgun',
    });
    expect(res.json().revision).toBe(3);
  });

  it('13. a stale expectedRevision returns 409 revision_conflict', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(14);
    await seedProfile(app, discordUserId);

    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
      headers: authHeaders,
      payload: { discordUserId, weaponId: 'single_shotgun', expectedRevision: 1 },
    }); // now revision 2

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
      headers: authHeaders,
      payload: { discordUserId, weaponId: 'double_barrel_shotgun', expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('revision_conflict');
    expect(body.currentRevision).toBe(2);
  });

  it('14. two concurrent unlocks with the same expectedRevision cannot both change the profile', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(15);
    await seedProfile(app, discordUserId);

    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
        headers: authHeaders,
        payload: { discordUserId, weaponId: 'single_shotgun', expectedRevision: 1 },
      }),
      app.inject({
        method: 'POST',
        url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
        headers: authHeaders,
        payload: { discordUserId, weaponId: 'double_barrel_shotgun', expectedRevision: 1 },
      }),
    ]);

    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const row = await db.object13PlayerProfile.findUnique({ where: { discordUserId } });
    expect(row?.revision).toBe(2); // exactly one write landed
  });

  it('15. an invalid weaponId returns 400', async () => {
    const app = await buildApp();
    const discordUserId = testDiscordId(16);
    await seedProfile(app, discordUserId);

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
      headers: authHeaders,
      payload: { discordUserId, weaponId: 'rocket_launcher', expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('an unlock against a profile that does not exist returns 404', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player-profile/equipment/weapon/unlock',
      headers: authHeaders,
      payload: { discordUserId: testDiscordId(17), weaponId: 'single_shotgun', expectedRevision: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'profile_not_found' });
  });
});
