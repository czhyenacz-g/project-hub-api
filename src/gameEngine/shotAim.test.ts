import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { FIELD_L, FIELD_R, FIELD_CY, GOAL_T, GOAL_B, PLAYER_SPEED, BALL_CONTROL_RADIUS } from './constants.js';
import { DEFAULT_BEHAVIOR_CONFIG, TRAINING_CHALLENGE_BEHAVIOR_CONFIG, GameBehaviorConfig } from './teamBehavior.js';
import { SHOT_AIM } from './shotAim.js';
import { buildSnapshot } from '../modules/osmaLiga/onlineGames.js';
import type { OnlineGameState, InputState } from './types.js';

// Aimed charged shot (shotAim.ts) on the server — mirrors
// osma-liga/game/shotAim.test.ts at the real 30 Hz tick, for both sides.

const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 1 / 30;
const idle = (): InputState => ({ up: false, down: false, left: false, right: false, kick: false, switchPlayer: false });
type Team = 'home' | 'away';

// One field player of `team` with the ball in front (toward the opponent's
// goal), everyone else off the pitch except the listed opponent players.
function solo(team: Team, x: number, y: number, opts: { keepGk?: boolean; defender?: { x: number; y: number } } = {}) {
  const state = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  const other: Team = team === 'home' ? 'away' : 'home';
  const me = state.players.find((p) => p.team === team && p.role === 'field_player')!;
  const gk = state.players.find((p) => p.team === other && p.role === 'goalkeeper')!;
  const def = state.players.find((p) => p.team === other && p.role === 'field_player')!;
  for (const p of state.players) {
    if (p === me || (opts.keepGk && p === gk) || (opts.defender && p === def)) continue;
    p.matchStatus = 'bench';
    p.x = -500; p.y = -500;
  }
  const sign = team === 'home' ? 1 : -1;
  me.x = x; me.y = y;
  state.ball.x = x + sign * 30; state.ball.y = y;
  if (opts.defender) { def.x = opts.defender.x; def.y = opts.defender.y; }
  state.manualActivePlayerId[team] = me.id;
  state.manualLockRemaining[team] = 60;
  return { state, me, def, sign };
}

function setInput(state: OnlineGameState, team: Team, i: Partial<InputState>) {
  if (team === 'home') state.inputs.home = { ...idle(), ...i };
  else state.inputs.guest = { ...idle(), ...i };
}

function run(state: OnlineGameState, team: Team, i: Partial<InputState>, seconds: number, cfg: GameBehaviorConfig = DEFAULT_BEHAVIOR_CONFIG, each?: () => void) {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    setInput(state, team, i);
    tickGame(state, DT, cfg, NO_REMOVALS);
    each?.();
  }
}

// Dribble toward goal, charge `charge` s holding `aim` (up/down), release;
// returns the ball's y where it crosses the goal line (null = never).
function shotY(team: Team, y: number, aim: Partial<InputState>, charge = 0.4, x?: number): number | null {
  const fwd: Partial<InputState> = team === 'home' ? { right: true } : { left: true };
  const { state, sign } = solo(team, x ?? (team === 'home' ? 600 : 360), y);
  run(state, team, fwd, 0.3);
  run(state, team, { ...fwd, kick: true }, 1 / 30);
  run(state, team, { ...aim, kick: true }, charge);
  let crossY: number | null = null;
  const line = sign > 0 ? FIELD_R : FIELD_L;
  run(state, team, {}, 2, DEFAULT_BEHAVIOR_CONFIG, () => {
    if (crossY === null && (sign > 0 ? state.ball.x >= line - 12 : state.ball.x <= line + 12)) crossY = state.ball.y;
  });
  return crossY;
}

describe('server aimed charged shot', () => {
  for (const team of ['home', 'away'] as const) {
    it(`${team}: a straight charge aims at the goal centre, ↑/↓ steer it smoothly`, () => {
      const mid = shotY(team, 250, {});
      const up = shotY(team, 250, { up: true }, 0.2);
      const upMore = shotY(team, 250, { up: true }, 0.4);
      const down = shotY(team, 250, { down: true }, 0.4);
      expect(mid).not.toBeNull();
      expect(Math.abs(mid! - FIELD_CY)).toBeLessThan(15);
      // Smooth: a longer hold moves the aim further, no jump.
      expect(up!).toBeLessThan(mid!);
      expect(upMore!).toBeLessThan(up!);
      expect(down!).toBeGreaterThan(mid!);
      // Clamped near the goal: never far outside the posts.
      expect(shotY(team, 250, { up: true }, 1.5)!).toBeGreaterThan(GOAL_T - SHOT_AIM.aimOvershoot - 15);
      expect(shotY(team, 250, { down: true }, 1.5)!).toBeLessThan(GOAL_B + SHOT_AIM.aimOvershoot + 15);
    });
  }

  it('moves on in the pressed direction at 85 % speed, keys do not steer the run, the ball stays under control', () => {
    const { state, me } = solo('home', 300, 280);
    run(state, 'home', { right: true }, 0.3);
    run(state, 'home', { right: true, kick: true }, 1 / 30);
    const x0 = me.x, y0 = me.y;
    let maxDist = 0;
    run(state, 'home', { up: true, left: true, kick: true }, 0.4, DEFAULT_BEHAVIOR_CONFIG, () => {
      maxDist = Math.max(maxDist, Math.hypot(state.ball.x - me.x, state.ball.y - me.y));
    });
    expect(me.y).toBe(y0);
    expect((me.x - x0) / 0.4).toBeCloseTo(PLAYER_SPEED * SHOT_AIM.chargeSpeedFactor, -1);
    expect(maxDist).toBeLessThan(BALL_CONTROL_RADIUS);
    // Release: normal controls on the very same tick.
    const xr = me.x, yr = me.y;
    run(state, 'home', { up: true }, 1 / 30);
    expect(me.y).toBeLessThan(yr);
    expect(me.x).toBeCloseTo(xr, 0);
  });

  it('a player standing still at the press does not start running', () => {
    const { state, me } = solo('home', 300, 280);
    run(state, 'home', {}, 0.2);
    const x0 = me.x;
    run(state, 'home', { kick: true }, 1 / 30);
    run(state, 'home', { right: true, kick: true }, 0.4);
    expect(me.x).toBeCloseTo(x0, 0);
  });

  it('an opponent can still take the ball during the charge; the aim then ends', () => {
    const { state, me } = solo('home', 300, 280, { defender: { x: 420, y: 280 } });
    run(state, 'home', { right: true }, 0.1);
    run(state, 'home', { right: true, kick: true }, 1, DEFAULT_BEHAVIOR_CONFIG);
    expect(Math.hypot(state.ball.x - me.x, state.ball.y - me.y)).toBeGreaterThan(BALL_CONTROL_RADIUS);
    expect(state.shotAim.home).toBeNull();
  });

  it('the training-challenge bot team never aims; its guest human does (attacking left)', () => {
    const { state } = solo('home', 600, 280);
    run(state, 'home', { right: true, kick: true }, 0.3, TRAINING_CHALLENGE_BEHAVIOR_CONFIG);
    expect(state.shotAim.home).toBeNull();
    const g = solo('away', 360, 280);
    run(g.state, 'away', { left: true }, 0.2, TRAINING_CHALLENGE_BEHAVIOR_CONFIG);
    run(g.state, 'away', { left: true, kick: true }, 0.2, TRAINING_CHALLENGE_BEHAVIOR_CONFIG);
    expect(g.state.shotAim.away?.aimY).not.toBeNull();
  });

  it('the snapshot carries the aim direction only while charging', () => {
    const { state } = solo('away', 360, 280);
    const room = { homeClubName: null, awayClubName: null } as never;
    run(state, 'away', { left: true }, 0.2);
    run(state, 'away', { left: true, kick: true }, 0.2);
    const aim = (buildSnapshot(state, room) as { shotAim: { away: { x: number; y: number } | null } }).shotAim.away;
    expect(aim).not.toBeNull();
    expect(aim!.x).toBeLessThan(0);
    run(state, 'away', {}, 1 / 30);
    expect((buildSnapshot(state, room) as { shotAim: { away: unknown } }).shotAim.away).toBeNull();
  });
});
