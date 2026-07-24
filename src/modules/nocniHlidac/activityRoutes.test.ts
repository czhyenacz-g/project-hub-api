import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { nocniHlidacActivityRoutes } from './activityRoutes.js';

const TOKEN = process.env.NOCNI_HLIDAC_API_TOKEN ?? '';
const authHeaders = { authorization: `Bearer ${TOKEN}` };
const TEST_PLAYER_ID = 'test-activity-discord-1';

async function buildApp() {
  const app = Fastify();
  await app.register(nocniHlidacActivityRoutes);
  return app;
}

async function cleanupTestPlayers(): Promise<void> {
  await db.nocniHlidacPlayer.deleteMany({ where: { discordUserId: { startsWith: 'test-activity-discord-' } } });
}

beforeAll(async () => {
  if (!TOKEN) {
    throw new Error('NOCNI_HLIDAC_API_TOKEN is not set — see docs/operations/nocni-hlidac.md.');
  }
  await cleanupTestPlayers();
});

afterEach(async () => {
  await cleanupTestPlayers();
});

afterAll(async () => {
  await db.$disconnect();
});

async function createTestPlayer(discordUserId: string) {
  return db.nocniHlidacPlayer.create({ data: { discordUserId, username: 'testguard' } });
}

describe('POST /nocni-hlidac/player/login', () => {
  it('updates lastLoginAt and lastActivityAt for an existing player', async () => {
    await createTestPlayer(TEST_PLAYER_ID);
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/login',
      headers: authHeaders,
      payload: { discordUserId: TEST_PLAYER_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const updated = await db.nocniHlidacPlayer.findUnique({ where: { discordUserId: TEST_PLAYER_ID } });
    expect(updated?.lastLoginAt).not.toBeNull();
    expect(updated?.lastActivityAt).not.toBeNull();
  });

  it('creates exactly one login event', async () => {
    const player = await createTestPlayer(TEST_PLAYER_ID);
    const app = await buildApp();

    await app.inject({ method: 'POST', url: '/nocni-hlidac/player/login', headers: authHeaders, payload: { discordUserId: TEST_PLAYER_ID } });

    const events = await db.nocniHlidacPlayerActivityEvent.findMany({ where: { playerId: player.id } });
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('login');
  });

  it('returns 404 and creates no event for an unknown player (identity must already exist)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/login',
      headers: authHeaders,
      payload: { discordUserId: 'test-activity-discord-does-not-exist' },
    });
    expect(res.statusCode).toBe(404);
    // Scoped to this test's own prefix, not a global count — other test
    // files may have concurrent events of their own (isolated per file, but
    // Postgres itself is shared across the whole suite run).
    const events = await db.nocniHlidacPlayerActivityEvent.count({ where: { player: { discordUserId: { startsWith: 'test-activity-discord-' } } } });
    expect(events).toBe(0);
  });

  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/nocni-hlidac/player/login', payload: { discordUserId: TEST_PLAYER_ID } });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /nocni-hlidac/player/activity/game-start', () => {
  it('updates lastPlayedAt/lastActivityAt/lastClient/lastBuildVersion and returns the summary', async () => {
    await createTestPlayer(TEST_PLAYER_ID);
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/activity/game-start',
      headers: authHeaders,
      payload: { discordUserId: TEST_PLAYER_ID, client: 'itch', buildVersion: '2026.07.24' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lastClient).toBe('itch');
    expect(body.lastBuildVersion).toBe('2026.07.24');
    expect(body.lastPlayedAt).not.toBeNull();
    expect(body.lastActivityAt).not.toBeNull();
  });

  it('creates exactly one game_started event with the client/buildVersion', async () => {
    const player = await createTestPlayer(TEST_PLAYER_ID);
    const app = await buildApp();

    await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/activity/game-start',
      headers: authHeaders,
      payload: { discordUserId: TEST_PLAYER_ID, client: 'local-export', buildVersion: 'v1' },
    });

    const events = await db.nocniHlidacPlayerActivityEvent.findMany({ where: { playerId: player.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'game_started', client: 'local-export', buildVersion: 'v1' });
  });

  it('normalizes an unrecognized client value to "unknown" instead of rejecting the request', async () => {
    await createTestPlayer(TEST_PLAYER_ID);
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/activity/game-start',
      headers: authHeaders,
      payload: { discordUserId: TEST_PLAYER_ID, client: 'totally-bogus' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().lastClient).toBe('unknown');
  });

  it('truncates an overly long buildVersion to 64 characters rather than rejecting the request', async () => {
    await createTestPlayer(TEST_PLAYER_ID);
    const app = await buildApp();
    const longVersion = 'x'.repeat(200);

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/activity/game-start',
      headers: authHeaders,
      payload: { discordUserId: TEST_PLAYER_ID, client: 'web', buildVersion: longVersion },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().lastBuildVersion).toHaveLength(64);
  });

  it('accepts a missing client/buildVersion (both optional)', async () => {
    await createTestPlayer(TEST_PLAYER_ID);
    const app = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/activity/game-start',
      headers: authHeaders,
      payload: { discordUserId: TEST_PLAYER_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().lastClient).toBe('unknown');
    expect(res.json().lastBuildVersion).toBeNull();
  });

  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/nocni-hlidac/player/activity/game-start',
      payload: { discordUserId: TEST_PLAYER_ID },
    });
    expect(res.statusCode).toBe(401);
  });
});
