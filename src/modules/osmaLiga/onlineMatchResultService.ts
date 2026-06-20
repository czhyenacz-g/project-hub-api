import { Prisma } from '@prisma/client';
import { db } from '../../db.js';
import type { OnlineGameRoom } from './onlineGames.js';

export function calculateClubPoints(homeScore: number, awayScore: number) {
  if (homeScore > awayScore) return { homeClubPoints: 3, awayClubPoints: 0 };
  if (homeScore < awayScore) return { homeClubPoints: 0, awayClubPoints: 3 };
  return { homeClubPoints: 1, awayClubPoints: 1 };
}

// Fallbacks only for legacy rooms created before homeClubSlug/homeClubName existed.
const FALLBACK_HOME_TEAM_SLUG = 'nahoda-fc';
const FALLBACK_HOME_TEAM_NAME = 'Náhoda FC';
const FALLBACK_AWAY_TEAM_SLUG = 'fk-parezov';
const FALLBACK_AWAY_TEAM_NAME = 'FK Pařezov';

function getMultiplayerComment(homeScore: number, awayScore: number): string {
  if (homeScore > awayScore) return 'Domácí přežili živého soupeře. To už se počítá.';
  if (awayScore > homeScore) return 'Hosté si odvážejí výhru a domácí hledají výmluvu.';
  return 'Remíza. Oba týmy tvrdí, že měly víc ze hry.';
}

function getTrainingChallengeComment(homeScore: number, awayScore: number): string {
  if (homeScore > awayScore) return 'Tréninkový zápas. Domácí udrželi tempo až do konce.';
  if (awayScore > homeScore) return 'Tréninkový zápas. Hosté si odvezli výhru i z přátelského utkání.';
  return 'Tréninkový zápas skončil remízou. Nikomu to nevadilo.';
}

export async function saveOnlineMatchResult(room: OnlineGameRoom): Promise<void> {
  if (room.resultSavedAt || room.onlineMatchId) return;
  if (!room.gameState || !room.startedAt) return;

  const { score } = room.gameState;
  const finishedAt = new Date();
  const winnerSide =
    score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'draw';
  const clubPoints = calculateClubPoints(score.home, score.away);
  const durationSeconds = Math.round(
    (finishedAt.getTime() - room.startedAt.getTime()) / 1000,
  );

  const homeTeamSlug = room.homeClubSlug ?? FALLBACK_HOME_TEAM_SLUG;
  const homeTeamName = room.homeClubName ?? FALLBACK_HOME_TEAM_NAME;
  const awayTeamSlug = room.awayClubSlug ?? FALLBACK_AWAY_TEAM_SLUG;
  const awayTeamName = room.awayClubName ?? FALLBACK_AWAY_TEAM_NAME;
  // Training challenges get their own mode so the homepage can label them
  // distinctly without ever exposing the word "bot" — see RecentResults.tsx.
  const mode = room.isTrainingChallenge ? 'training_challenge' : 'multiplayer';
  const matchComment = room.isTrainingChallenge
    ? getTrainingChallengeComment(score.home, score.away)
    : getMultiplayerComment(score.home, score.away);

  let savedId: string | null = null;

  await db.$transaction(async (tx) => {
    const onlineMatch = await tx.osmaOnlineMatch.create({
      data: {
        gameCode: room.code,
        status: 'finished',
        homeTeamSlug,
        homeTeamName,
        awayTeamSlug,
        awayTeamName,
        homeScore: score.home,
        awayScore: score.away,
        winnerSide,
        lobbyCreatedAt: new Date(room.createdAt),
        startedAt: room.startedAt,
        finishedAt,
        durationSeconds,
        finishReason: 'full_time',
        homeUserId: room.homeUserId ?? null,
        awayUserId: room.awayUserId ?? null,
        homeClubId: room.homeClubId ?? null,
        awayClubId: room.awayClubId ?? null,
        homeClubPoints: clubPoints.homeClubPoints,
        awayClubPoints: clubPoints.awayClubPoints,
      },
    });

    if (room.events.length > 0) {
      await tx.osmaOnlineMatchEvent.createMany({
        data: room.events.map((event) => ({
          onlineMatchId: onlineMatch.id,
          gameCode: room.code,
          type: event.type,
          matchSecond: event.matchSecond ?? null,
          teamSide: event.teamSide ?? null,
          teamName: event.teamName ?? null,
          actorLabel: event.actorLabel ?? null,
          homeScoreAfter: event.homeScoreAfter ?? null,
          awayScoreAfter: event.awayScoreAfter ?? null,
          message: event.message ?? null,
          metadataJson: event.metadataJson
            ? (event.metadataJson as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        })),
      });
    }

    const publicResult = await tx.osmaMatchResult.create({
      data: {
        homeTeamSlug,
        homeTeamName,
        awayTeamSlug,
        awayTeamName,
        homeScore: score.home,
        awayScore: score.away,
        mode,
        durationSeconds,
        matchComment,
        playedAt: finishedAt,
        onlineMatchId: onlineMatch.id,
      },
    });

    await tx.osmaOnlineMatch.update({
      where: { id: onlineMatch.id },
      data: { publicResultId: publicResult.id },
    });

    savedId = onlineMatch.id;
  });

  room.onlineMatchId = savedId;
  room.resultSavedAt = finishedAt;
}

const USER_SELECT = {
  id: true,
  username: true,
  globalName: true,
  avatar: true,
  discordId: true,
} as const;

const CLUB_SELECT = {
  id: true,
  slug: true,
  name: true,
  shortName: true,
  banner: true,
  logo: true,
} as const;

type RawUser = { id: string; username: string; globalName: string | null; avatar: string | null; discordId: string };
export type PublicUser = { id: string; username: string; globalName: string | null; avatarUrl: string | null };

function sanitizeUser(u: RawUser | null): PublicUser | null {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    globalName: u.globalName,
    avatarUrl: u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png?size=64`
      : null,
  };
}

export async function listOnlineMatches(limit: number) {
  const rows = await db.osmaOnlineMatch.findMany({
    orderBy: { savedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      gameCode: true,
      homeTeamName: true,
      awayTeamName: true,
      homeScore: true,
      awayScore: true,
      winnerSide: true,
      durationSeconds: true,
      finishReason: true,
      startedAt: true,
      finishedAt: true,
      savedAt: true,
      homeUser: { select: USER_SELECT },
      awayUser: { select: USER_SELECT },
      homeClub: { select: CLUB_SELECT },
      awayClub: { select: CLUB_SELECT },
      homeClubPoints: true,
      awayClubPoints: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    homeUser: sanitizeUser(r.homeUser),
    awayUser: sanitizeUser(r.awayUser),
  }));
}

function minimalUser(u: PublicUser | null): { username: string; globalName: string | null } | null {
  if (!u) return null;
  return { username: u.username, globalName: u.globalName };
}

type ProfileMatchRow = {
  id: string;
  finishedAt: Date | null;
  homeScore: number;
  awayScore: number;
  homeUserId: string | null;
  awayUserId: string | null;
  homeClubId: string | null;
  awayClubId: string | null;
  homeClubPoints: number | null;
  awayClubPoints: number | null;
  homeUser: RawUser | null;
  awayUser: RawUser | null;
  homeClub: { id: string; slug: string; name: string; shortName: string | null; logo: string | null } | null;
  awayClub: { id: string; slug: string; name: string; shortName: string | null; logo: string | null } | null;
};

const PROFILE_CLUB_SELECT = { id: true, slug: true, name: true, shortName: true, logo: true } as const;

export async function getPlayerProfile(userId: string) {
  const user = await db.osmaUser.findUnique({
    where: { id: userId },
    select: { id: true, username: true, globalName: true, avatar: true, discordId: true },
  });
  if (!user) return null;
  const currentUserId = user.id;

  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - 30);

  const baseSelect = {
    id: true,
    finishedAt: true,
    homeScore: true,
    awayScore: true,
    homeUserId: true,
    awayUserId: true,
    homeClubId: true,
    awayClubId: true,
    homeClubPoints: true,
    awayClubPoints: true,
    homeUser: { select: USER_SELECT },
    awayUser: { select: USER_SELECT },
    homeClub: { select: PROFILE_CLUB_SELECT },
    awayClub: { select: PROFILE_CLUB_SELECT },
  } as const;

  const [statsMatches, recentMatchesRaw] = await Promise.all([
    db.osmaOnlineMatch.findMany({
      where: {
        finishedAt: { gte: since },
        OR: [{ homeUserId: currentUserId }, { awayUserId: currentUserId }],
      },
      select: baseSelect,
    }),
    db.osmaOnlineMatch.findMany({
      where: {
        finishedAt: { not: null },
        OR: [{ homeUserId: currentUserId }, { awayUserId: currentUserId }],
      },
      orderBy: { finishedAt: 'desc' },
      take: 10,
      select: baseSelect,
    }),
  ]);

  let matches = 0, wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0, clubPointsEarned = 0;

  type ClubAgg = { club: { id: string; slug: string; name: string; shortName: string | null; logo: string | null }; matches: number; points: number; wins: number; draws: number; losses: number };
  const clubMap = new Map<string, ClubAgg>();

  function applyMatch(row: ProfileMatchRow): void {
    const isHome = row.homeUserId === currentUserId;
    const goalsForRow = isHome ? row.homeScore : row.awayScore;
    const goalsAgainstRow = isHome ? row.awayScore : row.homeScore;
    const clubPoints = isHome
      ? row.homeClubPoints ?? calculateClubPoints(row.homeScore, row.awayScore).homeClubPoints
      : row.awayClubPoints ?? calculateClubPoints(row.homeScore, row.awayScore).awayClubPoints;
    const club = isHome ? row.homeClub : row.awayClub;
    const result: 'win' | 'draw' | 'loss' = goalsForRow > goalsAgainstRow ? 'win' : goalsForRow === goalsAgainstRow ? 'draw' : 'loss';

    matches++;
    goalsFor += goalsForRow;
    goalsAgainst += goalsAgainstRow;
    clubPointsEarned += clubPoints;
    if (result === 'win') wins++;
    else if (result === 'draw') draws++;
    else losses++;

    if (club) {
      const existing = clubMap.get(club.id);
      if (existing) {
        existing.matches++;
        existing.points += clubPoints;
        if (result === 'win') existing.wins++;
        else if (result === 'draw') existing.draws++;
        else existing.losses++;
      } else {
        clubMap.set(club.id, {
          club,
          matches: 1,
          points: clubPoints,
          wins: result === 'win' ? 1 : 0,
          draws: result === 'draw' ? 1 : 0,
          losses: result === 'loss' ? 1 : 0,
        });
      }
    }
  }

  for (const row of statsMatches) applyMatch(row as ProfileMatchRow);

  const clubs = Array.from(clubMap.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.matches !== a.matches) return b.matches - a.matches;
    return a.club.name.localeCompare(b.club.name);
  });

  const recentMatches = recentMatchesRaw.map((row) => {
    const r = row as ProfileMatchRow;
    const isHome = r.homeUserId === currentUserId;
    const userClubPoints = isHome
      ? r.homeClubPoints ?? calculateClubPoints(r.homeScore, r.awayScore).homeClubPoints
      : r.awayClubPoints ?? calculateClubPoints(r.homeScore, r.awayScore).awayClubPoints;
    return {
      id: r.id,
      finishedAt: r.finishedAt,
      homeScore: r.homeScore,
      awayScore: r.awayScore,
      userSide: isHome ? ('home' as const) : ('away' as const),
      userClubPoints,
      homeClub: r.homeClub ? { slug: r.homeClub.slug, name: r.homeClub.name, shortName: r.homeClub.shortName } : null,
      awayClub: r.awayClub ? { slug: r.awayClub.slug, name: r.awayClub.name, shortName: r.awayClub.shortName } : null,
      homeUser: minimalUser(sanitizeUser(r.homeUser)),
      awayUser: minimalUser(sanitizeUser(r.awayUser)),
    };
  });

  return {
    user: {
      id: user.id,
      username: user.username,
      globalName: user.globalName,
      avatarUrl: user.avatar ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=128` : null,
    },
    period: { type: 'rolling_30_days' as const, days: 30, since: since.toISOString(), until: until.toISOString() },
    stats: { matches, wins, draws, losses, goalsFor, goalsAgainst, goalDifference: goalsFor - goalsAgainst, clubPointsEarned },
    clubs,
    recentMatches,
  };
}

export async function getOnlineMatchById(id: string) {
  const match = await db.osmaOnlineMatch.findUnique({
    where: { id },
    include: {
      events: {
        orderBy: [{ matchSecond: 'asc' }, { createdAt: 'asc' }],
      },
      homeUser: { select: USER_SELECT },
      awayUser: { select: USER_SELECT },
      homeClub: { select: CLUB_SELECT },
      awayClub: { select: CLUB_SELECT },
    },
  });
  if (!match) return null;
  return { ...match, homeUser: sanitizeUser(match.homeUser), awayUser: sanitizeUser(match.awayUser) };
}
