import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { deployBenchPlayer } from './benchDeployment.js';
import { DEFAULT_BEHAVIOR_CONFIG, TRAINING_CHALLENGE_BEHAVIOR_CONFIG } from './teamBehavior.js';
import { GOAL_PAUSE_DURATION } from './constants.js';
import { isOwnGoal } from './goalAttribution.js';
import { computeTrainingChallengeInput } from './ai.js';
import type { InputState, OnlineGameState } from './types.js';

// Own goals: only the conceding team's own kick or pass makes one; a
// defender or goalkeeper the ball merely bumps into never does. The same
// cases run against the local engine in osma-liga game/goalAttribution.test.ts.

type Team = 'home' | 'away';
const NO_REMOVALS = { ...DEFAULT_TEMPORARY_REMOVAL_CONFIG, enabled: false };
const DT = 0.033;
const idle = (): InputState => ({ up: false, down: false, left: false, right: false, kick: false, switchPlayer: false });

beforeEach(() => {
  let seed = 0x5eed;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('isOwnGoal', () => {
  it.each<[Team, Team | null, boolean]>([
    ['home', 'home', false],
    ['home', 'away', true],
    ['away', 'away', false],
    ['away', 'home', true],
    ['home', null, false],
    ['away', null, false],
  ])('%s scores, %s kicked last → own goal %s', (scoring, lastKick, own) => {
    expect(isOwnGoal(scoring, lastKick)).toBe(own);
  });
});

// ── Scenarios through the real engine (multiplayer: both teams human) ─────
// `side` is the human who acts ('home' attacks the right goal, 'away' the
// left). Players in `pinned` stand still; `live` ones play normally.
// `prior` = an earlier kick by that team, `priorTouch` = an earlier passive
// contact.

type Seg = { dur: number; up?: boolean; down?: boolean; left?: boolean; right?: boolean; kick?: boolean };
type Who = 'home:f:0' | 'away:f:0' | 'away:gk' | 'home:gk';
interface Scenario {
  side?: Team;
  me: { x: number; y: number };
  ball: { x: number; y: number };
  ballVel?: { x: number; y: number };
  pinned?: { who: Who; x: number; y: number }[];
  live?: Who[];
  prior?: Team;
  priorTouch?: Team;
  bench?: boolean;
  inputs: Seg[];
}

const TAP: Seg[] = [{ dur: 0.05, kick: true }, { dur: 3 }];
const AWAY_GK_ASIDE = { who: 'away:gk', x: 880, y: 120 } as const;

function run(sc: Scenario) {
  const side = sc.side ?? 'home';
  const state: OnlineGameState = createInitialState(NO_REMOVALS);
  state.status = 'playing';
  const find = (who: string) => {
    const [team, kind, n] = who.split(':');
    return state.players.filter((p) => p.team === team
      && (kind === 'gk' ? p.role === 'goalkeeper' : p.role === 'field_player' && p.matchStatus === 'field'))[Number(n ?? 0)];
  };
  const me = sc.bench
    ? state.players.find((p) => p.team === side && p.matchStatus === 'bench')!
    : find(`${side}:f:0`);
  if (sc.bench) expect(deployBenchPlayer(state, side, me.id, 'attacker')).toBe(true);
  const pins = (sc.pinned ?? []).map((q) => ({ p: find(q.who), x: q.x, y: q.y }));
  const keep = new Set([me.id, ...pins.map((q) => q.p.id), ...(sc.live ?? []).map((w) => find(w).id)]);
  for (const p of state.players) if (!keep.has(p.id)) { p.matchStatus = 'bench'; p.x = -500; p.y = -500; p.baseX = -500; p.baseY = -500; }
  me.x = sc.me.x; me.y = sc.me.y;
  state.ball.x = sc.ball.x; state.ball.y = sc.ball.y;
  state.ball.vx = sc.ballVel?.x ?? 0; state.ball.vy = sc.ballVel?.y ?? 0;
  if (sc.priorTouch) { state.lastTouchTeam = sc.priorTouch; state.lastTouchPlayerId = 'earlier'; }
  if (sc.prior) {
    state.lastTouchTeam = sc.prior; state.lastTouchPlayerId = 'earlier';
    state.lastKickTeam = sc.prior; state.lastKickPlayerId = 'earlier';
  }

  const opponentTouches = new Set<string>();
  let goal = false;
  for (const seg of sc.inputs) {
    for (let i = 0; i < Math.round(seg.dur / DT) && !goal; i++) {
      const input = { ...idle(), up: !!seg.up, down: !!seg.down, left: !!seg.left, right: !!seg.right, kick: !!seg.kick };
      state.inputs.home = side === 'home' ? input : idle();
      state.inputs.guest = side === 'away' ? input : idle();
      tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
      for (const q of pins) { q.p.x = q.x; q.p.y = q.y; q.p.vx = 0; q.p.vy = 0; }
      const toucher = state.players.find((p) => p.id === state.lastTouchPlayerId);
      if (toucher && toucher.team !== side) opponentTouches.add(toucher.role === 'goalkeeper' ? 'gk' : 'field');
      goal = state.score.home + state.score.away > 0;
    }
  }
  const scoring: Team | null = state.score.home ? 'home' : state.score.away ? 'away' : null;
  return { state, scoring, own: state.isOwnGoal, opponentTouches };
}

describe('goal attribution through the server engine', () => {
  it('A: a clean shot is the shooter\'s goal', () => {
    const r = run({ me: { x: 700, y: 280 }, ball: { x: 726, y: 280 }, pinned: [AWAY_GK_ASIDE], inputs: TAP });
    expect([r.scoring, r.own]).toEqual(['home', false]);
  });

  it('C: a light goalkeeper touch is not an own goal', () => {
    const r = run({ me: { x: 700, y: 280 }, ball: { x: 726, y: 280 }, pinned: [{ who: 'away:gk', x: 868, y: 304 }], inputs: TAP });
    expect(r.opponentTouches.has('gk')).toBe(true);
    expect([r.scoring, r.own]).toEqual(['home', false]);
    expect(r.state.score).toEqual({ home: 1, away: 0 });
  });

  it('D: a goalkeeper save that still ends in the net is the shooter\'s goal', () => {
    // A close angled shot he gets a glove to, deflected into the net. (The
    // old scenario here — a kick pressed against him — only scored because
    // the kick snapped the ball through his body; see
    // goalkeeperCollision.test.ts.)
    const r = run({
      me: { x: 480, y: 500 }, ball: { x: 840, y: 160 }, ballVel: { x: 358, y: 716 }, live: ['away:gk'], prior: 'home',
      inputs: [{ dur: 2 }],
    });
    expect(r.opponentTouches.has('gk')).toBe(true);
    expect([r.scoring, r.own]).toEqual(['home', false]);
  });

  it('E: a wide shot a defender happens to turn in counts for the shooter (ambiguous → no own goal)', () => {
    const r = run({
      me: { x: 640, y: 355 }, ball: { x: 666, y: 355 }, pinned: [AWAY_GK_ASIDE, { who: 'away:f:0', x: 780, y: 367 }],
      // Aimed wide: ↓ during the charge moves the aim below the post.
      inputs: [{ dur: 0.05, right: true, kick: true }, { dur: 0.45, down: true, kick: true }, { dur: 0.05, right: true }, { dur: 3 }],
    });
    expect(r.opponentTouches.has('field')).toBe(true);
    expect([r.scoring, r.own]).toEqual(['home', false]);
  });

  it('G: kicking into the own net is an own goal', () => {
    const r = run({ me: { x: 160, y: 280 }, ball: { x: 134, y: 280 }, inputs: [{ dur: 0.05, left: true, kick: true }, { dur: 0.05, left: true }, { dur: 3 }] });
    expect([r.scoring, r.own]).toEqual(['away', true]);
    expect(r.state.score).toEqual({ home: 0, away: 1 });
  });

  it('G (other end): the guest kicking into its own net is an own goal', () => {
    const r = run({ side: 'away', me: { x: 800, y: 280 }, ball: { x: 826, y: 280 }, inputs: [{ dur: 0.05, right: true, kick: true }, { dur: 0.05, right: true }, { dur: 3 }] });
    expect([r.scoring, r.own]).toEqual(['home', true]);
  });

  it('I: taking the ball, carrying it and then kicking it into the own net is an own goal', () => {
    const r = run({
      me: { x: 330, y: 280 }, ball: { x: 304, y: 280 }, prior: 'away',
      inputs: [{ dur: 0.6, left: true }, { dur: 0.05, left: true, kick: true }, { dur: 0.05, left: true }, { dur: 3 }],
    });
    expect([r.scoring, r.own]).toEqual(['away', true]);
  });

  it('M: an own-goal kick right after an opponent\'s shot is an own goal', () => {
    const r = run({ me: { x: 160, y: 280 }, ball: { x: 134, y: 280 }, prior: 'away', inputs: [{ dur: 0.05, left: true, kick: true }, { dur: 0.05, left: true }, { dur: 3 }] });
    expect([r.scoring, r.own]).toEqual(['away', true]);
  });

  it('N: a žolík\'s clean shot is the žolík team\'s goal', () => {
    const r = run({ bench: true, me: { x: 700, y: 280 }, ball: { x: 726, y: 280 }, pinned: [AWAY_GK_ASIDE], inputs: TAP });
    expect([r.scoring, r.own]).toEqual(['home', false]);
  });

  it('O: nobody kicked since the kick-off — a plain goal, never an own goal', () => {
    const r = run({ me: { x: 400, y: 470 }, ball: { x: 300, y: 280 }, ballVel: { x: -560, y: 0 }, inputs: [{ dur: 3 }] });
    expect([r.scoring, r.own]).toEqual(['away', false]);
  });

  it('P: a shot fired while a defender is in contact with the ball is the shooter\'s goal', () => {
    const r = run({
      me: { x: 779.3, y: 361.8 }, ball: { x: 795.8, y: 339.2 }, pinned: [{ who: 'away:f:0', x: 866.7, y: 243.3 }],
      inputs: [{ dur: 0.6, up: true, right: true, kick: true }, { dur: 0.05, up: true, right: true }, { dur: 3 }],
    });
    expect(r.opponentTouches.has('field')).toBe(true);
    expect([r.scoring, r.own]).toEqual(['home', false]);
  });

  it('Q: an earlier opponent bump does not make a later clean shot an own goal (kicks used to leave lastTouch untouched)', () => {
    const r = run({ me: { x: 700, y: 280 }, ball: { x: 740, y: 280 }, priorTouch: 'away', pinned: [AWAY_GK_ASIDE], inputs: TAP });
    expect([r.scoring, r.own]).toEqual(['home', false]);
  });
});

describe('every active play is recorded', () => {
  it('the training-challenge bot\'s kick counts as its team\'s kick', () => {
    const state = createInitialState(NO_REMOVALS);
    state.status = 'playing';
    const bot = state.players.find((p) => p.team === 'home' && p.role === 'field_player' && p.matchStatus === 'field')!;
    state.ball.x = bot.x + 20; state.ball.y = bot.y;
    for (let i = 0; i < 60 && state.lastKickTeam === null; i++) {
      state.inputs.home = computeTrainingChallengeInput(state);
      state.inputs.guest = idle();
      tickGame(state, DT, TRAINING_CHALLENGE_BEHAVIOR_CONFIG, NO_REMOVALS);
    }
    expect(state.lastKickTeam).toBe('home');
  });
});

describe('the last kick does not survive a restart', () => {
  it('is cleared at the kick-off after a goal', () => {
    const { state } = run({ me: { x: 160, y: 280 }, ball: { x: 134, y: 280 }, inputs: [{ dur: 0.05, left: true, kick: true }, { dur: 0.05, left: true }, { dur: 3 }] });
    expect(state.lastKickTeam).toBe('home');
    for (let t = 0; t < GOAL_PAUSE_DURATION + 0.2; t += DT) {
      state.inputs.home = idle(); state.inputs.guest = idle();
      tickGame(state, DT, DEFAULT_BEHAVIOR_CONFIG, NO_REMOVALS);
    }
    expect(state.goalPause).toBe(0);
    expect([state.lastKickTeam, state.lastKickPlayerId]).toEqual([null, null]);
  });

  it('a new match starts with nobody having kicked', () => {
    const state = createInitialState(NO_REMOVALS);
    expect([state.lastKickTeam, state.lastKickPlayerId, state.isOwnGoal]).toEqual([null, null, false]);
  });
});
