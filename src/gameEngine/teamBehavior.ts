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
  supportSpacing: 70,
};

export const TRAINING_CHALLENGE_GUEST_BEHAVIOR: TeamBehaviorConfig = {
  ...MULTIPLAYER_TEAM_BEHAVIOR,
};

export const TRAINING_CHALLENGE_HOME_BEHAVIOR: TeamBehaviorConfig = {
  activeController: 'trainingChallengeAi',
  teammateSupportMode: 'aggressive',
  supportCanShoot: true,
  supportChaseWeight: 0.7,
  supportSpacing: 50,
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

function computeAnchorTarget(team: 'home' | 'away', ball: OnlineBall): { x: number; y: number } {
  const fieldW = FIELD_R - FIELD_L;
  const attackDir = team === 'home' ? 1 : -1;
  const ownGoalX = team === 'home' ? FIELD_L : FIELD_R;
  const anchorX = ownGoalX + attackDir * fieldW * 0.25;
  return {
    x: clamp(anchorX, FIELD_L + 40, FIELD_R - 40),
    y: clamp(ball.y, FIELD_T + 50, FIELD_B - 50),
  };
}

function computeRunnerTarget(
  team: 'home' | 'away',
  ball: OnlineBall,
  active: OnlinePlayer,
  config: TeamBehaviorConfig,
): { x: number; y: number } {
  const fieldW = FIELD_R - FIELD_L;
  const attackDir = team === 'home' ? 1 : -1;
  const leadOffset = attackDir * 120 * config.supportChaseWeight;
  const vertOffset = ball.y < FIELD_CY ? 80 : -80;

  const runX = clamp(ball.x + leadOffset, FIELD_L + fieldW * 0.3, FIELD_R - fieldW * 0.3);
  let runY = clamp(ball.y + vertOffset, FIELD_T + 50, FIELD_B - 50);

  // Don't crowd the active player — nudge further away if too close.
  const tooClose = Math.hypot(runX - active.x, runY - active.y) < config.supportSpacing;
  if (tooClose) {
    runY = clamp(runY + (vertOffset > 0 ? -40 : 40), FIELD_T + 50, FIELD_B - 50);
  }

  return { x: runX, y: runY };
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

  if (anchor) targets.set(anchor.id, computeAnchorTarget(team, ball));
  if (runner) targets.set(runner.id, computeRunnerTarget(team, ball, active, config));

  return targets;
}
