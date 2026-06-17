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
} as const;
