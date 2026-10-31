import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { sweepBallAgainstGoalkeepers } from './physics.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { DEFAULT_BEHAVIOR_CONFIG, TRAINING_CHALLENGE_BEHAVIOR_CONFIG } from './teamBehavior.js';
import { computeTrainingChallengeInput } from './ai.js';
import { PLAYER_RADIUS, BALL_RADIUS, GOALKEEPER_BALL_DAMPING, GOALKEEPER_BUMP_FORCE } from './constants.js';
import type { InputState, OnlineGameState, OnlinePlayer, Vec2 } from './types.js';

// Goalkeeper contact: the ball must never cross a goalkeeper's body without
// touching him — not from a fast shot, not from a kick that snaps the ball
// forward next to him. Balls that miss him still score. The same cases run
// against the local engine in osma-liga game/goalkeeperCollision.test.ts.

const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 0.033;
const R = PLAYER_RADIUS + BALL_RADIUS;
const idle = (): InputState => ({ up: false, down: false, left: false, right: false, kick: false, switchPlayer: false });

beforeEach(() => {
  let seed = 0x5eed;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  });
});
afterEach(() => { vi.restoreAllMocks(); });

// Point where the segment p0→p1 enters the circle (c, R), if it does.
function entryPoint(p0: Vec2, p1: Vec2, c: Vec2): Vec2 | null {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, fx = p0.x - c.x, fy = p0.y - c.y;
  const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), cc = fx * fx + fy * fy - R * R;
  if (cc <= 0 || a < 1e-9) return null;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? { x: p0.x + dx * t, y: p0.y + dy * t } : null;
}

interface Shot {
  side: 'right' | 'left';
  ball: Vec2;
  vel?: Vec2;
  gk?: Vec2;          // pinned goalkeeper position; omitted = he plays normally
  kick?: number;      // the home player runs right from just behind the ball, charges this long, releases
  challenge?: boolean; // training challenge: home is AI-driven, away is the human
}
interface Outcome { goal: boolean; gkTouched: boolean; through: boolean; state: OnlineGameState; gk: OnlinePlayer }

function shoot(s: Shot, seconds = 2): Outcome {
  const state = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  const gkTeam = s.side === 'right' ? 'away' : 'home';
  const gk = state.players.find((p) => p.team === gkTeam && p.role === 'goalkeeper')!;
  const me = state.players.find((p) => p.team === 'home' && p.role === 'field_player')!;
  const guest = state.players.find((p) => p.team === 'away' && p.role === 'field_player')!;
  for (const p of state.players) {
    if (p === gk || p === me || p === guest) continue;
    p.matchStatus = 'bench'; p.x = -500; p.y = -500; p.baseX = -500; p.baseY = -500;
  }
  me.x = s.kick !== undefined ? s.ball.x - 28 : 480; me.y = s.kick !== undefined ? s.ball.y : 500;
  guest.x = 480; guest.y = 60; guest.baseX = 480; guest.baseY = 60;
  state.ball.x = s.ball.x; state.ball.y = s.ball.y;
  state.ball.vx = s.vel?.x ?? 0; state.ball.vy = s.vel?.y ?? 0;
  if (s.gk) { gk.x = s.gk.x; gk.y = s.gk.y; }
  const behavior = s.challenge ? TRAINING_CHALLENGE_BEHAVIOR_CONFIG : DEFAULT_BEHAVIOR_CONFIG;
  let gkTouched = false, through = false, t = 0;
  let lastEntry: Vec2 | null = null;
  for (let i = 0; i < seconds / DT && state.score.home + state.score.away === 0; i++) {
    const from = { x: state.ball.x, y: state.ball.y };
    const input = idle();
    if (s.kick !== undefined) {
      input.right = t < 0.2 + s.kick + 0.05;
      input.kick = t >= 0.2 && t < 0.2 + s.kick;
    }
    t += DT;
    state.inputs.home = s.challenge ? computeTrainingChallengeInput(state) : input;
    state.inputs.guest = idle();
    state.lastTouchPlayerId = null;
    tickGame(state, DT, behavior, NO_REMOVALS);
    if (state.lastTouchPlayerId === gk.id) gkTouched = true;
    // Through = the ball entered his body and came out on the opposite side
    // of it — within this tick, or after ending the last one inside him.
    const b = { x: state.ball.x, y: state.ball.y }, g = { x: gk.x, y: gk.y };
    const e = entryPoint(from, b, g) ?? (Math.hypot(from.x - g.x, from.y - g.y) < R ? lastEntry : null);
    if (e && (e.x - g.x) * (b.x - g.x) + (e.y - g.y) * (b.y - g.y) < 0) through = true;
    lastEntry = entryPoint(from, b, g) ?? lastEntry;
    if (s.gk) { gk.x = s.gk.x; gk.y = s.gk.y; gk.vx = 0; gk.vy = 0; }
  }
  return { goal: state.score.home + state.score.away > 0, gkTouched, through, state, gk };
}

// Mirror a right-goal shot onto the left goal.
const mirror = (s: Shot): Shot => ({
  ...s, side: 'left', ball: { x: 960 - s.ball.x, y: s.ball.y },
  vel: s.vel && { x: -s.vel.x, y: s.vel.y }, gk: s.gk && { x: 960 - s.gk.x, y: s.gk.y },
});
const bothSides = (s: Shot): [string, Shot][] => [['right goal', s], ['left goal', mirror(s)]];

const GK = { x: 868, y: 280 };

describe('shots straight at a ready goalkeeper are stopped by his body', () => {
  for (const speed of [150, 400, 800]) for (const d of [40, 120]) {
    for (const [side, shot] of bothSides({ side: 'right', ball: { x: GK.x - d, y: GK.y }, vel: { x: speed, y: 0 }, gk: GK })) {
      it(`${speed} px/s from ${d} px, ${side}`, () => {
        const r = shoot(shot);
        expect(r.gkTouched).toBe(true);
        expect(r.through).toBe(false);
        expect(r.goal).toBe(false);
      });
    }
  }
});

describe('the ball never passes through his body, whatever happens after contact', () => {
  for (const off of [0, 8, 16, 22, 26]) for (const speed of [500, 800]) {
    for (const [side, shot] of bothSides({ side: 'right', ball: { x: GK.x - 60, y: GK.y + off }, vel: { x: speed, y: 0 }, gk: GK })) {
      it(`${speed} px/s, ${off} px off centre, ${side}`, () => {
        const r = shoot(shot);
        expect(r.gkTouched).toBe(true);
        expect(r.through).toBe(false);
      });
    }
  }
});

// A close shot angled across the goal while he steps toward it: a glancing
// parry may still end in the net, but only off his body, never through it.
describe('close angled shots at a goalkeeper on the move', () => {
  for (const speed of [600, 800]) for (const fromY of [160, 400]) {
    const len = Math.hypot(60, 280 - fromY);
    const shot: Shot = { side: 'right', ball: { x: 840, y: fromY }, vel: { x: speed * 60 / len, y: speed * (280 - fromY) / len } };
    for (const [side, s] of bothSides(shot)) {
      it(`${speed} px/s from y ${fromY}, ${side}`, () => {
        expect(shoot(s).through).toBe(false);
      });
    }
  }
});

describe('balls out of his reach still score', () => {
  // R + 10: he still shuffles a few px toward the ball within a tick.
  for (const [side, shot] of bothSides({ side: 'right', ball: { x: GK.x - 60, y: GK.y + R + 10 }, vel: { x: 600, y: 0 }, gk: GK })) {
    it(`just past him, ${side}`, () => {
      const r = shoot(shot);
      expect(r.gkTouched).toBe(false);
      expect(r.goal).toBe(true);
    });
  }
  for (const y of [222, 338]) {
    for (const [side, shot] of bothSides({ side: 'right', ball: { x: 760, y }, vel: { x: 700, y: 0 }, gk: GK })) {
      it(`into the ${y < 280 ? 'top' : 'bottom'} corner, ${side}`, () => {
        const r = shoot(shot);
        expect(r.gkTouched).toBe(false);
        expect(r.goal).toBe(true);
      });
    }
  }
});

describe('other contacts', () => {
  it('an angled shot across his body is stopped', () => {
    const r = shoot({ side: 'right', ball: { x: 800, y: 180 }, vel: { x: 400, y: 588 }, gk: GK });
    expect(r.gkTouched).toBe(true);
    expect(r.through).toBe(false);
  });
  it('a ball off the end wall into his body is stopped', () => {
    const r = shoot({ side: 'right', ball: { x: 800, y: 130 }, vel: { x: 500, y: 150 }, gk: { x: 866, y: 185 } });
    expect(r.state.ball.y).toBeLessThan(215);
    expect(r.gkTouched).toBe(true);
    expect(r.through).toBe(false);
  });
  it('a moving goalkeeper is never shot through', () => {
    for (const [, shot] of bothSides({ side: 'right', ball: { x: 840, y: 160 }, vel: { x: 360, y: 720 } })) {
      expect(shoot(shot).through).toBe(false);
    }
  });
  it('a kick while pressed against him does not teleport the ball past him', () => {
    for (const charge of [0.05, 0.3, 0.5]) {
      const r = shoot({ side: 'right', ball: { x: 728, y: 280 }, gk: { x: 866, y: 280 }, kick: charge }, 3);
      expect(r.through).toBe(false);
      expect(r.goal).toBe(false);
    }
  });
  it('training challenge (AI home team) uses the same contact', () => {
    for (const [, shot] of bothSides({ side: 'right', ball: { x: 840, y: 160 }, vel: { x: 360, y: 720 }, challenge: true })) {
      expect(shoot(shot).through).toBe(false);
    }
  });
  it('the rebound comes back into play and a follow-up into the corner scores', () => {
    const first = shoot({ side: 'right', ball: { x: 760, y: 280 }, vel: { x: 700, y: 0 }, gk: GK }, 0.5);
    expect(first.gkTouched).toBe(true);
    expect(first.state.ball.vx).toBeLessThan(0);
    // The attacker collects it a step further out (46 px from his body he
    // still covers the whole goal) and shoots for the corner.
    const from = { x: first.state.ball.x - 60, y: first.state.ball.y };
    const aim = { x: 900 - from.x, y: 225 - from.y }; // top corner
    const len = Math.hypot(aim.x, aim.y);
    const follow = shoot({ side: 'right', ball: { ...from }, vel: { x: 700 * aim.x / len, y: 700 * aim.y / len }, gk: GK });
    expect(follow.goal).toBe(true);
  });
});

describe('sweepBallAgainstGoalkeepers', () => {
  function gkAt(): OnlinePlayer {
    const gk = createInitialState(NO_REMOVALS).players.find((p) => p.team === 'away' && p.role === 'goalkeeper')!;
    gk.x = GK.x; gk.y = GK.y;
    return gk;
  }

  it('puts the ball back at the entry point and bounces it there once', () => {
    const gk = gkAt();
    const ball = { x: GK.x + 10, y: GK.y, vx: 1500, vy: 0 }; // one long step, past his centre
    expect(sweepBallAgainstGoalkeepers([gk], ball, GK.x - 40, GK.y)).toBe(gk.id);
    expect(ball.x).toBeCloseTo(GK.x - R - 1, 6);
    expect(ball.y).toBeCloseTo(GK.y, 6);
    expect(ball.vx).toBeCloseTo(1500 * GOALKEEPER_BALL_DAMPING - GOALKEEPER_BUMP_FORCE, 6);
    // Already outside him: the overlap pass in the same tick finds nothing.
    expect(Math.hypot(ball.x - gk.x, ball.y - gk.y)).toBeGreaterThan(R);
  });

  it('leaves a ball that only reaches into him from the front to the overlap pass', () => {
    const ball = { x: GK.x - R + 5, y: GK.y, vx: 300, vy: 0 };
    expect(sweepBallAgainstGoalkeepers([gkAt()], ball, GK.x - 40, GK.y)).toBeNull();
    expect(ball.vx).toBe(300);
  });

  it('ignores a path that misses him', () => {
    const ball = { x: GK.x + 40, y: GK.y + R + 1, vx: 0, vy: 0 };
    expect(sweepBallAgainstGoalkeepers([gkAt()], ball, GK.x - 40, GK.y + R + 1)).toBeNull();
  });
});
