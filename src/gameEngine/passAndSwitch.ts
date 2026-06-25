import { OnlineBall, OnlinePlayer } from './types.js';
import { BALL_CONTROL_RADIUS } from './constants.js';

// Q / PŘEP. with the ball under control = pass-and-switch instead of a plain
// active-player cycle. Mirrors osma-liga/game/passAndSwitch.ts so /hra/bot,
// multiplayer and training challenge share one principle. Server
// authoritative: the caller only ever evaluates this for the team the
// connection owns (see tick.ts's resolveActivePlayer).
export interface PassAndSwitchConfig {
  enabled: boolean;
  requiresBallControl: boolean;
  controlDistance: number;
  maxBallSpeedForControl: number;
  accuracy: number; // 0..1 — higher = straighter, more reliably-paced pass
  minForce: number;
  maxForce: number;
  manualLockSeconds: number;
}

export const DEFAULT_PASS_AND_SWITCH_CONFIG: PassAndSwitchConfig = {
  enabled: true,
  requiresBallControl: true,
  controlDistance: BALL_CONTROL_RADIUS,
  maxBallSpeedForControl: 240,
  accuracy: 0.85,
  minForce: 320,
  maxForce: 520,
  manualLockSeconds: 2,
};

const MAX_ERROR_ANGLE_RAD = (30 * Math.PI) / 180;
const IDEAL_PASS_DIST_MIN = 70;
const IDEAL_PASS_DIST_MAX = 320;
const LANE_BLOCK_RADIUS = 28;

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function hasBallControl(player: OnlinePlayer, ball: OnlineBall, config: PassAndSwitchConfig): boolean {
  if (!config.requiresBallControl) return true;
  const d = dist(player.x, player.y, ball.x, ball.y);
  const speed = Math.hypot(ball.vx, ball.vy);
  return d < config.controlDistance && speed < config.maxBallSpeedForControl;
}

// Perpendicular distance from (px,py) to the segment a→b, restricted to the
// middle stretch of the pass lane (t in [0.15, 0.85]) — a simple stand-in for
// "is an opponent standing in the passing lane".
function isInPassingLane(ax: number, ay: number, bx: number, by: number, px: number, py: number, radius: number): boolean {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1) return false;
  const t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
  if (t < 0.15 || t > 0.85) return false;
  const projX = ax + abx * t;
  const projY = ay + aby * t;
  return Math.hypot(px - projX, py - projY) < radius;
}

function scoreCandidate(passer: OnlinePlayer, candidate: OnlinePlayer, opponents: OnlinePlayer[], attackDir: 1 | -1): number {
  const d = dist(passer.x, passer.y, candidate.x, candidate.y);
  let score = 0;

  // Distance — reward a sensible passing range, penalize too close/too far.
  if (d < IDEAL_PASS_DIST_MIN) {
    score -= (IDEAL_PASS_DIST_MIN - d) * 1.5;
  } else if (d > IDEAL_PASS_DIST_MAX) {
    score -= (d - IDEAL_PASS_DIST_MAX) * 0.6;
  } else {
    score += 40 - Math.abs(d - (IDEAL_PASS_DIST_MIN + IDEAL_PASS_DIST_MAX) / 2) * 0.15;
  }

  // Forward progress toward the opponent's goal.
  score += (candidate.x - passer.x) * attackDir * 0.3;

  // Open space around the candidate (distance to nearest opponent).
  let nearestOpponent = Infinity;
  for (const o of opponents) nearestOpponent = Math.min(nearestOpponent, dist(candidate.x, candidate.y, o.x, o.y));
  if (nearestOpponent !== Infinity) {
    score += Math.min(nearestOpponent, 200) * 0.25;
    if (nearestOpponent < 35) score -= 40; // marked too tightly
  }

  // Passing lane blocked by a defender standing in the way.
  for (const o of opponents) {
    if (isInPassingLane(passer.x, passer.y, candidate.x, candidate.y, o.x, o.y, LANE_BLOCK_RADIUS)) {
      score -= 60;
    }
  }

  return score;
}

// Picks the best available teammate to pass to — never "next in order".
// Returns null if no sensible teammate exists (caller should fall back to a
// plain active-player switch).
export function findBestPassTarget(
  passer: OnlinePlayer,
  teammates: OnlinePlayer[],
  opponents: OnlinePlayer[],
): OnlinePlayer | null {
  const candidates = teammates.filter((p) => p.id !== passer.id);
  if (candidates.length === 0) return null;

  const attackDir: 1 | -1 = passer.team === 'home' ? 1 : -1;
  let best: OnlinePlayer | null = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreCandidate(passer, candidate, opponents, attackDir);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

// Q / PŘEP. without ball control = switch to whichever available teammate is
// closest to the ball, not a blind "next in order" cycle. Always excludes
// whoever currently holds the role, so a press changes someone even if that
// player happens to already be the closest. Returns null if no other
// teammate is available (caller should fall back to keeping the current
// active player). Mirrors osma-liga/game/passAndSwitch.ts.
export function findNearestTeammateToBall(
  teammates: OnlinePlayer[],
  ball: OnlineBall,
  excludePlayerId: string,
): OnlinePlayer | null {
  let best: OnlinePlayer | null = null;
  let bestDist = Infinity;
  for (const p of teammates) {
    if (p.id === excludePlayerId) continue;
    const d = dist(p.x, p.y, ball.x, ball.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

// Inaccurate-on-purpose pass velocity: direction toward the target plus a
// small angular error (shrinking as `accuracy` rises), force scaled by
// distance and clamped to [minForce, maxForce].
export function computePassVelocity(passer: OnlinePlayer, target: OnlinePlayer, config: PassAndSwitchConfig): { x: number; y: number } {
  const dx = target.x - passer.x;
  const dy = target.y - passer.y;
  const distance = Math.hypot(dx, dy) || 1;
  const baseDirX = dx / distance;
  const baseDirY = dy / distance;

  const errorAngle = (Math.random() * 2 - 1) * MAX_ERROR_ANGLE_RAD * (1 - config.accuracy);
  const cos = Math.cos(errorAngle);
  const sin = Math.sin(errorAngle);
  const dirX = baseDirX * cos - baseDirY * sin;
  const dirY = baseDirX * sin + baseDirY * cos;

  const t = Math.max(0, Math.min(1, (distance - IDEAL_PASS_DIST_MIN) / (IDEAL_PASS_DIST_MAX - IDEAL_PASS_DIST_MIN)));
  const force = config.minForce + (config.maxForce - config.minForce) * t;

  return { x: dirX * force, y: dirY * force };
}
