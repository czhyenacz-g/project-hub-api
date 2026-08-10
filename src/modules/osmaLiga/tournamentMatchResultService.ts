import { TournamentMatch } from '@prisma/client';
import { db } from '../../db.js';
import { checkAndFinishTournament } from './tournamentCompletionService.js';

// Deliberately its own file (not tournamentService.ts) so onlineGames.ts can
// import it without a circular dependency — tournamentService.ts already
// imports createGame() from onlineGames.ts, so the reverse import would
// create a cycle.

export interface FinishTournamentMatchFromOnlineGameParams {
  // The online-game room code — matches TournamentMatch.onlineMatchId
  // exactly as set by playTournamentMatch() in tournamentService.ts.
  onlineMatchId: string;
  // The room's own home/away user ids (OnlineGameRoom.homeUserId/awayUserId)
  // — NOT necessarily the tournament's home/away team; see the mapping note
  // on finishTournamentMatchFromOnlineGame below. Either may be null (e.g. an
  // anonymous guest who joined without a Discord-linked account).
  homeUserId: string | null;
  awayUserId: string | null;
  // The online game's own score, from the room's perspective (room home vs
  // room away) — remapped onto the tournament's homeTeamId/awayTeamId below.
  homeScore: number;
  awayScore: number;
}

export type FinishTournamentMatchOutcome =
  | { outcome: 'not_a_tournament_match' }
  | { outcome: 'mapping_unresolved'; match: TournamentMatch }
  | { outcome: 'finished'; match: TournamentMatch }
  | { outcome: 'already_finished_same_result'; match: TournamentMatch }
  | { outcome: 'conflict'; match: TournamentMatch };

function computeWinnerTeamId(match: TournamentMatch, homeScore: number, awayScore: number): string | null {
  if (homeScore > awayScore) return match.homeTeamId;
  if (awayScore > homeScore) return match.awayTeamId;
  return null;
}

function sameResult(
  match: TournamentMatch,
  homeScore: number,
  awayScore: number,
  winnerTeamId: string | null,
): boolean {
  return match.homeScore === homeScore && match.awayScore === awayScore && match.winnerTeamId === winnerTeamId;
}

/**
 * Propagates an online game's final score into its linked TournamentMatch —
 * called from onlineGames.ts's startGame() tick loop, exactly at the point
 * the SERVER (not a client) decides `room.gameState.status === 'finished'`,
 * right next to the existing saveOnlineMatchResult() call for the ordinary
 * match-results flow. A pure no-op for every online game that isn't a
 * tournament match (no TournamentMatch has this onlineMatchId) — regular
 * /hra/bot, casual multiplayer lobbies, and training challenges are
 * completely unaffected.
 *
 * Score mapping — this is the part that is NOT simply "room home = tournament
 * home": TournamentMatch.homeScore/awayScore refer to the tournament's own
 * homeTeamId/awayTeamId, but createGame() (onlineGames.ts) always assigns
 * whichever user called POST /matches/:matchId/play *first* as the room's
 * home side, regardless of whether that user actually claimed the
 * tournament's home or away team (playTournamentMatch() passes `userId` as
 * the single userInfo argument to createGame() either way — see its doc
 * comment in tournamentService.ts). So "room home" really means "whoever
 * created the room", not "tournament home team". This function re-derives
 * the correct mapping by comparing the room's homeUserId/awayUserId against
 * each TournamentTeam's claimedByUserId, and swaps the reported scores
 * whenever the room's home side turns out to be the tournament's AWAY team.
 *
 * If neither the room's home nor away user id can be matched to either
 * claimed team, this refuses to guess and returns 'mapping_unresolved'
 * without writing anything — the existing online-games join flow does not
 * itself re-verify a tournament claim, so in principle an unrelated account
 * could end up in the room, and silently attributing a score to the wrong
 * team would be worse than not recording a result at all.
 *
 * Idempotent: a repeat finish with the identical (already-mapped) score is a
 * safe no-op that returns the existing match. A repeat finish with a
 * DIFFERENT score never overwrites the stored result — it's logged and
 * returned as a conflict instead.
 *
 * Whenever this match ends up confirmed 'finished' (freshly, or on an
 * idempotent repeat), it also calls checkAndFinishTournament() — see
 * tournamentCompletionService.ts — so the whole tournament (not just this
 * one match) gets marked finished + gets its winner as soon as every
 * generated match is done, without needing a separate cron/poll.
 */
export async function finishTournamentMatchFromOnlineGame(
  params: FinishTournamentMatchFromOnlineGameParams,
): Promise<FinishTournamentMatchOutcome> {
  const { onlineMatchId, homeUserId, awayUserId, homeScore: roomHomeScore, awayScore: roomAwayScore } = params;

  const match = await db.tournamentMatch.findFirst({ where: { onlineMatchId } });
  if (!match) return { outcome: 'not_a_tournament_match' };

  const [homeTeam, awayTeam] = await Promise.all([
    db.tournamentTeam.findUnique({ where: { id: match.homeTeamId } }),
    db.tournamentTeam.findUnique({ where: { id: match.awayTeamId } }),
  ]);
  if (!homeTeam || !awayTeam) return { outcome: 'mapping_unresolved', match };

  let swap: boolean;
  if (homeUserId && homeUserId === homeTeam.claimedByUserId) swap = false;
  else if (homeUserId && homeUserId === awayTeam.claimedByUserId) swap = true;
  else if (awayUserId && awayUserId === homeTeam.claimedByUserId) swap = true;
  else if (awayUserId && awayUserId === awayTeam.claimedByUserId) swap = false;
  else return { outcome: 'mapping_unresolved', match };

  const homeScore = swap ? roomAwayScore : roomHomeScore;
  const awayScore = swap ? roomHomeScore : roomAwayScore;
  const winnerTeamId = computeWinnerTeamId(match, homeScore, awayScore);

  if (match.status === 'finished') {
    if (sameResult(match, homeScore, awayScore, winnerTeamId)) {
      // Idempotent — a no-op if the tournament is already finished too, but
      // still worth re-checking in case an earlier finish call recorded this
      // match's result while the tournament-level check hadn't run yet.
      await checkAndFinishTournament(match.tournamentId);
      return { outcome: 'already_finished_same_result', match };
    }
    console.error(
      `[tournamentMatchResultService] Conflicting finish for TournamentMatch ${match.id}: ` +
        `existing ${match.homeScore}:${match.awayScore} (winner ${match.winnerTeamId ?? 'draw'}), ` +
        `new ${homeScore}:${awayScore} (winner ${winnerTeamId ?? 'draw'}) — keeping the existing result.`,
    );
    return { outcome: 'conflict', match };
  }

  const finishedAt = new Date();
  // Conditional updateMany (WHERE status != 'finished') as the atomic guard
  // against a concurrent finish racing this one — same compare-and-swap
  // pattern as claimTournamentTeam/startTournament in tournamentService.ts.
  const updateResult = await db.tournamentMatch.updateMany({
    where: { id: match.id, status: { not: 'finished' } },
    data: { homeScore, awayScore, winnerTeamId, status: 'finished', finishedAt },
  });

  const refreshed = await db.tournamentMatch.findUnique({ where: { id: match.id } });
  if (!refreshed) return { outcome: 'not_a_tournament_match' };

  if (updateResult.count === 0) {
    // Lost the race — another concurrent call already finished this match.
    if (sameResult(refreshed, homeScore, awayScore, winnerTeamId)) {
      await checkAndFinishTournament(match.tournamentId);
      return { outcome: 'already_finished_same_result', match: refreshed };
    }
    return { outcome: 'conflict', match: refreshed };
  }

  // This match just became finished — see if that was the last one the
  // tournament was waiting on.
  await checkAndFinishTournament(match.tournamentId);
  return { outcome: 'finished', match: refreshed };
}
