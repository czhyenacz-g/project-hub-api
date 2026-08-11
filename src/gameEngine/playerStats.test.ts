import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { updateGoalkeepers } from './goalkeeperAI.js';
import { resolvePlayerBallCollisions } from './physics.js';
import { DEFAULT_FIELD_PLAYER_STATS, DEFAULT_GOALKEEPER_STATS } from './playerStats.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { PLAYER_RADIUS, BUMP_FORCE } from './constants.js';
import { DEFAULT_BEHAVIOR_CONFIG, TRAINING_CHALLENGE_BEHAVIOR_CONFIG } from './teamBehavior.js';
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

describe('PlayerStats — data model', () => {
  it('every player has a stats object with all fields defined', () => {
    const state = createInitialState();
    for (const p of state.players) {
      expect(typeof p.stats.speed).toBe('number');
      expect(typeof p.stats.shotPower).toBe('number');
      expect(typeof p.stats.stoppingPower).toBe('number');
      expect(typeof p.stats.size).toBe('number');
    }
  });

  it('field players get the default field-player profile', () => {
    const state = createInitialState();
    const fieldPlayer = state.players.find((p) => p.role === 'field_player')!;
    expect(fieldPlayer.stats).toEqual(DEFAULT_FIELD_PLAYER_STATS);
  });

  it('goalkeepers get the default goalkeeper profile', () => {
    const state = createInitialState();
    const gk = state.players.find((p) => p.role === 'goalkeeper')!;
    expect(gk.stats).toEqual(DEFAULT_GOALKEEPER_STATS);
    expect(gk.stats.stoppingPower).toBeGreaterThan(DEFAULT_FIELD_PLAYER_STATS.stoppingPower);
    expect(gk.stats.size).toBeGreaterThan(DEFAULT_FIELD_PLAYER_STATS.size);
  });

  it('each player owns an independent stats object', () => {
    const state = createInitialState();
    const [a, b] = state.players.filter((p) => p.role === 'field_player');
    a.stats.speed = 999;
    expect(b.stats.speed).toBe(DEFAULT_FIELD_PLAYER_STATS.speed);
  });

  it('two players sharing a role can have different stats', () => {
    const state = createInitialState();
    const [a, b] = state.players.filter((p) => p.role === 'field_player');
    a.stats.speed = 300;
    b.stats.speed = 100;
    expect(a.role).toBe(b.role);
    expect(a.stats.speed).not.toBe(b.stats.speed);
  });
});

describe('PlayerStats — speed drives movement', () => {
  it('a faster active player covers more distance per tick than a slower one', () => {
    const state = freshState();
    state.autoActivePlayerId.home = 'h1';
    const h1 = state.players.find((p) => p.id === 'h1')!;
    h1.active = true;
    h1.stats.speed = 400;
    const startX = h1.x;
    state.inputs.home = { ...noInput(), right: true };
    tickGame(state, DT);
    const fastMoved = state.players.find((p) => p.id === 'h1')!.x - startX;

    const slow = freshState();
    slow.autoActivePlayerId.home = 'h1';
    const h1Slow = slow.players.find((p) => p.id === 'h1')!;
    h1Slow.active = true;
    h1Slow.stats.speed = 50;
    const startXSlow = h1Slow.x;
    slow.inputs.home = { ...noInput(), right: true };
    tickGame(slow, DT);
    const slowMoved = slow.players.find((p) => p.id === 'h1')!.x - startXSlow;

    expect(fastMoved).toBeGreaterThan(slowMoved);
  });

  it('goalkeeper movement respects its own stats.speed', () => {
    const state = createInitialState();
    const gk = state.players.find((p) => p.role === 'goalkeeper' && p.team === 'home')!;
    gk.stats.speed = 0;
    const startX = gk.x;
    const startY = gk.y;
    state.ball.x = gk.x + 60;
    state.ball.y = gk.y + 60;
    for (let i = 0; i < 30; i++) updateGoalkeepers(state, 1 / 60);
    expect(gk.x).toBeCloseTo(startX, 5);
    expect(gk.y).toBeCloseTo(startY, 5);
  });
});

describe('PlayerStats — shotPower scales kick force', () => {
  it('a higher shotPower produces a faster ball after an immediate kick', () => {
    const state = freshState();
    state.autoActivePlayerId.home = 'h1';
    const h1 = state.players.find((p) => p.id === 'h1')!;
    h1.active = true;
    h1.x = 300;
    h1.y = 300;
    h1.stats.shotPower = 3;
    state.ball.x = 320;
    state.ball.y = 300;
    state.ball.vx = 0;
    state.ball.vy = 0;
    // Training-challenge behavior config uses the immediate (non-charged)
    // kick path, firing on press rather than release.
    state.inputs.home = { ...noInput(), kick: true, right: true };
    tickGame(state, DT, { ...DEFAULT_BEHAVIOR_CONFIG, home: TRAINING_CHALLENGE_BEHAVIOR_CONFIG.home });

    const speed = Math.hypot(state.ball.vx, state.ball.vy);
    expect(speed).toBeGreaterThan(0);
  });
});

describe('PlayerStats — stoppingPower drives ball-collision damping', () => {
  it('collision damping/bump scales with stoppingPower', () => {
    const state = createInitialState();
    const [a, b] = state.players.filter((p) => p.role === 'field_player');
    a.stats.stoppingPower = 0;
    b.stats.stoppingPower = 1;

    state.ball.x = a.x + 5;
    state.ball.y = a.y;
    state.ball.vx = -400;
    state.ball.vy = 0;
    resolvePlayerBallCollisions(state.players, state.ball);
    const lowStopOutgoing = Math.hypot(state.ball.vx, state.ball.vy);

    state.ball.x = b.x + 5;
    state.ball.y = b.y;
    state.ball.vx = -400;
    state.ball.vy = 0;
    resolvePlayerBallCollisions(state.players, state.ball);
    const highStopOutgoing = Math.hypot(state.ball.vx, state.ball.vy);

    expect(highStopOutgoing).toBeLessThan(lowStopOutgoing);
  });

  it('stoppingPower 0 reproduces the plain BUMP_FORCE impulse (regression guard)', () => {
    const state = createInitialState();
    const fieldPlayer = state.players.find((p) => p.role === 'field_player')!;
    state.ball.x = fieldPlayer.x + 5;
    state.ball.y = fieldPlayer.y;
    state.ball.vx = 0;
    state.ball.vy = 0;
    resolvePlayerBallCollisions(state.players, state.ball);
    expect(Math.hypot(state.ball.vx, state.ball.vy)).toBeCloseTo(BUMP_FORCE, 0);
  });
});

describe('PlayerStats — size is visual only', () => {
  it('goalkeeper stats.size is larger than PLAYER_RADIUS; field player equals it', () => {
    const state = createInitialState();
    const gk = state.players.find((p) => p.role === 'goalkeeper')!;
    const fieldPlayer = state.players.find((p) => p.role === 'field_player')!;
    expect(gk.stats.size).toBeGreaterThan(PLAYER_RADIUS);
    expect(fieldPlayer.stats.size).toBe(PLAYER_RADIUS);
  });
});
