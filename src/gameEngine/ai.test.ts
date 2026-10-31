import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { computeTrainingChallengeInput } from './ai.js';
import { TRAINING_CHALLENGE_BEHAVIOR_CONFIG, DEFAULT_BEHAVIOR_CONFIG } from './teamBehavior.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { canDeployFromBench, deployBenchPlayer } from './benchDeployment.js';
import {
  FIELD_L, FIELD_R, FIELD_T, FIELD_CY, AI_KICK_RANGE as KICK_RANGE, KICK_COOLDOWN, AI_KICK_COOLDOWN, MATCH_DURATION,
  PLAYER_SPEED,
} from './constants.js';
import type { OnlineGameState, OnlinePlayer, InputState } from './types.js';

// Training-challenge bot (home side). Regression coverage for the passive
// bot: it used to steer/range-check from whichever home player was nearest
// to the ball — goalkeeper and benched player included — while tick.ts moved
// a different (active) player; its kick direction followed its approach
// direction; and the human-only held-movement lock pinned it to one player.

const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 0.033; // real server tick

function freshState(): OnlineGameState {
  const state = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  return state;
}

function player(state: OnlineGameState, id: string): OnlinePlayer {
  return state.players.find((p) => p.id === id)!;
}

function setActive(state: OnlineGameState, id: string): void {
  for (const p of state.players) if (p.team === 'home') p.active = p.id === id;
}

function idle(): InputState {
  return { up: false, down: false, left: false, right: false, kick: false, switchPlayer: false };
}

// Deterministic Math.random (support kicks / corner clear use it).
function seedRandom(seed: number): void {
  let a = seed;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeTrainingChallengeInput — which player it steers', () => {
  it('steers from the active field player even when the home goalkeeper is closer to the ball', () => {
    const state = freshState();
    setActive(state, 'h2');
    const gk = player(state, 'h-gk');
    state.ball.x = gk.x + 10;
    state.ball.y = gk.y;
    const h2 = player(state, 'h2');
    h2.x = 400;
    h2.y = FIELD_CY;

    const input = computeTrainingChallengeInput(state);
    // Ball is to the LEFT of h2 — the goalkeeper's position must not matter.
    expect(input.left).toBe(true);
    expect(input.right).toBe(false);
    expect(input.kick).toBe(false);
  });

  it('ignores an unused bench player sitting next to the ball', () => {
    const state = freshState();
    const bench = player(state, 'h-bench-0');
    state.ball.x = bench.x;
    state.ball.y = bench.y - 10;
    setActive(state, 'h3');

    const input = computeTrainingChallengeInput(state);
    // Bench player is within kick range of the ball, but it is not on the pitch.
    expect(input.kick).toBe(false);
    expect(input.down).toBe(true);
  });

  it('with no active player yet (kickoff / after a goal), steers the nearest selectable field player', () => {
    const state = freshState();
    for (const p of state.players) p.active = false;
    const input = computeTrainingChallengeInput(state);
    // Kickoff: all home field players are left of the centre ball.
    expect(input.right).toBe(true);
    expect(input.left).toBe(false);
  });
});

describe('computeTrainingChallengeInput — kicking', () => {
  it('kicks toward the away goal when the ball is in front of it', () => {
    const state = freshState();
    setActive(state, 'h2');
    const h2 = player(state, 'h2');
    h2.x = 600;
    h2.y = FIELD_CY;
    state.ball.x = 620;
    state.ball.y = FIELD_CY;

    const input = computeTrainingChallengeInput(state);
    expect(input.kick).toBe(true);
    expect(input.right).toBe(true);
    expect(input.left).toBe(false);
  });

  it('aims back toward the goal mouth instead of along its approach when the ball is level and off to the side', () => {
    const state = freshState();
    setActive(state, 'h2');
    const h2 = player(state, 'h2');
    // Approaching from below-left, ball well above the goal mouth, close to goal.
    h2.x = 790;
    h2.y = 170;
    state.ball.x = 800;
    state.ball.y = 160;

    const input = computeTrainingChallengeInput(state);
    expect(input.kick).toBe(true);
    expect(input.right).toBe(true);
    expect(input.down).toBe(true); // toward the goal mouth, not up (the approach direction)
    expect(input.up).toBe(false);
  });

  it('never aims a kick further into the top wall', () => {
    const state = freshState();
    setActive(state, 'h2');
    const h2 = player(state, 'h2');
    h2.x = 300;
    h2.y = FIELD_T + 30;
    state.ball.x = 320;
    state.ball.y = FIELD_T + 20;

    const input = computeTrainingChallengeInput(state);
    expect(input.up).toBe(false);
  });

  it('does not kick while the ball is behind it and near the edge of kick range — steps onto the ball first', () => {
    const state = freshState();
    setActive(state, 'h2');
    const h2 = player(state, 'h2');
    h2.x = 700;
    h2.y = FIELD_CY;
    state.ball.x = 700 - (KICK_RANGE - 2);
    state.ball.y = FIELD_CY;

    const input = computeTrainingChallengeInput(state);
    expect(input.kick).toBe(false);
    expect(input.left).toBe(true);
  });

  it('does not press kick during its own cooldown', () => {
    const state = freshState();
    setActive(state, 'h2');
    const h2 = player(state, 'h2');
    h2.x = 600;
    h2.y = FIELD_CY;
    h2.kickCooldown = 0.5;
    state.ball.x = 620;
    state.ball.y = FIELD_CY;

    expect(computeTrainingChallengeInput(state).kick).toBe(false);
  });
});

describe('training challenge AI inside tickGame', () => {
  it('the AI team switches its active player by distance even while holding a direction', () => {
    const state = freshState();
    setActive(state, 'h1');
    state.autoActivePlayerId.home = 'h1';
    // Ball right next to h3, far from h1.
    state.ball.x = player(state, 'h3').x + 25;
    state.ball.y = player(state, 'h3').y;

    for (let i = 0; i < 10; i++) {
      state.inputs.home = computeTrainingChallengeInput(state);
      tickGame(state, DT, TRAINING_CHALLENGE_BEHAVIOR_CONFIG);
    }
    expect(state.players.find((p) => p.team === 'home' && p.active)?.id).toBe('h3');
  });

  it('a human team keeps the held-movement lock (unchanged multiplayer behavior)', () => {
    const state = freshState();
    setActive(state, 'h1');
    state.autoActivePlayerId.home = 'h1';
    state.ball.x = player(state, 'h3').x + 25;
    state.ball.y = player(state, 'h3').y;

    for (let i = 0; i < 10; i++) {
      state.inputs.home = { ...idle(), right: true };
      tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG);
    }
    expect(state.players.find((p) => p.team === 'home' && p.active)?.id).toBe('h1');
  });

  it('AI kicks use AI_KICK_COOLDOWN; a human tap kick keeps KICK_COOLDOWN', () => {
    const ai = freshState();
    setActive(ai, 'h2');
    ai.autoActivePlayerId.home = 'h2';
    const h2 = player(ai, 'h2');
    h2.x = 600; h2.y = FIELD_CY;
    ai.ball.x = 620; ai.ball.y = FIELD_CY;
    ai.inputs.home = computeTrainingChallengeInput(ai);
    tickGame(ai, DT, TRAINING_CHALLENGE_BEHAVIOR_CONFIG);
    expect(player(ai, 'h2').kickCooldown).toBeCloseTo(AI_KICK_COOLDOWN, 5);
    expect(ai.ball.vx).toBeGreaterThan(0);

    const human = freshState();
    setActive(human, 'h2');
    human.autoActivePlayerId.home = 'h2';
    const hh = player(human, 'h2');
    hh.x = 600; hh.y = FIELD_CY;
    human.ball.x = 620; human.ball.y = FIELD_CY;
    human.inputs.home = { ...idle(), kick: true };
    tickGame(human, DT, DEFAULT_BEHAVIOR_CONFIG);
    human.inputs.home = idle();
    tickGame(human, DT, DEFAULT_BEHAVIOR_CONFIG);
    expect(player(human, 'h2').kickCooldown).toBeCloseTo(KICK_COOLDOWN, 5);
  });

  it('the AI never moves its player faster than the player\'s own speed stat', () => {
    const state = freshState();
    let prev = { x: 0, y: 0, id: '' };
    for (let i = 0; i < 300; i++) {
      state.inputs.home = computeTrainingChallengeInput(state);
      tickGame(state, DT, TRAINING_CHALLENGE_BEHAVIOR_CONFIG);
      const a = state.players.find((p) => p.team === 'home' && p.active);
      if (a && a.id === prev.id && state.goalPause === 0) {
        const step = Math.hypot(a.x - prev.x, a.y - prev.y);
        // separateSameTeamPlayers never pushes the active player, so one
        // tick's displacement is bounded by its own speed.
        expect(step).toBeLessThanOrEqual(PLAYER_SPEED * DT + 1e-6);
      }
      if (a) prev = { x: a.x, y: a.y, id: a.id };
    }
  });
});

describe('training challenge — deterministic full-match simulation vs an idle opponent', () => {
  function simulate(seed: number) {
    seedRandom(seed);
    const state = createInitialState(); // production config incl. random substitution
    state.status = 'playing';
    let homeKicks = 0;
    let forwardKicks = 0;
    let stillBallTicks = 0;
    let longestStillBall = 0;
    let homeTouches = 0;
    let lastTouch: string | null = null;

    const isFinished = (): boolean => state.status === 'finished';
    while (!isFinished()) {
      state.inputs.home = computeTrainingChallengeInput(state);
      // Mirrors onlineGames.ts: the bot deploys its bench player after half-time.
      if (state.timeLeftSeconds < MATCH_DURATION / 2) {
        const bp = state.players.find((p) => p.team === 'home' && canDeployFromBench(p));
        if (bp) deployBenchPlayer(state, 'home', bp.id);
      }
      state.inputs.guest = idle();
      const paused = state.goalPause > 0;
      const before = new Map(state.players.map((p) => [p.id, p.kickCooldown]));
      tickGame(state, DT, TRAINING_CHALLENGE_BEHAVIOR_CONFIG);
      if (paused) continue;

      for (const p of state.players) {
        if (p.team === 'home' && p.active && p.kickCooldown > (before.get(p.id) ?? 0) + 0.1) {
          homeKicks++;
          if (state.ball.vx > 0) forwardKicks++;
        }
      }
      if (state.lastTouchPlayerId !== lastTouch) {
        lastTouch = state.lastTouchPlayerId;
        if (state.players.find((p) => p.id === lastTouch)?.team === 'home') homeTouches++;
      }
      stillBallTicks = Math.hypot(state.ball.vx, state.ball.vy) < 5 ? stillBallTicks + 1 : 0;
      longestStillBall = Math.max(longestStillBall, stillBallTicks);
    }
    return { state, homeKicks, forwardKicks, homeTouches, longestStillBallS: longestStillBall * DT };
  }

  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: attacks, shoots forward, never freezes, deploys its bench player, goalkeepers stay in their zones`, () => {
      const r = simulate(seed);
      expect(r.state.score.home).toBeGreaterThanOrEqual(1);
      expect(r.homeKicks).toBeGreaterThanOrEqual(10);
      expect(r.forwardKicks / r.homeKicks).toBeGreaterThan(0.8);
      expect(r.homeTouches).toBeGreaterThanOrEqual(10);
      expect(r.longestStillBallS).toBeLessThan(5);
      expect(player(r.state, 'h-bench-0').benchUsed).toBe(true);
      const homeGk = player(r.state, 'h-gk');
      const awayGk = player(r.state, 'a-gk');
      expect(homeGk.x).toBeLessThan(FIELD_L + 140);
      expect(awayGk.x).toBeGreaterThan(FIELD_R - 140);
    });
  }
});
