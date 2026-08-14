import { OnlineGameState, OnlinePlayer, BenchDeployment } from './types.js';
import { FIELD_L, FIELD_R, FIELD_B, BENCH_DEPLOY_DURATION_MS } from './constants.js';
import { getRemovedPlayerIds } from './temporaryRemoval.js';

export type { BenchDeployment };

// Bench + temporary substitute — separate system from the unrelated
// TemporaryPlayerRemoval mechanic (random substitution) in temporaryRemoval.ts.
// Server-authoritative: the client only ever renders a snapshot of
// state.benchDeployments/player.matchStatus — it never decides a bench
// player is active on its own. Mirrors osma-liga/game/benchDeployment.ts.

export function canDeployFromBench(player: OnlinePlayer): boolean {
  return player.role === 'field_player' && player.matchStatus === 'bench' && !player.benchUsed;
}

// Selectable pool for active-player resolution / support-positioning —
// excludes goalkeepers (never selectable), bench players (not on the pitch
// yet), and players currently mid-removal (the unrelated random-substitution
// mechanic).
export function isSelectableFieldPlayer(p: OnlinePlayer, removedIds: Set<string>): boolean {
  return p.role !== 'goalkeeper' && p.matchStatus !== 'bench' && !removedIds.has(p.id);
}

// Holding spot for a bench player once deployed — just inside the field,
// near the team's own baseline, distinct from the random-substitution bench
// spot (getBenchPosition in temporaryRemoval.ts) so the two systems never
// collide visually.
export function getBenchEntryPosition(team: 'home' | 'away'): { x: number; y: number } {
  return { x: team === 'home' ? FIELD_L + 90 : FIELD_R - 90, y: FIELD_B - 60 };
}

// Validates and performs a bench deployment in place. Returns false (no
// mutation) if the player doesn't exist, doesn't belong to `team`, isn't
// bench-eligible, or is currently mid-removal (the unrelated
// random-substitution mechanic).
export function deployBenchPlayer(
  state: OnlineGameState,
  team: 'home' | 'away',
  playerId: string,
): boolean {
  const player = state.players.find((p) => p.id === playerId && p.team === team);
  if (!player) return false;
  if (!canDeployFromBench(player)) return false;
  if (getRemovedPlayerIds(state).has(player.id)) return false;

  const pos = getBenchEntryPosition(team);
  player.matchStatus = 'temporarily_deployed';
  player.benchUsed = true;
  player.x = pos.x;
  player.y = pos.y;
  player.vx = 0;
  player.vy = 0;
  player.kickCooldown = 0;
  state.benchDeployments.push({ playerId, team, remainingMs: BENCH_DEPLOY_DURATION_MS });
  return true;
}

// Server-authoritative countdown — call once per tick. When a deployment's
// timer runs out, the player reverts to 'bench' (not removed from the
// roster; `benchUsed` stays true so it can't be redeployed).
export function updateBenchDeployments(state: OnlineGameState, dt: number): void {
  if (state.benchDeployments.length === 0) return;

  const stillActive: BenchDeployment[] = [];
  for (const deployment of state.benchDeployments) {
    deployment.remainingMs -= dt * 1000;
    if (deployment.remainingMs > 0) {
      stillActive.push(deployment);
      continue;
    }
    const player = state.players.find((p) => p.id === deployment.playerId);
    if (player && player.matchStatus === 'temporarily_deployed') {
      player.matchStatus = 'bench';
      player.vx = 0;
      player.vy = 0;
    }
  }
  state.benchDeployments = stillActive;
}
