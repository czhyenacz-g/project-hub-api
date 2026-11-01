import { GOALKEEPER_RADIUS, BALL_RADIUS, FIELD_T, FIELD_B } from './constants.js';

// Goalkeeper save outcome (all modes) — port of osma-liga
// game/goalkeeperSave.ts (same model, same constants), keep in sync.
//
// A REAL save = the goalkeeper becomes the ball's first toucher after an
// opponent's kick, with the ball moving toward his own goal at least
// minShotSpeed fast. Any other contact (dribble, slow roller, rebound,
// repeated touches of the same save) is plain physics as before.
// Each save is decided once, from the match's save sequence number
// (goalkeeperSaveSeq: started from the clock and ball position of the
// match's first save, +1 per save) — deterministic, no Math.random, the
// same sequence gives the same outcomes in both engines:
//   - catch (30 %): he holds the ball in front of him for 0.5–0.8 s
//     (goalkeeperHold — the ball is pinned, nobody can play it), then
//     passes to an open teammate ahead of him or, if none, clears it;
//   - parry (50 %): the existing bounce, nothing changes;
//   - clear (20 %): an immediate long kick toward the opponent's half.
// A pass/clearance always starts in front of him (field side) and goes
// forward, so it can never head into his own net.
export const GOALKEEPER_SAVE = {
  minShotSpeed: 200,
  catchShare: 0.3,
  parryShare: 0.5,
  holdMinSeconds: 0.5,
  holdMaxSeconds: 0.8,
  clearSpeed: 620,
  // Pass: teammate at least passMinAhead px further up the pitch, within
  // passMinDist..passMaxDist, no opponent within passLaneClearance of the line.
  passMinAhead: 40,
  passMinDist: 80,
  passMaxDist: 420,
  passLaneClearance: 40,
  // Pass strength: enough to roll passArrivalPx beyond the teammate, so
  // it reaches him with ~120 px/s left.
  passArrivalPx: 120,
  passMinSpeed: 240,
  passMaxSpeed: 560,
  // Clearance: the first clearLookAhead px of the kick avoid opponents.
  clearAngles: [-0.45, -0.2, 0.2, 0.45],
  clearLookAhead: 160,
  clearOpenEnough: 80,
} as const;

export type SaveOutcome = 'catch' | 'parry' | 'clear';

export interface GoalkeeperHold {
  playerId: string;
  remaining: number;
  seq: number; // the save's sequence number (picks the clearance angle)
}

interface Pt { x: number; y: number }

// ln(1 / 0.35): px/s of start speed per px a free ball rolls before stopping
// (ball friction keeps 35 % of its speed per second).
const ROLL_SPEED_PER_PX = Math.log(1 / 0.35);

// Own goal on the left for home, on the right for away.
function forwardSign(team: 'home' | 'away'): number {
  return team === 'home' ? 1 : -1;
}

export function isShotSave(vx: number, vy: number, gkTeam: 'home' | 'away', lastKickTeam: 'home' | 'away' | null): boolean {
  if (lastKickTeam === null || lastKickTeam === gkTeam) return false;
  if (vx * forwardSign(gkTeam) >= 0) return false;
  return Math.hypot(vx, vy) >= GOALKEEPER_SAVE.minShotSpeed;
}

// Deterministic 0..1 from a save's sequence number (integer hash); `salt`
// draws further independent values for the same save.
export function saveRoll(seq: number, salt = 0): number {
  let h = Math.imul((seq | 0) ^ 0x811c9dc5, 0x01000193);
  h = Math.imul(h ^ (salt | 0), 0x01000193);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Start of a match's save sequence, from the state at its first save.
export function firstSaveSeq(timeLeft: number, x: number, y: number): number {
  return Math.floor(saveRoll(Math.round(timeLeft * 1000), Math.round(x * 16) * 65599 + Math.round(y * 16)) * 0x7fffffff);
}

export function saveOutcome(roll: number): SaveOutcome {
  if (roll < GOALKEEPER_SAVE.catchShare) return 'catch';
  if (roll < GOALKEEPER_SAVE.catchShare + GOALKEEPER_SAVE.parryShare) return 'parry';
  return 'clear';
}

// Hold time of a catch — spreads the catch's own part of the roll over
// holdMin..holdMax.
export function holdSeconds(roll: number): number {
  const t = Math.min(1, Math.max(0, roll / GOALKEEPER_SAVE.catchShare));
  return GOALKEEPER_SAVE.holdMinSeconds + (GOALKEEPER_SAVE.holdMaxSeconds - GOALKEEPER_SAVE.holdMinSeconds) * t;
}

// Where a held ball sits: just in front of him, toward the field.
export function heldBallSpot(gk: Pt, team: 'home' | 'away'): Pt {
  return { x: gk.x + forwardSign(team) * (GOALKEEPER_RADIUS + BALL_RADIUS + 1), y: gk.y };
}

function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function laneClearance(from: Pt, to: Pt, opponents: Pt[]): number {
  let min = Infinity;
  for (const o of opponents) min = Math.min(min, segmentDistance(o, from, to));
  return min;
}

export interface BallRelease {
  x: number;
  y: number;
  vx: number;
  vy: number;
  passTo: number | null; // index into teammates, null = clearance
}

// The goalkeeper plays the ball: a pass to the nearest open teammate ahead
// (when allowed), otherwise a clearance toward the opponent's half, angled
// away from opponents. `variant` (0..1) picks among equally open angles.
export function releaseBall(
  gk: Pt, team: 'home' | 'away', teammates: Pt[], opponents: Pt[], allowPass: boolean, variant: number,
): BallRelease {
  const S = GOALKEEPER_SAVE;
  const sign = forwardSign(team);
  const from = heldBallSpot(gk, team);

  if (allowPass) {
    let best = -1, bestDist = Infinity;
    teammates.forEach((t, i) => {
      const d = Math.hypot(t.x - from.x, t.y - from.y);
      if ((t.x - from.x) * sign < S.passMinAhead || d < S.passMinDist || d > S.passMaxDist || d >= bestDist) return;
      if (laneClearance(from, t, opponents) < S.passLaneClearance) return;
      best = i;
      bestDist = d;
    });
    if (best >= 0) {
      const t = teammates[best];
      const speed = Math.min(S.passMaxSpeed, Math.max(S.passMinSpeed, (bestDist + S.passArrivalPx) * ROLL_SPEED_PER_PX));
      return { ...from, vx: (t.x - from.x) / bestDist * speed, vy: (t.y - from.y) / bestDist * speed, passTo: best };
    }
  }

  const n = S.clearAngles.length;
  const start = Math.min(n - 1, Math.floor(variant * n));
  let bestDir = { x: sign, y: 0 }, bestOpen = -1;
  for (let k = 0; k < n; k++) {
    const a = S.clearAngles[(start + k) % n];
    const dir = { x: sign * Math.cos(a), y: Math.sin(a) };
    // Toward the near touchline only as far as the pitch allows.
    const end = { x: from.x + dir.x * S.clearLookAhead, y: from.y + dir.y * S.clearLookAhead };
    if (end.y < FIELD_T || end.y > FIELD_B) continue;
    const open = Math.min(S.clearOpenEnough, laneClearance(from, end, opponents));
    if (open > bestOpen) { bestOpen = open; bestDir = dir; }
  }
  return { ...from, vx: bestDir.x * S.clearSpeed, vy: bestDir.y * S.clearSpeed, passTo: null };
}
