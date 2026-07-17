import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { tournamentRoutes } from './tournamentRoutes.js';
import { determineTournamentFormat } from './tournamentService.js';

// Route-level integration tests against the local dev Postgres (see
// docker-compose.yml `project-hub-postgres`, DATABASE_URL in .env loaded by
// vitest.setup.ts). Mirrors the pattern used in
// ../nocniHlidac/routes.test.ts.
const API_KEY = process.env.PROJECT_HUB_API_KEY ?? '';
const authHeaders = { 'x-project-hub-key': API_KEY };

const TEST_DISCORD_ID = 'test-discord-tournament-creator';

async function buildApp() {
  const app = Fastify();
  await app.register(tournamentRoutes);
  return app;
}

async function cleanupTestTournaments(): Promise<void> {
  // Tournament -> TournamentTeam cascades on delete (see schema.prisma).
  await db.tournament.deleteMany({ where: { createdByUserId: { in: await testUserIds() } } });
}

async function testUserIds(): Promise<string[]> {
  const users = await db.osmaUser.findMany({
    where: { discordId: TEST_DISCORD_ID },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

let creatorUserId: string;

beforeAll(async () => {
  if (!API_KEY) {
    throw new Error(
      'PROJECT_HUB_API_KEY is not set — these tests need a local Postgres + .env.',
    );
  }
  await cleanupTestTournaments();
  const user = await db.osmaUser.upsert({
    where: { discordId: TEST_DISCORD_ID },
    update: {},
    create: { discordId: TEST_DISCORD_ID, username: 'tournament-tester' },
  });
  creatorUserId = user.id;
});

afterEach(async () => {
  await cleanupTestTournaments();
});

afterAll(async () => {
  await cleanupTestTournaments();
  await db.osmaUser.deleteMany({ where: { discordId: TEST_DISCORD_ID } });
  await db.$disconnect();
});

describe('auth', () => {
  it('rejects a request with no api key', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      payload: { name: 'Test', playerCount: 4, createdByUserId: creatorUserId },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/osma-liga/tournaments', () => {
  it('creates a tournament with default teams when none are sent', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'Okresní pohár', playerCount: 4, createdByUserId: creatorUserId },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.tournament.name).toBe('Okresní pohár');
    expect(body.tournament.playerCount).toBe(4);
    expect(body.tournament.status).toBe('open');
    expect(body.tournament.format).toBe('league_top2_final');
    expect(body.tournament.publicCode).toMatch(/^[a-z2-9]{6}$/);
    expect(body.tournament.teams).toHaveLength(4);
    expect(body.tournament.teams.map((t: { name: string }) => t.name)).toEqual([
      'Tým 1', 'Tým 2', 'Tým 3', 'Tým 4',
    ]);
    expect(body.tournament.teams.every((t: { seed: number; slotNumber: number }) => t.seed === t.slotNumber)).toBe(true);
  });

  it('uses client-sent team names but ignores a client-sent format', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: {
        name: 'Derby',
        playerCount: 2,
        format: 'league_top4_playoff', // wrong on purpose — backend must recompute
        createdByUserId: creatorUserId,
        teams: [
          { slotNumber: 1, name: 'Náhoda FC' },
          { slotNumber: 2, name: 'FK Pařezov' },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tournament.format).toBe('derby');
    expect(body.tournament.teams.map((t: { name: string }) => t.name)).toEqual(['Náhoda FC', 'FK Pařezov']);
  });

  it('rejects playerCount below 2', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'Test', playerCount: 1, createdByUserId: creatorUserId },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects playerCount above 8', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'Test', playerCount: 9, createdByUserId: creatorUserId },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty name', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: '', playerCount: 4, createdByUserId: creatorUserId },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing createdByUserId', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'Test', playerCount: 4, createdByUserId: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown createdByUserId', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'Test', playerCount: 4, createdByUserId: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a teams array whose length does not match playerCount', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: {
        name: 'Test',
        playerCount: 4,
        createdByUserId: creatorUserId,
        teams: [{ slotNumber: 1, name: 'Tým 1' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('generates unique publicCodes across multiple tournaments', async () => {
    const app = await buildApp();
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/osma-liga/tournaments',
        headers: authHeaders,
        payload: { name: `Test ${i}`, playerCount: 2, createdByUserId: creatorUserId },
      });
      expect(res.statusCode).toBe(201);
      codes.add(res.json().tournament.publicCode);
    }
    expect(codes.size).toBe(5);
  });
});

describe('format by playerCount', () => {
  it('picks derby for 2 players', () => {
    expect(determineTournamentFormat(2)).toBe('derby');
  });
  it('picks league_top2_final for 3-4 players', () => {
    expect(determineTournamentFormat(3)).toBe('league_top2_final');
    expect(determineTournamentFormat(4)).toBe('league_top2_final');
  });
  it('picks league_top4_playoff for 5-8 players', () => {
    expect(determineTournamentFormat(5)).toBe('league_top4_playoff');
    expect(determineTournamentFormat(8)).toBe('league_top4_playoff');
  });
});

describe('GET /api/osma-liga/tournaments/:code', () => {
  it('returns 404 for an unknown code', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/osma-liga/tournaments/zzzzzz',
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns the tournament with teams sorted by slotNumber', async () => {
    const app = await buildApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: {
        name: 'Sorted teams test',
        playerCount: 3,
        createdByUserId: creatorUserId,
        teams: [
          { slotNumber: 3, name: 'Tým C' },
          { slotNumber: 1, name: 'Tým A' },
          { slotNumber: 2, name: 'Tým B' },
        ],
      },
    });
    const { publicCode } = createRes.json().tournament;

    const res = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${publicCode}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.tournament.publicCode).toBe(publicCode);
    expect(body.tournament.teams.map((t: { slotNumber: number }) => t.slotNumber)).toEqual([1, 2, 3]);
    expect(body.tournament.teams.map((t: { name: string }) => t.name)).toEqual(['Tým A', 'Tým B', 'Tým C']);
  });

  it('looks up the code case-insensitively', async () => {
    const app = await buildApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'Case test', playerCount: 2, createdByUserId: creatorUserId },
    });
    const { publicCode } = createRes.json().tournament;

    const res = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${publicCode.toUpperCase()}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tournament.publicCode).toBe(publicCode);
  });
});
