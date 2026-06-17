import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { db } from './db.js';
import { osmaLigaRoutes } from './modules/osmaLiga/routes.js';

const app = Fastify({ logger: true });

async function main(): Promise<void> {
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'project-hub-api',
  }));

  await app.register(osmaLigaRoutes);

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
