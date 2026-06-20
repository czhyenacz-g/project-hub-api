import { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../shared/apiKeyAuth.js';
import { sendError } from '../../shared/errors.js';
import { ListOnlineGamesQuerySchema, OnlineGameUserInfoSchema, LookingForOpponentBodySchema } from './onlineGameValidation.js';
import { createGame, getGame, joinGame, listGames, setLookingForOpponent, getActiveLookingForOpponentGame } from './onlineGames.js';
import { listOnlineMatches, getOnlineMatchById } from './onlineMatchResultService.js';
import { db } from '../../db.js';

type ResolvedClub = { id: string; slug: string; name: string };

async function resolveClub(clubId: string | null | undefined): Promise<ResolvedClub | null | 'invalid'> {
  if (!clubId) return null;
  const club = await db.osmaClub.findUnique({
    where: { id: clubId },
    select: { id: true, slug: true, name: true, isActive: true },
  });
  if (!club || !club.isActive) return 'invalid';
  return club;
}

export async function onlineRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/osma-liga/online-games — create game
  app.post(
    '/api/osma-liga/online-games',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const parsed = OnlineGameUserInfoSchema.safeParse(request.body ?? {});
      const userInfo = parsed.success ? parsed.data : undefined;
      const resolvedClub = await resolveClub(userInfo?.clubId);
      if (resolvedClub === 'invalid') {
        return sendError(reply, 400, 'Invalid club');
      }
      const room = createGame({
        ...userInfo,
        clubId: resolvedClub?.id ?? null,
        clubSlug: resolvedClub?.slug ?? null,
        clubName: resolvedClub?.name ?? null,
      });
      return reply.status(201).send({
        code: room.code,
        status: room.status,
        joinUrlPath: `/hra/online/${room.code}`,
        players: 1,
        maxPlayers: 2,
        playerToken: room.hostToken,
        expiresAt: room.expiresAt,
      });
    },
  );

  // GET /api/osma-liga/online-games — list games
  app.get(
    '/api/osma-liga/online-games',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const parsed = ListOnlineGamesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 400, 'Invalid query params');
      }
      const games = listGames(parsed.data.limit);
      const response = games.map((g) => ({
        code: g.code,
        status: g.status,
        players: (g.status === 'full' || g.status === 'playing' || g.status === 'finished') ? 2 : 1,
        maxPlayers: 2,
        createdAt: g.createdAt,
        expiresAt: g.expiresAt,
        onlineMatchId: g.onlineMatchId ?? null,
      }));
      return reply.send(response);
    },
  );

  // GET /api/osma-liga/online-games/:code — get game detail
  app.get(
    '/api/osma-liga/online-games/:code',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const room = getGame(code.toUpperCase());
      if (!room) {
        return sendError(reply, 404, 'Online game not found');
      }
      return reply.send({
        code: room.code,
        status: room.status,
        players: room.guestToken !== null ? 2 : 1,
        maxPlayers: 2,
        createdAt: room.createdAt,
        expiresAt: room.expiresAt,
        onlineMatchId: room.onlineMatchId ?? null,
        homeClubSlug: room.homeClubSlug,
        homeClubName: room.homeClubName,
        awayClubSlug: room.awayClubSlug,
        awayClubName: room.awayClubName,
      });
    },
  );

  // POST /api/osma-liga/online-games/:code/join — join as guest
  app.post(
    '/api/osma-liga/online-games/:code/join',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const parsed = OnlineGameUserInfoSchema.safeParse(request.body ?? {});
      const userInfo = parsed.success ? parsed.data : undefined;

      // Training challenge results feed into history/profile/club tables, so
      // (unlike a casual classic-multiplayer match) joining one requires a
      // real Discord-linked account. Classic multiplayer stays anonymous-friendly.
      const targetRoom = getGame(code.toUpperCase());
      if (targetRoom?.isTrainingChallenge && !userInfo?.userId) {
        return sendError(reply, 401, 'Discord login required to join a training challenge');
      }

      const resolvedClub = await resolveClub(userInfo?.clubId);
      if (resolvedClub === 'invalid') {
        return sendError(reply, 400, 'Invalid club');
      }
      const result = joinGame(code.toUpperCase(), {
        ...userInfo,
        clubId: resolvedClub?.id ?? null,
        clubSlug: resolvedClub?.slug ?? null,
        clubName: resolvedClub?.name ?? null,
      });
      if ('error' in result) {
        if (result.error === 'not_found') {
          return sendError(reply, 404, 'Online game not found');
        }
        // result.error === 'full'
        return sendError(reply, 409, 'Game is full');
      }
      const { room, guestToken } = result;
      return reply.send({
        code: room.code,
        role: 'guest',
        status: room.status,
        players: 2,
        maxPlayers: 2,
        playerToken: guestToken,
        expiresAt: room.expiresAt,
      });
    },
  );

  // POST /api/osma-liga/online-games/:code/looking-for-opponent — post a callout
  app.post(
    '/api/osma-liga/online-games/:code/looking-for-opponent',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const parsed = LookingForOpponentBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return sendError(reply, 400, 'Missing player token');
      }
      const result = setLookingForOpponent(code.toUpperCase(), parsed.data.playerToken);
      if ('error' in result) {
        if (result.error === 'not_found') {
          return sendError(reply, 404, 'Online game not found');
        }
        if (result.error === 'forbidden') {
          return sendError(reply, 403, 'Only the host can post a callout');
        }
        // result.error === 'not_waiting'
        return sendError(reply, 409, 'Game is not waiting for opponent');
      }
      return reply.send({ ok: true, expiresAt: result.expiresAt });
    },
  );

  // GET /api/osma-liga/online-games/looking-for-opponent — active homepage callout, if any
  app.get(
    '/api/osma-liga/online-games/looking-for-opponent',
    { preHandler: apiKeyAuth },
    async (_request, reply) => {
      const room = getActiveLookingForOpponentGame();
      if (!room) {
        return reply.send({ game: null });
      }
      let club: { name: string; shortName: string | null; slug: string } | null = null;
      if (room.homeClubId) {
        const found = await db.osmaClub.findUnique({
          where: { id: room.homeClubId },
          select: { name: true, shortName: true, slug: true },
        });
        if (found) club = found;
      }
      return reply.send({
        game: {
          code: room.code,
          club,
          createdAt: room.createdAt,
          expiresAt: room.lookingForOpponentExpiresAt,
        },
      });
    },
  );

  // GET /api/osma-liga/online-matches — public list of finished online matches
  app.get('/api/osma-liga/online-matches', async (request, reply) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit ?? '20', 10) || 20, 100);
    const matches = await listOnlineMatches(limit);
    return reply.send(matches);
  });

  // GET /api/osma-liga/online-matches/:id — public match detail with events
  app.get('/api/osma-liga/online-matches/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const match = await getOnlineMatchById(id);
    if (!match) {
      return sendError(reply, 404, 'Online match not found');
    }
    return reply.send(match);
  });
}
