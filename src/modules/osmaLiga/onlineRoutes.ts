import { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../shared/apiKeyAuth.js';
import { sendError } from '../../shared/errors.js';
import { ListOnlineGamesQuerySchema, OnlineGameUserInfoSchema } from './onlineGameValidation.js';
import { createGame, getGame, joinGame, listGames } from './onlineGames.js';
import { listOnlineMatches, getOnlineMatchById } from './onlineMatchResultService.js';
import { db } from '../../db.js';

async function resolveClubId(clubId: string | null | undefined): Promise<string | null | 'invalid'> {
  if (!clubId) return null;
  const club = await db.osmaClub.findUnique({ where: { id: clubId }, select: { id: true, isActive: true } });
  if (!club || !club.isActive) return 'invalid';
  return club.id;
}

export async function onlineRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/osma-liga/online-games — create game
  app.post(
    '/api/osma-liga/online-games',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const parsed = OnlineGameUserInfoSchema.safeParse(request.body ?? {});
      const userInfo = parsed.success ? parsed.data : undefined;
      const resolvedClubId = await resolveClubId(userInfo?.clubId);
      if (resolvedClubId === 'invalid') {
        return sendError(reply, 400, 'Invalid club');
      }
      const room = createGame({ ...userInfo, clubId: resolvedClubId });
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
        players: g.status === 'full' ? 2 : 1,
        maxPlayers: 2,
        createdAt: g.createdAt,
        expiresAt: g.expiresAt,
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
      const resolvedClubId = await resolveClubId(userInfo?.clubId);
      if (resolvedClubId === 'invalid') {
        return sendError(reply, 400, 'Invalid club');
      }
      const result = joinGame(code.toUpperCase(), { ...userInfo, clubId: resolvedClubId });
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
