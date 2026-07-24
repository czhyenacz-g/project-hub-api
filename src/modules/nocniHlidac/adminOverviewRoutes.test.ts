import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { nocniHlidacAdminOverviewRoutes } from './adminOverviewRoutes.js';

const TOKEN = process.env.NOCNI_HLIDAC_API_TOKEN ?? '';
const authHeaders = { authorization: `Bearer ${TOKEN}` };
const PREFIX = 'test-discord-admin-';

async function buildApp() {
  const app = Fastify();
  await app.register(nocniHlidacAdminOverviewRoutes);
  return app;
}

async function cleanupTestPlayers(): Promise<void> {
  await db.nocniHlidacPlayer.deleteMany({ where: { discordUserId: { startsWith: PREFIX } } });
  await db.object13HardcorePlayerProfile.deleteMany({ where: { discordUserId: { startsWith: PREFIX } } });
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

describe('GET /nocni-hlidac/admin/players', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/admin/players' });
    expect(res.statusCode).toBe(401);
  });

  it('returns players sorted by lastActivityAt desc, with players lacking activity sorted last', async () => {
    const now = new Date();
    const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    await db.nocniHlidacPlayer.create({ data: { discordUserId: `${PREFIX}older`, username: 'older', lastActivityAt: anHourAgo } });
    await db.nocniHlidacPlayer.create({ data: { discordUserId: `${PREFIX}newer`, username: 'newer', lastActivityAt: now } });
    await db.nocniHlidacPlayer.create({ data: { discordUserId: `${PREFIX}never`, username: 'never', lastActivityAt: null } });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/admin/players', headers: authHeaders });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ discordUserId: string }>;
    const testRows = body.filter((row) => row.discordUserId.startsWith(PREFIX));
    expect(testRows.map((row) => row.discordUserId)).toEqual([`${PREFIX}newer`, `${PREFIX}older`, `${PREFIX}never`]);
  });

  it('includes hardcoreBestNight from the separate Object13HardcorePlayerProfile table', async () => {
    await db.nocniHlidacPlayer.create({ data: { discordUserId: `${PREFIX}hc`, username: 'hc-player' } });
    await db.object13HardcorePlayerProfile.create({
      data: { discordUserId: `${PREFIX}hc`, hardcoreBestNight: 17, lastSeenAt: new Date() },
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/admin/players', headers: authHeaders });
    const body = res.json() as Array<{ discordUserId: string; hardcoreBestNight: number }>;
    const row = body.find((r) => r.discordUserId === `${PREFIX}hc`);
    expect(row?.hardcoreBestNight).toBe(17);
  });

  it('defaults hardcoreBestNight to 0 when no hardcore profile exists', async () => {
    await db.nocniHlidacPlayer.create({ data: { discordUserId: `${PREFIX}no-hc`, username: 'no-hc-player' } });
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/admin/players', headers: authHeaders });
    const body = res.json() as Array<{ discordUserId: string; hardcoreBestNight: number }>;
    const row = body.find((r) => r.discordUserId === `${PREFIX}no-hc`);
    expect(row?.hardcoreBestNight).toBe(0);
  });

  it('caps the result at 100 even if a larger limit is requested', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/admin/players?limit=99999', headers: authHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeLessThanOrEqual(100);
  });
});

describe('GET /nocni-hlidac/admin/activity-events', () => {
  it('rejects an unauthenticated request', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/admin/activity-events' });
    expect(res.statusCode).toBe(401);
  });

  it('returns events sorted by createdAt desc, with denormalized player identity', async () => {
    const player = await db.nocniHlidacPlayer.create({
      data: { discordUserId: `${PREFIX}events`, username: 'event-player', displayName: 'Event Player' },
    });
    const older = new Date(Date.now() - 60_000);
    const newer = new Date();
    await db.nocniHlidacPlayerActivityEvent.create({ data: { playerId: player.id, eventType: 'login', createdAt: older } });
    await db.nocniHlidacPlayerActivityEvent.create({ data: { playerId: player.id, eventType: 'game_started', createdAt: newer } });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/admin/activity-events', headers: authHeaders });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ discordUserId: string; displayName: string | null; eventType: string; createdAt: string }>;
    const testRows = body.filter((row) => row.discordUserId === `${PREFIX}events`);
    expect(testRows.map((row) => row.eventType)).toEqual(['game_started', 'login']);
    expect(testRows[0].displayName).toBe('Event Player');
  });

  it('caps the result at 100 even if a larger limit is requested', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nocni-hlidac/admin/activity-events?limit=99999', headers: authHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeLessThanOrEqual(100);
  });
});
