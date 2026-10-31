import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { deployBenchPlayer, computeBenchRoleTarget, chooseBotBenchRole, isBenchRole } from './benchDeployment.js';
import { computeTrainingChallengeInput } from './ai.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { TRAINING_CHALLENGE_BEHAVIOR_CONFIG, DEFAULT_BEHAVIOR_CONFIG } from './teamBehavior.js';
import { FIELD_L, FIELD_R, FIELD_CX, SUPPORT_PLAYER_SPEED } from './constants.js';
import type { OnlineGameState, InputState } from './types.js';

// A deployed bench substitute ("žolík") plays its called-up role while it
// is not the controlled player — before this it had no support slot and
// walked back to its off-pitch bench spot (i.e. stood at the edge).

const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 0.033;

function idle(): InputState {
  return { up: false, down: false, left: false, right: false, kick: false, switchPlayer: false };
}

function deployed(team: 'home' | 'away', role: 'attacker' | 'defender') {
  const state = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  const sub = state.players.find((p) => p.team === team && p.matchStatus === 'bench')!;
  expect(deployBenchPlayer(state, team, sub.id, role)).toBe(true);
  expect(sub.benchRole).toBe(role);
  return { state, sub };
}

function run(state: OnlineGameState, seconds: number, aiHome = false): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    if (aiHome) state.inputs.home = computeTrainingChallengeInput(state);
    tickGame(state, DT, aiHome ? TRAINING_CHALLENGE_BEHAVIOR_CONFIG : DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
  }
}

describe('žolík role (server engine)', () => {
  it('attacker (multiplayer, idle humans) runs forward into the opponent half', () => {
    const { state, sub } = deployed('away', 'attacker');
    const start = { x: sub.x, y: sub.y };
    state.inputs.home = idle();
    state.inputs.guest = idle();
    run(state, 3);
    expect(sub.active).toBe(false);
    expect(Math.hypot(sub.x - start.x, sub.y - start.y)).toBeGreaterThan(150);
    // Away attacks toward FIELD_L — it is heading up the pitch from its
    // baseline entry spot, toward the opponent half.
    expect(sub.x).toBeLessThan(start.x - 150);
    const target = computeBenchRoleTarget('away', 'attacker', state.ball);
    expect(target.x).toBeLessThanOrEqual(FIELD_CX);
  });

  it('defender stays in its own half in front of its goal', () => {
    const { state, sub } = deployed('home', 'defender');
    state.inputs.home = idle();
    state.inputs.guest = idle();
    run(state, 3);
    expect(sub.x).toBeLessThan(FIELD_CX);
    expect(sub.x).toBeGreaterThan(FIELD_L + 60);
  });

  it('moves at the normal support speed (no speed boost)', () => {
    const { state, sub } = deployed('home', 'attacker');
    const before = { x: sub.x, y: sub.y };
    state.inputs.home = idle();
    state.inputs.guest = idle();
    tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
    expect(Math.hypot(sub.x - before.x, sub.y - before.y)).toBeLessThanOrEqual(SUPPORT_PLAYER_SPEED * DT + 2);
  });

  it('training-challenge bot: its substitute also moves to its role position', () => {
    const { state, sub } = deployed('home', 'attacker');
    const start = { x: sub.x, y: sub.y };
    state.inputs.guest = idle();
    run(state, 3, true);
    expect(Math.hypot(sub.x - start.x, sub.y - start.y)).toBeGreaterThan(100);
  });

  it('role targets mirror per team and stay on the pitch', () => {
    const ball = { x: 480, y: 280 };
    expect(computeBenchRoleTarget('home', 'attacker', ball).x).toBeGreaterThan(ball.x);
    expect(computeBenchRoleTarget('away', 'attacker', ball).x).toBeLessThan(ball.x);
    expect(computeBenchRoleTarget('home', 'defender', ball).x).toBeLessThan(ball.x);
    expect(computeBenchRoleTarget('away', 'defender', ball).x).toBeGreaterThan(ball.x);
    for (const b of [{ x: FIELD_L + 5, y: 60 }, { x: FIELD_R - 5, y: 500 }]) {
      for (const t of ['home', 'away'] as const) {
        for (const r of ['attacker', 'defender'] as const) {
          const p = computeBenchRoleTarget(t, r, b);
          expect(p.x).toBeGreaterThan(FIELD_L);
          expect(p.x).toBeLessThan(FIELD_R);
        }
      }
    }
  });

  it('bot role by score: attacker unless leading; unknown roles are not accepted', () => {
    const state = createInitialState(NO_REMOVALS);
    expect(chooseBotBenchRole(state, 'home')).toBe('attacker');
    state.score = { home: 1, away: 0 };
    expect(chooseBotBenchRole(state, 'home')).toBe('defender');
    expect(isBenchRole('attacker')).toBe(true);
    expect(isBenchRole('defender')).toBe(true);
    expect(isBenchRole('goalkeeper')).toBe(false);
    expect(isBenchRole(undefined)).toBe(false);
  });
});
