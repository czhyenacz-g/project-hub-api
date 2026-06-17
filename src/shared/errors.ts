import { FastifyReply } from 'fastify';

export function sendError(reply: FastifyReply, statusCode: number, message: string): void {
  reply.status(statusCode).send({ error: message });
}
