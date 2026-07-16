import { FastifyInstance } from 'fastify';
import { nocniHlidacAuth } from '../../shared/nocniHlidacAuth.js';
import { sendError } from '../../shared/errors.js';
import { isSupportedObject13PlayerProfileVersion } from './playerProfileTypes.js';
import {
  Object13PlayerProfileGetQuerySchema,
  parseObject13PlayerProfileSyncEnvelope,
  validateObject13PlayerProfileDataV2,
} from './playerProfileValidation.js';
import { getOrCreateObject13PlayerProfile, updateObject13PlayerProfile } from './playerProfileService.js';

// Object13 (nocni-hlidac) general, mode-agnostic player profile — step 1A of
// the profile/inventory work. Isolated route module, same auth/error-shape
// convention as routes.ts/hardcoreProfileRoutes.ts, but its own file per the
// task's isolation requirement — no Prisma access here, only
// playerProfileService.ts talks to the DB.
export async function nocniHlidacPlayerProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/nocni-hlidac/player-profile',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      const parsed = Object13PlayerProfileGetQuerySchema.safeParse(request.query);
      if (!parsed.success) return sendError(reply, 400, 'invalid_request');

      try {
        const profile = await getOrCreateObject13PlayerProfile(parsed.data.discordUserId);
        return reply.status(200).send(profile);
      } catch (err) {
        request.log.error({ err }, 'object13 player-profile get failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );

  app.put(
    '/nocni-hlidac/player-profile',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      const envelope = parseObject13PlayerProfileSyncEnvelope(request.body);
      if (!envelope.success) return sendError(reply, 400, 'invalid_request');

      const { discordUserId, expectedRevision, profileVersion, profileData: rawProfileData } = envelope.data;

      if (!isSupportedObject13PlayerProfileVersion(profileVersion)) {
        return sendError(reply, 400, 'unsupported_profile_version');
      }

      // Strict, fully-whitelisted V2 shape validation on purpose — no
      // lenient silent fallback like
      // hardcoreProfileValidation.ts#sanitizeIncomingHardcoreSnapshot. A bad
      // profileData shape is a real 400/413, never a quietly-substituted
      // default (see playerProfileValidation.ts). This generic PUT is meant
      // for technical/dev use only — ordinary bulb inventory changes go
      // through the dedicated /inventory/bulb/add|consume endpoints, and
      // weapon unlocks go through /equipment/weapon/unlock (see
      // playerProfileInventoryRoutes.ts / playerProfileEquipmentRoutes.ts),
      // which use optimistic locking purpose-built for a single-field
      // change, not a whole-profile overwrite race.
      const validated = validateObject13PlayerProfileDataV2(rawProfileData);
      if (!validated.ok) {
        if (validated.error.code === 'too_large') {
          return sendError(reply, 413, 'profile_data_too_large');
        }
        return sendError(reply, 400, 'invalid_profile_data');
      }

      try {
        const result = await updateObject13PlayerProfile(discordUserId, expectedRevision, profileVersion, validated.data);

        if (result.outcome === 'not_found') {
          return sendError(reply, 404, 'profile_not_found');
        }
        if (result.outcome === 'revision_conflict') {
          // Same "current state" style as the task spec asks for — the
          // caller gets both the number it needs to retry AND the full
          // current profile, so it doesn't need a second round-trip.
          return reply.status(409).send({
            error: 'revision_conflict',
            currentRevision: result.currentRevision,
            profile: result.profile,
          });
        }
        return reply.status(200).send(result.profile);
      } catch (err) {
        request.log.error({ err }, 'object13 player-profile put failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );
}
