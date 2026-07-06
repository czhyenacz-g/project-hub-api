const requireEnv = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3001', 10),
  databaseUrl: requireEnv('DATABASE_URL'),
  apiKey: requireEnv('PROJECT_HUB_API_KEY'),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
  // Optional on purpose — missing this must not crash the whole API on boot.
  // The training-challenge cron endpoint checks it at request time and fails safely if unset.
  trainingCronSecret: process.env.TRAINING_CRON_SECRET ?? null,
  // Optional, same reason — nocni-hlidac is a separate project sharing this API.
  // Missing this must not crash the whole API on boot; the nocni-hlidac auth
  // preHandler fails closed (401) at request time if unset.
  nocniHlidacApiToken: process.env.NOCNI_HLIDAC_API_TOKEN ?? null,
} as const;
