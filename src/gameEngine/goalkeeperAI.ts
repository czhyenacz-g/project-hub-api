import { OnlineBall, OnlineGameState, OnlinePlayer } from './types.js';
import {
  FIELD_L, FIELD_R, FIELD_CY,
  GOALKEEPER_ZONE_DEPTH, GOALKEEPER_ZONE_HEIGHT,
  GOALKEEPER_DEFAULT_DEPTH, GOALKEEPER_REACT_RANGE,
} from './constants.js';

// Simple, fully-automatic goalkeeper AI — mirrors osma-liga/game/goalkeeperAI.ts.
// Stays between the ball and the own goal, moving only within a small
// rectangular zone in front of it. No shot prediction, no advanced saves —
// just a smoothed vertical track of the ball's y position, clamped to the
// zone. Runs for BOTH teams' goalkeepers every tick, entirely separate from
// each team's active-player resolution / support positioning in tick.ts.

export interface GoalkeeperZone {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export function getGoalkeeperZone(team: 'home' | 'away'): GoalkeeperZone {
  const isHome = team === 'home';
  return {
    xMin: isHome ? FIELD_L : FIELD_R - GOALKEEPER_ZONE_DEPTH,
    xMax: isHome ? FIELD_L + GOALKEEPER_ZONE_DEPTH : FIELD_R,
    yMin: FIELD_CY - GOALKEEPER_ZONE_HEIGHT / 2,
    yMax: FIELD_CY + GOALKEEPER_ZONE_HEIGHT / 2,
  };
}

function updateGoalkeeper(gk: OnlinePlayer, ball: OnlineBall, dt: number): void {
  const isHome = gk.team === 'home';
  const zone = getGoalkeeperZone(gk.team);
  const goalLineX = isHome ? FIELD_L : FIELD_R;
  const defaultX = isHome ? FIELD_L + GOALKEEPER_DEFAULT_DEPTH : FIELD_R - GOALKEEPER_DEFAULT_DEPTH;

  const ballIsThreat = Math.abs(ball.x - goalLineX) < GOALKEEPER_REACT_RANGE;
  const targetX = defaultX;
  const targetY = ballIsThreat
    ? Math.max(zone.yMin, Math.min(zone.yMax, ball.y))
    : FIELD_CY;

  const dx = targetX - gk.x;
  const dy = targetY - gk.y;
  const distToTarget = Math.hypot(dx, dy);

  if (distToTarget > 1) {
    const step = Math.min(distToTarget, gk.stats.speed * dt);
    const nx = dx / distToTarget;
    const ny = dy / distToTarget;
    gk.x += nx * step;
    gk.y += ny * step;
    gk.vx = nx * gk.stats.speed;
    gk.vy = ny * gk.stats.speed;
  } else {
    gk.vx = 0;
    gk.vy = 0;
  }

  // Safety clamp — guarantees the goalkeeper stays in its zone even if a
  // collision (or anything else) knocked it out this tick.
  gk.x = Math.max(zone.xMin, Math.min(zone.xMax, gk.x));
  gk.y = Math.max(zone.yMin, Math.min(zone.yMax, gk.y));
}

export function updateGoalkeepers(state: OnlineGameState, dt: number): void {
  for (const p of state.players) {
    if (p.role !== 'goalkeeper') continue;
    updateGoalkeeper(p, state.ball, dt);
  }
}
