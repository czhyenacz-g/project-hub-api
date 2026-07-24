import { FastifyInstance } from 'fastify';
import { nocniHlidacAuth } from '../../shared/nocniHlidacAuth.js';
import { sendError } from '../../shared/errors.js';
import { NocniHlidacDiscordUserIdSchema } from './validation.js';
import { resolveActivityClient, sanitizeBuildVersion } from './activityValidation.js';
import { recordGameStart, recordLogin } from './activityService.js';

// Player activity logging (see docs/operations/nocni-hlidac.md) — same
// auth/error-shape convention as routes.ts/hardcoreProfileRoutes.ts, kept in
// its own file per the existing per-concern module split.
export async function nocniHlidacActivityRoutes(app: FastifyInstance): Promise<void> {
  // Called EXCLUSIVELY from the nocni-hlidac OAuth callback after a real
  // completed login — never from its /api/auth/me session check (verified
  // against that repo's app/api/auth/callback/route.ts /
  // lib/activity/remotePlayerActivity.ts#recordPlayerLogin, which reads only
  // `.ok` from the response — no other fields are expected here).
  app.post(
    '/nocni-hlidac/player/login',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      const parsed = NocniHlidacDiscordUserIdSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'invalid_request');

      try {
        const activity = await recordLogin(parsed.data.discordUserId);
        if (!activity) return sendError(reply, 404, 'player_not_found');
        return reply.status(200).send({ ok: true });
      } catch (err) {
        request.log.error({ err }, 'nocni-hlidac player login failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );

  // Response is the FLAT PlayerActivitySummary object (no `{ ok }` wrapper)
  // — verified against nocni-hlidac's
  // lib/activity/remotePlayerActivity.ts#recordGameStart, which does
  // `hubPost<PlayerActivitySummary>(...)` directly.
  app.post(
    '/nocni-hlidac/player/activity/game-start',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      const parsed = NocniHlidacDiscordUserIdSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'invalid_request');

      const body = (request.body ?? {}) as Record<string, unknown>;
      const client = resolveActivityClient(body.client);
      const buildVersion = sanitizeBuildVersion(body.buildVersion);

      try {
        const activity = await recordGameStart(parsed.data.discordUserId, client, buildVersion);
        if (!activity) return sendError(reply, 404, 'player_not_found');
        return reply.status(200).send(activity);
      } catch (err) {
        request.log.error({ err }, 'nocni-hlidac game-start failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );
}
