import { Prisma } from '@prisma/client';
import { db } from '../../db.js';
import type { OnlineGameRoom } from './onlineGames.js';

const HOME_TEAM_SLUG = 'nahoda-fc';
const HOME_TEAM_NAME = 'Náhoda FC';
const AWAY_TEAM_SLUG = 'fk-parezov';
const AWAY_TEAM_NAME = 'FK Pařezov';

function getMultiplayerComment(homeScore: number, awayScore: number): string {
  if (homeScore > awayScore) return 'Náhoda FC přežila živého soupeře. To už se počítá.';
  if (awayScore > homeScore) return 'Hosté si odvážejí výhru a domácí hledají výmluvu.';
  return 'Remíza. Oba týmy tvrdí, že měly víc ze hry.';
}

export async function saveOnlineMatchResult(room: OnlineGameRoom): Promise<void> {
  if (room.resultSavedAt || room.onlineMatchId) return;
  if (!room.gameState || !room.startedAt) return;

  const { score } = room.gameState;
  const finishedAt = new Date();
  const winnerSide =
    score.home > score.away ? 'home' : score.away > score.home ? 'away' : 'draw';
  const durationSeconds = Math.round(
    (finishedAt.getTime() - room.startedAt.getTime()) / 1000,
  );

  let savedId: string | null = null;

  await db.$transaction(async (tx) => {
    const onlineMatch = await tx.osmaOnlineMatch.create({
      data: {
        gameCode: room.code,
        status: 'finished',
        homeTeamSlug: HOME_TEAM_SLUG,
        homeTeamName: HOME_TEAM_NAME,
        awayTeamSlug: AWAY_TEAM_SLUG,
        awayTeamName: AWAY_TEAM_NAME,
        homeScore: score.home,
        awayScore: score.away,
        winnerSide,
        lobbyCreatedAt: new Date(room.createdAt),
        startedAt: room.startedAt,
        finishedAt,
        durationSeconds,
        finishReason: 'full_time',
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
        homeTeamSlug: HOME_TEAM_SLUG,
        homeTeamName: HOME_TEAM_NAME,
        awayTeamSlug: AWAY_TEAM_SLUG,
        awayTeamName: AWAY_TEAM_NAME,
        homeScore: score.home,
        awayScore: score.away,
        mode: 'multiplayer',
        durationSeconds,
        matchComment: getMultiplayerComment(score.home, score.away),
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

export async function listOnlineMatches(limit: number) {
  return db.osmaOnlineMatch.findMany({
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
    },
  });
}

export async function getOnlineMatchById(id: string) {
  return db.osmaOnlineMatch.findUnique({
    where: { id },
    include: {
      events: {
        orderBy: [{ matchSecond: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
}
