export interface TournamentMatchDraft {
  phase: string;
  roundNumber: number;
  matchNumber: number;
  homeTeamId: string;
  awayTeamId: string;
}

export interface TeamForScheduling {
  id: string;
  slotNumber: number;
}

// Standard "circle method" round-robin: fixes one team and rotates the rest
// each round. With an odd team count a placeholder "bye" seat is added so
// the rotation still works — any pairing involving the bye is simply
// dropped, which is why the loop below filters nulls instead of counting on
// a fixed match count per round. Produces exactly n*(n-1)/2 matches, no
// repeated pairing, no team playing itself, deterministic given a
// deterministic input order (see generateTournamentMatches, which sorts by
// slotNumber before calling this).
function generateRoundRobinMatches(teamIds: string[]): TournamentMatchDraft[] {
  const seats: (string | null)[] = [...teamIds];
  if (seats.length % 2 !== 0) seats.push(null);

  const n = seats.length;
  const totalRounds = n - 1;
  const half = n / 2;

  const drafts: TournamentMatchDraft[] = [];
  let arranged = seats;

  for (let round = 1; round <= totalRounds; round++) {
    let matchNumber = 1;
    for (let i = 0; i < half; i++) {
      const home = arranged[i];
      const away = arranged[n - 1 - i];
      if (home !== null && away !== null) {
        drafts.push({ phase: 'league', roundNumber: round, matchNumber, homeTeamId: home, awayTeamId: away });
        matchNumber++;
      }
    }
    // Rotate everyone except the fixed first seat.
    const fixed = arranged[0];
    const rest = arranged.slice(1);
    const last = rest.pop();
    if (last !== undefined) rest.unshift(last);
    arranged = [fixed, ...rest];
  }

  return drafts;
}

// Derby (2 teams): a fixed best-of-3 schedule, home/away alternating.
// finishing the series early after 2 games (2-0) is future scope — this
// task only plans the full 3-match schedule.
function generateDerbyMatches(teams: TeamForScheduling[]): TournamentMatchDraft[] {
  if (teams.length !== 2) {
    throw new Error(`derby format requires exactly 2 teams, got ${teams.length}`);
  }
  const [t1, t2] = teams;
  return [
    { phase: 'derby', roundNumber: 1, matchNumber: 1, homeTeamId: t1.id, awayTeamId: t2.id },
    { phase: 'derby', roundNumber: 2, matchNumber: 1, homeTeamId: t2.id, awayTeamId: t1.id },
    { phase: 'derby', roundNumber: 3, matchNumber: 1, homeTeamId: t1.id, awayTeamId: t2.id },
  ];
}

// Generates the initial match schedule for a tournament, given its claimed
// teams and format. For league formats (3-8 teams) this only produces the
// round-robin league phase — playoff/final matches are generated later
// (from the standings), not by this function.
export function generateTournamentMatches(
  teams: TeamForScheduling[],
  format: string,
): TournamentMatchDraft[] {
  const sorted = [...teams].sort((a, b) => a.slotNumber - b.slotNumber);

  if (format === 'derby') {
    return generateDerbyMatches(sorted);
  }

  // league_top2_final / league_top4_playoff — league round-robin only.
  return generateRoundRobinMatches(sorted.map((t) => t.id));
}
