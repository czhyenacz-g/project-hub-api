import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { db } from './db.js';
import { osmaLigaRoutes } from './modules/osmaLiga/routes.js';
import { onlineRoutes } from './modules/osmaLiga/onlineRoutes.js';
import { trainingChallengeRoutes } from './modules/osmaLiga/trainingChallengeRoutes.js';
import { tournamentRoutes } from './modules/osmaLiga/tournamentRoutes.js';
import { nocniHlidacRoutes } from './modules/nocniHlidac/routes.js';
import { nocniHlidacActivityRoutes } from './modules/nocniHlidac/activityRoutes.js';
import { nocniHlidacAdminOverviewRoutes } from './modules/nocniHlidac/adminOverviewRoutes.js';
import { nocniHlidacHardcoreProfileRoutes } from './modules/nocniHlidac/hardcoreProfileRoutes.js';
import { nocniHlidacPlayerProfileRoutes } from './modules/nocniHlidac/playerProfileRoutes.js';
import { nocniHlidacPlayerProfileInventoryRoutes } from './modules/nocniHlidac/playerProfileInventoryRoutes.js';
import { nocniHlidacPlayerProfileEquipmentRoutes } from './modules/nocniHlidac/playerProfileEquipmentRoutes.js';
import { attachSocketIO } from './ws/onlineGameSocket.js';

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
  await app.register(onlineRoutes);
  await app.register(trainingChallengeRoutes);
  await app.register(tournamentRoutes);
  await app.register(nocniHlidacRoutes);
  await app.register(nocniHlidacActivityRoutes);
  await app.register(nocniHlidacAdminOverviewRoutes);
  await app.register(nocniHlidacHardcoreProfileRoutes);
  await app.register(nocniHlidacPlayerProfileRoutes);
  await app.register(nocniHlidacPlayerProfileInventoryRoutes);
  await app.register(nocniHlidacPlayerProfileEquipmentRoutes);

  await app.listen({ port: config.port, host: '0.0.0.0' });

  // Attach Socket.IO after listen so app.server is available
  attachSocketIO(app.server);
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
