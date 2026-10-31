import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import {
  BALL_CONTROL_RADIUS, KICK_RANGE, KICK_MAX_CHARGE_MS, AI_KICK_RANGE, AI_BALL_CONTROL_RADIUS,
  KICK_FORCE, KICK_TAP_FORCE_MULTIPLIER, KICK_MAX_CHARGE_FORCE_MULTIPLIER,
} from './constants.js';
import { DEFAULT_BEHAVIOR_CONFIG, TRAINING_CHALLENGE_BEHAVIOR_CONFIG } from './teamBehavior.js';
import type { OnlineGameState, InputState } from './types.js';

// Human ball handling = the bot engine's (osma-liga/game/constants.ts):
// control 57, kick reach 57, full charge after 500 ms. The training-
// challenge bot keeps its explicit, smaller reach (AI_*) — its difficulty
// is not part of the physics unification.

const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 0.033;
const idle = (): InputState => ({ up: false, down: false, left: false, right: false, kick: false, switchPlayer: false });

function solo(ballDx: number): OnlineGameState {
  const state = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  const me = state.players.find((p) => p.team === 'home' && p.role === 'field_player')!;
  for (const p of state.players) if (p !== me) { p.matchStatus = 'bench'; p.x = -500; p.y = -500; p.baseX = -500; p.baseY = -500; }
  me.x = 150; me.y = 280;
  state.ball.x = 150 + ballDx; state.ball.y = 280;
  return state;
}

// Holds kick for `heldSeconds` standing still, releases, returns the
// ball's speed right after the release tick (0 = no kick).
function shot(ballDx: number, heldSeconds: number): number {
  const state = solo(ballDx);
  for (let t = 0; t < heldSeconds - 1e-9; t += DT) {
    state.inputs.home = { ...idle(), kick: true };
    tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
  }
  state.inputs.home = idle();
  tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
  return Math.hypot(state.ball.vx, state.ball.vy);
}

describe('human ball handling matches the bot engine', () => {
  it('kick reach is not smaller than control reach (no silently missed shot)', () => {
    expect(BALL_CONTROL_RADIUS).toBe(57);
    expect(KICK_RANGE).toBeGreaterThanOrEqual(BALL_CONTROL_RADIUS);
    expect(KICK_MAX_CHARGE_MS).toBe(500);
  });

  it('a ball 50 px away is kicked, one 75 px away is not', () => {
    expect(shot(50, 0.05)).toBeGreaterThan(KICK_FORCE * KICK_TAP_FORCE_MULTIPLIER * 0.9);
    expect(shot(75, 0.05)).toBe(0);
  });

  it('a tap while running fires (used to fail: the ball rolled past 40 px while the key was down)', () => {
    const state = solo(28);
    state.inputs.home = { ...idle(), right: true };
    for (let i = 0; i < 9; i++) tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
    state.inputs.home = { ...idle(), kick: true };
    tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
    tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
    state.inputs.home = idle();
    tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeGreaterThan(400);
  });

  it('the charge is full after 500 ms; holding longer adds nothing', () => {
    const tap = shot(30, 0.05), half = shot(30, 0.25), full = shot(30, 0.55), long = shot(30, 1.5);
    expect(tap).toBeLessThan(half);
    expect(half).toBeLessThan(full);
    expect(long).toBeCloseTo(full, 5);
    const max = KICK_FORCE * KICK_MAX_CHARGE_FORCE_MULTIPLIER;
    // One tick of friction (0.35^0.033 ≈ 0.966) already applied.
    expect(full).toBeGreaterThan(max * 0.95);
    expect(full).toBeLessThanOrEqual(max + 1);
  });
});

describe('training-challenge bot keeps its explicit reach', () => {
  it('AI reach constants are unchanged', () => {
    expect(AI_KICK_RANGE).toBe(40);
    expect(AI_BALL_CONTROL_RADIUS).toBe(44);
  });

  it('the AI-driven home team does not kick a ball 50 px away', () => {
    const state = solo(50);
    state.inputs.home = { ...idle(), kick: true };
    tickGame(state, DT, TRAINING_CHALLENGE_BEHAVIOR_CONFIG, NO_REMOVALS);
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBe(0);
  });
});
