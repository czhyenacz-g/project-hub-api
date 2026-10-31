import { OnlineGameState, OnlinePlayer, BenchDeployment, BenchRole } from './types.js';
import { FIELD_L, FIELD_R, FIELD_T, FIELD_B, FIELD_CX, FIELD_CY, BENCH_DEPLOY_DURATION_MS } from './constants.js';
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
// near the bottom (bench) touchline in the team's own corner, distinct from
// the random-substitution bench spot (benchSideline.ts) so the two systems
// never collide visually. The client renders it running up into this spot
// from the bench line; the engine position itself is unchanged.
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
  role: BenchRole = 'attacker',
): boolean {
  const player = state.players.find((p) => p.id === playerId && p.team === team);
  if (!player) return false;
  if (!canDeployFromBench(player)) return false;
  if (getRemovedPlayerIds(state).has(player.id)) return false;

  const pos = getBenchEntryPosition(team);
  player.matchStatus = 'temporarily_deployed';
  player.benchUsed = true;
  player.benchRole = role;
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

export function isBenchRole(value: unknown): value is BenchRole {
  return value === 'attacker' || value === 'defender';
}

const clampTo = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Where a deployed substitute heads while it is NOT the controlled player —
// the 3 starters keep the anchor/runner support slots (teamBehavior.ts), so
// without this the 4th field player had no target and walked back to its
// off-pitch bench spot. Reads only the current ball position.
//   attacker: ahead of the ball in the central lane toward the opponent goal
//             (the overload), never deeper than just outside the box
//   defender: on the line between the ball and its own goal, ~40% of the way
//             out, leaning toward the ball's height
// Mirrors osma-liga/game/benchDeployment.ts.
export function computeBenchRoleTarget(
  team: 'home' | 'away',
  role: BenchRole,
  ball: { x: number; y: number },
): { x: number; y: number } {
  const dir = team === 'home' ? 1 : -1;
  const ownGoalX = team === 'home' ? FIELD_L : FIELD_R;
  const oppGoalX = team === 'home' ? FIELD_R : FIELD_L;
  const yMin = FIELD_T + 50;
  const yMax = FIELD_B - 50;
  if (role === 'attacker') {
    const x = ball.x + dir * 160;
    const lo = team === 'home' ? FIELD_CX : oppGoalX + 130;
    const hi = team === 'home' ? oppGoalX - 130 : FIELD_CX;
    return { x: clampTo(x, lo, hi), y: clampTo(FIELD_CY + (ball.y - FIELD_CY) * 0.3, yMin, yMax) };
  }
  const depth = clampTo(Math.abs(ball.x - ownGoalX) * 0.4, 90, (FIELD_R - FIELD_L) * 0.4);
  return { x: ownGoalX + dir * depth, y: clampTo(FIELD_CY + (ball.y - FIELD_CY) * 0.6, yMin, yMax) };
}

// The training-challenge bot's call-up role: chase the game when behind or
// level, protect a lead. Deterministic — only the current score.
export function chooseBotBenchRole(state: OnlineGameState, team: 'home' | 'away'): BenchRole {
  const own = team === 'home' ? state.score.home : state.score.away;
  const opp = team === 'home' ? state.score.away : state.score.home;
  return own > opp ? 'defender' : 'attacker';
}
