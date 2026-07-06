import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db.js';
import { seedNocniHlidac, SEED_PLAYERS, SEED_PREFIX } from './seed.js';

// Integration tests against the local dev Postgres (see routes.test.ts for
// the same setup rationale — DATABASE_URL from .env, loaded by vitest.setup.ts).
// Deliberately NOT prefixed with "seed-" or "test-discord-" — the latter is
// used by routes.test.ts's own cleanup filter, and vitest may run test
// files concurrently against the same shared local dev DB.
const REAL_PLAYER_ID = 'real-guard-untouched-by-seed';

async function cleanup(): Promise<void> {
  await db.nocniHlidacPlayer.deleteMany({ where: { discordUserId: { startsWith: SEED_PREFIX } } });
  await db.nocniHlidacPlayer.deleteMany({ where: { discordUserId: REAL_PLAYER_ID } });
}

beforeAll(cleanup);
afterEach(cleanup);
afterAll(async () => {
  await db.$disconnect();
});

describe('seedNocniHlidac', () => {
  it('creates all 5 seed players with the defined bestRun/currentRun values', async () => {
    await seedNocniHlidac();

    const rows = await db.nocniHlidacPlayer.findMany({ where: { discordUserId: { startsWith: SEED_PREFIX } } });
    expect(rows).toHaveLength(SEED_PLAYERS.length);

    for (const expected of SEED_PLAYERS) {
      const row = rows.find((r) => r.discordUserId === expected.discordUserId);
      expect(row).toBeDefined();
      expect(row?.displayName).toBe(expected.displayName);
      expect(row?.bestRun).toBe(expected.bestRun);
      expect(row?.currentRun).toBe(expected.currentRun);
    }
  });

  it('is idempotent — running it twice does not create duplicates or change values', async () => {
    await seedNocniHlidac();
    await seedNocniHlidac();

    const rows = await db.nocniHlidacPlayer.findMany({ where: { discordUserId: { startsWith: SEED_PREFIX } } });
    expect(rows).toHaveLength(SEED_PLAYERS.length);

    const novak = rows.find((r) => r.discordUserId === 'seed-strazny-novak');
    expect(novak?.bestRun).toBe(5);
    expect(novak?.currentRun).toBe(3);
  });

  it('never touches a real (non-"seed-") player row', async () => {
    await db.nocniHlidacPlayer.create({
      data: { discordUserId: REAL_PLAYER_ID, username: 'real-player', displayName: 'Real Player', bestRun: 7, currentRun: 4 },
    });

    await seedNocniHlidac();

    const real = await db.nocniHlidacPlayer.findUnique({ where: { discordUserId: REAL_PLAYER_ID } });
    expect(real).toMatchObject({ username: 'real-player', displayName: 'Real Player', bestRun: 7, currentRun: 4 });
  });

  it('re-running updates displayName/bestRun/currentRun on existing seed rows to the current definitions', async () => {
    // Simulate a seed row that drifted from the current definition (e.g. an
    // older version of the seed list, or manual DB tinkering).
    await db.nocniHlidacPlayer.create({
      data: { discordUserId: 'seed-strazny-novak', username: 'strazny-novak', displayName: 'Old Name', bestRun: 1, currentRun: 1 },
    });

    await seedNocniHlidac();

    const row = await db.nocniHlidacPlayer.findUnique({ where: { discordUserId: 'seed-strazny-novak' } });
    expect(row).toMatchObject({ displayName: 'Strážný Novák', bestRun: 5, currentRun: 3 });
  });
});
