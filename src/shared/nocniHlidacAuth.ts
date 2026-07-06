import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { config } from '../config.js';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }
  return null;
}

// Auth for the nocni-hlidac endpoints — separate token from PROJECT_HUB_API_KEY,
// since nocni-hlidac is an unrelated project sharing this API, not part of Osma Liga.
// Fails closed (401, never 500) whether the token is missing, wrong, or the
// server-side NOCNI_HLIDAC_API_TOKEN isn't configured at all.
export function nocniHlidacAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  const token = extractBearerToken(request);
  if (!config.nocniHlidacApiToken || !token || !safeCompare(token, config.nocniHlidacApiToken)) {
    reply.status(401).send({ error: 'unauthorized' });
    return;
  }
  done();
}
