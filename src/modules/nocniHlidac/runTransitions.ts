// Pure state-transition logic for a guard's run — kept separate from Prisma
// access (service.ts) so it can be unit-tested without a database.

export interface RunState {
  bestRun: number;
  currentRun: number;
}

// currentRun += 1, bestRun = max(bestRun, currentRun). No dedup of repeated
// calls in this step — the caller (nocni-hlidac) only calls this once per
// "win" screen transition, so this is acceptable for now.
export function applySurviveNight(state: RunState): RunState {
  const currentRun = state.currentRun + 1;
  return { currentRun, bestRun: Math.max(state.bestRun, currentRun) };
}

// currentRun resets to 0, bestRun is never touched.
export function applyDeath(state: RunState): RunState {
  return { currentRun: 0, bestRun: state.bestRun };
}
