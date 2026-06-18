import { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../shared/apiKeyAuth.js';
import { sendError } from '../../shared/errors.js';
import { CreateMatchResultSchema, ListMatchResultsQuerySchema, DiscordUpsertSchema } from './validation.js';
import { createMatchResult, listMatchResults, upsertDiscordUser } from './service.js';

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
