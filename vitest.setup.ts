// Loads .env before any test module (incl. src/config.ts) reads process.env
// — this project has no dotenv dependency, .env is normally only picked up
// by the Prisma CLI, not by plain `node`/`tsx` runs. Optional: CI/production
// set env vars directly, no .env file needed there.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env file present — fine, env vars are expected to be set another way.
}
