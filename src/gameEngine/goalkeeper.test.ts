import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { updateGoalkeepers, getGoalkeeperZone } from './goalkeeperAI.js';
import { resolvePlayerBallCollisions } from './physics.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import {
  FIELD_L, FIELD_R, FIELD_CY, GOALKEEPER_BALL_DAMPING, BUMP_FORCE, GOALKEEPER_BUMP_FORCE,
} from './constants.js';
import type { OnlineGameState, InputState } from './types.js';

const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 0.05;

function noInput(): InputState {
  return { up: false, down: false, left: false, right: false, kick: false, switchPlayer: false };
}

function freshState(): OnlineGameState {
  const state = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  return state;
}

describe('goalkeeper — data model', () => {
  it('each team has exactly one goalkeeper, not counted among the 3 field players', () => {
    const state = createInitialState();
    const homeGKs = state.players.filter((p) => p.team === 'home' && p.role === 'goalkeeper');
    const awayGKs = state.players.filter((p) => p.team === 'away' && p.role === 'goalkeeper');
    const homeFieldPlayers = state.players.filter((p) => p.team === 'home' && p.role === 'field_player');
    const awayFieldPlayers = state.players.filter((p) => p.team === 'away' && p.role === 'field_player');
    expect(homeGKs).toHaveLength(1);
    expect(awayGKs).toHaveLength(1);
    expect(homeFieldPlayers).toHaveLength(3);
    expect(awayFieldPlayers).toHaveLength(3);
    expect(state.players).toHaveLength(8);
  });

  it('goalkeepers start inside their own zone, near their own goal', () => {
    const state = createInitialState();
    const homeGK = state.players.find((p) => p.team === 'home' && p.role === 'goalkeeper')!;
    const awayGK = state.players.find((p) => p.team === 'away' && p.role === 'goalkeeper')!;
    const homeZone = getGoalkeeperZone('home');
    const awayZone = getGoalkeeperZone('away');
    expect(homeGK.x).toBeGreaterThanOrEqual(homeZone.xMin);
    expect(homeGK.x).toBeLessThanOrEqual(homeZone.xMax);
    expect(awayGK.x).toBeGreaterThanOrEqual(awayZone.xMin);
    expect(awayGK.x).toBeLessThanOrEqual(awayZone.xMax);
  });
});

describe('goalkeeper — zone clamp', () => {
  it('never leaves its zone even while a distant ball is in play, over many ticks', () => {
    const state = createInitialState();
    state.ball.x = FIELD_R - 5;
    state.ball.y = 20;
    for (let i = 0; i < 300; i++) {
      updateGoalkeepers(state, 1 / 60);
    }
    const homeGK = state.players.find((p) => p.team === 'home' && p.role === 'goalkeeper')!;
    const zone = getGoalkeeperZone('home');
    expect(homeGK.x).toBeGreaterThanOrEqual(zone.xMin);
    expect(homeGK.x).toBeLessThanOrEqual(zone.xMax);
    expect(homeGK.y).toBeGreaterThanOrEqual(zone.yMin);
    expect(homeGK.y).toBeLessThanOrEqual(zone.yMax);
  });

  it('is clamped back into the zone if knocked out by an external force', () => {
    const state = createInitialState();
    const homeGK = state.players.find((p) => p.team === 'home' && p.role === 'goalkeeper')!;
    homeGK.x = FIELD_R - 100;
    homeGK.y = FIELD_CY;
    updateGoalkeepers(state, 1 / 60);
    const zone = getGoalkeeperZone('home');
    expect(homeGK.x).toBeLessThanOrEqual(zone.xMax);
  });
});

describe('goalkeeper — excluded from active-player / support / substitution pools', () => {
  it('is never picked as the active player for either team, even standing on the ball', () => {
    const state = freshState();
    const homeGK = state.players.find((p) => p.team === 'home' && p.role === 'goalkeeper')!;
    state.ball.x = homeGK.x;
    state.ball.y = homeGK.y;
    for (let i = 0; i < 30; i++) tickGame(state, DT);
    expect(state.players.find((p) => p.id === homeGK.id)!.active).toBe(false);
  });
});

describe('goalkeeper — ball collision stopping power', () => {
  it('damps the ball far more than a regular player on contact', () => {
    const state = createInitialState();
    const gk = state.players.find((p) => p.team === 'home' && p.role === 'goalkeeper')!;
    state.ball.x = gk.x + 5;
    state.ball.y = gk.y;
    state.ball.vx = -400;
    state.ball.vy = 0;
    resolvePlayerBallCollisions(state.players, state.ball);
    const outgoingSpeed = Math.hypot(state.ball.vx, state.ball.vy);
    expect(outgoingSpeed).toBeLessThan(400 * 0.7);
  });

  it('is not perfectly impenetrable — a strong shot retains some speed after contact', () => {
    const state = createInitialState();
    const gk = state.players.find((p) => p.team === 'home' && p.role === 'goalkeeper')!;
    state.ball.x = gk.x + 5;
    state.ball.y = gk.y;
    state.ball.vx = -600;
    state.ball.vy = 0;
    resolvePlayerBallCollisions(state.players, state.ball);
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeGreaterThan(0);
  });

  it('field players use unchanged BUMP_FORCE behavior (regression guard)', () => {
    const state = createInitialState();
    const fieldPlayer = state.players.find((p) => p.role === 'field_player')!;
    state.ball.x = fieldPlayer.x + 5;
    state.ball.y = fieldPlayer.y;
    state.ball.vx = 0;
    state.ball.vy = 0;
    resolvePlayerBallCollisions(state.players, state.ball);
    const speed = Math.hypot(state.ball.vx, state.ball.vy);
    expect(speed).toBeCloseTo(BUMP_FORCE, 0);
    expect(GOALKEEPER_BUMP_FORCE).toBeLessThan(BUMP_FORCE * 1.5);
    expect(GOALKEEPER_BALL_DAMPING).toBeLessThan(1);
  });
});

describe('goalkeeper — reset after goal', () => {
  it('goalkeepers stay in their zone through a goal + reset cycle', () => {
    const state = freshState();
    // Push the ball into the away goal to trigger a score.
    state.ball.x = FIELD_R + 5;
    state.ball.y = FIELD_CY;
    state.ball.vx = 50;
    state.lastTouchTeam = 'home';

    let sawGoalPause = false;
    for (let i = 0; i < 200; i++) {
      tickGame(state, DT);
      if (state.goalPause > 0) sawGoalPause = true;
    }
    expect(sawGoalPause).toBe(true);

    const homeGK = state.players.find((p) => p.team === 'home' && p.role === 'goalkeeper')!;
    const zone = getGoalkeeperZone('home');
    expect(homeGK.x).toBeGreaterThanOrEqual(zone.xMin);
    expect(homeGK.x).toBeLessThanOrEqual(zone.xMax);
    expect(homeGK.role).toBe('goalkeeper');
  });
});
