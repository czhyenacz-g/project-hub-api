import { describe, it, expect } from 'vitest';
import { TournamentTeam, TournamentMatch } from '@prisma/client';
import { calculateTournamentStandings } from './tournamentStandings.js';

// Plain object literals — calculateTournamentStandings is pure and DB-free,
// so no Postgres/Fastify app needed for these tests (unlike
// tournamentRoutes.test.ts / tournamentMatchResultService.test.ts).

function makeTeam(overrides: Partial<TournamentTeam> & { id: string; slotNumber: number }): TournamentTeam {
  return {
    tournamentId: 't1',
    name: `Tým ${overrides.slotNumber}`,
    claimedByUserId: null,
    claimedAt: null,
    seed: overrides.slotNumber,
    finalRank: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMatch(overrides: Partial<TournamentMatch> & { id: string; homeTeamId: string; awayTeamId: string }): TournamentMatch {
  return {
    tournamentId: 't1',
    phase: 'league',
    roundNumber: 1,
    matchNumber: 1,
    homeScore: null,
    awayScore: null,
    winnerTeamId: null,
    status: 'scheduled',
    onlineMatchId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

const teamA = makeTeam({ id: 'a', slotNumber: 1, name: 'Tým A' });
const teamB = makeTeam({ id: 'b', slotNumber: 2, name: 'Tým B' });
const teamC = makeTeam({ id: 'c', slotNumber: 3, name: 'Tým C' });

describe('calculateTournamentStandings', () => {
  it('returns all teams, all-zero, when there are no matches at all', () => {
    const standings = calculateTournamentStandings([teamA, teamB, teamC], []);
    expect(standings).toHaveLength(3);
    for (const row of standings) {
      expect(row.played).toBe(0);
      expect(row.wins).toBe(0);
      expect(row.draws).toBe(0);
      expect(row.losses).toBe(0);
      expect(row.goalsFor).toBe(0);
      expect(row.goalsAgainst).toBe(0);
      expect(row.goalDifference).toBe(0);
      expect(row.points).toBe(0);
    }
  });

  it('returns all teams, all-zero, when matches exist but none are finished', () => {
    const matches = [
      makeMatch({ id: 'm1', homeTeamId: 'a', awayTeamId: 'b', status: 'scheduled' }),
      makeMatch({ id: 'm2', homeTeamId: 'a', awayTeamId: 'c', status: 'in_progress' }),
    ];
    const standings = calculateTournamentStandings([teamA, teamB, teamC], matches);
    expect(standings.every((r) => r.played === 0)).toBe(true);
  });

  it('a home win awards the home team 3 points and the away team 0', () => {
    const matches = [makeMatch({ id: 'm1', homeTeamId: 'a', awayTeamId: 'b', status: 'finished', homeScore: 2, awayScore: 0 })];
    const standings = calculateTournamentStandings([teamA, teamB], matches);
    const home = standings.find((r) => r.teamId === 'a')!;
    const away = standings.find((r) => r.teamId === 'b')!;
    expect(home.points).toBe(3);
    expect(home.wins).toBe(1);
    expect(home.losses).toBe(0);
    expect(away.points).toBe(0);
    expect(away.losses).toBe(1);
    expect(away.wins).toBe(0);
  });

  it('an away win awards the away team 3 points and the home team 0', () => {
    const matches = [makeMatch({ id: 'm1', homeTeamId: 'a', awayTeamId: 'b', status: 'finished', homeScore: 0, awayScore: 3 })];
    const standings = calculateTournamentStandings([teamA, teamB], matches);
    const home = standings.find((r) => r.teamId === 'a')!;
    const away = standings.find((r) => r.teamId === 'b')!;
    expect(away.points).toBe(3);
    expect(away.wins).toBe(1);
    expect(home.points).toBe(0);
    expect(home.losses).toBe(1);
  });

  it('a draw gives both teams 1 point', () => {
    const matches = [makeMatch({ id: 'm1', homeTeamId: 'a', awayTeamId: 'b', status: 'finished', homeScore: 1, awayScore: 1 })];
    const standings = calculateTournamentStandings([teamA, teamB], matches);
    const home = standings.find((r) => r.teamId === 'a')!;
    const away = standings.find((r) => r.teamId === 'b')!;
    expect(home.points).toBe(1);
    expect(away.points).toBe(1);
    expect(home.draws).toBe(1);
    expect(away.draws).toBe(1);
    expect(home.wins).toBe(0);
    expect(away.wins).toBe(0);
  });

  it('computes goalsFor/goalsAgainst/goalDifference correctly across multiple matches', () => {
    const matches = [
      makeMatch({ id: 'm1', homeTeamId: 'a', awayTeamId: 'b', status: 'finished', homeScore: 3, awayScore: 1 }),
      makeMatch({ id: 'm2', homeTeamId: 'b', awayTeamId: 'a', status: 'finished', homeScore: 2, awayScore: 2 }),
    ];
    const standings = calculateTournamentStandings([teamA, teamB], matches);
    const a = standings.find((r) => r.teamId === 'a')!;
    const b = standings.find((r) => r.teamId === 'b')!;
    // a: scored 3 (m1 home) + 2 (m2 away) = 5; conceded 1 (m1) + 2 (m2) = 3
    expect(a.goalsFor).toBe(5);
    expect(a.goalsAgainst).toBe(3);
    expect(a.goalDifference).toBe(2);
    // b: scored 1 (m1) + 2 (m2 home) = 3; conceded 3 (m1) + 2 (m2) = 5
    expect(b.goalsFor).toBe(3);
    expect(b.goalsAgainst).toBe(5);
    expect(b.goalDifference).toBe(-2);
    expect(a.played).toBe(2);
    expect(b.played).toBe(2);
  });

  it('ignores scheduled/in_progress/void/replay_required matches and finished matches without scores', () => {
    const matches = [
      makeMatch({ id: 'm1', homeTeamId: 'a', awayTeamId: 'b', status: 'scheduled' }),
      makeMatch({ id: 'm2', homeTeamId: 'a', awayTeamId: 'b', status: 'in_progress' }),
      makeMatch({ id: 'm3', homeTeamId: 'a', awayTeamId: 'b', status: 'void', homeScore: 9, awayScore: 9 }),
      makeMatch({ id: 'm4', homeTeamId: 'a', awayTeamId: 'b', status: 'replay_required', homeScore: 1, awayScore: 1 }),
      makeMatch({ id: 'm5', homeTeamId: 'a', awayTeamId: 'b', status: 'finished', homeScore: null, awayScore: null }),
    ];
    const standings = calculateTournamentStandings([teamA, teamB], matches);
    expect(standings.every((r) => r.played === 0)).toBe(true);
  });

  it('sorts by points descending', () => {
    // Each team plays a separate opponent so points differ cleanly without
    // entangling goalDifference between a/b/c themselves.
    const teamX = makeTeam({ id: 'x', slotNumber: 4 });
    const teamY = makeTeam({ id: 'y', slotNumber: 5 });
    const matches = [
      makeMatch({ id: 'm1', homeTeamId: 'a', awayTeamId: 'x', status: 'finished', homeScore: 3, awayScore: 0 }), // a: 3pts
      makeMatch({ id: 'm2', homeTeamId: 'b', awayTeamId: 'y', status: 'finished', homeScore: 1, awayScore: 1 }), // b: 1pt
      // c plays no match — stays at 0pts, identical all-zero row to a fresh team.
    ];
    const standings = calculateTournamentStandings([teamA, teamB, teamC], matches);
    expect(standings.map((r) => r.teamId)).toEqual(['a', 'b', 'c']); // a(3) > b(1) > c(0)
  });

  it('tie-breaks equal points by goalDifference descending', () => {
    const matches = [
      makeMatch({ id: 'm1', homeTeamId: 'a', awayTeamId: 'c', status: 'finished', homeScore: 5, awayScore: 0 }), // a: 3pts, GD +5
      makeMatch({ id: 'm2', homeTeamId: 'b', awayTeamId: 'c', status: 'finished', homeScore: 1, awayScore: 0 }), // b: 3pts, GD +1
    ];
    const standings = calculateTournamentStandings([teamA, teamB, teamC], matches);
    expect(standings[0].teamId).toBe('a'); // same points as b, better GD
    expect(standings[1].teamId).toBe('b');
  });

  it('tie-breaks equal points and goalDifference by goalsFor descending', () => {
    const matches = [
      makeMatch({ id: 'm1', homeTeamId: 'a', awayTeamId: 'x', status: 'finished', homeScore: 4, awayScore: 2 }), // a: 3pts, GD +2, GF 4
      makeMatch({ id: 'm2', homeTeamId: 'b', awayTeamId: 'x', status: 'finished', homeScore: 3, awayScore: 1 }), // b: 3pts, GD +2, GF 3
    ];
    const teamX = makeTeam({ id: 'x', slotNumber: 4 });
    const standings = calculateTournamentStandings([teamA, teamB, teamX], matches);
    const aIndex = standings.findIndex((r) => r.teamId === 'a');
    const bIndex = standings.findIndex((r) => r.teamId === 'b');
    expect(aIndex).toBeLessThan(bIndex); // same points and GD, a scored more
  });

  // goalsAgainst is included as an explicit 4th tie-break level per spec, but
  // since goalDifference is defined as goalsFor - goalsAgainst, two rows that
  // are already tied on both goalDifference AND goalsFor are mathematically
  // forced to also be tied on goalsAgainst (GA = GF - GD) — real match data
  // can never produce a case where it's the deciding factor. This test
  // documents that: the comparator still reaches the goalsAgainst line
  // without erroring or reordering anything, and — since GA is equal too in
  // that state — falls through to the final slotNumber tie-break exactly
  // like the "everything tied" case.
  it('reaches the goalsAgainst comparison when points/goalDifference/goalsFor are tied, and falls through to slotNumber (GA is equal too by definition)', () => {
    const teamX = makeTeam({ id: 'x', slotNumber: 4 });
    const teamHighSlot = makeTeam({ id: 'z', slotNumber: 9, name: 'Tým Z' });
    const matches = [
      makeMatch({ id: 'm1', homeTeamId: 'a', awayTeamId: 'x', status: 'finished', homeScore: 2, awayScore: 0 }),
      makeMatch({ id: 'm2', homeTeamId: 'z', awayTeamId: 'x', status: 'finished', homeScore: 2, awayScore: 0 }),
    ];
    const standings = calculateTournamentStandings([teamA, teamHighSlot, teamX], matches);
    const a = standings.find((r) => r.teamId === 'a')!;
    const z = standings.find((r) => r.teamId === 'z')!;
    expect(a.points).toBe(z.points);
    expect(a.goalDifference).toBe(z.goalDifference);
    expect(a.goalsFor).toBe(z.goalsFor);
    expect(a.goalsAgainst).toBe(z.goalsAgainst); // forced equal, not independently controllable
    expect(standings.findIndex((r) => r.teamId === 'a')).toBeLessThan(standings.findIndex((r) => r.teamId === 'z')); // slotNumber 1 < 9
  });

  it('falls back to slotNumber ascending when everything else is tied (no matches played)', () => {
    const teamHighSlot = makeTeam({ id: 'z', slotNumber: 9 });
    const standings = calculateTournamentStandings([teamHighSlot, teamA], []);
    expect(standings.map((r) => r.teamId)).toEqual(['a', 'z']); // slotNumber 1 before 9
  });
});
