import { db } from '../../db.js';
import { CreateMatchResultInput, DiscordUpsertInput } from './validation.js';

const HOME_TEAM_SLUG = 'nahoda-fc';
const HOME_TEAM_NAME = 'Náhoda FC';
const AWAY_TEAM_SLUG = 'fk-parezov';
const AWAY_TEAM_NAME = 'FK Pařezov';

function getMatchComment(homeScore: number, awayScore: number): string {
  if (homeScore > awayScore) return 'Postupujeme. Nikdo neví proč.';
  if (awayScore > homeScore) return 'Dneska nás zařízl trávník.';
  return 'Bod je bod. Hlavně že se nikdo neptá.';
}

export async function createMatchResult(input: CreateMatchResultInput) {
  return db.osmaMatchResult.create({
    data: {
      homeTeamSlug: HOME_TEAM_SLUG,
      homeTeamName: HOME_TEAM_NAME,
      awayTeamSlug: AWAY_TEAM_SLUG,
      awayTeamName: AWAY_TEAM_NAME,
      homeScore: input.homeScore,
      awayScore: input.awayScore,
      mode: 'singleplayer',
      durationSeconds: input.durationSeconds,
      matchComment: getMatchComment(input.homeScore, input.awayScore),
      playedAt: new Date(),
    },
  });
}

export async function listMatchResults(limit: number) {
  return db.osmaMatchResult.findMany({
    orderBy: { playedAt: 'desc' },
    take: limit,
  });
}

export async function listClubs() {
  return db.osmaClub.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
}

export async function getClubBySlug(slug: string) {
  return db.osmaClub.findUnique({ where: { slug } });
}

export async function upsertDiscordUser(input: DiscordUpsertInput) {
  return db.osmaUser.upsert({
    where: { discordId: input.discordId },
    update: {
      username: input.username,
      globalName: input.globalName ?? null,
      avatar: input.avatar ?? null,
    },
    create: {
      discordId: input.discordId,
      username: input.username,
      globalName: input.globalName ?? null,
      avatar: input.avatar ?? null,
    },
  });
}
