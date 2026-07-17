import { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../shared/apiKeyAuth.js';
import { sendError } from '../../shared/errors.js';
import { CreateTournamentSchema, ClaimTournamentTeamSchema, StartTournamentSchema, PlayTournamentMatchSchema } from './tournamentValidation.js';
import {
  createTournament, getTournamentByPublicCode, claimTournamentTeam, startTournament, playTournamentMatch,
  serializeTournament, serializeTournamentMatch,
} from './tournamentService.js';
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

  // POST /api/osma-liga/tournaments/:code/start — creator starts the tournament, generates matches
  app.post(
    '/api/osma-liga/tournaments/:code/start',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const parsed = StartTournamentSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues.map((i) => i.message).join(', '));
      }

      const user = await db.osmaUser.findUnique({ where: { id: parsed.data.userId } });
      if (!user) {
        return sendError(reply, 400, 'Invalid userId');
      }

      const result = await startTournament(code, parsed.data.userId);
      switch (result.outcome) {
        case 'tournament_not_found':
          return sendError(reply, 404, 'Tournament not found');
        case 'forbidden':
          return sendError(reply, 403, 'Only the tournament creator can start it');
        case 'not_open':
          return sendError(reply, 409, 'Tournament is not open');
        case 'teams_not_full':
          return sendError(reply, 409, 'All teams must be claimed before starting');
        case 'already_started':
          return sendError(reply, 409, 'Tournament has already been started');
        case 'started':
          return reply.send({ ok: true, tournament: serializeTournament(result.tournament) });
      }
    },
  );

  // POST /api/osma-liga/tournaments/:code/matches/:matchId/play — start or resume the
  // online game session for a scheduled/in-progress tournament match
  app.post(
    '/api/osma-liga/tournaments/:code/matches/:matchId/play',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const { code, matchId } = request.params as { code: string; matchId: string };
      const parsed = PlayTournamentMatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues.map((i) => i.message).join(', '));
      }

      const user = await db.osmaUser.findUnique({ where: { id: parsed.data.userId } });
      if (!user) {
        return sendError(reply, 400, 'Invalid userId');
      }

      const result = await playTournamentMatch(code, matchId, parsed.data.userId);
      switch (result.outcome) {
        case 'tournament_not_found':
          return sendError(reply, 404, 'Tournament not found');
        case 'match_not_found':
          return sendError(reply, 404, 'Match not found');
        case 'teams_not_claimed':
          return sendError(reply, 409, 'Both teams must be claimed before playing this match');
        case 'forbidden':
          return sendError(reply, 403, 'Only the players of this match can start it');
        case 'tournament_not_in_progress':
          return sendError(reply, 409, 'Tournament is not in progress');
        case 'match_finished':
          return sendError(reply, 409, 'Match has already finished');
        case 'match_not_playable':
          return sendError(reply, 409, 'Match is not in a playable state');
        case 'created':
        case 'existing':
          return reply.send({
            ok: true,
            onlineMatchId: result.onlineMatchId,
            joinUrlPath: result.joinUrlPath,
            ...(result.playerToken ? { playerToken: result.playerToken } : {}),
            match: serializeTournamentMatch(result.match),
            tournament: serializeTournament(result.tournament),
          });
      }
    },
  );
}
