import { FastifyInstance } from 'fastify';
import { nocniHlidacAuth } from '../../shared/nocniHlidacAuth.js';
import { sendError } from '../../shared/errors.js';
import { listAdminActivityEvents, listAdminPlayers } from './adminOverviewService.js';

const MAX_LIMIT = 100;

// `?limit=` is bounded to MAX_LIMIT regardless of what's requested — this is
// an internal, server-to-server-only read endpoint (see module comment
// below), but there's no reason to let it return unbounded rows even so.
function parseLimit(raw: unknown): number {
  const value = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(value) || value <= 0) return MAX_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

/**
 * Read-only data for nocni-hlidac's `/admin` Server Component page (see
 * lib/admin/adminOverview.ts in that repo) — NOT a public admin API. Same
 * `nocniHlidacAuth` bearer token as every other `/nocni-hlidac/*` endpoint;
 * admin identity ("is this Discord user czhyenacz?") is checked ENTIRELY on
 * the nocni-hlidac Next.js side (lib/auth/adminUsers.ts) before this hub is
 * ever called — this hub has no concept of "which Discord user is asking",
 * only "is the caller our own Next.js server". No CORS, no browser-facing
 * token, no new auth/role system (see task "11. Bezpečnost a autentizace").
 */
export async function nocniHlidacAdminOverviewRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/nocni-hlidac/admin/players',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      try {
        const limit = parseLimit((request.query as Record<string, unknown> | undefined)?.limit);
        const players = await listAdminPlayers(limit);
        return reply.status(200).send(players);
      } catch (err) {
        request.log.error({ err }, 'nocni-hlidac admin players failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );

  app.get(
    '/nocni-hlidac/admin/activity-events',
    { preHandler: nocniHlidacAuth },
    async (request, reply) => {
      try {
        const limit = parseLimit((request.query as Record<string, unknown> | undefined)?.limit);
        const events = await listAdminActivityEvents(limit);
        return reply.status(200).send(events);
      } catch (err) {
        request.log.error({ err }, 'nocni-hlidac admin activity-events failed');
        return sendError(reply, 500, 'internal_error');
      }
    },
  );
}
