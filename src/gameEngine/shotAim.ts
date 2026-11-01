import type { Vec2 } from './types.js';
import { FIELD_L, FIELD_R, GOAL_T, GOAL_B } from './constants.js';

// Aimed charged shot for human teams (TeamBehaviorConfig.preparedTurns) —
// port of osma-liga/game/shotAim.ts (same model, same constants), keep in sync.
//
// Holding kick with the ball at the feet starts an aimed charge:
//   - the player keeps the direction held at the press (none = stands
//     still) at chargeSpeedFactor × stats.speed, whatever the keys do;
//   - ball control and retention keep running as in a normal dribble;
//   - toward the opponent's goal (from within maxShotDistance) the shot
//     aims at a point on its goal line: goal centre at the press, ↑/↓
//     move it at aimSpeed px/s, clamped to the goal ± aimOvershoot;
//   - releasing kick fires as before (same force and charge); any other
//     kick (pass, clearance, back) keeps the direction held at release.
// The ball leaving control radius ends the aimed charge (normal controls,
// kick still held = plain charge as before).
export const SHOT_AIM = {
  chargeSpeedFactor: 0.85,
  aimSpeed: 180,
  aimOvershoot: 15,
  maxShotDistance: (FIELD_R - FIELD_L) / 2,
} as const;

export interface ShotAimState {
  playerId: string;
  // Held direction at the press (unit), null = player stood still.
  moveDir: Vec2 | null;
  // Target y on the opponent's goal line; null = not a shot at goal.
  aimY: number | null;
}

const GOAL_MID_Y = (GOAL_T + GOAL_B) / 2;

// attackSign: +1 = attacking the right goal (x = FIELD_R), -1 = left.
export function goalLineX(attackSign: number): number {
  return attackSign > 0 ? FIELD_R : FIELD_L;
}

export function startShotAim(playerId: string, heldDir: Vec2 | null, ball: Vec2, attackSign: number): ShotAimState {
  const towardGoal = !heldDir || heldDir.x * attackSign > 0;
  const inRange = Math.abs(goalLineX(attackSign) - ball.x) <= SHOT_AIM.maxShotDistance;
  return { playerId, moveDir: heldDir, aimY: towardGoal && inRange ? GOAL_MID_Y : null };
}

export function steerShotAim(aim: ShotAimState, up: boolean, down: boolean, dt: number): void {
  if (aim.aimY === null || up === down) return;
  const y = aim.aimY + (down ? 1 : -1) * SHOT_AIM.aimSpeed * dt;
  aim.aimY = Math.max(GOAL_T - SHOT_AIM.aimOvershoot, Math.min(GOAL_B + SHOT_AIM.aimOvershoot, y));
}

// Unit shot direction from the ball to the aim point; null when the charge
// is not a shot at goal (the caller keeps its usual kick direction).
export function shotAimDir(aim: ShotAimState, ball: Vec2, attackSign: number): Vec2 | null {
  if (aim.aimY === null) return null;
  const dx = goalLineX(attackSign) - ball.x;
  const dy = aim.aimY - ball.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return null;
  return { x: dx / len, y: dy / len };
}
