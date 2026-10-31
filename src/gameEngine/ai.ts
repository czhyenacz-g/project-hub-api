import { OnlineGameState, InputState, OnlinePlayer } from './types.js';
import { KICK_RANGE, FIELD_R, FIELD_T, FIELD_B, GOAL_T, GOAL_B } from './constants.js';
import { isSelectableFieldPlayer } from './benchDeployment.js';
import { getRemovedPlayerIds } from './temporaryRemoval.js';

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x1 - x2, y1 - y2);
}

const NEUTRAL_INPUT: InputState = { up: false, down: false, left: false, right: false, kick: false, switchPlayer: false };

// Ball this close to the top/bottom wall: never aim a kick further into it.
const WALL_KICK_MARGIN = 68;
// tan(22.5°) — splits the 8 keyboard directions evenly.
const DIAGONAL_RATIO = 0.414;
const GOAL_AIM_INSET = 20;
// > one server tick of movement (PLAYER_SPEED 210 px/s × 33 ms ≈ 7 px).
const BEHIND_BALL_KICK_SLACK = 10;

// The player tick.ts will actually move with this input: the home player it
// resolved as active last tick, or — on the first tick / right after a goal
// reset (resetPositions clears `active`) — the closest selectable field
// player, i.e. what findAutoActivePlayer will pick. Goalkeepers (own AI) and
// bench / mid-removal players are never driven by this input, so they must
// never be the reference point for steering or the kick-range check.
function findControlledPlayer(state: OnlineGameState): OnlinePlayer | null {
  const removedIds = getRemovedPlayerIds(state);
  const selectable = state.players.filter((p) => p.team === 'home' && isSelectableFieldPlayer(p, removedIds));
  const active = selectable.find((p) => p.active);
  if (active) return active;

  let nearest: OnlinePlayer | null = null;
  let nearestDist = Infinity;
  for (const p of selectable) {
    const d = dist(p.x, p.y, state.ball.x, state.ball.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = p;
    }
  }
  return nearest;
}

// Kick direction is taken from the held movement keys (tick.ts
// computeKickDirection), so on a kick tick the keys are pointed from the ball
// at the away goal instead of at the ball — otherwise the kick goes wherever
// the bot happened to approach from, often back toward its own goal. Same
// 8-direction keyboard a human has; near the top/bottom wall the vertical key
// that would drive the ball into the wall is dropped.
function aimAtAwayGoal(state: OnlineGameState, input: InputState): void {
  const { ball } = state;
  // Aim inside the goal mouth, on the ball's own height when it is level with
  // the goal, otherwise at the nearer post area.
  const targetY = Math.max(GOAL_T + GOAL_AIM_INSET, Math.min(GOAL_B - GOAL_AIM_INSET, ball.y));
  const dx = FIELD_R - ball.x;
  const dy = targetY - ball.y;

  input.left = false;
  input.right = dx > 0;
  input.up = dy < 0 && Math.abs(dy) > Math.abs(dx) * DIAGONAL_RATIO;
  input.down = dy > 0 && Math.abs(dy) > Math.abs(dx) * DIAGONAL_RATIO;
  if (ball.y - FIELD_T < WALL_KICK_MARGIN) input.up = false;
  if (FIELD_B - ball.y < WALL_KICK_MARGIN) input.down = false;
}

// Drives the "home" team for an automatic training challenge — a fictional
// club with no real connected host. Steers the player tick.ts actually
// controls toward the ball and, when in range, kicks toward the away goal.
// Uses the same input channel, speed, kick range and cooldown as a human;
// only reads the current ball position (no prediction). Deliberately
// simple — no formation/passing (support teammates: teamBehavior.ts).
export function computeTrainingChallengeInput(state: OnlineGameState): InputState {
  const controlled = findControlledPlayer(state);
  if (!controlled) return NEUTRAL_INPUT;

  const dx = state.ball.x - controlled.x;
  const dy = state.ball.y - controlled.y;
  const input: InputState = { ...NEUTRAL_INPUT };

  if (Math.abs(dx) > 4) {
    if (dx > 0) input.right = true;
    else input.left = true;
  }
  if (Math.abs(dy) > 4) {
    if (dy > 0) input.down = true;
    else input.up = true;
  }
  // In range: face the away goal — kicks when the cooldown allows, otherwise
  // carries the ball that way (tick.ts ball control follows held keys).
  // tick.ts moves the player BEFORE resolving the kick, so if the ball is
  // behind the aim direction the aim keys would carry the player out of
  // range first; in that case keep stepping onto the ball until it is close
  // enough that one step can't break contact.
  const ballDist = dist(controlled.x, controlled.y, state.ball.x, state.ball.y);
  if (ballDist <= KICK_RANGE) {
    const aimed: InputState = { ...input };
    aimAtAwayGoal(state, aimed);
    const ax = (aimed.right ? 1 : 0) - (aimed.left ? 1 : 0);
    const ay = (aimed.down ? 1 : 0) - (aimed.up ? 1 : 0);
    const ballAhead = ax * dx + ay * dy >= 0;
    if (ballAhead || ballDist <= KICK_RANGE - BEHIND_BALL_KICK_SLACK) {
      aimed.kick = controlled.kickCooldown <= 0;
      return aimed;
    }
  }

  return input;
}
