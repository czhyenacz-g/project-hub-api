import { Prisma, Tournament, TournamentTeam } from '@prisma/client';
import { db } from '../../db.js';
import { CreateTournamentInput } from './tournamentValidation.js';

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

export type TournamentWithTeams = Tournament & { teams: TournamentTeam[] };

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
    include: { teams: { orderBy: { slotNumber: 'asc' } } },
  });
}

// Codes are generated lowercase, but lookups are normalised case-insensitively
// as a defensive measure against any caller that happens to upcase the code
// (e.g. a URL slug) before requesting it back.
export async function getTournamentByPublicCode(publicCode: string): Promise<TournamentWithTeams | null> {
  return db.tournament.findFirst({
    where: { publicCode: { equals: publicCode, mode: Prisma.QueryMode.insensitive } },
    include: { teams: { orderBy: { slotNumber: 'asc' } } },
  });
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
  };
}
