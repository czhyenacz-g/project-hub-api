import { TournamentTeam, TournamentMatch } from '@prisma/client';

// Pure, DB-free — takes exactly the two row shapes already loaded by
// getTournamentByPublicCode()/checkAndFinishTournament() and returns a
// derived view. Never writes anything, never called with anything other
// than data that's already been fetched, so it's trivial to unit test with
// plain object literals (see tournamentStandings.test.ts).
export interface TournamentStandingRow {
  teamId: string;
  slotNumber: number;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

/**
 * MVP tournament table — every team appears even with zero matches played
 * (all-zero row), so the frontend can render the full table from kickoff
 * onward instead of handling a "some teams missing" case.
 *
 * Only counts matches with status === 'finished' AND both scores present —
 * scheduled/in_progress/void/replay_required matches (or a finished match
 * that somehow has a null score) are ignored entirely, matching exactly
 * what finishTournamentMatchFromOnlineGame.ts ever writes.
 *
 * Scoring: win = 3, draw = 1, loss = 0 — standard football points, nothing
 * league-specific configurable here (MVP scope).
 *
 * Sort order (MVP tie-break, no head-to-head): points desc, goalDifference
 * desc, goalsFor desc, goalsAgainst asc, slotNumber asc (stable, deterministic
 * fallback — never leaves two teams in an arbitrary/unstable order).
 */
export function calculateTournamentStandings(
  teams: TournamentTeam[],
  matches: TournamentMatch[],
): TournamentStandingRow[] {
  const rows = new Map<string, TournamentStandingRow>();
  for (const team of teams) {
    rows.set(team.id, {
      teamId: team.id,
      slotNumber: team.slotNumber,
      name: team.name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    });
  }

  for (const match of matches) {
    if (match.status !== 'finished') continue;
    if (match.homeScore === null || match.awayScore === null) continue;

    const home = rows.get(match.homeTeamId);
    const away = rows.get(match.awayTeamId);
    if (!home || !away) continue; // defensive — every match's teams belong to this tournament

    home.played += 1;
    away.played += 1;
    home.goalsFor += match.homeScore;
    home.goalsAgainst += match.awayScore;
    away.goalsFor += match.awayScore;
    away.goalsAgainst += match.homeScore;

    if (match.homeScore > match.awayScore) {
      home.wins += 1;
      home.points += 3;
      away.losses += 1;
    } else if (match.awayScore > match.homeScore) {
      away.wins += 1;
      away.points += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      home.points += 1;
      away.draws += 1;
      away.points += 1;
    }
  }

  for (const row of rows.values()) {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
  }

  return Array.from(rows.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    if (a.goalsAgainst !== b.goalsAgainst) return a.goalsAgainst - b.goalsAgainst;
    return a.slotNumber - b.slotNumber;
  });
}
