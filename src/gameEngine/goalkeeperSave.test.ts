import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { FIELD_L, FIELD_R, FIELD_CX, FIELD_CY, GOALKEEPER_RADIUS, BALL_RADIUS } from './constants.js';
import { DEFAULT_BEHAVIOR_CONFIG, TRAINING_CHALLENGE_BEHAVIOR_CONFIG, GameBehaviorConfig } from './teamBehavior.js';
import { computeTrainingChallengeInput } from './ai.js';
import {
  GOALKEEPER_SAVE, saveRoll, saveOutcome, holdSeconds, heldBallSpot, releaseBall, firstSaveSeq,
} from './goalkeeperSave.js';
import { buildSnapshot } from '../modules/osmaLiga/onlineGames.js';
import type { OnlineGameState, OnlinePlayer, InputState } from './types.js';

// Goalkeeper save outcomes (goalkeeperSave.ts) on the server — mirrors
// osma-liga/game/goalkeeperSave.test.ts at the real 30 Hz tick, both goals.

const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 1 / 30;
const R = GOALKEEPER_RADIUS + BALL_RADIUS;
// saveRoll sequence numbers with a known outcome — the same as osma-liga
// game/physicsContract/spec.ts (CATCH/PARRY/CLEAR_SAVE_SEQ).
const CATCH = 5, PARRY = 1, CLEAR = 0;
type Team = 'home' | 'away';
const idle = (): InputState => ({ up: false, down: false, left: false, right: false, kick: false, switchPlayer: false });
const fwd = (team: Team) => (team === 'home' ? 1 : -1);

describe('server goalkeeper save model (same as osma-liga)', () => {
  it('known sequence numbers, 30/50/20 split, 0.5–0.8 s hold', () => {
    expect(saveOutcome(saveRoll(CATCH))).toBe('catch');
    expect(saveOutcome(saveRoll(PARRY))).toBe('parry');
    expect(saveOutcome(saveRoll(CLEAR))).toBe('clear');
    // Pinned values: any change here must be made in osma-liga too.
    expect(saveRoll(0)).toBeCloseTo(0.904, 3);
    expect(saveRoll(5, 1)).toBeCloseTo(0.348, 3);
    const n = { catch: 0, parry: 0, clear: 0 };
    for (let m = 0; m < 2000; m++) {
      const start = firstSaveSeq(180 - (m % 170), 700 + (m % 97), 200 + (m % 61));
      for (let k = 0; k < 10; k++) n[saveOutcome(saveRoll(start + k))]++;
    }
    expect(Math.abs(n.catch / 20000 - 0.3)).toBeLessThan(0.02);
    expect(Math.abs(n.parry / 20000 - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(n.clear / 20000 - 0.2)).toBeLessThan(0.02);
    for (let s = 0; s < 300; s++) {
      expect(holdSeconds(saveRoll(s))).toBeGreaterThanOrEqual(GOALKEEPER_SAVE.holdMinSeconds);
      expect(holdSeconds(saveRoll(s))).toBeLessThanOrEqual(GOALKEEPER_SAVE.holdMaxSeconds);
    }
  });

  for (const team of ['home', 'away'] as const) {
    it(`${team}: every release goes forward from in front of him`, () => {
      const gk = { x: team === 'home' ? FIELD_L + 34 : FIELD_R - 34, y: FIELD_CY };
      for (let k = 0; k < 300; k++) {
        const h = (i: number) => saveRoll(k, i);
        const opp = [0, 1, 2].map((i) => ({ x: gk.x + fwd(team) * (30 + h(i) * 200), y: gk.y + (h(i + 3) - 0.5) * 300 }));
        const mates = [0, 1].map((i) => ({ x: gk.x + fwd(team) * (-30 + h(i + 6) * 400), y: gk.y + (h(i + 8) - 0.5) * 300 }));
        const r = releaseBall(gk, team, mates, opp, h(11) < 0.5, h(12));
        expect(r.x).toBeCloseTo(heldBallSpot(gk, team).x, 5);
        expect(r.vx * fwd(team)).toBeGreaterThan(0);
      }
    });
  }
});

interface Setup {
  gkTeam: Team;
  seq: number;
  ballDx?: number;
  ballDy?: number;
  speed?: number;
  mate?: { x: number; y: number };
}

function setup(s: Setup) {
  const state = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  const shooterTeam: Team = s.gkTeam === 'home' ? 'away' : 'home';
  const gk = state.players.find((p) => p.team === s.gkTeam && p.role === 'goalkeeper')!;
  const shooter = state.players.find((p) => p.team === shooterTeam && p.role === 'field_player' && p.matchStatus === 'field')!;
  const mate = state.players.find((p) => p.team === s.gkTeam && p.role === 'field_player' && p.matchStatus === 'field')!;
  for (const p of state.players) {
    if (p === gk || p === shooter || p.role === 'goalkeeper') continue;
    if (p === mate && s.mate) { p.x = s.mate.x; p.y = s.mate.y; p.baseX = s.mate.x; p.baseY = s.mate.y; continue; }
    p.matchStatus = 'bench';
    p.x = -500; p.y = -500; p.baseX = -500; p.baseY = -500;
  }
  shooter.x = FIELD_CX; shooter.y = 80; shooter.baseX = FIELD_CX; shooter.baseY = 80;
  const sign = fwd(s.gkTeam);
  state.ball.x = gk.x + sign * (s.ballDx ?? 220);
  state.ball.y = gk.y + (s.ballDy ?? 0);
  const goalX = s.gkTeam === 'home' ? FIELD_L : FIELD_R;
  const d = Math.hypot(goalX - state.ball.x, FIELD_CY - state.ball.y);
  const speed = s.speed ?? 600;
  state.ball.vx = (goalX - state.ball.x) / d * speed;
  state.ball.vy = (FIELD_CY - state.ball.y) / d * speed;
  state.lastKickTeam = shooterTeam; state.lastKickPlayerId = shooter.id;
  state.lastTouchTeam = shooterTeam; state.lastTouchPlayerId = shooter.id;
  state.goalkeeperSaveSeq = s.seq;
  return { state, gk, shooter, mate };
}

interface Trace { contactT: number | null; releaseT: number | null; maxHeldDrift: number; heldTicks: number; goals: number; closestToMate: number }

function play(state: OnlineGameState, gk: OnlinePlayer, seconds: number, cfg: GameBehaviorConfig = DEFAULT_BEHAVIOR_CONFIG, mate?: OnlinePlayer, each?: () => void): Trace {
  const tr: Trace = { contactT: null, releaseT: null, maxHeldDrift: 0, heldTicks: 0, goals: 0, closestToMate: Infinity };
  const score0 = state.score.home + state.score.away;
  let t = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    state.inputs.home = idle();
    state.inputs.guest = idle();
    each?.();
    const wasHeld = !!state.goalkeeperHold;
    tickGame(state, DT, cfg, NO_REMOVALS);
    t += DT;
    if (tr.contactT === null && state.lastTouchPlayerId === gk.id) tr.contactT = t;
    if (state.goalkeeperHold) {
      tr.heldTicks++;
      const spot = heldBallSpot(gk, gk.team);
      tr.maxHeldDrift = Math.max(tr.maxHeldDrift, Math.hypot(state.ball.x - spot.x, state.ball.y - spot.y), Math.hypot(state.ball.vx, state.ball.vy));
    } else if (wasHeld && tr.releaseT === null) tr.releaseT = t;
    if (mate && tr.releaseT !== null) tr.closestToMate = Math.min(tr.closestToMate, Math.hypot(state.ball.x - mate.x, state.ball.y - mate.y));
  }
  tr.goals = state.score.home + state.score.away - score0;
  return tr;
}

describe('server goalkeeper save outcomes', () => {
  for (const gkTeam of ['home', 'away'] as const) {
    describe(`${gkTeam} goalkeeper (${gkTeam === 'home' ? 'left' : 'right'} goal)`, () => {
      it('catch: pinned 0.5–0.8 s, then a pass to the open teammate', () => {
        const gx = gkTeam === 'home' ? FIELD_L + 34 : FIELD_R - 34;
        const { state, gk, mate } = setup({ gkTeam, seq: CATCH, mate: { x: gx + fwd(gkTeam) * 260, y: 160 } });
        const tr = play(state, gk, 2.2, DEFAULT_BEHAVIOR_CONFIG, mate);
        expect(tr.releaseT! - tr.contactT!).toBeGreaterThanOrEqual(GOALKEEPER_SAVE.holdMinSeconds - 0.04);
        expect(tr.releaseT! - tr.contactT!).toBeLessThanOrEqual(GOALKEEPER_SAVE.holdMaxSeconds + 0.04);
        expect(tr.maxHeldDrift).toBeLessThan(0.01);
        expect(tr.closestToMate).toBeLessThan(60);
        expect(state.goalkeeperSaveSeq).toBe(CATCH + 1);
        expect(state.lastKickTeam).toBe(gkTeam);
        expect(tr.goals).toBe(0);
      });

      it('catch with nobody to pass to: a clearance toward the opponent half', () => {
        const { state, gk } = setup({ gkTeam, seq: CATCH });
        const tr = play(state, gk, 2.5);
        expect(tr.releaseT).not.toBeNull();
        expect((state.ball.x - gk.x) * fwd(gkTeam)).toBeGreaterThan(300);
        expect(tr.goals).toBe(0);
      });

      it('parry: a free rebound in front of him; a follow-up shot is a new save', () => {
        const { state, gk, shooter } = setup({ gkTeam, seq: PARRY, ballDx: 160 });
        play(state, gk, 0.5);
        expect(state.goalkeeperHold).toBeNull();
        const out = (state.ball.x - gk.x) * fwd(gkTeam);
        expect(out).toBeGreaterThan(R);
        expect(out).toBeLessThan(160);
        state.ball.vx = -fwd(gkTeam) * 600; state.ball.vy = 0;
        state.lastKickTeam = shooter.team; state.lastKickPlayerId = shooter.id;
        state.lastTouchTeam = shooter.team; state.lastTouchPlayerId = shooter.id;
        play(state, gk, 0.5);
        expect(state.goalkeeperSaveSeq).toBe(PARRY + 2);
      });

      it('clear: an immediate long kick forward', () => {
        const { state, gk } = setup({ gkTeam, seq: CLEAR });
        const tr = play(state, gk, 1.5);
        expect(tr.heldTicks).toBe(0);
        expect(state.lastKickTeam).toBe(gkTeam);
        expect((state.ball.x - gk.x) * fwd(gkTeam)).toBeGreaterThan(350);
        expect(tr.goals).toBe(0);
      });
    });
  }

  it('one decision per save, also for close-range and hard shots', () => {
    for (const gkTeam of ['home', 'away'] as const) for (const [ballDx, speed] of [[60, 450], [40, 800], [250, 800], [120, 380]] as const) {
      for (const seq of [CATCH, PARRY, CLEAR]) {
        const { state, gk } = setup({ gkTeam, seq, ballDx, speed });
        const tr = play(state, gk, 2);
        expect(state.goalkeeperSaveSeq, `${gkTeam} dx${ballDx} v${speed} seq${seq}`).toBe(seq + 1);
        expect(tr.goals).toBe(0);
      }
    }
  });

  it('a held ball: the opponent standing on it and kicking changes nothing', () => {
    const { state, gk, shooter } = setup({ gkTeam: 'away', seq: CATCH });
    play(state, gk, 0.45);
    expect(state.goalkeeperHold).not.toBeNull();
    shooter.x = state.ball.x - 30; shooter.y = state.ball.y;
    state.manualActivePlayerId.home = shooter.id;
    state.manualLockRemaining.home = 5;
    const kickSeq = [true, true, false, false];
    let i = 0;
    const tr = play(state, gk, 0.15, DEFAULT_BEHAVIOR_CONFIG, undefined, () => {
      state.inputs.home = { ...idle(), right: true, kick: kickSeq[i++] ?? false };
    });
    expect(state.goalkeeperHold).not.toBeNull();
    expect(tr.maxHeldDrift).toBeLessThan(0.01);
    expect(state.lastKickTeam).toBe('home'); // still the original shot
    play(state, gk, 1);
    expect(state.goalkeeperHold).toBeNull();
    expect(state.goalkeeperSaveSeq).toBe(CATCH + 1);
  });

  it('the snapshot just shows the ball at his feet while he holds it (no protocol change)', () => {
    const { state, gk } = setup({ gkTeam: 'away', seq: CATCH });
    play(state, gk, 0.45);
    const snap = buildSnapshot(state, { homeClubName: null, awayClubName: null } as never) as { ball: { x: number; y: number } };
    const spot = heldBallSpot(gk, 'away');
    expect(snap.ball.x).toBeCloseTo(spot.x, 1);
    expect(snap.ball.y).toBeCloseTo(spot.y, 1);
  });

  it('training challenge: the bot team keeps playing — it wins the ball back after a catch', () => {
    // Bot (home) shoots at the human guest's goalkeeper (away); after his
    // clearance the bot gets to the ball again.
    const { state, gk } = setup({ gkTeam: 'away', seq: CATCH });
    for (const p of state.players) if (p.team === 'home' && p.role === 'field_player') { p.matchStatus = 'field'; p.x = 400; p.y = 280; p.baseX = 300; p.baseY = 280; }
    let botTouchAfter = false;
    let released = false;
    play(state, gk, 6, TRAINING_CHALLENGE_BEHAVIOR_CONFIG, undefined, () => {
      state.inputs.home = computeTrainingChallengeInput(state);
      if (!state.goalkeeperHold && state.lastKickTeam === 'away') released = true;
      if (released && state.lastTouchTeam === 'home') botTouchAfter = true;
    });
    expect(released).toBe(true);
    expect(botTouchAfter).toBe(true);
  });
});
