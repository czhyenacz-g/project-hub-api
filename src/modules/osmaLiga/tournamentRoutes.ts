import { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../shared/apiKeyAuth.js';
import { sendError } from '../../shared/errors.js';
import { CreateTournamentSchema, ClaimTournamentTeamSchema } from './tournamentValidation.js';
import { createTournament, getTournamentByPublicCode, claimTournamentTeam, serializeTournament } from './tournamentService.js';
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

  // POST /api/osma-liga/tournaments/:code/teams/:teamId/claim — claim a free team
  app.post(
    '/api/osma-liga/tournaments/:code/teams/:teamId/claim',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const { code, teamId } = request.params as { code: string; teamId: string };
      const parsed = ClaimTournamentTeamSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues.map((i) => i.message).join(', '));
      }

      const user = await db.osmaUser.findUnique({ where: { id: parsed.data.userId } });
      if (!user) {
        return sendError(reply, 400, 'Invalid userId');
      }

      const result = await claimTournamentTeam(code, teamId, parsed.data.userId);
      switch (result.outcome) {
        case 'tournament_not_found':
          return sendError(reply, 404, 'Tournament not found');
        case 'team_not_found':
          return sendError(reply, 404, 'Team not found');
        case 'not_open':
          return sendError(reply, 409, 'Tournament is not open for claiming');
        case 'team_taken':
          return sendError(reply, 409, 'Team is already claimed');
        case 'user_already_has_team':
          return sendError(reply, 409, 'You already have a team in this tournament');
        case 'claimed':
          return reply.send({ ok: true, tournament: serializeTournament(result.tournament) });
      }
    },
  );
}
