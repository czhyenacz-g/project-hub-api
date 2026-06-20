import { OnlineGameState, InputState, OnlinePlayer } from './types.js';
import { KICK_RANGE } from './constants.js';

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x1 - x2, y1 - y2);
}

const NEUTRAL_INPUT: InputState = { up: false, down: false, left: false, right: false, kick: false };

// Drives the "home" team for an automatic training challenge — a fictional
// club with no real connected host. Chases the ball with whichever player
// is closest (mirrors tick.ts's own findActivePlayer logic) and kicks toward
// the away goal when in range. Deliberately simple — no formation/passing.
export function computeTrainingChallengeInput(state: OnlineGameState): InputState {
  const homePlayers = state.players.filter((p) => p.team === 'home');
  if (homePlayers.length === 0) return NEUTRAL_INPUT;

  let chaser: OnlinePlayer = homePlayers[0];
  let chaserDist = Infinity;
  for (const p of homePlayers) {
    const d = dist(p.x, p.y, state.ball.x, state.ball.y);
    if (d < chaserDist) {
      chaserDist = d;
      chaser = p;
    }
  }

  const dx = state.ball.x - chaser.x;
  const dy = state.ball.y - chaser.y;
  const input: InputState = { ...NEUTRAL_INPUT };

  if (Math.abs(dx) > 4) {
    if (dx > 0) input.right = true;
    else input.left = true;
  }
  if (Math.abs(dy) > 4) {
    if (dy > 0) input.down = true;
    else input.up = true;
  }
  if (chaserDist <= KICK_RANGE) {
    input.kick = true;
  }

  return input;
}
