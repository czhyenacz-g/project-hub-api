import { Tournament } from '@prisma/client';
import { db } from '../../db.js';
import { calculateTournamentStandings } from './tournamentStandings.js';

// Its own file (not tournamentService.ts) for the same reason as
// tournamentMatchResultService.ts: tournamentService.ts imports createGame()
// from onlineGames.ts, and onlineGames.ts needs to call this after a
// tournament match finishes, so putting this here (no import of
// onlineGames.ts or tournamentService.ts) avoids a circular dependency.

export type CheckAndFinishTournamentOutcome =
  | { outcome: 'tournament_not_found' }
  | { outcome: 'already_finished'; tournament: Tournament }
  // Tournament isn't in_progress, has no matches yet, or at least one
  // generated match isn't 'finished' yet — completely normal mid-tournament
  // state, not an error.
  | { outcome: 'not_ready' }
  | { outcome: 'finished'; tournament: Tournament };

/**
 * MVP tournament completion check — called right after
 * finishTournamentMatchFromOnlineGame() successfully records a match result
 * (see onlineGames.ts / tournamentMatchResultService.ts), and safe to call
 * at any other time too since it's fully idempotent.
 *
 * "All relevant matches finished" for MVP means every TournamentMatch row
 * that startTournament() generated (derby: 3 matches for 2 players; league:
 * all round-robin matches for 3-8 players) — this project doesn't generate
 * playoff/final matches yet, so there's nothing else to wait for.
 *
 * Winner = standings[0] after calculateTournamentStandings() — no shared/
 * multiple winners, no special-casing derby vs league (the standings table
 * works identically for both; derby's 3 matches just happen to be a
 * round-robin of 2 teams).
 *
 * Idempotent: an already-finished tournament is left completely untouched
 * (status/winnerTeamId/finishedAt never get recomputed or overwritten) —
 * calling this again after a later, unrelated match-finish event, or twice
 * concurrently, is always a safe no-op via an atomic conditional updateMany
 * (WHERE status: 'in_progress'), the same compare-and-swap pattern used by
 * startTournament()/claimTournamentTeam() in tournamentService.ts.
 */
export async function checkAndFinishTournament(tournamentId: string): Promise<CheckAndFinishTournamentOutcome> {
  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    include: { teams: true, matches: true },
  });
  if (!tournament) return { outcome: 'tournament_not_found' };
  if (tournament.status === 'finished') return { outcome: 'already_finished', tournament };
  if (tournament.status !== 'in_progress') return { outcome: 'not_ready' };
  if (tournament.matches.length === 0) return { outcome: 'not_ready' };

  const allFinished = tournament.matches.every((m) => m.status === 'finished');
  if (!allFinished) return { outcome: 'not_ready' };

  const standings = calculateTournamentStandings(tournament.teams, tournament.matches);
  const winnerTeamId = standings[0]?.teamId;
  // Defensive — a tournament always has at least 2 teams (playerCount is
  // validated >= 2 at creation), so standings is never actually empty here.
  if (!winnerTeamId) return { outcome: 'not_ready' };

  const finishedAt = new Date();
  const updateResult = await db.tournament.updateMany({
    where: { id: tournament.id, status: 'in_progress' },
    data: { status: 'finished', winnerTeamId, finishedAt },
  });

  const refreshed = await db.tournament.findUnique({ where: { id: tournament.id } });
  if (!refreshed) return { outcome: 'tournament_not_found' };

  if (updateResult.count === 0) {
    // Lost a race against a concurrent finish check for the same tournament
    // — already finished by the other caller, which is exactly what we were
    // about to do (winner is derived from the same finished matches either
    // way), so this is a safe idempotent no-op rather than a conflict.
    return { outcome: 'already_finished', tournament: refreshed };
  }

  return { outcome: 'finished', tournament: refreshed };
}
