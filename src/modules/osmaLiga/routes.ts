import { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../shared/apiKeyAuth.js';
import { sendError } from '../../shared/errors.js';
import { CreateMatchResultSchema, ListMatchResultsQuerySchema, DiscordUpsertSchema } from './validation.js';
import { createMatchResult, listMatchResults, upsertDiscordUser, listClubs, getClubBySlug } from './service.js';
import { db } from '../../db.js';
import { calculateClubPoints } from './onlineMatchResultService.js';

export async function osmaLigaRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/osma-liga/match-results',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const parsed = CreateMatchResultSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues.map(i => i.message).join(', '));
      }
      const result = await createMatchResult(parsed.data);
      return reply.status(201).send(result);
    },
  );

  app.get(
    '/api/osma-liga/match-results',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const parsed = ListMatchResultsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 400, 'Invalid query params');
      }
      const results = await listMatchResults(parsed.data.limit);
      return reply.send(results);
    },
  );

  app.get(
    '/api/osma-liga/clubs',
    { preHandler: apiKeyAuth },
    async (_request, reply) => {
      const clubs = await listClubs();
      return reply.send(clubs);
    },
  );

  app.get(
    '/api/osma-liga/clubs/:slug',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const club = await getClubBySlug(slug);
      if (!club) return sendError(reply, 404, 'Club not found');
      return reply.send(club);
    },
  );

  // GET /api/osma-liga/clubs/:slug/stats — public club stats aggregated from online matches
  app.get(
    '/api/osma-liga/clubs/:slug/stats',
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const club = await db.osmaClub.findUnique({ where: { id: slug }, select: { id: true, slug: true, name: true, shortName: true, isActive: true } });
      if (!club || !club.isActive) return sendError(reply, 404, 'Club not found');

      const homeMatches = await db.osmaOnlineMatch.findMany({
        where: { homeClubId: slug },
        select: { homeScore: true, awayScore: true, homeClubPoints: true },
      });
      const awayMatches = await db.osmaOnlineMatch.findMany({
        where: { awayClubId: slug },
        select: { homeScore: true, awayScore: true, awayClubPoints: true },
      });

      let matches = 0, wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0, points = 0;

      for (const m of homeMatches) {
        matches++;
        goalsFor += m.homeScore;
        goalsAgainst += m.awayScore;
        const pts = m.homeClubPoints ?? calculateClubPoints(m.homeScore, m.awayScore).homeClubPoints;
        points += pts;
        if (m.homeScore > m.awayScore) wins++;
        else if (m.homeScore === m.awayScore) draws++;
        else losses++;
      }
      for (const m of awayMatches) {
        matches++;
        goalsFor += m.awayScore;
        goalsAgainst += m.homeScore;
        const pts = m.awayClubPoints ?? calculateClubPoints(m.homeScore, m.awayScore).awayClubPoints;
        points += pts;
        if (m.awayScore > m.homeScore) wins++;
        else if (m.awayScore === m.homeScore) draws++;
        else losses++;
      }

      return reply.send({
        club: { id: club.id, slug: club.slug, name: club.name, shortName: club.shortName },
        stats: { matches, wins, draws, losses, goalsFor, goalsAgainst, goalDifference: goalsFor - goalsAgainst, points },
      });
    },
  );

  app.post(
    '/api/osma-liga/users/discord-upsert',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const parsed = DiscordUpsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues.map(i => i.message).join(', '));
      }
      const user = await upsertDiscordUser(parsed.data);
      return reply.status(200).send(user);
    },
  );
}
