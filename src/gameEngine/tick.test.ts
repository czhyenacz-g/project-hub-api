import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { AUTO_SWITCH_INPUT_LOCK_MS } from './constants.js';
import type { OnlineGameState, InputState } from './types.js';

// Regression coverage for the auto-switch-during-held-movement bug: while a
// team holds a movement direction, no automatic mechanism (distance-based
// auto-pick, teammate-ball-receive takeover) may steal the active role, even
// when another teammate is dramatically closer to — or in constant contact
// with — the ball. Manual switching (Q / PŘEP.) must still work immediately.

const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 0.05; // 50ms/tick — chunkier than the real 33ms server tick, fewer iterations needed

function noInput(): InputState {
  return { up: false, down: false, left: false, right: false, kick: false, switchPlayer: false };
}

function freshState(): OnlineGameState {
  const state = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  return state;
}

function activeHomeId(state: OnlineGameState): string | undefined {
  return state.players.find((p) => p.team === 'home' && p.active)?.id;
}

// Keeps a teammate glued just inside ball-receive contact range every tick —
// a sustained "this other player is right on the ball" adversarial condition,
// not just a one-off snapshot that support-positioning could drift away from.
function pinNearBall(state: OnlineGameState, playerId: string): void {
  const p = state.players.find((pl) => pl.id === playerId)!;
  p.x = state.ball.x + 5;
  p.y = state.ball.y;
}

describe('active-player lock while movement input is held', () => {
  it('scenario A: keeps the active player during a long held direction even as a teammate stays glued to the ball', () => {
    const state = freshState();
    state.autoActivePlayerId.home = 'h1';
    state.players.find((p) => p.id === 'h1')!.active = true;
    state.inputs.home = { ...noInput(), right: true };

    for (let i = 0; i < 100; i++) { // 5 simulated seconds
      pinNearBall(state, 'h2');
      tickGame(state, DT);
      expect(activeHomeId(state)).toBe('h1');
    }
  });

  it('scenario B: diagonal movement also suppresses auto-switch', () => {
    const state = freshState();
    state.autoActivePlayerId.home = 'h1';
    state.players.find((p) => p.id === 'h1')!.active = true;
    state.inputs.home = { ...noInput(), up: true, right: true };

    for (let i = 0; i < 60; i++) {
      pinNearBall(state, 'h2');
      tickGame(state, DT);
      expect(activeHomeId(state)).toBe('h1');
    }
  });

  it('scenario C: auto-switch resumes only after movement is released and the lock interval elapses', () => {
    const state = freshState();
    state.autoActivePlayerId.home = 'h1';
    state.players.find((p) => p.id === 'h1')!.active = true;
    state.inputs.home = { ...noInput(), right: true };

    for (let i = 0; i < 20; i++) { // 1s held
      pinNearBall(state, 'h2');
      tickGame(state, DT);
    }
    expect(activeHomeId(state)).toBe('h1');

    // Release movement — h2 stays glued to the ball so it's the obvious pick
    // once the lock allows it.
    state.inputs.home = noInput();
    const lockSeconds = AUTO_SWITCH_INPUT_LOCK_MS / 1000;
    const ticksDuringLock = Math.ceil(lockSeconds / DT);
    for (let i = 0; i < ticksDuringLock; i++) {
      pinNearBall(state, 'h2');
      tickGame(state, DT);
    }
    expect(state.autoSwitchInputLockRemaining.home).toBeLessThanOrEqual(1e-9);

    let switched = false;
    for (let i = 0; i < 40; i++) {
      pinNearBall(state, 'h2');
      tickGame(state, DT);
      if (activeHomeId(state) === 'h2') { switched = true; break; }
    }
    expect(switched).toBe(true);
  });

  it('scenario D: manual switch during held movement takes effect immediately and the new player stays active for as long as movement is held', () => {
    const state = freshState();
    state.autoActivePlayerId.home = 'h1';
    state.players.find((p) => p.id === 'h1')!.active = true;
    state.inputs.home = { ...noInput(), right: true };

    for (let i = 0; i < 10; i++) tickGame(state, DT);
    expect(activeHomeId(state)).toBe('h1');

    // Edge-triggered switchPlayer press for one tick.
    state.inputs.home = { ...noInput(), right: true, switchPlayer: true };
    tickGame(state, DT);
    const switchedTo = activeHomeId(state);
    expect(switchedTo).toBeDefined();
    expect(switchedTo).not.toBe('h1');

    // Keep holding movement (switchPlayer no longer pressed) well past the
    // manual override's own MANUAL_SWITCH_LOCK_DURATION (2s) — the switched
    // player must not silently revert to whoever the background auto-pick
    // was tracking before the switch.
    state.inputs.home = { ...noInput(), right: true };
    for (let i = 0; i < 80; i++) { // 4s
      tickGame(state, DT);
      expect(activeHomeId(state)).toBe(switchedTo);
    }
  });

  it('scenario E: mobile touch input (merged into the same InputState) is treated identically', () => {
    // The server has no separate touch/keyboard concept — the client merges
    // keyboard + TouchInput into one InputState before it's ever sent over
    // the socket (components/game/OnlineGameClient.tsx). From the server's
    // perspective a D-pad hold and a keyboard hold are indistinguishable, so
    // this asserts the same up/down/left/right fields are respected
    // regardless of origin.
    const state = freshState();
    state.autoActivePlayerId.home = 'h1';
    state.players.find((p) => p.id === 'h1')!.active = true;
    state.inputs.home = { up: false, down: true, left: false, right: false, kick: false, switchPlayer: false };

    for (let i = 0; i < 60; i++) {
      pinNearBall(state, 'h2');
      tickGame(state, DT);
      expect(activeHomeId(state)).toBe('h1');
    }
  });
});

describe('scenario F: multiplayer server ticks with held direction and a closer teammate', () => {
  it('does not auto-switch the active player across many server ticks at the real tick rate', () => {
    const state = freshState();
    state.autoActivePlayerId.home = 'h1';
    state.players.find((p) => p.id === 'h1')!.active = true;
    state.inputs.home = { ...noInput(), left: true };

    const TICK_MS = 33; // mirrors onlineGames.ts TICK_MS
    const dt = TICK_MS / 1000;
    const ticksFor5Seconds = Math.round(5000 / TICK_MS);
    for (let i = 0; i < ticksFor5Seconds; i++) {
      pinNearBall(state, 'h3');
      tickGame(state, dt);
      expect(activeHomeId(state)).toBe('h1');
    }
  });

  it('away team auto-switch is independent of home team movement lock', () => {
    const state = freshState();
    state.autoActivePlayerId.home = 'h1';
    state.players.find((p) => p.id === 'h1')!.active = true;
    state.autoActivePlayerId.away = 'a1';
    state.players.find((p) => p.id === 'a1')!.active = true;
    state.inputs.home = { ...noInput(), right: true };
    // guest (away) holds no input at all — its own auto-pick should still be
    // free to react normally, unaffected by home's lock.
    state.inputs.guest = noInput();

    const a2 = state.players.find((p) => p.id === 'a2')!;
    for (let i = 0; i < 60; i++) {
      pinNearBall(state, 'h2');
      a2.x = state.ball.x - 5;
      a2.y = state.ball.y;
      tickGame(state, DT);
      expect(activeHomeId(state)).toBe('h1');
    }
    // Away side had no held input, so its own auto-pick was free to move to
    // whichever away player is closest to the ball.
    const activeAway = state.players.find((p) => p.team === 'away' && p.active)?.id;
    expect(activeAway).toBe('a2');
  });
});
