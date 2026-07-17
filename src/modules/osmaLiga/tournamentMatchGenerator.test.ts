import { describe, it, expect } from 'vitest';
import { generateTournamentMatches, type TeamForScheduling } from './tournamentMatchGenerator.js';

function makeTeams(n: number): TeamForScheduling[] {
  return Array.from({ length: n }, (_, i) => ({ id: `team-${i + 1}`, slotNumber: i + 1 }));
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

describe('generateTournamentMatches', () => {
  it('derby (2 teams) creates exactly 3 matches with alternating home/away', () => {
    const teams = makeTeams(2);
    const matches = generateTournamentMatches(teams, 'derby');
    expect(matches).toHaveLength(3);
    expect(matches.every((m) => m.phase === 'derby')).toBe(true);
    expect(matches.map((m) => m.roundNumber)).toEqual([1, 2, 3]);
    expect(matches.map((m) => m.matchNumber)).toEqual([1, 1, 1]);
    expect(matches[0]).toMatchObject({ homeTeamId: 'team-1', awayTeamId: 'team-2' });
    expect(matches[1]).toMatchObject({ homeTeamId: 'team-2', awayTeamId: 'team-1' });
    expect(matches[2]).toMatchObject({ homeTeamId: 'team-1', awayTeamId: 'team-2' });
  });

  it.each([
    [3, 3],
    [4, 6],
    [5, 10],
    [6, 15],
    [7, 21],
    [8, 28],
  ])('league round-robin for %i teams creates %i matches', (teamCount, expectedMatches) => {
    const teams = makeTeams(teamCount);
    const matches = generateTournamentMatches(teams, 'league_top2_final');
    expect(matches).toHaveLength(expectedMatches);
    expect(matches.every((m) => m.phase === 'league')).toBe(true);
  });

  it('league_top4_playoff also only generates the league phase', () => {
    const matches = generateTournamentMatches(makeTeams(6), 'league_top4_playoff');
    expect(matches).toHaveLength(15);
    expect(matches.every((m) => m.phase === 'league')).toBe(true);
  });

  it('no match has the same home and away team', () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const matches = generateTournamentMatches(makeTeams(n), 'league_top2_final');
      for (const m of matches) {
        expect(m.homeTeamId).not.toBe(m.awayTeamId);
      }
    }
  });

  it('no pairing repeats within the league round-robin', () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const matches = generateTournamentMatches(makeTeams(n), 'league_top2_final');
      const seen = new Set<string>();
      for (const m of matches) {
        const key = pairKey(m.homeTeamId, m.awayTeamId);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('every team plays every other team exactly once', () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const teams = makeTeams(n);
      const matches = generateTournamentMatches(teams, 'league_top2_final');
      const playedAgainst = new Map<string, Set<string>>();
      for (const t of teams) playedAgainst.set(t.id, new Set());
      for (const m of matches) {
        playedAgainst.get(m.homeTeamId)!.add(m.awayTeamId);
        playedAgainst.get(m.awayTeamId)!.add(m.homeTeamId);
      }
      for (const t of teams) {
        const opponents = playedAgainst.get(t.id)!;
        expect(opponents.size).toBe(n - 1);
        for (const other of teams) {
          if (other.id === t.id) continue;
          expect(opponents.has(other.id)).toBe(true);
        }
      }
    }
  });

  it('has no duplicate (roundNumber, matchNumber) pair within a tournament', () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const matches = generateTournamentMatches(makeTeams(n), 'league_top2_final');
      const seen = new Set<string>();
      for (const m of matches) {
        const key = `${m.roundNumber}:${m.matchNumber}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('is deterministic for the same input order', () => {
    const teams = makeTeams(6);
    const first = generateTournamentMatches(teams, 'league_top2_final');
    const second = generateTournamentMatches(teams, 'league_top2_final');
    expect(second).toEqual(first);
  });

  it('sorts by slotNumber before generating, independent of input array order', () => {
    const teams = makeTeams(4);
    const shuffled = [teams[2], teams[0], teams[3], teams[1]];
    const fromSorted = generateTournamentMatches(teams, 'league_top2_final');
    const fromShuffled = generateTournamentMatches(shuffled, 'league_top2_final');
    expect(fromShuffled).toEqual(fromSorted);
  });

  it('results are sortable by roundNumber then matchNumber into a stable schedule', () => {
    const matches = generateTournamentMatches(makeTeams(5), 'league_top2_final');
    const sorted = [...matches].sort((a, b) => a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber);
    expect(matches).toEqual(sorted);
  });
});
