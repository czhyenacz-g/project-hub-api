import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { tournamentRoutes } from './tournamentRoutes.js';
import { checkAndFinishTournament } from './tournamentCompletionService.js';

// Integration tests against the local dev Postgres — same pattern as
// tournamentRoutes.test.ts / tournamentMatchResultService.test.ts.
// checkAndFinishTournament() is called directly (it's what
// tournamentMatchResultService.ts calls right after a match result is
// saved — there's no public endpoint for this, by design). Match results
// are written straight to the DB via `db.tournamentMatch.update` here
// rather than through the full online-game finish pipeline — that mapping/
// scoring logic is already covered by tournamentMatchResultService.test.ts;
// this file is purely about "once matches are finished, does the tournament
// itself wrap up correctly".
const API_KEY = process.env.PROJECT_HUB_API_KEY ?? '';
const authHeaders = { 'x-project-hub-key': API_KEY };

const TEST_DISCORD_ID = 'test-discord-completion-creator';
const EXTRA_DISCORD_IDS = Array.from({ length: 7 }, (_, i) => `test-discord-completion-claimer-${i + 2}`);
const ALL_TEST_DISCORD_IDS = [TEST_DISCORD_ID, ...EXTRA_DISCORD_IDS];

async function buildApp() {
  const app = Fastify();
  await app.register(tournamentRoutes);
  return app;
}

async function testUserIds(): Promise<string[]> {
  const users = await db.osmaUser.findMany({
    where: { discordId: { in: ALL_TEST_DISCORD_IDS } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function cleanupTestTournaments(): Promise<void> {
  await db.tournament.deleteMany({ where: { createdByUserId: { in: await testUserIds() } } });
}

let creatorUserId: string;
let claimerUserIds: string[];

beforeAll(async () => {
  if (!API_KEY) {
    throw new Error('PROJECT_HUB_API_KEY is not set — these tests need a local Postgres + .env.');
  }
  await cleanupTestTournaments();
  const creator = await db.osmaUser.upsert({
    where: { discordId: TEST_DISCORD_ID },
    update: {},
    create: { discordId: TEST_DISCORD_ID, username: 'completion-tester' },
  });
  creatorUserId = creator.id;
  claimerUserIds = [];
  for (const [i, discordId] of EXTRA_DISCORD_IDS.entries()) {
    const user = await db.osmaUser.upsert({
      where: { discordId },
      update: {},
      create: { discordId, username: `completion-tester-${i + 2}` },
    });
    claimerUserIds.push(user.id);
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

type TestTeam = { id: string; slotNumber: number; claimedByUserId: string | null };
type TestMatch = { id: string; homeTeamId: string; awayTeamId: string; status: string };
type TestTournament = {
  id: string;
  publicCode: string;
  status: string;
  teams: TestTeam[];
  matches: TestMatch[];
};

// Creates and starts a tournament with `playerCount` teams, all claimed by
// distinct users (creator + claimerUserIds pool).
async function createStartedTournament(
  app: Awaited<ReturnType<typeof buildApp>>,
  playerCount: number,
): Promise<TestTournament> {
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/osma-liga/tournaments',
    headers: authHeaders,
    payload: { name: 'Completion test', playerCount, createdByUserId: creatorUserId },
  });
  const tournament = createRes.json().tournament as TestTournament;

  const claimers = [creatorUserId, ...claimerUserIds].slice(0, playerCount);
  for (let i = 0; i < playerCount; i++) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[i].id}/claim`,
      headers: authHeaders,
      payload: { userId: claimers[i] },
    });
    if (res.statusCode !== 200) throw new Error(`Failed to claim team ${i}: ${res.statusCode} ${res.body}`);
  }

  const startRes = await app.inject({
    method: 'POST',
    url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
    headers: authHeaders,
    payload: { userId: creatorUserId },
  });
  if (startRes.statusCode !== 200) throw new Error(`Failed to start tournament: ${startRes.statusCode} ${startRes.body}`);
  return startRes.json().tournament as TestTournament;
}

// Writes a finished result directly to a TournamentMatch row — bypasses the
// online-game finish pipeline (already covered by
// tournamentMatchResultService.test.ts) so these tests stay focused on
// tournament-level completion.
async function finishMatchDirectly(matchId: string, homeScore: number, awayScore: number): Promise<void> {
  await db.tournamentMatch.update({
    where: { id: matchId },
    data: { homeScore, awayScore, status: 'finished', finishedAt: new Date() },
  });
}

describe('checkAndFinishTournament — waits for all generated matches', () => {
  it('does not finish while at least one match is still scheduled', async () => {
    const app = await buildApp();
    const tournament = await createStartedTournament(app, 2); // derby: 3 matches
    await finishMatchDirectly(tournament.matches[0].id, 2, 0);
    // matches[1] and [2] left 'scheduled'

    const result = await checkAndFinishTournament(tournament.id);
    expect(result.outcome).toBe('not_ready');

    const row = await db.tournament.findUnique({ where: { id: tournament.id } });
    expect(row?.status).toBe('in_progress');
    expect(row?.winnerTeamId).toBeNull();
    expect(row?.finishedAt).toBeNull();
  });

  it('does not finish while a match is in_progress (even with no scheduled ones left)', async () => {
    const app = await buildApp();
    const tournament = await createStartedTournament(app, 2);
    await finishMatchDirectly(tournament.matches[0].id, 2, 0);
    await finishMatchDirectly(tournament.matches[1].id, 1, 1);
    await db.tournamentMatch.update({ where: { id: tournament.matches[2].id }, data: { status: 'in_progress' } });

    const result = await checkAndFinishTournament(tournament.id);
    expect(result.outcome).toBe('not_ready');
    const row = await db.tournament.findUnique({ where: { id: tournament.id } });
    expect(row?.status).toBe('in_progress');
  });

  it('finishes once every generated match is finished', async () => {
    const app = await buildApp();
    const tournament = await createStartedTournament(app, 2);
    for (const m of tournament.matches) {
      await finishMatchDirectly(m.id, 1, 0);
    }

    const result = await checkAndFinishTournament(tournament.id);
    expect(result.outcome).toBe('finished');
    if (result.outcome !== 'finished') throw new Error('expected finished');
    expect(result.tournament.status).toBe('finished');
    expect(result.tournament.finishedAt).not.toBeNull();
  });
});

describe('checkAndFinishTournament — winner and standings', () => {
  it('sets winnerTeamId to the standings leader', async () => {
    const app = await buildApp();
    const tournament = await createStartedTournament(app, 2);
    // 2-player derby: 3 matches between the same 2 teams (home/away alternates
    // per generateTournamentMatches — assert on final standings, not assumed slots).
    for (const m of tournament.matches) {
      // Team in homeTeamId always wins 3:0 — home team may differ per match,
      // so read the winner back from standings rather than assuming.
      await finishMatchDirectly(m.id, 3, 0);
    }

    const result = await checkAndFinishTournament(tournament.id);
    expect(result.outcome).toBe('finished');
    if (result.outcome !== 'finished') throw new Error('expected finished');

    const detail = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}`,
      headers: authHeaders,
    });
    const body = detail.json();
    expect(body.tournament.winnerTeamId).toBe(body.tournament.standings[0].teamId);
  });

  it('sets finishedAt', async () => {
    const app = await buildApp();
    const tournament = await createStartedTournament(app, 2);
    for (const m of tournament.matches) await finishMatchDirectly(m.id, 1, 1);

    const before = new Date();
    const result = await checkAndFinishTournament(tournament.id);
    expect(result.outcome).toBe('finished');
    if (result.outcome !== 'finished') throw new Error('expected finished');
    expect(result.tournament.finishedAt).not.toBeNull();
    expect(new Date(result.tournament.finishedAt!).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('GET detail after completion returns status finished, winnerTeamId, finishedAt, and standings', async () => {
    const app = await buildApp();
    const tournament = await createStartedTournament(app, 2);
    for (const m of tournament.matches) await finishMatchDirectly(m.id, 2, 1);
    await checkAndFinishTournament(tournament.id);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}`,
      headers: authHeaders,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.tournament.status).toBe('finished');
    expect(body.tournament.winnerTeamId).not.toBeNull();
    expect(body.tournament.finishedAt).not.toBeNull();
    expect(body.tournament.standings).toHaveLength(2);
    expect(body.tournament.standings[0].points).toBeGreaterThanOrEqual(body.tournament.standings[1].points);
  });
});

describe('checkAndFinishTournament — idempotence', () => {
  it('a repeat finish check does not change finishedAt or winnerTeamId', async () => {
    const app = await buildApp();
    const tournament = await createStartedTournament(app, 2);
    for (const m of tournament.matches) await finishMatchDirectly(m.id, 1, 0);

    const first = await checkAndFinishTournament(tournament.id);
    expect(first.outcome).toBe('finished');
    if (first.outcome !== 'finished') throw new Error('expected finished');
    const firstFinishedAt = first.tournament.finishedAt;
    const firstWinnerTeamId = first.tournament.winnerTeamId;

    const second = await checkAndFinishTournament(tournament.id);
    expect(second.outcome).toBe('already_finished');
    if (second.outcome !== 'already_finished') throw new Error('expected already_finished');
    expect(second.tournament.finishedAt?.getTime()).toBe(firstFinishedAt?.getTime());
    expect(second.tournament.winnerTeamId).toBe(firstWinnerTeamId);
  });
});

describe('checkAndFinishTournament — matches generated per format', () => {
  it('a derby (2-player) tournament only finishes after all 3 derby matches', async () => {
    const app = await buildApp();
    const tournament = await createStartedTournament(app, 2);
    expect(tournament.matches).toHaveLength(3);

    await finishMatchDirectly(tournament.matches[0].id, 1, 0);
    await finishMatchDirectly(tournament.matches[1].id, 1, 0);
    expect((await checkAndFinishTournament(tournament.id)).outcome).toBe('not_ready');

    await finishMatchDirectly(tournament.matches[2].id, 1, 0);
    expect((await checkAndFinishTournament(tournament.id)).outcome).toBe('finished');
  });

  it('a 4-player league tournament finishes after all 6 league matches', async () => {
    const app = await buildApp();
    const tournament = await createStartedTournament(app, 4);
    expect(tournament.matches).toHaveLength(6);

    for (let i = 0; i < tournament.matches.length - 1; i++) {
      await finishMatchDirectly(tournament.matches[i].id, 1, 0);
    }
    expect((await checkAndFinishTournament(tournament.id)).outcome).toBe('not_ready');

    await finishMatchDirectly(tournament.matches[tournament.matches.length - 1].id, 1, 0);
    expect((await checkAndFinishTournament(tournament.id)).outcome).toBe('finished');
  });

  it('a 6-player league tournament finishes after all 15 league matches', async () => {
    const app = await buildApp();
    const tournament = await createStartedTournament(app, 6);
    expect(tournament.matches).toHaveLength(15);

    for (let i = 0; i < tournament.matches.length - 1; i++) {
      await finishMatchDirectly(tournament.matches[i].id, 2, 2);
    }
    expect((await checkAndFinishTournament(tournament.id)).outcome).toBe('not_ready');

    await finishMatchDirectly(tournament.matches[tournament.matches.length - 1].id, 2, 2);
    const result = await checkAndFinishTournament(tournament.id);
    expect(result.outcome).toBe('finished');
  });
});

describe('checkAndFinishTournament — not a tournament / not in progress', () => {
  it('returns tournament_not_found for an unknown id', async () => {
    const result = await checkAndFinishTournament('does-not-exist');
    expect(result.outcome).toBe('tournament_not_found');
  });

  it('returns not_ready for a tournament with no matches yet (still open)', async () => {
    const app = await buildApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'Not started yet', playerCount: 2, createdByUserId: creatorUserId },
    });
    const tournament = createRes.json().tournament as TestTournament;

    const result = await checkAndFinishTournament(tournament.id);
    expect(result.outcome).toBe('not_ready');
  });
});
