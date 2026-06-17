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

export function apiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction,
): void {
  const key = request.headers['x-project-hub-key'];
  if (typeof key !== 'string' || !safeCompare(key, config.apiKey)) {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }
  done();
}
