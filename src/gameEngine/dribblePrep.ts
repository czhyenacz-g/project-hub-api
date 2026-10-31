import type { DribblePrepState, OnlineBall, OnlinePlayer, Vec2 } from './types.js';
import { BALL_PHYSICS_V3, FIELD_L, FIELD_R, FIELD_T, FIELD_B } from './constants.js';

// Ball physics V3 "prepared turn" — port of osma-liga/game/dribblePrep.ts
// (same model, same constants), used for human-driven teams
// (TeamBehaviorConfig.preparedTurns). State is per team.
//
// While the human really dribbles (ball close, moving with the player, for
// a moment, no opponent near) and asks for a direction the ball is clearly
// NOT in front of, a short prep phase starts:
//   1. the player slows to prepPlayerSpeed,
//   2. the ball's velocity relative to the player eases toward an arc round
//      the player into the new direction — never a position write, so
//      collisions stay in charge,
//   3. once the ball sits settled in front (or the window runs out) the
//      player ramps back to full speed over recoverSeconds.
// Everything is time-based (dt). An opponent near the ball, letting go of
// the controls, kicking or losing the ball ends it at once. One exception:
// a drag-back AWAY from a pressing opponent (shield turn) stays assisted
// while no opponent touches the ball or stands in the new direction.

const C = BALL_PHYSICS_V3;
const DEG = Math.PI / 180;


export function createDribblePrepState(): DribblePrepState {
  return {
    playerId: null, controlSeconds: 0, phase: 'none', remaining: 0, recoverTotal: 0, side: 1,
    prepDir: null, chainSeconds: 0, idleSeconds: 0, shield: false,
  };
}

function opponentsNearBall(opponents: Vec2[], ball: OnlineBall): Vec2[] {
  return opponents.filter((o) => Math.hypot(o.x - ball.x, o.y - ball.y) <= C.noOpponentRadius);
}

function shieldClear(near: Vec2[], player: Vec2, ball: Vec2, dir: Vec2): boolean {
  return near.every((o) => Math.hypot(o.x - ball.x, o.y - ball.y) > C.shieldContactRadius
    && (o.x - player.x) * dir.x + (o.y - player.y) * dir.y < 0);
}

function offAngleDeg(rel: Vec2, dir: Vec2): number {
  const len = Math.hypot(rel.x, rel.y);
  if (len < 0.001) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (rel.x * dir.x + rel.y * dir.y) / len))) / DEG;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function chooseSide(player: Vec2, rel: Vec2, dir: Vec2, opponents: Vec2[]): number {
  const thB = Math.atan2(rel.y, rel.x);
  const delta = wrap(Math.atan2(dir.y, dir.x) - thB);
  if (Math.abs(delta) < 150 * DEG) return delta >= 0 ? 1 : -1;
  const room = (side: number) => {
    const a = thB + side * Math.PI / 2;
    const x = player.x + Math.cos(a) * C.targetDistance;
    const y = player.y + Math.sin(a) * C.targetDistance;
    let r = Math.min(x - FIELD_L, FIELD_R - x, y - FIELD_T, FIELD_B - y);
    for (const o of opponents) r = Math.min(r, Math.hypot(o.x - x, o.y - y) - C.shieldContactRadius);
    return r;
  };
  const plus = room(1), minus = room(-1);
  if (Math.abs(plus - minus) < 1) return delta >= 0 ? 1 : -1;
  return plus > minus ? 1 : -1;
}

// Runs before the active player moves; `active.vx/vy` still hold last
// tick's velocity. `opponents` = positions of the other team's players
// that are on the pitch. Returns the speed cap for this tick (Infinity =
// no cap). Mutates `dp`.
export function updateDribblePrep(
  dp: DribblePrepState,
  active: OnlinePlayer,
  ball: OnlineBall,
  opponents: Vec2[],
  dir: Vec2 | null,
  kickHeld: boolean,
  selfTrapProtected: boolean,
  dt: number,
): number {
  if (dp.playerId !== active.id) {
    Object.assign(dp, createDribblePrepState(), { playerId: active.id });
    return Infinity;
  }

  const rel = { x: ball.x - active.x, y: ball.y - active.y };
  const d = Math.hypot(rel.x, rel.y);
  const relSpeed = Math.hypot(ball.vx - active.vx, ball.vy - active.vy);
  const near = opponentsNearBall(opponents, ball);
  const opponentNear = near.length > 0;
  const onBall = !kickHeld && !selfTrapProtected && d < C.dribbleControlRadius;
  dp.controlSeconds = onBall && relSpeed < C.dribbleMaxRelativeSpeed ? Math.min(1, dp.controlSeconds + dt) : 0;
  const turnKind = (aim: Vec2, off: number): 'plain' | 'shield' | null => {
    if (!onBall) return null;
    if (!opponentNear) return 'plain';
    return off >= C.shieldTurnMinAngleDeg && shieldClear(near, active, ball, aim) ? 'shield' : null;
  };

  if (dp.phase === 'prep') dp.chainSeconds += dt;
  else dp.idleSeconds += dt;
  if (dp.phase !== 'prep' && dp.idleSeconds >= C.chainResetSeconds) dp.chainSeconds = 0;

  const full = active.stats.speed;
  const budgetLeft = dp.chainSeconds < C.maxChainSeconds;
  const startPrep = (aim: Vec2, off: number, kind: 'plain' | 'shield') => {
    const sharp = Math.max(0, Math.min(1, (off - 90) / 90));
    dp.phase = 'prep';
    dp.remaining = C.prepSeconds + (C.prepSeconds180 - C.prepSeconds) * sharp;
    dp.side = chooseSide(active, rel, aim, near);
    dp.prepDir = aim;
    dp.idleSeconds = 0;
    dp.shield = kind === 'shield' || off >= C.shieldTurnMinAngleDeg;
  };
  const toRecover = () => {
    dp.phase = 'recover';
    dp.recoverTotal = C.recoverSeconds;
    dp.remaining = C.recoverSeconds;
    dp.prepDir = null;
  };

  if (dp.phase === 'prep') {
    const allowed = onBall && (!opponentNear || (dp.shield && !!dir && shieldClear(near, active, ball, dir)));
    if (!dir || !allowed) {
      dp.phase = 'none';
      dp.prepDir = null;
      return Infinity;
    }
    if (dp.prepDir && offAngleDeg(dp.prepDir, dir) >= C.reaimMinAngleDeg) {
      const off = offAngleDeg(rel, dir);
      const kind = turnKind(dir, off);
      if (!budgetLeft || !kind) { toRecover(); return C.prepPlayerSpeed; }
      startPrep(dir, off, kind);
      return C.prepPlayerSpeed;
    }
    const settled = offAngleDeg(rel, dir) <= C.settledAngleDeg
      && relSpeed < C.settledRelativeSpeed
      && d > C.targetDistance - 10 && d < C.targetDistance + 14;
    dp.remaining -= dt;
    if (settled || dp.remaining <= 0 || !budgetLeft) toRecover();
    return C.prepPlayerSpeed;
  }

  const canStart = dp.phase === 'recover' || dp.controlSeconds >= C.dribbleMinControlSeconds;
  if (dir && budgetLeft && canStart) {
    const off = offAngleDeg(rel, dir);
    const kind = off >= C.turnMinAngleDeg ? turnKind(dir, off) : null;
    if (kind) {
      startPrep(dir, off, kind);
      return C.prepPlayerSpeed;
    }
  }

  if (dp.phase === 'recover') {
    if (!dir || opponentNear) { dp.phase = 'none'; return Infinity; }
    dp.remaining -= dt;
    if (dp.remaining <= 0) { dp.phase = 'none'; return Infinity; }
    const t = 1 - dp.remaining / dp.recoverTotal;
    return C.prepPlayerSpeed + (full - C.prepPlayerSpeed) * t;
  }
  return Infinity;
}

// Runs in the ball-control step, after the active player moved (vx/vy =
// this tick's velocity). Returns true when it handled ball control this
// tick (classic control skipped).
export function applyDribblePrepBallControl(dp: DribblePrepState, active: OnlinePlayer, ball: OnlineBall, dt: number): boolean {
  if (dp.phase !== 'prep' || dp.playerId !== active.id) return false;
  if (Math.hypot(active.vx, active.vy) < 0.001) return false;

  const rel = { x: ball.x - active.x, y: ball.y - active.y };
  const d = Math.hypot(rel.x, rel.y);
  if (d < 0.001) return false;
  const radial = { x: rel.x / d, y: rel.y / d };

  let delta = wrap(Math.atan2(active.vy, active.vx) - Math.atan2(rel.y, rel.x));
  if (Math.abs(delta) > 100 * DEG && Math.sign(delta) !== dp.side) delta += dp.side * 2 * Math.PI;
  const dirSign = delta >= 0 ? 1 : -1;
  const tangential = { x: -radial.y * dirSign, y: radial.x * dirSign };
  const tanSpeed = Math.min(C.arcSpeed, C.angularGain * Math.abs(delta) * C.targetDistance);
  const radSpeed = Math.max(-C.maxRadialSpeed, Math.min(C.maxRadialSpeed, C.radialGain * (C.targetDistance - d)));
  const wantX = tangential.x * tanSpeed + radial.x * radSpeed;
  const wantY = tangential.y * tanSpeed + radial.y * radSpeed;

  const relVx = ball.vx - active.vx;
  const relVy = ball.vy - active.vy;
  const blend = 1 - Math.exp(-C.velocityBlendRate * dt);
  let dvx = (wantX - relVx) * blend;
  let dvy = (wantY - relVy) * blend;
  const dv = Math.hypot(dvx, dvy), dvMax = C.maxAccel * dt;
  if (dv > dvMax) { dvx *= dvMax / dv; dvy *= dvMax / dv; }
  ball.vx += dvx;
  ball.vy += dvy;
  return true;
}
