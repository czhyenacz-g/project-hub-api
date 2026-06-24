import { OnlineBall, OnlinePlayer } from './types.js';
import { FIELD_L, FIELD_R, FIELD_T, FIELD_B, FIELD_CY } from './constants.js';

// Shared principle (mirrors the bot engine's game/supportPositioning.ts):
// one active player per team is driven by real input (human or AI), the
// rest hold support positions instead of standing still. Modes/teams differ
// only by config, not by separate implementations.
export type TeammateSupportMode = 'none' | 'basic' | 'aggressive';

export interface TeamBehaviorConfig {
  activeController: 'human' | 'casualAi' | 'trainingChallengeAi';
  teammateSupportMode: TeammateSupportMode;
  supportCanShoot: boolean;
  // 0..1 — how far the forward support player leans toward the ball.
  supportChaseWeight: number;
  // Minimum distance (px) the forward support player keeps from the active player.
  supportSpacing: number;
  // Charged kick (tap = weaker, hold = stronger — see tick.ts) only makes
  // sense for a human holding a button. AI-driven teams keep the old
  // immediate-fire-on-press kick so their shot timing doesn't change.
  usesChargedKick: boolean;
}

export interface GameBehaviorConfig {
  home: TeamBehaviorConfig;
  away: TeamBehaviorConfig;
}

export const MULTIPLAYER_TEAM_BEHAVIOR: TeamBehaviorConfig = {
  activeController: 'human',
  teammateSupportMode: 'basic',
  supportCanShoot: false,
  supportChaseWeight: 0.35,
  supportSpacing: 110,
  usesChargedKick: true,
};

export const TRAINING_CHALLENGE_GUEST_BEHAVIOR: TeamBehaviorConfig = {
  ...MULTIPLAYER_TEAM_BEHAVIOR,
};

export const TRAINING_CHALLENGE_HOME_BEHAVIOR: TeamBehaviorConfig = {
  activeController: 'trainingChallengeAi',
  teammateSupportMode: 'aggressive',
  supportCanShoot: true,
  supportChaseWeight: 0.7,
  supportSpacing: 90,
  usesChargedKick: false,
};

export const DEFAULT_BEHAVIOR_CONFIG: GameBehaviorConfig = {
  home: MULTIPLAYER_TEAM_BEHAVIOR,
  away: MULTIPLAYER_TEAM_BEHAVIOR,
};

export const TRAINING_CHALLENGE_BEHAVIOR_CONFIG: GameBehaviorConfig = {
  home: TRAINING_CHALLENGE_HOME_BEHAVIOR,
  away: TRAINING_CHALLENGE_GUEST_BEHAVIOR,
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Anchor prefers defending over shadowing the ball: it sits deep near its
// own goal and only partly leans toward the ball's height, so it reads as
// "the one who stays back" rather than another ball-chaser.
function computeAnchorTarget(team: 'home' | 'away', ball: OnlineBall): { x: number; y: number } {
  const fieldW = FIELD_R - FIELD_L;
  const attackDir = team === 'home' ? 1 : -1;
  const ownGoalX = team === 'home' ? FIELD_L : FIELD_R;
  const anchorX = ownGoalX + attackDir * fieldW * 0.18;
  const ballLeanY = FIELD_CY + (ball.y - FIELD_CY) * 0.5;
  return {
    x: clamp(anchorX, FIELD_L + 40, FIELD_R - 40),
    y: clamp(ballLeanY, FIELD_T + 50, FIELD_B - 50),
  };
}

// Pushes `target` directly away from `obstacle` until at least `minDist`
// apart, along the line connecting them (falls back to a fixed direction
// if they land exactly on top of each other).
function pushApart(
  target: { x: number; y: number },
  obstacle: { x: number; y: number },
  minDist: number,
): { x: number; y: number } {
  const dx = target.x - obstacle.x;
  const dy = target.y - obstacle.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: obstacle.x, y: obstacle.y + minDist };
  if (d >= minDist) return target;
  const scale = minDist / d;
  return { x: obstacle.x + dx * scale, y: obstacle.y + dy * scale };
}

function computeRunnerTarget(
  team: 'home' | 'away',
  ball: OnlineBall,
  active: OnlinePlayer,
  anchorTarget: { x: number; y: number },
  config: TeamBehaviorConfig,
): { x: number; y: number } {
  const fieldW = FIELD_R - FIELD_L;
  const attackDir = team === 'home' ? 1 : -1;
  const leadOffset = attackDir * 120 * config.supportChaseWeight;
  const vertOffset = ball.y < FIELD_CY ? 80 : -80;

  const runX = clamp(ball.x + leadOffset, FIELD_L + fieldW * 0.3, FIELD_R - fieldW * 0.3);
  const runY = clamp(ball.y + vertOffset, FIELD_T + 50, FIELD_B - 50);

  // Keep distance from both the active player and the anchor — support
  // shouldn't bunch up with any other teammate, regardless of axis.
  let target = pushApart({ x: runX, y: runY }, { x: active.x, y: active.y }, config.supportSpacing);
  target = pushApart(target, anchorTarget, config.supportSpacing);

  return {
    x: clamp(target.x, FIELD_L + 30, FIELD_R - 30),
    y: clamp(target.y, FIELD_T + 30, FIELD_B - 30),
  };
}

// For each non-active teammate, computes a support target position: one
// holds a deeper "anchor" position, the other leans toward the ball as a
// "runner" without crowding the active player. Returns no targets when
// teammateSupportMode is "none" (falls back to existing return-to-base
// behavior in tick.ts).
export function computeTeamSupportInputs(
  players: OnlinePlayer[],
  team: 'home' | 'away',
  active: OnlinePlayer,
  ball: OnlineBall,
  config: TeamBehaviorConfig,
): Map<string, { x: number; y: number }> {
  const targets = new Map<string, { x: number; y: number }>();
  if (config.teammateSupportMode === 'none') return targets;

  const teammates = players.filter((p) => p.team === team && p.id !== active.id);
  if (teammates.length === 0) return targets;

  const ownGoalX = team === 'home' ? FIELD_L : FIELD_R;
  const [anchor, runner] = [...teammates].sort(
    (a, b) => Math.abs(a.x - ownGoalX) - Math.abs(b.x - ownGoalX),
  );

  const anchorTarget = anchor ? computeAnchorTarget(team, ball) : null;
  if (anchor && anchorTarget) targets.set(anchor.id, anchorTarget);
  if (runner) {
    targets.set(
      runner.id,
      computeRunnerTarget(team, ball, active, anchorTarget ?? { x: active.x, y: active.y }, config),
    );
  }

  return targets;
}
