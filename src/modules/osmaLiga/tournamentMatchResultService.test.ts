import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { tournamentRoutes } from './tournamentRoutes.js';
import { finishTournamentMatchFromOnlineGame } from './tournamentMatchResultService.js';

// Integration tests against the local dev Postgres — same pattern as
// tournamentRoutes.test.ts. finishTournamentMatchFromOnlineGame() is called
// directly (it's the function onlineGames.ts's tick loop calls when the
// server itself decides a match is over — there's no public endpoint to hit
// for this, by design, see the task report), with fixtures built through the
// real HTTP routes (create/claim/start/play) so the TournamentMatch and user
// ids are exactly what production would produce.
const API_KEY = process.env.PROJECT_HUB_API_KEY ?? '';
const authHeaders = { 'x-project-hub-key': API_KEY };

const TEST_DISCORD_ID = 'test-discord-match-result-creator';
const TEST_DISCORD_ID_2 = 'test-discord-match-result-claimer-2';
const TEST_DISCORD_ID_3 = 'test-discord-match-result-outsider';
const ALL_TEST_DISCORD_IDS = [TEST_DISCORD_ID, TEST_DISCORD_ID_2, TEST_DISCORD_ID_3];

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

let creatorUserId: string; // claims team 1 (home)
let secondUserId: string; // claims team 2 (away)
let outsiderUserId: string; // never claims a team in these tests

beforeAll(async () => {
  if (!API_KEY) {
    throw new Error('PROJECT_HUB_API_KEY is not set — these tests need a local Postgres + .env.');
  }
  await cleanupTestTournaments();
  const user = await db.osmaUser.upsert({
    where: { discordId: TEST_DISCORD_ID },
    update: {},
    create: { discordId: TEST_DISCORD_ID, username: 'match-result-tester' },
  });
  creatorUserId = user.id;
  const user2 = await db.osmaUser.upsert({
    where: { discordId: TEST_DISCORD_ID_2 },
    update: {},
    create: { discordId: TEST_DISCORD_ID_2, username: 'match-result-tester-2' },
  });
  secondUserId = user2.id;
  const user3 = await db.osmaUser.upsert({
    where: { discordId: TEST_DISCORD_ID_3 },
    update: {},
    create: { discordId: TEST_DISCORD_ID_3, username: 'match-result-outsider' },
  });
  outsiderUserId = user3.id;
});

afterEach(async () => {
  await cleanupTestTournaments();
});

afterAll(async () => {
  await cleanupTestTournaments();
  await db.osmaUser.deleteMany({ where: { discordId: { in: ALL_TEST_DISCORD_IDS } } });
  await db.$disconnect();
});

type TestMatch = { id: string; homeTeamId: string; awayTeamId: string; onlineMatchId: string | null };
type TestTournament = {
  publicCode: string;
  teams: { id: string; claimedByUserId: string | null }[];
  matches: TestMatch[];
};

// Creates a 2-player (derby) tournament, claims both teams, starts it, and
// plays the (only) match as `playFirstAs` — mirroring exactly what
// tournamentService.ts#playTournamentMatch does: whoever calls /play first
// becomes the online-game room's home side, regardless of which tournament
// team they actually claimed. Returns the match plus the room code (which
// is what TournamentMatch.onlineMatchId gets set to).
async function createPlayedMatch(
  app: Awaited<ReturnType<typeof buildApp>>,
  playFirstAs: 'home' | 'away',
): Promise<{ match: TestMatch; onlineMatchId: string; homeTeamId: string; awayTeamId: string; publicCode: string }> {
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/osma-liga/tournaments',
    headers: authHeaders,
    payload: { name: 'Match result test', playerCount: 2, createdByUserId: creatorUserId },
  });
  const tournament = createRes.json().tournament as TestTournament;

  await app.inject({
    method: 'POST',
    url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[0].id}/claim`,
    headers: authHeaders,
    payload: { userId: creatorUserId },
  });
  await app.inject({
    method: 'POST',
    url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[1].id}/claim`,
    headers: authHeaders,
    payload: { userId: secondUserId },
  });

  const startRes = await app.inject({
    method: 'POST',
    url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
    headers: authHeaders,
    payload: { userId: creatorUserId },
  });
  const started = startRes.json().tournament as TestTournament;
  const match = started.matches[0];

  const playAsUserId = playFirstAs === 'home' ? creatorUserId : secondUserId;
  const playRes = await app.inject({
    method: 'POST',
    url: `/api/osma-liga/tournaments/${tournament.publicCode}/matches/${match.id}/play`,
    headers: authHeaders,
    payload: { userId: playAsUserId },
  });
  const onlineMatchId = playRes.json().onlineMatchId as string;

  return {
    match,
    onlineMatchId,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    publicCode: tournament.publicCode,
  };
}

describe('finishTournamentMatchFromOnlineGame — no linked TournamentMatch', () => {
  it('is a safe no-op for a plain online game (no TournamentMatch has this code)', async () => {
    const result = await finishTournamentMatchFromOnlineGame({
      onlineMatchId: 'NOTREAL',
      homeUserId: creatorUserId,
      awayUserId: secondUserId,
      homeScore: 3,
      awayScore: 1,
    });
    expect(result.outcome).toBe('not_a_tournament_match');
  });

  it('a scheduled tournament match with no onlineMatchId is never accidentally finished', async () => {
    const app = await buildApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/osma-liga/tournaments',
      headers: authHeaders,
      payload: { name: 'Unplayed match test', playerCount: 2, createdByUserId: creatorUserId },
    });
    const tournament = createRes.json().tournament as TestTournament;
    await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[0].id}/claim`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/teams/${tournament.teams[1].id}/claim`,
      headers: authHeaders,
      payload: { userId: secondUserId },
    });
    const startRes = await app.inject({
      method: 'POST',
      url: `/api/osma-liga/tournaments/${tournament.publicCode}/start`,
      headers: authHeaders,
      payload: { userId: creatorUserId },
    });
    const match = (startRes.json().tournament as TestTournament).matches[0];
    expect(match.onlineMatchId).toBeNull();

    // Some unrelated online game happens to reuse a code that isn't linked
    // to this (or any) match — must not touch the still-scheduled match.
    const result = await finishTournamentMatchFromOnlineGame({
      onlineMatchId: 'UNRELATED',
      homeUserId: creatorUserId,
      awayUserId: secondUserId,
      homeScore: 5,
      awayScore: 0,
    });
    expect(result.outcome).toBe('not_a_tournament_match');

    const stillScheduled = await db.tournamentMatch.findUnique({ where: { id: match.id } });
    expect(stillScheduled?.status).toBe('scheduled');
    expect(stillScheduled?.homeScore).toBeNull();
  });
});

describe('finishTournamentMatchFromOnlineGame — score mapping and winner', () => {
  it('finds the correct TournamentMatch by onlineMatchId', async () => {
    const app = await buildApp();
    const { match, onlineMatchId } = await createPlayedMatch(app, 'home');

    const result = await finishTournamentMatchFromOnlineGame({
      onlineMatchId,
      homeUserId: creatorUserId,
      awayUserId: secondUserId,
      homeScore: 2,
      awayScore: 2,
    });
    expect(result.outcome).toBe('finished');
    if (result.outcome === 'finished') {
      expect(result.match.id).toBe(match.id);
    }
  });

  it('home team win: room home == tournament home (creator played first)', async () => {
    const app = await buildApp();
    const { match, onlineMatchId, homeTeamId } = await createPlayedMatch(app, 'home');

    const result = await finishTournamentMatchFromOnlineGame({
      onlineMatchId,
      homeUserId: creatorUserId, // room home == tournament home, no swap needed
      awayUserId: secondUserId,
      homeScore: 3,
      awayScore: 1,
    });
    expect(result.outcome).toBe('finished');
    if (result.outcome !== 'finished') throw new Error('expected finished');
    expect(result.match.homeScore).toBe(3);
    expect(result.match.awayScore).toBe(1);
    expect(result.match.winnerTeamId).toBe(homeTeamId);
    expect(result.match.status).toBe('finished');
    expect(result.match.finishedAt).not.toBeNull();
    void match;
  });

  it('away team win: room home == tournament AWAY team (away player played first) — score is swapped', async () => {
    const app = await buildApp();
    const { onlineMatchId, homeTeamId, awayTeamId } = await createPlayedMatch(app, 'away');

    // secondUserId (tournament AWAY) is the one who called /play first, so
    // they are room.homeUserId. The room reports its own home side (3
    // goals) winning — that must land as the tournament's AWAY score/winner.
    const result = await finishTournamentMatchFromOnlineGame({
      onlineMatchId,
      homeUserId: secondUserId,
      awayUserId: creatorUserId,
      homeScore: 3, // room home (secondUserId / tournament away) scored 3
      awayScore: 1, // room away (creatorUserId / tournament home) scored 1
    });
    expect(result.outcome).toBe('finished');
    if (result.outcome !== 'finished') throw new Error('expected finished');
    expect(result.match.homeScore).toBe(1); // tournament home (creator) score
    expect(result.match.awayScore).toBe(3); // tournament away (second) score
    expect(result.match.winnerTeamId).toBe(awayTeamId);
    void homeTeamId;
  });

  it('draw sets winnerTeamId to null', async () => {
    const app = await buildApp();
    const { onlineMatchId } = await createPlayedMatch(app, 'home');

    const result = await finishTournamentMatchFromOnlineGame({
      onlineMatchId,
      homeUserId: creatorUserId,
      awayUserId: secondUserId,
      homeScore: 2,
      awayScore: 2,
    });
    expect(result.outcome).toBe('finished');
    if (result.outcome !== 'finished') throw new Error('expected finished');
    expect(result.match.homeScore).toBe(2);
    expect(result.match.awayScore).toBe(2);
    expect(result.match.winnerTeamId).toBeNull();
    expect(result.match.status).toBe('finished');
  });

  it('refuses to guess when neither room user id matches a claimed team', async () => {
    const app = await buildApp();
    const { match, onlineMatchId } = await createPlayedMatch(app, 'home');

    const result = await finishTournamentMatchFromOnlineGame({
      onlineMatchId,
      homeUserId: outsiderUserId,
      awayUserId: null,
      homeScore: 4,
      awayScore: 0,
    });
    expect(result.outcome).toBe('mapping_unresolved');

    const unchanged = await db.tournamentMatch.findUnique({ where: { id: match.id } });
    expect(unchanged?.status).toBe('in_progress');
    expect(unchanged?.homeScore).toBeNull();
  });
});

describe('finishTournamentMatchFromOnlineGame — idempotence', () => {
  it('a repeat finish with the identical result is a safe no-op', async () => {
    const app = await buildApp();
    const { onlineMatchId, homeTeamId } = await createPlayedMatch(app, 'home');

    const first = await finishTournamentMatchFromOnlineGame({
      onlineMatchId,
      homeUserId: creatorUserId,
      awayUserId: secondUserId,
      homeScore: 2,
      awayScore: 0,
    });
    expect(first.outcome).toBe('finished');

    const second = await finishTournamentMatchFromOnlineGame({
      onlineMatchId,
      homeUserId: creatorUserId,
      awayUserId: secondUserId,
      homeScore: 2,
      awayScore: 0,
    });
    expect(second.outcome).toBe('already_finished_same_result');
    if (second.outcome !== 'already_finished_same_result') throw new Error('expected already_finished_same_result');
    expect(second.match.homeScore).toBe(2);
    expect(second.match.awayScore).toBe(0);
    expect(second.match.winnerTeamId).toBe(homeTeamId);
  });

  it('a repeat finish with a DIFFERENT result does not overwrite the stored one', async () => {
    const app = await buildApp();
    const { onlineMatchId } = await createPlayedMatch(app, 'home');

    await finishTournamentMatchFromOnlineGame({
      onlineMatchId,
      homeUserId: creatorUserId,
      awayUserId: secondUserId,
      homeScore: 2,
      awayScore: 0,
    });

    const conflicting = await finishTournamentMatchFromOnlineGame({
      onlineMatchId,
      homeUserId: creatorUserId,
      awayUserId: secondUserId,
      homeScore: 9,
      awayScore: 9,
    });
    expect(conflicting.outcome).toBe('conflict');
    if (conflicting.outcome !== 'conflict') throw new Error('expected conflict');
    // The original result is preserved, not the conflicting one.
    expect(conflicting.match.homeScore).toBe(2);
    expect(conflicting.match.awayScore).toBe(0);
  });
});

describe('GET /api/osma-liga/tournaments/:code — result visible after finish', () => {
  it('returns status finished, homeScore, awayScore, winnerTeamId, finishedAt after a finish', async () => {
    const app = await buildApp();
    const { match, onlineMatchId, homeTeamId, publicCode } = await createPlayedMatch(app, 'home');

    await finishTournamentMatchFromOnlineGame({
      onlineMatchId,
      homeUserId: creatorUserId,
      awayUserId: secondUserId,
      homeScore: 4,
      awayScore: 2,
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/api/osma-liga/tournaments/${publicCode}`,
      headers: authHeaders,
    });
    expect(detail.statusCode).toBe(200);
    const detailMatch = detail.json().tournament.matches.find((m: TestMatch) => m.id === match.id);
    expect(detailMatch.status).toBe('finished');
    expect(detailMatch.homeScore).toBe(4);
    expect(detailMatch.awayScore).toBe(2);
    expect(detailMatch.winnerTeamId).toBe(homeTeamId);
    expect(detailMatch.finishedAt).not.toBeNull();
  });
});
