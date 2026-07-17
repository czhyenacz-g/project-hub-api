import { Prisma, Tournament, TournamentTeam, TournamentMatch } from '@prisma/client';
import { db } from '../../db.js';
import { CreateTournamentInput } from './tournamentValidation.js';
import { generateTournamentMatches } from './tournamentMatchGenerator.js';

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
    matches: tournament.matches.map((match) => ({
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
    })),
  };
}
