import { FastifyInstance } from 'fastify';
import { nocniHlidacAuth } from '../../shared/nocniHlidacAuth.js';
import { sendError } from '../../shared/errors.js';
import { NocniHlidacPlayerUpsertSchema, NocniHlidacDiscordUserIdSchema } from './validation.js';
import { upsertNocniHlidacPlayer, recordSurvivedNight, recordDeath, listNocniHlidacLeaderboard } from './service.js';

// Isolated support for nocni-hlidac (nocni-hlidac.vercel.app) — a separate
// project sharing this API, unrelated to Osma Liga. Error codes here use
// nocni-hlidac's own convention ({ error: 'invalid_request' } etc.), not the
// human-readable messages the osma-liga routes use — the two are independent
// call sites, no shared client depends on this format.
export async function nocniHlidacRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/nocni-hlidac/player/upsert',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      const parsed = NocniHlidacPlayerUpsertSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'invalid_request');

      try {
        const player = await upsertNocniHlidacPlayer(parsed.data);
        return reply.status(200).send(player);
      } catch (err) {
        request.log.error({ err }, 'nocni-hlidac player upsert failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );

  app.post(
    '/nocni-hlidac/player/survive-night',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      const parsed = NocniHlidacDiscordUserIdSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'invalid_request');

      try {
        const player = await recordSurvivedNight(parsed.data.discordUserId);
        if (!player) return sendError(reply, 404, 'player_not_found');
        return reply.status(200).send(player);
      } catch (err) {
        request.log.error({ err }, 'nocni-hlidac survive-night failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );

  app.post(
    '/nocni-hlidac/player/death',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      const parsed = NocniHlidacDiscordUserIdSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'invalid_request');

      try {
        const player = await recordDeath(parsed.data.discordUserId);
        if (!player) return sendError(reply, 404, 'player_not_found');
        return reply.status(200).send(player);
      } catch (err) {
        request.log.error({ err }, 'nocni-hlidac death failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );

  app.get(
    '/nocni-hlidac/leaderboard',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      try {
        const leaderboard = await listNocniHlidacLeaderboard();
        return reply.send(leaderboard);
      } catch (err) {
        request.log.error({ err }, 'nocni-hlidac leaderboard failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );
}
