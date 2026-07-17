import { Prisma, Tournament, TournamentTeam, TournamentMatch } from '@prisma/client';
import { db } from '../../db.js';
import { CreateTournamentInput } from './tournamentValidation.js';
import { generateTournamentMatches } from './tournamentMatchGenerator.js';
import { createGame } from './onlineGames.js';

export type TournamentFormat = 'derby' | 'league_top2_final' | 'league_top4_playoff';

export function determineTournamentFormat(playerCount: number): TournamentFormat {
  if (playerCount <= 2) return 'derby';
  if (playerCount <= 4) return 'league_top2_final';
  return 'league_top4_playoff';
}

function defaultTeams(playerCount: number): { slotNumber: number; name: string }[] {
  return Array.from({ length: playerCount }, (_, i) => ({
    slotNumber: i + 1,
    name: `Tým ${i + 1}`,
  }));
}

// Lowercase alphanumeric, no ambiguous chars (0/o/1/l/i) — short and safe for
// a URL (/turnaj/:publicCode).
const PUBLIC_CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
const PUBLIC_CODE_LENGTH = 6;
const PUBLIC_CODE_MAX_ATTEMPTS = 10;

function randomPublicCode(): string {
  return Array.from(
    { length: PUBLIC_CODE_LENGTH },
    () => PUBLIC_CODE_CHARS[Math.floor(Math.random() * PUBLIC_CODE_CHARS.length)],
  ).join('');
}

async function generateUniquePublicCode(): Promise<string> {
  for (let attempt = 0; attempt < PUBLIC_CODE_MAX_ATTEMPTS; attempt++) {
    const code = randomPublicCode();
    const existing = await db.tournament.findUnique({ where: { publicCode: code } });
    if (!existing) return code;
  }
  throw new Error('Failed to generate a unique tournament public code');
}

export type TournamentWithTeams = Tournament & { teams: TournamentTeam[]; matches: TournamentMatch[] };

export async function createTournament(input: CreateTournamentInput): Promise<TournamentWithTeams> {
  // Backend is the source of truth for format — never trust a client-sent value.
  const format = determineTournamentFormat(input.playerCount);
  const teamsInput = input.teams ?? defaultTeams(input.playerCount);
  const publicCode = await generateUniquePublicCode();

  return db.tournament.create({
    data: {
      publicCode,
      name: input.name,
      createdByUserId: input.createdByUserId,
      status: 'open',
      playerCount: input.playerCount,
      format,
      teams: {
        create: teamsInput.map((team) => ({
          slotNumber: team.slotNumber,
          name: team.name,
          seed: team.slotNumber,
        })),
      },
    },
    include: {
      teams: { orderBy: { slotNumber: 'asc' } },
      matches: { orderBy: [{ roundNumber: 'asc' }, { matchNumber: 'asc' }] },
    },
  });
}

// Codes are generated lowercase, but lookups are normalised case-insensitively
// as a defensive measure against any caller that happens to upcase the code
// (e.g. a URL slug) before requesting it back.
export async function getTournamentByPublicCode(publicCode: string): Promise<TournamentWithTeams | null> {
  return db.tournament.findFirst({
    where: { publicCode: { equals: publicCode, mode: Prisma.QueryMode.insensitive } },
    include: {
      teams: { orderBy: { slotNumber: 'asc' } },
      matches: { orderBy: [{ roundNumber: 'asc' }, { matchNumber: 'asc' }] },
    },
  });
}

export type ClaimTournamentTeamResult =
  | { outcome: 'claimed'; tournament: TournamentWithTeams }
  | { outcome: 'tournament_not_found' }
  | { outcome: 'team_not_found' }
  | { outcome: 'not_open' }
  | { outcome: 'team_taken' }
  | { outcome: 'user_already_has_team' };

/**
 * POST /api/osma-liga/tournaments/:code/teams/:teamId/claim
 *
 * Deliberately NOT `findUnique` + unconditional `update` (lost-update race —
 * two concurrent claims on the same team could both read "unclaimed" before
 * either writes). Instead this uses an atomic, conditional `updateMany` whose
 * WHERE clause also requires `claimedByUserId: null`: Postgres serializes
 * concurrent UPDATEs against the same row via its own row lock, so only ONE
 * of two truly-simultaneous claimers can still match by the time it executes
 * — the loser's `updateMany` reports `count: 0`, never a silently
 * overwritten claim. Mirrors the pattern in
 * nocniHlidac/playerProfileService.ts#updateObject13PlayerProfile.
 *
 * The "does this user already have a team here" check is done as a pre-check
 * for a clean error message, but the real guarantee against a user racing
 * themselves into two teams is the DB-level unique index on
 * (tournamentId, claimedByUserId) — see schema.prisma. A unique-constraint
 * violation on the update is caught below and mapped to the same outcome.
 */
export async function claimTournamentTeam(
  publicCode: string,
  teamId: string,
  userId: string,
): Promise<ClaimTournamentTeamResult> {
  const tournament = await getTournamentByPublicCode(publicCode);
  if (!tournament) return { outcome: 'tournament_not_found' };
  if (tournament.status !== 'open') return { outcome: 'not_open' };

  const team = tournament.teams.find((t) => t.id === teamId);
  if (!team) return { outcome: 'team_not_found' };

  if (tournament.teams.some((t) => t.claimedByUserId === userId)) {
    return { outcome: 'user_already_has_team' };
  }

  try {
    const updateResult = await db.tournamentTeam.updateMany({
      where: { id: teamId, tournamentId: tournament.id, claimedByUserId: null },
      data: { claimedByUserId: userId, claimedAt: new Date() },
    });
    if (updateResult.count === 0) {
      return { outcome: 'team_taken' };
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { outcome: 'user_already_has_team' };
    }
    throw err;
  }

  const updated = await getTournamentByPublicCode(publicCode);
  if (!updated) return { outcome: 'tournament_not_found' };
  return { outcome: 'claimed', tournament: updated };
}

export type StartTournamentResult =
  | { outcome: 'started'; tournament: TournamentWithTeams }
  | { outcome: 'tournament_not_found' }
  | { outcome: 'forbidden' }
  | { outcome: 'not_open' }
  | { outcome: 'teams_not_full' }
  | { outcome: 'already_started' };

/**
 * POST /api/osma-liga/tournaments/:code/start
 *
 * Guards against a concurrent double-start (two clicks racing, or two tabs)
 * the same way claimTournamentTeam guards a team claim: an atomic conditional
 * `updateMany` whose WHERE clause requires `status: 'open'` acts as a
 * compare-and-swap on the Tournament row. Postgres serializes concurrent
 * UPDATEs against the same row, so only one of two truly-simultaneous start
 * attempts can still match by the time it executes inside the transaction —
 * the loser's `updateMany` reports `count: 0` and the transaction returns
 * `raced: true` without ever calling `createMany`, so duplicate
 * TournamentMatch rows can never be committed. The
 * `(tournamentId, roundNumber, matchNumber)` unique index in schema.prisma
 * is defense-in-depth on top of that, not the primary guard.
 */
export async function startTournament(publicCode: string, userId: string): Promise<StartTournamentResult> {
  const tournament = await getTournamentByPublicCode(publicCode);
  if (!tournament) return { outcome: 'tournament_not_found' };
  if (tournament.createdByUserId !== userId) return { outcome: 'forbidden' };
  if (tournament.status !== 'open') return { outcome: 'not_open' };
  if (tournament.teams.some((t) => !t.claimedByUserId)) return { outcome: 'teams_not_full' };
  if (tournament.matches.length > 0) return { outcome: 'already_started' };

  const drafts = generateTournamentMatches(tournament.teams, tournament.format);

  const { raced } = await db.$transaction(async (tx) => {
    const statusUpdate = await tx.tournament.updateMany({
      where: { id: tournament.id, status: 'open' },
      data: { status: 'in_progress', startedAt: new Date() },
    });
    if (statusUpdate.count === 0) {
      return { raced: true as const };
    }
    await tx.tournamentMatch.createMany({
      data: drafts.map((d) => ({
        tournamentId: tournament.id,
        phase: d.phase,
        roundNumber: d.roundNumber,
        matchNumber: d.matchNumber,
        homeTeamId: d.homeTeamId,
        awayTeamId: d.awayTeamId,
        status: 'scheduled',
      })),
    });
    return { raced: false as const };
  });

  if (raced) return { outcome: 'already_started' };

  const updated = await getTournamentByPublicCode(publicCode);
  if (!updated) return { outcome: 'tournament_not_found' };
  return { outcome: 'started', tournament: updated };
}

export type PlayTournamentMatchResult =
  | {
      outcome: 'created' | 'existing';
      tournament: TournamentWithTeams;
      match: TournamentMatch;
      onlineMatchId: string;
      joinUrlPath: string;
      // Only set on 'created' — the caller who just opened the room gets its
      // host token so the frontend can seed sessionStorage exactly like the
      // regular online-games lobby flow does. A caller hitting the already-
      // existing branch doesn't get a token minted for them here (see
      // playTournamentMatch doc comment for why not).
      playerToken?: string;
    }
  | { outcome: 'tournament_not_found' }
  | { outcome: 'match_not_found' }
  | { outcome: 'teams_not_claimed' }
  | { outcome: 'forbidden' }
  | { outcome: 'tournament_not_in_progress' }
  | { outcome: 'match_finished' }
  | { outcome: 'match_not_playable' };

/**
 * POST /api/osma-liga/tournaments/:code/matches/:matchId/play
 *
 * Reuses the existing online-games lobby (`createGame` in onlineGames.ts) —
 * no parallel online-game system, no protocol change. Online game rooms are
 * an in-memory store, not a DB table, so there's no way to atomically
 * "create the room only if none exists yet" the way claimTournamentTeam or
 * startTournament guard their DB rows. Instead the guarantee is built the
 * other way around: `createGame()` is called unconditionally, but the
 * *newly created* room is only ever wired up to real players if this
 * function's atomic `updateMany` (WHERE onlineMatchId: null) is the one that
 * successfully claims the match — Postgres serializes concurrent UPDATEs on
 * the same row, so at most one of two racing calls can win it. The loser's
 * freshly-created room is simply never referenced by anyone and expires on
 * its own TTL (see ONLINE_GAME_TTL_MINUTES) — same as any abandoned lobby.
 *
 * A second (later, non-racing) caller hitting the 'existing' branch is
 * deliberately NOT auto-joined as guest server-side here: that would risk
 * silently consuming the guest slot on an unrelated repeat call (e.g. the
 * room creator refreshing their own browser and hitting /play again), which
 * could lock the real second player out. The existing, working
 * `/hra/online/[code]` join flow already handles "no token in
 * sessionStorage yet" by showing the ordinary connect-as-guest button, so
 * this function only ever returns the room's code/join path for that case.
 */
export async function playTournamentMatch(
  publicCode: string,
  matchId: string,
  userId: string,
): Promise<PlayTournamentMatchResult> {
  const tournament = await getTournamentByPublicCode(publicCode);
  if (!tournament) return { outcome: 'tournament_not_found' };

  const match = tournament.matches.find((m) => m.id === matchId);
  if (!match || match.tournamentId !== tournament.id) return { outcome: 'match_not_found' };

  const homeTeam = tournament.teams.find((t) => t.id === match.homeTeamId);
  const awayTeam = tournament.teams.find((t) => t.id === match.awayTeamId);
  if (!homeTeam?.claimedByUserId || !awayTeam?.claimedByUserId) {
    return { outcome: 'teams_not_claimed' };
  }

  const isHomePlayer = userId === homeTeam.claimedByUserId;
  const isAwayPlayer = userId === awayTeam.claimedByUserId;
  if (!isHomePlayer && !isAwayPlayer) return { outcome: 'forbidden' };

  if (tournament.status !== 'in_progress') return { outcome: 'tournament_not_in_progress' };
  if (match.status === 'finished') return { outcome: 'match_finished' };
  if (match.status !== 'scheduled' && match.status !== 'in_progress') return { outcome: 'match_not_playable' };

  if (match.onlineMatchId) {
    return {
      outcome: 'existing',
      tournament,
      match,
      onlineMatchId: match.onlineMatchId,
      joinUrlPath: `/hra/online/${match.onlineMatchId}`,
    };
  }

  const user = await db.osmaUser.findUnique({ where: { id: userId } });
  const userName = user?.globalName ?? user?.username ?? null;
  const userAvatar = user?.avatar
    ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=64`
    : null;

  const room = createGame(
    {
      userId,
      userName,
      userAvatar,
      clubId: null,
      // No real OsmaClub backs a tournament team — createGame() accepts a
      // freeform display name here regardless (see resolveClub() in
      // onlineRoutes.ts, which only validates clubId against a real club
      // when one is actually provided).
      clubName: isHomePlayer ? homeTeam.name : awayTeam.name,
    },
    { tournamentId: tournament.id, tournamentMatchId: match.id },
  );

  const claim = await db.tournamentMatch.updateMany({
    where: { id: match.id, tournamentId: tournament.id, onlineMatchId: null },
    data: { onlineMatchId: room.code, status: 'in_progress', startedAt: new Date() },
  });

  if (claim.count === 0) {
    // Lost the race — someone else's /play call already claimed this match
    // between our read above and this update. Our freshly-created room is
    // simply abandoned (see doc comment); fetch whichever room actually won.
    const refreshed = await getTournamentByPublicCode(publicCode);
    const refreshedMatch = refreshed?.matches.find((m) => m.id === matchId);
    if (!refreshed || !refreshedMatch?.onlineMatchId) return { outcome: 'match_not_found' };
    return {
      outcome: 'existing',
      tournament: refreshed,
      match: refreshedMatch,
      onlineMatchId: refreshedMatch.onlineMatchId,
      joinUrlPath: `/hra/online/${refreshedMatch.onlineMatchId}`,
    };
  }

  const updated = await getTournamentByPublicCode(publicCode);
  const updatedMatch = updated?.matches.find((m) => m.id === matchId);
  if (!updated || !updatedMatch) return { outcome: 'match_not_found' };

  return {
    outcome: 'created',
    tournament: updated,
    match: updatedMatch,
    onlineMatchId: room.code,
    joinUrlPath: `/hra/online/${room.code}`,
    playerToken: room.hostToken,
  };
}

export function serializeTournamentMatch(match: TournamentMatch) {
  return {
    id: match.id,
    tournamentId: match.tournamentId,
    phase: match.phase,
    roundNumber: match.roundNumber,
    matchNumber: match.matchNumber,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    winnerTeamId: match.winnerTeamId,
    status: match.status,
    onlineMatchId: match.onlineMatchId,
    startedAt: match.startedAt,
    finishedAt: match.finishedAt,
  };
}

export function serializeTournament(tournament: TournamentWithTeams) {
  return {
    id: tournament.id,
    publicCode: tournament.publicCode,
    name: tournament.name,
    createdByUserId: tournament.createdByUserId,
    status: tournament.status,
    playerCount: tournament.playerCount,
    format: tournament.format,
    createdAt: tournament.createdAt,
    startedAt: tournament.startedAt,
    finishedAt: tournament.finishedAt,
    winnerTeamId: tournament.winnerTeamId,
    teams: tournament.teams.map((team) => ({
      id: team.id,
      tournamentId: team.tournamentId,
      slotNumber: team.slotNumber,
      name: team.name,
      claimedByUserId: team.claimedByUserId,
      claimedAt: team.claimedAt,
      seed: team.seed,
      finalRank: team.finalRank,
    })),
    matches: tournament.matches.map(serializeTournamentMatch),
  };
}
