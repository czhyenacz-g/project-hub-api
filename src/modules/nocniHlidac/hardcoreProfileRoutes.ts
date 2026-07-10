import { FastifyInstance } from 'fastify';
import { nocniHlidacAuth } from '../../shared/nocniHlidacAuth.js';
import { sendError } from '../../shared/errors.js';
import { HardcoreProfileGetQuerySchema, HardcoreProfileSyncIdentitySchema, sanitizeIncomingHardcoreSnapshot } from './hardcoreProfileValidation.js';
import { getOrCreateHardcoreProfile, syncHardcoreProfile } from './hardcoreProfileService.js';

// Object13 (nocni-hlidac) Hardcore-only player profile — isolated route
// module, same auth/error-shape convention as routes.ts (nocniHlidacRoutes)
// but kept in its own file/router per the task's isolation requirement. Paths
// match exactly what the nocni-hlidac Next.js client already calls (see
// lib/hardcoreProfile/remoteHardcoreProfile.ts in that repo) —
// `/nocni-hlidac/hardcore-profile[...]`, NOT `/object13/...` — this project
// only has one path prefix for nocni-hlidac, `/nocni-hlidac/*`.
export async function nocniHlidacHardcoreProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/nocni-hlidac/hardcore-profile',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      const parsed = HardcoreProfileGetQuerySchema.safeParse(request.query);
      if (!parsed.success) return sendError(reply, 400, 'invalid_request');

      try {
        const profile = await getOrCreateHardcoreProfile(parsed.data.discordUserId);
        return reply.status(200).send(profile);
      } catch (err) {
        request.log.error({ err }, 'object13 hardcore-profile get failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );

  app.post(
    '/nocni-hlidac/hardcore-profile/sync',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      const parsed = HardcoreProfileSyncIdentitySchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, 'invalid_request');

      // Hardcore snapshot fields are sanitized leniently, not strictly
      // zod-validated — an invalid/missing/Normal-like field is silently
      // ignored (defaults to false/0), never a 400, per the task's
      // "Nepřijímej / ignoruj" list (see hardcoreProfileValidation.ts).
      const snapshot = sanitizeIncomingHardcoreSnapshot(request.body);

      try {
        const profile = await syncHardcoreProfile(
          parsed.data.discordUserId,
          { displayName: parsed.data.displayName ?? null, avatarUrl: parsed.data.avatarUrl ?? null },
          snapshot,
        );
        return reply.status(200).send(profile);
      } catch (err) {
        request.log.error({ err }, 'object13 hardcore-profile sync failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );
}
