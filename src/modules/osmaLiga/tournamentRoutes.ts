import { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../shared/apiKeyAuth.js';
import { sendError } from '../../shared/errors.js';
import { CreateTournamentSchema } from './tournamentValidation.js';
import { createTournament, getTournamentByPublicCode, serializeTournament } from './tournamentService.js';
import { db } from '../../db.js';

export async function tournamentRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/osma-liga/tournaments — create a tournament + its teams
  app.post(
    '/api/osma-liga/tournaments',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const parsed = CreateTournamentSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues.map((i) => i.message).join(', '));
      }

      const creator = await db.osmaUser.findUnique({ where: { id: parsed.data.createdByUserId } });
      if (!creator) {
        return sendError(reply, 400, 'Invalid createdByUserId');
      }

      const tournament = await createTournament(parsed.data);
      return reply.status(201).send({ ok: true, tournament: serializeTournament(tournament) });
    },
  );

  // GET /api/osma-liga/tournaments/:code — tournament detail by publicCode
  app.get(
    '/api/osma-liga/tournaments/:code',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const tournament = await getTournamentByPublicCode(code);
      if (!tournament) {
        return sendError(reply, 404, 'Tournament not found');
      }
      return reply.send({ ok: true, tournament: serializeTournament(tournament) });
    },
  );
}
