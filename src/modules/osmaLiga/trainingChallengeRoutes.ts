import { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../shared/apiKeyAuth.js';
import { trainingCronAuth } from '../../shared/trainingCronAuth.js';
import { sendError } from '../../shared/errors.js';
import { createTrainingChallenge, getActiveTrainingChallenge, type OnlineGameRoom } from './onlineGames.js';
import { db } from '../../db.js';

type ClubInfo = { id: string; name: string; shortName: string | null; slug: string };

async function pickRandomActiveClub(): Promise<ClubInfo | null> {
  const clubs = await db.osmaClub.findMany({
    where: { isActive: true },
    select: { id: true, name: true, shortName: true, slug: true },
  });
  if (clubs.length === 0) return null;
  return clubs[Math.floor(Math.random() * clubs.length)];
}

async function loadClubInfo(clubId: string | null): Promise<ClubInfo | null> {
  if (!clubId) return null;
  return db.osmaClub.findUnique({
    where: { id: clubId },
    select: { id: true, name: true, shortName: true, slug: true },
  });
}

function toGeneratedGameResponse(room: OnlineGameRoom, club: ClubInfo | null) {
  return {
    code: room.code,
    club: club ? { id: club.id, name: club.name, slug: club.slug } : null,
    expiresAt: room.trainingChallengeExpiresAt,
  };
}

export async function trainingChallengeRoutes(app: FastifyInstance): Promise<void> {
  // POST /internal/training-challenges/generate — called by the Hetzner cron job.
  // Protected by TRAINING_CRON_SECRET, not the regular project-hub API key.
  app.post(
    '/internal/training-challenges/generate',
    { preHandler: trainingCronAuth },
    async (_request, reply) => {
      // Re-check right before creating to keep the race window as small as possible —
      // this process is single-threaded/in-memory, so this is a best-effort guard,
      // not a DB-backed lock. See report for the documented limitation.
      const existing = getActiveTrainingChallenge();
      if (existing) {
        const club = await loadClubInfo(existing.trainingChallengeClubId);
        return reply.send({
          ok: true,
          status: 'skipped',
          reason: 'active_training_challenge_exists',
          game: toGeneratedGameResponse(existing, club),
        });
      }

      const club = await pickRandomActiveClub();
      if (!club) {
        return sendError(reply, 500, 'No active clubs available');
      }

      // Re-check after the async club lookup in case another request created one meanwhile.
      const stillNone = getActiveTrainingChallenge();
      if (stillNone) {
        const existingClub = await loadClubInfo(stillNone.trainingChallengeClubId);
        return reply.send({
          ok: true,
          status: 'skipped',
          reason: 'active_training_challenge_exists',
          game: toGeneratedGameResponse(stillNone, existingClub),
        });
      }

      const room = createTrainingChallenge(club.id);
      return reply.status(201).send({
        ok: true,
        status: 'created',
        game: toGeneratedGameResponse(room, club),
      });
    },
  );

  // GET /api/osma-liga/training-challenges/active — used by the osma-liga homepage/lobby.
  app.get(
    '/api/osma-liga/training-challenges/active',
    { preHandler: apiKeyAuth },
    async (_request, reply) => {
      const room = getActiveTrainingChallenge();
      if (!room) {
        return reply.send({ game: null });
      }
      const club = await loadClubInfo(room.trainingChallengeClubId);
      return reply.send({
        game: {
          code: room.code,
          club: club ? { id: club.id, name: club.name, shortName: club.shortName, slug: club.slug } : null,
          expiresAt: room.trainingChallengeExpiresAt,
        },
      });
    },
  );
}
