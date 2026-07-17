import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { tournamentRoutes } from './tournamentRoutes.js';
import { determineTournamentFormat } from './tournamentService.js';
import { getGame } from './onlineGames.js';

// Route-level integration tests against the local dev Postgres (see
// docker-compose.yml `project-hub-postgres`, DATABASE_URL in .env loaded by
// vitest.setup.ts). Mirrors the pattern used in
// ../nocniHlidac/routes.test.ts.
const API_KEY = process.env.PROJECT_HUB_API_KEY ?? '';
const authHeaders = { 'x-project-hub-key': API_KEY };

const TEST_DISCORD_ID = 'test-discord-tournament-creator';
const TEST_DISCORD_ID_2 = 'test-discord-tournament-claimer-2';
// Extra pool for start/scheduling tests that need up to 8 distinct claimers
// (one team can only ever be claimed by one user — see the DB unique index
// on (tournamentId, claimedByUserId) in schema.prisma).
const EXTRA_DISCORD_IDS = Array.from({ length: 6 }, (_, i) => `test-discord-tournament-claimer-${i + 3}`);
const ALL_TEST_DISCORD_IDS = [TEST_DISCORD_ID, TEST_DISCORD_ID_2, ...EXTRA_DISCORD_IDS];

async function buildApp() {
  const app = Fastify();
  await app.register(tournamentRoutes);
  return app;
}

async function cleanupTestTournaments(): Promise<void> {
  // Tournament -> TournamentTeam / TournamentMatch cascade on delete (see schema.prisma).
  await db.tournament.deleteMany({ where: { createdByUserId: { in: await testUserIds() } } });
}

async function testUserIds(): Promise<string[]> {
  const users = await db.osmaUser.findMany({
    where: { discordId: { in: ALL_TEST_DISCORD_IDS } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

let creatorUserId: string;
let secondUserId: string;
let extraUserIds: string[];

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
  const user2 = await db.osmaUser.upsert({
    where: { discordId: TEST_DISCORD_ID_2 },
    update: {},
    create: { discordId: TEST_DISCORD_ID_2, username: 'tournament-tester-2' },
  });
  secondUserId = user2.id;
  extraUserIds = [];
  for (const [i, discordId] of EXTRA_DISCORD_IDS.entries()) {
    const extraUser = await db.osmaUser.upsert({
      where: { discordId },
      update: {},
      create: { discordId, username: `tournament-tester-${i + 3}` },
    });
    extraUserIds.push(extraUser.id);
  }
});

afterEach(async () => {
  await cleanupTestTournaments();
});

afterAll(async () => {
  await cleanupTestTournaments();
  await db.osmaUser.deleteMany({ where: { discordId: { in: ALL_TEST_DISCORD_IDS } } });
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

describe('POST /api/osma-liga/tournaments/:code/teams/:teamId/claim', () => {
  async function createTestTournament(app: Awaited<ReturnType<typeof buildApp>>, playerCount = 4) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'Claim test', playerCount, createdByUserId: creatorUserId },
    });
    return res.json().tournament as { publicCode: string; teams: { id: string }[] };
  }

  it('requires the api key', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[0].id}/claim`,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(401);
  });

  it('claims a free team', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[0].id}/claim`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    const claimedTeam = body.tournament.teams.find((t: { id: string }) => t.id === tournament.teams[0].id);
    expect(claimedTeam.claimedByUserId).toBe(creatorUserId);
    expect(claimedTeam.claimedAt).not.toBeNull();
  });

  it('reflects the claim on a subsequent GET', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app);
    await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[0].id}/claim`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}`,
      headers: authHeaders,
    });
    const claimedTeam = res.json().tournament.teams.find((t: { id: string }) => t.id === tournament.teams[0].id);
    expect(claimedTeam.claimedByUserId).toBe(creatorUserId);
  });

  it('rejects a second team claimed by the same user in the same tournament', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app);
    await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[0].id}/claim`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[1].id}/claim`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects claiming a team already claimed by someone else', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app);
    await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[0].id}/claim`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[0].id}/claim`,
      headers: authHeaders,
      payload: { userId: secondUserId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('lets a different user claim a different free team', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app);
    await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[0].id}/claim`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[1].id}/claim`,
      headers: authHeaders,
      payload: { userId: secondUserId },
    });
    expect(res.statusCode).toBe(200);
    const claimedTeam = res.json().tournament.teams.find((t: { id: string }) => t.id === tournament.teams[1].id);
    expect(claimedTeam.claimedByUserId).toBe(secondUserId);
  });

  it('rejects a team id that belongs to a different tournament', async () => {
    const app = await buildApp();
    const tournamentA = await createTestTournament(app);
    const tournamentB = await createTestTournament(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournamentA.publicCode}/teams/${tournamentB.teams[0].id}/claim`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects claiming in a tournament that is not open', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app);
    await db.tournament.update({ where: { publicCode: tournament.publicCode }, data: { status: 'closed' } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[0].id}/claim`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects an unknown userId', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[0].id}/claim`,
      headers: authHeaders,
      payload: { userId: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown publicCode', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/zzzzzz/teams/${tournament.teams[0].id}/claim`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for an unknown teamId', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/does-not-exist/claim`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/osma-liga/tournaments/:code/start', () => {
  type TestTournament = {
    publicCode: string;
    status: string;
    teams: { id: string; claimedByUserId: string | null }[];
    matches: { id: string; phase: string; roundNumber: number; matchNumber: number; homeTeamId: string; awayTeamId: string; status: string }[];
  };

  async function createTestTournament(app: Awaited<ReturnType<typeof buildApp>>, playerCount: number): Promise<TestTournament> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'Start test', playerCount, createdByUserId: creatorUserId },
    });
    return res.json().tournament as TestTournament;
  }

  // Claims teams[0..claimerIds.length-1] — pass fewer claimerIds than teams
  // to leave some teams intentionally unclaimed for the "not all teams
  // claimed" test.
  async function claimAllTeams(
    app: Awaited<ReturnType<typeof buildApp>>,
    tournament: TestTournament,
    claimerIds: string[],
  ): Promise<void> {
    for (let i = 0; i < claimerIds.length; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[i].id}/claim`,
        headers: authHeaders,
        payload: { userId: claimerIds[i] },
      });
      if (res.statusCode !== 200) {
        throw new Error(`Failed to claim team ${i}: ${res.statusCode} ${res.body}`);
      }
    }
  }

  function claimerPoolFor(playerCount: number): string[] {
    return [creatorUserId, secondUserId, ...extraUserIds].slice(0, playerCount);
  }

  it('requires the api key', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app, 2);
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown userId', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app, 2);
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      headers: authHeaders,
      payload: { userId: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown publicCode', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments/zzzzzz/start',
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a non-creator user', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app, 2);
    await claimAllTeams(app, tournament, claimerPoolFor(2));
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      headers: authHeaders,
      payload: { userId: secondUserId },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects starting before all teams are claimed', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app, 4);
    // Claim only 3 of 4 teams.
    await claimAllTeams(app, tournament, claimerPoolFor(3));
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects starting a tournament that is not open', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app, 2);
    await claimAllTeams(app, tournament, claimerPoolFor(2));
    await db.tournament.update({ where: { publicCode: tournament.publicCode }, data: { status: 'closed' } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('creator starts a fully-claimed 2-player tournament and generates 3 derby matches', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app, 2);
    await claimAllTeams(app, tournament, claimerPoolFor(2));

    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.tournament.status).toBe('in_progress');
    expect(body.tournament.startedAt).not.toBeNull();
    expect(body.tournament.matches).toHaveLength(3);
    expect(body.tournament.matches.every((m: { phase: string }) => m.phase === 'derby')).toBe(true);
    expect(body.tournament.matches.every((m: { status: string }) => m.status === 'scheduled')).toBe(true);
    expect(body.tournament.matches.every((m: { homeScore: number | null }) => m.homeScore === null)).toBe(true);
  });

  it('cannot start the same tournament twice', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app, 2);
    await claimAllTeams(app, tournament, claimerPoolFor(2));

    const first = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(second.statusCode).toBe(409);

    // No duplicate matches were created by the second attempt.
    const detail = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}`,
      headers: authHeaders,
    });
    expect(detail.json().tournament.matches).toHaveLength(3);
  });

  it('starting concurrently (double click) never creates duplicate matches', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app, 4);
    await claimAllTeams(app, tournament, claimerPoolFor(4));

    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
        headers: authHeaders,
        payload: { userId: creatorUserId },
      }),
      app.inject({
        method: 'POST',
        url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
        headers: authHeaders,
        payload: { userId: creatorUserId },
      }),
    ]);
    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}`,
      headers: authHeaders,
    });
    expect(detail.json().tournament.matches).toHaveLength(6);
  });

  it.each([
    [3, 3],
    [4, 6],
    [5, 10],
    [8, 28],
  ])('starting a %i-player tournament generates %i league matches with no self-matches or repeated pairings', async (playerCount, expectedMatches) => {
    const app = await buildApp();
    const tournament = await createTestTournament(app, playerCount);
    await claimAllTeams(app, tournament, claimerPoolFor(playerCount));

    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(200);
    const matches = res.json().tournament.matches as { homeTeamId: string; awayTeamId: string; phase: string }[];
    expect(matches).toHaveLength(expectedMatches);
    expect(matches.every((m) => m.phase === 'league')).toBe(true);
    expect(matches.every((m) => m.homeTeamId !== m.awayTeamId)).toBe(true);

    const seenPairs = new Set<string>();
    for (const m of matches) {
      const key = [m.homeTeamId, m.awayTeamId].sort().join('|');
      expect(seenPairs.has(key)).toBe(false);
      seenPairs.add(key);
    }
  });

  it('GET detail after start returns the matches sorted by roundNumber then matchNumber', async () => {
    const app = await buildApp();
    const tournament = await createTestTournament(app, 4);
    await claimAllTeams(app, tournament, claimerPoolFor(4));
    await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    const matches = res.json().tournament.matches as { roundNumber: number; matchNumber: number }[];
    expect(matches).toHaveLength(6);
    const sorted = [...matches].sort((a, b) => a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber);
    expect(matches).toEqual(sorted);
  });
});

describe('GET /api/osma-liga/tournaments/:code returns empty matches before start', () => {
  it('returns matches: [] for a freshly created tournament', async () => {
    const app = await buildApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'No matches yet', playerCount: 4, createdByUserId: creatorUserId },
    });
    const { publicCode } = createRes.json().tournament;

    const res = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${publicCode}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tournament.matches).toEqual([]);
  });
});

describe('POST /api/osma-liga/tournaments/:code/matches/:matchId/play', () => {
  type TestMatch = {
    id: string;
    tournamentId: string;
    status: string;
    onlineMatchId: string | null;
    startedAt: string | null;
    homeTeamId: string;
    awayTeamId: string;
  };
  type StartedTournament = {
    id: string;
    publicCode: string;
    status: string;
    teams: { id: string; claimedByUserId: string | null }[];
    matches: TestMatch[];
  };

  async function createAndStartTournament(
    app: Awaited<ReturnType<typeof buildApp>>,
    playerCount: number,
  ): Promise<StartedTournament> {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'Play test', playerCount, createdByUserId: creatorUserId },
    });
    const tournament = createRes.json().tournament as { publicCode: string; teams: { id: string }[] };

    const claimers = [creatorUserId, secondUserId, ...extraUserIds].slice(0, playerCount);
    for (let i = 0; i < playerCount; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[i].id}/claim`,
        headers: authHeaders,
        payload: { userId: claimers[i] },
      });
      if (res.statusCode !== 200) {
        throw new Error(`Failed to claim team ${i}: ${res.statusCode} ${res.body}`);
      }
    }

    const startRes = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    if (startRes.statusCode !== 200) {
      throw new Error(`Failed to start tournament: ${startRes.statusCode} ${startRes.body}`);
    }
    return startRes.json().tournament as StartedTournament;
  }

  it('requires the api key', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 2);
    const match = tournament.matches[0];
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown userId', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 2);
    const match = tournament.matches[0];
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
      headers: authHeaders,
      payload: { userId: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown tournament code', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 2);
    const match = tournament.matches[0];
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/zzzzzz/matches/${match.id}/play`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for an unknown matchId', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 2);
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/does-not-exist/play`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the match belongs to a different tournament', async () => {
    const app = await buildApp();
    const tournamentA = await createAndStartTournament(app, 2);
    const tournamentB = await createAndStartTournament(app, 2);
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournamentA.publicCode}/matches/${tournamentB.matches[0].id}/play`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a user who is not a player of the match', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 2);
    const match = tournament.matches[0];
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
      headers: authHeaders,
      payload: { userId: extraUserIds[0] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets the home team player start a scheduled match', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 2);
    const match = tournament.matches[0];
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
      headers: authHeaders,
      payload: { userId: creatorUserId }, // creator claimed team 1 (home) in a 2-player tournament
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.onlineMatchId).toBeTruthy();
    expect(body.joinUrlPath).toBe(`/hra/online/${body.onlineMatchId}`);
    expect(body.playerToken).toBeTruthy();
    expect(body.match.status).toBe('in_progress');
    expect(body.match.onlineMatchId).toBe(body.onlineMatchId);
    expect(body.match.startedAt).not.toBeNull();

    // The room really was created via the existing online-games store —
    // no parallel system — and carries the tournament metadata.
    const room = getGame(body.onlineMatchId);
    expect(room).not.toBeNull();
    expect(room!.tournamentId).toBe(tournament.id);
    expect(room!.tournamentMatchId).toBe(match.id);
    expect(room!.homeUserId).toBe(creatorUserId);
  });

  it('lets the away team player start a scheduled match', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 2);
    const match = tournament.matches[0];
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
      headers: authHeaders,
      payload: { userId: secondUserId }, // secondUserId claimed team 2 (away)
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.onlineMatchId).toBeTruthy();
    expect(body.match.status).toBe('in_progress');
  });

  it('returns the existing onlineMatchId on a second call without creating a new game', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 2);
    const match = tournament.matches[0];

    const first = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    const firstOnlineMatchId = first.json().onlineMatchId;

    const second = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
      headers: authHeaders,
      payload: { userId: secondUserId },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json();
    expect(secondBody.onlineMatchId).toBe(firstOnlineMatchId);
    // No fresh host token minted for the second (non-creating) caller.
    expect(secondBody.playerToken).toBeUndefined();

    const detail = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}`,
      headers: authHeaders,
    });
    const detailMatch = detail.json().tournament.matches.find((m: TestMatch) => m.id === match.id);
    expect(detailMatch.onlineMatchId).toBe(firstOnlineMatchId);
    expect(detailMatch.status).toBe('in_progress');
  });

  it('concurrent play calls (double click) never create two online games', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 2);
    const match = tournament.matches[0];

    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
        headers: authHeaders,
        payload: { userId: creatorUserId },
      }),
      app.inject({
        method: 'POST',
        url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
        headers: authHeaders,
        payload: { userId: secondUserId },
      }),
    ]);
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    const id1 = res1.json().onlineMatchId;
    const id2 = res2.json().onlineMatchId;
    expect(id1).toBe(id2);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}`,
      headers: authHeaders,
    });
    const detailMatch = detail.json().tournament.matches.find((m: TestMatch) => m.id === match.id);
    expect(detailMatch.onlineMatchId).toBe(id1);
  });

  it('rejects playing when the tournament is not in_progress', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 2);
    const match = tournament.matches[0];
    await db.tournament.update({ where: { id: tournament.id }, data: { status: 'open' } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects playing a finished match', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 2);
    const match = tournament.matches[0];
    await db.tournamentMatch.update({ where: { id: match.id }, data: { status: 'finished' } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    expect(res.statusCode).toBe(409);
  });

  it('GET detail after playing returns match.status = in_progress and onlineMatchId', async () => {
    const app = await buildApp();
    const tournament = await createAndStartTournament(app, 4);
    const match = tournament.matches[0];
    await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}`,
      headers: authHeaders,
    });
    expect(res.statusCode).toBe(200);
    const detailMatch = res.json().tournament.matches.find((m: TestMatch) => m.id === match.id);
    expect(detailMatch.status).toBe('in_progress');
    expect(detailMatch.onlineMatchId).toBeTruthy();
    expect(detailMatch.startedAt).not.toBeNull();

    // Other, untouched matches stay scheduled with no onlineMatchId.
    const other = res.json().tournament.matches.find((m: TestMatch) => m.id !== match.id);
    expect(other.status).toBe('scheduled');
    expect(other.onlineMatchId).toBeNull();
  });
});
