import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { deployBenchPlayer, isSelectableFieldPlayer } from './benchDeployment.js';
import { computeTrainingChallengeInput } from './ai.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { TRAINING_CHALLENGE_BEHAVIOR_CONFIG, DEFAULT_BEHAVIOR_CONFIG } from './teamBehavior.js';
import { BENCH_DEPLOY_DURATION_MS } from './constants.js';
import type { OnlineGameState, InputState } from './types.js';

// Bench substitute leaving the pitch after BENCH_DEPLOY_DURATION_MS while it
// is the team's ACTIVE player: control must move to a remaining field player
// immediately — also while the human keeps holding a direction (the
// held-movement lock) and for the training-challenge AI.

const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 0.033;

function idle(): InputState {
  return { up: false, down: false, left: false, right: false, kick: false, switchPlayer: false };
}

function playingState(): OnlineGameState {
  const state = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  return state;
}

// Deploys `team`'s bench player and makes it that team's active player,
// parked right at the ball (the "has the ball" case).
function deployAsActive(state: OnlineGameState, team: 'home' | 'away'): string {
  const bench = state.players.find((p) => p.team === team && p.matchStatus === 'bench')!;
  expect(deployBenchPlayer(state, team, bench.id)).toBe(true);
  bench.x = state.ball.x + (team === 'home' ? -20 : 20);
  bench.y = state.ball.y;
  state.autoActivePlayerId[team] = bench.id;
  for (const p of state.players) if (p.team === team) p.active = p.id === bench.id;
  return bench.id;
}

function expire(state: OnlineGameState, playerId: string): void {
  state.benchDeployments.find((d) => d.playerId === playerId)!.remainingMs = 1;
}

describe('bench substitute expiring while it is the active player', () => {
  it('human team holding a direction: control moves to a field player that actually moves', () => {
    const state = playingState();
    const subId = deployAsActive(state, 'home');
    state.inputs.home = { ...idle(), right: true };
    tickGame(state, DT);
    expire(state, subId);

    tickGame(state, DT);
    const sub = state.players.find((p) => p.id === subId)!;
    expect(sub.matchStatus).toBe('bench');
    expect(sub.active).toBe(false);

    const active = state.players.find((p) => p.team === 'home' && p.active);
    expect(active).toBeDefined();
    expect(isSelectableFieldPlayer(active!, new Set())).toBe(true);
    expect(active!.id).not.toBe(subId);

    const x0 = active!.x;
    for (let i = 0; i < 5; i++) tickGame(state, DT);
    expect(active!.x).toBeGreaterThan(x0); // the held "right" now drives a real player
  });

  it('the expired substitute no longer touches the ball', () => {
    const state = playingState();
    const subId = deployAsActive(state, 'away');
    expire(state, subId);
    tickGame(state, DT);
    const sub = state.players.find((p) => p.id === subId)!;
    // Put the ball right on the benched player and give it speed toward it.
    state.ball.x = sub.x;
    state.ball.y = sub.y;
    state.ball.vx = 0;
    state.ball.vy = 0;
    const before = state.lastTouchPlayerId;
    tickGame(state, DT);
    expect(state.lastTouchPlayerId === subId).toBe(false);
    expect(before === subId).toBe(false);
  });

  it('training challenge AI: after its substitute expires the bot keeps playing with a field player', () => {
    const state = playingState();
    const subId = deployAsActive(state, 'home');
    expire(state, subId);
    for (let i = 0; i < 60; i++) {
      state.inputs.home = computeTrainingChallengeInput(state);
      tickGame(state, DT, TRAINING_CHALLENGE_BEHAVIOR_CONFIG);
    }
    const active = state.players.find((p) => p.team === 'home' && p.active);
    expect(active).toBeDefined();
    expect(active!.id).not.toBe(subId);
    expect(isSelectableFieldPlayer(active!, new Set())).toBe(true);
  });

  it('both teams deploy independently and each substitute leaves after exactly its own 30 s', () => {
    const state = playingState();
    const homeBench = state.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    const awayBench = state.players.find((p) => p.team === 'away' && p.matchStatus === 'bench')!;
    expect(deployBenchPlayer(state, 'home', homeBench.id)).toBe(true);
    for (let i = 0; i < 30; i++) tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG); // ~1 s later
    expect(deployBenchPlayer(state, 'away', awayBench.id)).toBe(true);
    expect(state.benchDeployments).toHaveLength(2);

    const ticksToHomeExpiry = Math.ceil((BENCH_DEPLOY_DURATION_MS / 1000 - 30 * DT) / DT) + 1;
    for (let i = 0; i < ticksToHomeExpiry; i++) {
      state.goalPause = 0;
      tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG);
    }
    expect(homeBench.matchStatus).toBe('bench');
    expect(awayBench.matchStatus).toBe('temporarily_deployed');
    for (let i = 0; i < 32; i++) {
      state.goalPause = 0;
      tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG);
    }
    expect(awayBench.matchStatus).toBe('bench');
    expect(homeBench.benchUsed && awayBench.benchUsed).toBe(true);
    expect(deployBenchPlayer(state, 'home', homeBench.id)).toBe(false);
    expect(deployBenchPlayer(state, 'away', awayBench.id)).toBe(false);
  });
});
