import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { nocniHlidacHardcoreProfileRoutes } from './hardcoreProfileRoutes.js';

// Route-level integration tests against the local dev Postgres — same infra
// as routes.test.ts (docker-compose `project-hub-postgres`, DATABASE_URL in
// .env loaded by vitest.setup.ts), same NOCNI_HLIDAC_API_TOKEN bearer auth.
const TOKEN = process.env.NOCNI_HLIDAC_API_TOKEN ?? '';
const authHeaders = { authorization: `Bearer ${TOKEN}` };

async function buildApp() {
  const app = Fastify();
  await app.register(nocniHlidacHardcoreProfileRoutes);
  return app;
}

async function cleanupTestProfiles(): Promise<void> {
  await db.object13HardcorePlayerProfile.deleteMany({ where: { discordUserId: { startsWith: 'test-hc-discord-' } } });
}

beforeAll(async () => {
  if (!TOKEN) {
    throw new Error('NOCNI_HLIDAC_API_TOKEN is not set — these tests need a local Postgres + .env.');
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
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/hardcore-profile?discordUserId=test-hc-discord-auth' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects POST sync with no token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      payload: { discordUserId: 'test-hc-discord-auth' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/nocni-hlidac/hardcore-profile?discordUserId=test-hc-discord-auth',
      headers: { authorization: 'Bearer definitely-wrong' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /nocni-hlidac/hardcore-profile', () => {
  it('creates a default profile for a new discordUserId', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/nocni-hlidac/hardcore-profile?discordUserId=test-hc-discord-1',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      discordUserId: 'test-hc-discord-1',
      displayName: null,
      avatarUrl: null,
      hardcoreHasDefeatedMonster: false,
      hardcoreDoubleBarrelUnlocked: false,
      hardcoreMonsterDefeatsCount: 0,
      hardcoreBestNight: 0,
    });
    expect(typeof body.createdAt).toBe('string');
    expect(typeof body.updatedAt).toBe('string');
    expect(typeof body.lastSeenAt).toBe('string');
    expect(body.hardcoreDeathsByNight).toEqual({});
  });

  it('returns the existing profile for a known discordUserId, without resetting its values', async () => {
    const app = await buildApp();
    await db.object13HardcorePlayerProfile.create({
      data: {
        discordUserId: 'test-hc-discord-2',
        hardcoreHasDefeatedMonster: true,
        hardcoreDoubleBarrelUnlocked: true,
        hardcoreMonsterDefeatsCount: 4,
        hardcoreBestNight: 8,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/nocni-hlidac/hardcore-profile?discordUserId=test-hc-discord-2',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      discordUserId: 'test-hc-discord-2',
      hardcoreHasDefeatedMonster: true,
      hardcoreDoubleBarrelUnlocked: true,
      hardcoreMonsterDefeatsCount: 4,
      hardcoreBestNight: 8,
    });
  });

  it('rejects a missing discordUserId with 400', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/hardcore-profile', headers: authHeaders });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });
});

describe('POST /nocni-hlidac/hardcore-profile/sync', () => {
  it('sets hardcoreHasDefeatedMonster true on first sync', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-3', hardcoreHasDefeatedMonster: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hardcoreHasDefeatedMonster: true });
  });

  it('sets hardcoreDoubleBarrelUnlocked true on first sync', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-4', hardcoreDoubleBarrelUnlocked: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hardcoreDoubleBarrelUnlocked: true });
  });

  it('sets hardcoreMonsterDefeatsCount to 3 on first sync', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-5', hardcoreMonsterDefeatsCount: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hardcoreMonsterDefeatsCount: 3 });
  });

  it('does not lower hardcoreMonsterDefeatsCount: 3 then 1 stays 3', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-6', hardcoreMonsterDefeatsCount: 3 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-6', hardcoreMonsterDefeatsCount: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hardcoreMonsterDefeatsCount: 3 });
  });

  it('sets hardcoreBestNight to 10 on first sync', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-7', hardcoreBestNight: 10 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hardcoreBestNight: 10 });
  });

  it('does not lower hardcoreBestNight: 10 then 5 stays 10', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-8', hardcoreBestNight: 10 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-8', hardcoreBestNight: 5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hardcoreBestNight: 10 });
  });

  it('does not lower a true boolean back to false on a later sync with false', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-9', hardcoreHasDefeatedMonster: true, hardcoreDoubleBarrelUnlocked: true },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-9', hardcoreHasDefeatedMonster: false, hardcoreDoubleBarrelUnlocked: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hardcoreHasDefeatedMonster: true, hardcoreDoubleBarrelUnlocked: true });
  });

  it('never stores negative values (they are ignored/clamped to 0 or the existing value)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-10', hardcoreMonsterDefeatsCount: -5, hardcoreBestNight: -1 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hardcoreMonsterDefeatsCount).toBeGreaterThanOrEqual(0);
    expect(body.hardcoreBestNight).toBeGreaterThanOrEqual(0);
    expect(body.hardcoreMonsterDefeatsCount).toBe(0);
    expect(body.hardcoreBestNight).toBe(0);
  });

  it('clamps extreme values to the documented max', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-11', hardcoreMonsterDefeatsCount: 999_999_999, hardcoreBestNight: 999_999_999 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ hardcoreMonsterDefeatsCount: 100_000, hardcoreBestNight: 10_000 });
  });

  it('ignores Normal-like fields entirely (never stored, never surfaced in the response)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: {
        discordUserId: 'test-hc-discord-12',
        hardcoreBestNight: 2,
        totalDeaths: 999,
        totalRunsStarted: 999,
        totalNightsSurvived: 999,
        bulbsReplaced: 999,
        generatorsRestarted: 999,
        expeditionsStarted: 999,
        expeditionsReturned: 999,
        monsterHitsConfirmed: 999,
        monsterKills: 999,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hardcoreBestNight).toBe(2);
    expect(body).not.toHaveProperty('totalDeaths');
    expect(body).not.toHaveProperty('totalRunsStarted');
    expect(body).not.toHaveProperty('totalNightsSurvived');
    expect(body).not.toHaveProperty('bulbsReplaced');
    expect(body).not.toHaveProperty('generatorsRestarted');
    expect(body).not.toHaveProperty('expeditionsStarted');
    expect(body).not.toHaveProperty('expeditionsReturned');
    expect(body).not.toHaveProperty('monsterHitsConfirmed');
    expect(body).not.toHaveProperty('monsterKills');
  });

  it('refreshes displayName/avatarUrl from the sync identity', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-13', displayName: 'Old Name', avatarUrl: 'https://old.example/a.png' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-13', displayName: 'New Name', avatarUrl: 'https://new.example/a.png' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ displayName: 'New Name', avatarUrl: 'https://new.example/a.png' });
  });

  it('rejects a missing discordUserId with 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { hardcoreBestNight: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });
});

describe('POST /nocni-hlidac/hardcore-profile/sync — hardcoreDeathsByNight', () => {
  it('stores { "1": 1 } on first sync and returns it in the response', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-14', hardcoreDeathsByNight: { '1': 1 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hardcoreDeathsByNight).toEqual({ '1': 1 });
  });

  it('raises { "1": 1 } to { "1": 2 } on a second sync', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-15', hardcoreDeathsByNight: { '1': 1 } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-15', hardcoreDeathsByNight: { '1': 2 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hardcoreDeathsByNight).toEqual({ '1': 2 });
  });

  it('never lowers an existing per-night count: { "1": 2 } then { "1": 1 } stays { "1": 2 }', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-16', hardcoreDeathsByNight: { '1': 2 } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-16', hardcoreDeathsByNight: { '1': 1 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hardcoreDeathsByNight).toEqual({ '1': 2 });
  });

  it('adds a new night key without touching an existing one: { "2": 3 } after { "1": 1 }', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-17', hardcoreDeathsByNight: { '1': 1 } },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-17', hardcoreDeathsByNight: { '2': 3 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hardcoreDeathsByNight).toEqual({ '1': 1, '2': 3 });
  });

  it('ignores invalid night keys (0, negative, non-numeric)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-18', hardcoreDeathsByNight: { '0': 5, '-1': 3, abc: 2, '1': 1 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hardcoreDeathsByNight).toEqual({ '1': 1 });
  });

  it('clamps an extreme count to the documented maximum', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-19', hardcoreDeathsByNight: { '1': 999_999_999 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hardcoreDeathsByNight).toEqual({ '1': 1_000_000 });
  });

  it('treats null/string/array instead of an object as {} — never crashes, never stores garbage', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/hardcore-profile/sync',
      headers: authHeaders,
      payload: { discordUserId: 'test-hc-discord-20', hardcoreDeathsByNight: 'not an object' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hardcoreDeathsByNight).toEqual({});
  });
});
