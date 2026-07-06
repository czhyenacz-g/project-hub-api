import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { nocniHlidacRoutes } from './routes.js';

// Route-level integration tests against the local dev Postgres (see
// docker-compose.yml `project-hub-postgres`, DATABASE_URL in .env loaded by
// vitest.setup.ts). Requires NOCNI_HLIDAC_API_TOKEN to be set for the
// "authorized" cases — vitest.setup.ts loads it from .env.
const TOKEN = process.env.NOCNI_HLIDAC_API_TOKEN ?? '';
const authHeaders = { authorization: `Bearer ${TOKEN}` };

async function buildApp() {
  const app = Fastify();
  await app.register(nocniHlidacRoutes);
  return app;
}

async function cleanupTestPlayers(): Promise<void> {
  await db.nocniHlidacPlayer.deleteMany({ where: { discordUserId: { startsWith: 'test-discord-' } } });
}

beforeAll(async () => {
  if (!TOKEN) {
    throw new Error(
      'NOCNI_HLIDAC_API_TOKEN is not set — these tests need a local Postgres + .env (see docs/operations/nocni-hlidac.md).',
    );
  }
  await cleanupTestPlayers();
});

afterEach(async () => {
  await cleanupTestPlayers();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('auth', () => {
  it('rejects a request with no token', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/leaderboard' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects a request with the wrong token', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/nocni-hlidac/leaderboard',
      headers: { authorization: 'Bearer definitely-wrong' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /nocni-hlidac/player/upsert', () => {
  it('creates a new player with bestRun/currentRun at 0', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/upsert',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-1', username: 'newguard', displayName: 'New Guard' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ guardName: 'New Guard', bestRun: 0, currentRun: 0 });
  });

  it('updates name/avatar on an existing player without resetting bestRun/currentRun', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/upsert',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-2', username: 'oldname' },
    });
    // Simulate progress the player made after the first login.
    await db.nocniHlidacPlayer.update({
      where: { discordUserId: 'test-discord-2' },
      data: { bestRun: 5, currentRun: 3 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/upsert',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-2', username: 'newname', displayName: 'New Display' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ guardName: 'New Display', bestRun: 5, currentRun: 3 });
  });

  it('rejects an invalid body with 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/upsert',
      headers: authHeaders,
      payload: { discordUserId: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });
});

describe('POST /nocni-hlidac/player/survive-night', () => {
  it('returns 404 for a player that was never upserted', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/survive-night',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-never-existed' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'player_not_found' });
  });

  it('increments currentRun by 1 each call', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/upsert',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-3', username: 'runner' },
    });

    const first = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/survive-night',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-3' },
    });
    expect(first.json()).toEqual({ guardName: 'runner', bestRun: 1, currentRun: 1 });

    const second = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/survive-night',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-3' },
    });
    expect(second.json()).toEqual({ guardName: 'runner', bestRun: 2, currentRun: 2 });
  });

  it('raises bestRun only once currentRun surpasses the previous record', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/upsert',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-4', username: 'veteran' },
    });
    await db.nocniHlidacPlayer.update({
      where: { discordUserId: 'test-discord-4' },
      data: { bestRun: 9, currentRun: 2 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/survive-night',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-4' },
    });
    // currentRun 2 -> 3, still below bestRun 9.
    expect(res.json()).toEqual({ guardName: 'veteran', bestRun: 9, currentRun: 3 });
  });
});

describe('POST /nocni-hlidac/player/death', () => {
  it('returns 404 for a player that was never upserted', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/death',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-never-existed' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('resets currentRun to 0 and leaves bestRun untouched', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/upsert',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-5', username: 'doomed' },
    });
    await db.nocniHlidacPlayer.update({
      where: { discordUserId: 'test-discord-5' },
      data: { bestRun: 6, currentRun: 4 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/death',
      headers: authHeaders,
      payload: { discordUserId: 'test-discord-5' },
    });
    expect(res.json()).toEqual({ guardName: 'doomed', bestRun: 6, currentRun: 0 });
  });
});

describe('GET /nocni-hlidac/leaderboard', () => {
  it('sorts by bestRun desc, then currentRun desc, and limits to 10', async () => {
    const app = await buildApp();
    const seed = [
      { discordUserId: 'test-discord-lb-1', username: 'low', bestRun: 1, currentRun: 0 },
      { discordUserId: 'test-discord-lb-2', username: 'high', bestRun: 9, currentRun: 2 },
      { discordUserId: 'test-discord-lb-3', username: 'tie-a', bestRun: 5, currentRun: 3 },
      { discordUserId: 'test-discord-lb-4', username: 'tie-b', bestRun: 5, currentRun: 1 },
    ];
    for (const s of seed) {
      await db.nocniHlidacPlayer.create({ data: s });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/nocni-hlidac/leaderboard',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { guardName: string; bestRun: number; currentRun: number }[];
    const names = body.filter((e) => e.guardName === 'low' || e.guardName === 'high' || e.guardName === 'tie-a' || e.guardName === 'tie-b').map((e) => e.guardName);
    expect(names).toEqual(['high', 'tie-a', 'tie-b', 'low']);
    expect(body.length).toBeLessThanOrEqual(10);
  });
});
