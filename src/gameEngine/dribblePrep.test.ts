import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { FIELD_T, FIELD_B, PLAYER_RADIUS } from './constants.js';
import {
  DEFAULT_BEHAVIOR_CONFIG, TRAINING_CHALLENGE_BEHAVIOR_CONFIG, GameBehaviorConfig,
} from './teamBehavior.js';
import type { OnlineGameState, InputState } from './types.js';

// Ball physics V3 on the server (dribblePrep.ts, TeamBehaviorConfig
// .preparedTurns): a human team keeps the ball through a sharp turn, the
// training-challenge bot keeps the classic feel. Mirrors the scenarios in
// osma-liga/game/dribblePrep.test.ts at the real 30 Hz tick.

const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 1 / 30;
const idle = (): InputState => ({ up: false, down: false, left: false, right: false, kick: false, switchPlayer: false });

// One home field player with the ball in front, everyone else off the pitch.
function solo(defender?: { x: number; y: number }): { state: OnlineGameState; meId: string } {
  const state = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  const me = state.players.find((p) => p.team === 'home' && p.role === 'field_player')!;
  const def = state.players.find((p) => p.team === 'away' && p.role === 'field_player')!;
  for (const p of state.players) {
    if (p === me || (defender && p === def)) continue;
    p.matchStatus = 'bench';
    p.x = -500; p.y = -500;
  }
  me.x = 250; me.y = 280;
  if (defender) { def.x = defender.x; def.y = defender.y; }
  state.ball.x = 280; state.ball.y = 280;
  state.manualActivePlayerId.home = me.id;
  state.manualLockRemaining.home = 60;
  return { state, meId: me.id };
}

// Runs right for `runSeconds`, then holds `turn` and returns how long (s)
// the ball spent beyond control distance and the max |y| excursion.
function turn(
  state: OnlineGameState, meId: string, turnInput: Partial<InputState>, cfg: GameBehaviorConfig = DEFAULT_BEHAVIOR_CONFIG,
  runSeconds = 1, defPos?: { x: number; y: number },
) {
  const me = () => state.players.find((p) => p.id === meId)!;
  const def = state.players.find((p) => p.team === 'away' && p.role === 'field_player')!;
  let t = 0, lost = 0, prep = 0, minY = Infinity, maxY = -Infinity;
  while (t < runSeconds + 1.2) {
    state.inputs.home = { ...idle(), ...(t < runSeconds ? { right: true } : turnInput) };
    tickGame(state, DT, cfg, NO_REMOVALS);
    if (defPos) { def.x = defPos.x; def.y = defPos.y; }
    t += DT;
    if (state.dribblePrep.home.phase === 'prep') prep += DT;
    if (t > runSeconds && Math.hypot(state.ball.x - me().x, state.ball.y - me().y) > 57) lost += DT;
    minY = Math.min(minY, me().y); maxY = Math.max(maxY, me().y);
  }
  return { lost, prep, minY, maxY };
}

describe('server ball physics V3 (prepared turns)', () => {
  it('a human 90° and 180° turn keeps the ball', () => {
    for (const input of [{ down: true }, { up: true }, { left: true }]) {
      const { state, meId } = solo();
      const r = turn(state, meId, input);
      expect(r.prep, JSON.stringify(input)).toBeGreaterThan(0);
      expect(r.lost, JSON.stringify(input)).toBe(0);
    }
  });

  it('the training-challenge bot team (preparedTurns off) is untouched', () => {
    // Same human-side scenario but driven through the challenge config's
    // HOME team = trainingChallengeAi — no prep state is ever entered.
    const { state, meId } = solo();
    const r = turn(state, meId, { down: true }, TRAINING_CHALLENGE_BEHAVIOR_CONFIG);
    expect(r.prep).toBe(0);
  });

  it('drag-back away from a pressing defender is assisted, turning into one is not', () => {
    // Defender ~50 px ahead of the ball at the moment of the turn.
    const ahead = { x: 250 + 126 + 32 + 50, y: 280 };
    const a = solo(ahead);
    const r = turn(a.state, a.meId, { left: true }, DEFAULT_BEHAVIOR_CONFIG, 0.6, ahead);
    expect(r.prep).toBeGreaterThan(0);
    expect(r.lost).toBe(0);

    const behind = { x: 250 + 110, y: 280 + 38 };
    const b = solo(behind);
    expect(turn(b.state, b.meId, { left: true }, DEFAULT_BEHAVIOR_CONFIG, 0.6, behind).prep).toBe(0);
  });

  it('the controlled player stays on the pitch at the touchline', () => {
    const { state, meId } = solo();
    const r = turn(state, meId, { up: true }, DEFAULT_BEHAVIOR_CONFIG, 0.3);
    const r2 = turn(state, meId, { down: true }, DEFAULT_BEHAVIOR_CONFIG, 0.1);
    expect(Math.min(r.minY, r2.minY)).toBeGreaterThanOrEqual(FIELD_T + PLAYER_RADIUS);
    expect(Math.max(r.maxY, r2.maxY)).toBeLessThanOrEqual(FIELD_B - PLAYER_RADIUS);
  });

  it('a human kick arms the self-trap protection for the kicker only', () => {
    const { state, meId } = solo();
    state.inputs.home = { ...idle(), right: true };
    for (let i = 0; i < 9; i++) tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
    state.inputs.home = { ...idle(), right: true, kick: true };
    tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
    state.inputs.home = { ...idle(), right: true };
    tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
    expect(state.kickSelfTrap.home.playerId).toBe(meId);
    expect(state.kickSelfTrap.home.remaining).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
    expect(state.kickSelfTrap.home.playerId).toBeNull();
  });
});
