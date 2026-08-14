import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import {
  canDeployFromBench, isSelectableFieldPlayer, deployBenchPlayer, updateBenchDeployments,
} from './benchDeployment.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { DEFAULT_BENCH_SIZE, BENCH_DEPLOY_DURATION_MS } from './constants.js';
import type { OnlineGameState } from './types.js';

const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 0.05;

function freshState(): OnlineGameState {
  const state = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  return state;
}

describe('bench — data model / default size', () => {
  it('default bench size is 1 per team', () => {
    expect(DEFAULT_BENCH_SIZE).toBe(1);
    const state = createInitialState();
    const homeBench = state.players.filter((p) => p.team === 'home' && p.matchStatus === 'bench');
    const awayBench = state.players.filter((p) => p.team === 'away' && p.matchStatus === 'bench');
    expect(homeBench).toHaveLength(1);
    expect(awayBench).toHaveLength(1);
  });

  it('new match starts clean — no bench player used or deployed', () => {
    const state = createInitialState();
    for (const p of state.players) {
      if (p.matchStatus === 'bench') {
        expect(p.benchUsed).toBe(false);
      } else {
        expect(p.matchStatus).toBe('field');
        expect(p.benchUsed).toBe(false);
      }
    }
    expect(state.benchDeployments).toHaveLength(0);
  });
});

// The public API (canDeployFromBench/deployBenchPlayer/updateBenchDeployments)
// doesn't depend on createInitialState's fixed roster shape, so bench size 0
// and >1 are exercised directly against hand-built state, per the fixture
// style used elsewhere in this file (mirrors goalkeeper.test.ts's freshState).
function stateWithBenchSize(size: number): OnlineGameState {
  const state = freshState();
  // Drop the default bench players, then add `size` for home only (enough
  // to prove the underlying deploy/update logic scales to 0/3/5 without
  // requiring createInitialState itself to support an override).
  state.players = state.players.filter((p) => p.matchStatus !== 'bench');
  for (let i = 0; i < size; i++) {
    state.players.push({
      id: `h-extra-bench-${i}`,
      team: 'home',
      x: 0, y: 0, vx: 0, vy: 0, baseX: 0, baseY: 0,
      label: `X${i}`,
      kickCooldown: 0,
      active: false,
      role: 'field_player',
      stats: { speed: 210, shotPower: 1, stoppingPower: 0, size: 18 },
      matchStatus: 'bench',
      benchUsed: false,
    });
  }
  return state;
}

describe('bench — engine handles varying bench sizes', () => {
  it('bench size 0 — no bench players, nothing to deploy', () => {
    const state = stateWithBenchSize(0);
    const homeBench = state.players.filter((p) => p.team === 'home' && p.matchStatus === 'bench');
    expect(homeBench).toHaveLength(0);
  });

  it('bench size 3 — each is independently deployable', () => {
    const state = stateWithBenchSize(3);
    const ids = state.players.filter((p) => p.matchStatus === 'bench').map((p) => p.id);
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      expect(deployBenchPlayer(state, 'home', id)).toBe(true);
    }
    expect(state.benchDeployments).toHaveLength(3);
  });

  it('bench size 5 — each is independently deployable', () => {
    const state = stateWithBenchSize(5);
    const ids = state.players.filter((p) => p.matchStatus === 'bench').map((p) => p.id);
    expect(ids).toHaveLength(5);
    for (const id of ids) {
      expect(deployBenchPlayer(state, 'home', id)).toBe(true);
    }
    expect(state.benchDeployments).toHaveLength(5);
  });
});

describe('bench — canDeployFromBench / isSelectableFieldPlayer', () => {
  it('bench player excluded from isSelectableFieldPlayer pre-activation', () => {
    const state = freshState();
    const bench = state.players.find((p) => p.matchStatus === 'bench')!;
    expect(isSelectableFieldPlayer(bench, new Set())).toBe(false);
  });

  it('goalkeeper is rejected by canDeployFromBench', () => {
    const state = freshState();
    const gk = state.players.find((p) => p.role === 'goalkeeper')!;
    expect(canDeployFromBench(gk)).toBe(false);
  });

  it('field starter (matchStatus field) is rejected by canDeployFromBench', () => {
    const state = freshState();
    const starter = state.players.find((p) => p.matchStatus === 'field' && p.role === 'field_player')!;
    expect(canDeployFromBench(starter)).toBe(false);
  });
});

describe('bench — deployBenchPlayer', () => {
  it('activates the correct player by ID, sets matchStatus/benchUsed, retains own stats', () => {
    const state = freshState();
    const bench = state.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    const originalStats = { ...bench.stats };
    const ok = deployBenchPlayer(state, 'home', bench.id);
    expect(ok).toBe(true);
    const after = state.players.find((p) => p.id === bench.id)!;
    expect(after.matchStatus).toBe('temporarily_deployed');
    expect(after.benchUsed).toBe(true);
    expect(after.stats).toEqual(originalStats);
  });

  it('post-deploy, the player is included in isSelectableFieldPlayer pool', () => {
    const state = freshState();
    const bench = state.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    deployBenchPlayer(state, 'home', bench.id);
    const after = state.players.find((p) => p.id === bench.id)!;
    expect(isSelectableFieldPlayer(after, new Set())).toBe(true);
  });

  it('duration is exactly BENCH_DEPLOY_DURATION_MS (30000)', () => {
    expect(BENCH_DEPLOY_DURATION_MS).toBe(30_000);
    const state = freshState();
    const bench = state.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    deployBenchPlayer(state, 'home', bench.id);
    const deployment = state.benchDeployments.find((d) => d.playerId === bench.id)!;
    expect(deployment.remainingMs).toBe(30_000);
  });

  it('reverts to bench after updateBenchDeployments ticks past duration', () => {
    const state = freshState();
    const bench = state.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    deployBenchPlayer(state, 'home', bench.id);
    updateBenchDeployments(state, 30.1); // one big tick past the 30s window
    const after = state.players.find((p) => p.id === bench.id)!;
    expect(after.matchStatus).toBe('bench');
    expect(after.benchUsed).toBe(true); // used up, can't be redeployed
    expect(state.benchDeployments).toHaveLength(0);
  });

  it('rejects re-deploy once benchUsed', () => {
    const state = freshState();
    const bench = state.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    deployBenchPlayer(state, 'home', bench.id);
    updateBenchDeployments(state, 30.1);
    expect(deployBenchPlayer(state, 'home', bench.id)).toBe(false);
  });

  it('rejects concurrent double-deploy of the same player', () => {
    const state = freshState();
    const bench = state.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    expect(deployBenchPlayer(state, 'home', bench.id)).toBe(true);
    expect(deployBenchPlayer(state, 'home', bench.id)).toBe(false);
    expect(state.benchDeployments).toHaveLength(1);
  });

  it('rejects deploying another team\'s bench player', () => {
    const state = freshState();
    const awayBench = state.players.find((p) => p.team === 'away' && p.matchStatus === 'bench')!;
    expect(deployBenchPlayer(state, 'home', awayBench.id)).toBe(false);
  });

  it('rejects an unknown player id', () => {
    const state = freshState();
    expect(deployBenchPlayer(state, 'home', 'does-not-exist')).toBe(false);
  });
});

describe('bench — integration with tickGame', () => {
  it('active-player selection safely reassigns when an active temporarily-deployed player expires', () => {
    const state = freshState();
    const bench = state.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    deployBenchPlayer(state, 'home', bench.id);
    // Force the deployment to be on the verge of expiry.
    const deployment = state.benchDeployments.find((d) => d.playerId === bench.id)!;
    deployment.remainingMs = DT * 1000; // expires on the very next tick

    expect(() => {
      for (let i = 0; i < 10; i++) tickGame(state, DT);
    }).not.toThrow();

    const after = state.players.find((p) => p.id === bench.id)!;
    expect(after.matchStatus).toBe('bench');
    // Active-player pool for home must still resolve without crashing/being empty.
    const homeSelectable = state.players.filter((p) => p.team === 'home' && p.matchStatus !== 'bench' && p.role !== 'goalkeeper');
    expect(homeSelectable.length).toBeGreaterThan(0);
  });

  it('goal-reset/kickoff does not wipe or misconvert an active temporarily-deployed player', () => {
    const state = freshState();
    const bench = state.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    deployBenchPlayer(state, 'home', bench.id);

    // Trigger a goal.
    state.ball.x = 901; // FIELD_R + a bit
    state.ball.y = 280; // FIELD_CY
    state.ball.vx = 50;
    state.lastTouchTeam = 'home';

    let sawGoalPause = false;
    for (let i = 0; i < 200; i++) {
      tickGame(state, DT);
      if (state.goalPause > 0) sawGoalPause = true;
    }
    expect(sawGoalPause).toBe(true);

    const after = state.players.find((p) => p.id === bench.id)!;
    // Still deployed (30s window hasn't been forced to expire here), not
    // silently converted back to 'bench' or 'field' by the reset.
    expect(after.matchStatus).toBe('temporarily_deployed');
    expect(after.benchUsed).toBe(true);
  });
});
