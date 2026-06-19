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

function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }
  const secretHeader = request.headers['x-training-cron-secret'];
  if (typeof secretHeader === 'string') return secretHeader;
  return null;
}

// Auth for the internal cron-triggered endpoint. If TRAINING_CRON_SECRET is not
// configured, the endpoint must fail closed — never silently accept requests.
export function trainingCronAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  if (!config.trainingCronSecret) {
    reply.status(503).send({ error: 'Training cron is not configured' });
    return;
  }
  const token = extractToken(request);
  if (!token || !safeCompare(token, config.trainingCronSecret)) {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }
  done();
}
