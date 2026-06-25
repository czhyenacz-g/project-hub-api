import { OnlinePlayer, OnlineBall, Vec2 } from './types.js';
import {
  FIELD_L, FIELD_R, FIELD_T, FIELD_B,
  GOAL_T, GOAL_B, GOAL_DEPTH,
  PLAYER_RADIUS, BALL_RADIUS,
  BUMP_FORCE, BALL_MAX_SPEED, BALL_WALL_RESTITUTION, KICK_SNAP_CLEARANCE,
  TEAMMATE_SEPARATION_RADIUS, TEAMMATE_SEPARATION_STRENGTH,
} from './constants.js';

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export function normalize(x: number, y: number): Vec2 {
  const len = Math.sqrt(x * x + y * y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function updateBallPhysics(ball: OnlineBall, dt: number): void {
  // Apply friction
  const friction = Math.pow(0.35, dt);
  ball.vx *= friction;
  ball.vy *= friction;

  // Move
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Cap speed
  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  if (speed > BALL_MAX_SPEED) {
    const scale = BALL_MAX_SPEED / speed;
    ball.vx *= scale;
    ball.vy *= scale;
  }

  // Bounce off top/bottom field walls
  if (ball.y - BALL_RADIUS < FIELD_T) {
    ball.y = FIELD_T + BALL_RADIUS;
    ball.vy = Math.abs(ball.vy) * BALL_WALL_RESTITUTION;
  }
  if (ball.y + BALL_RADIUS > FIELD_B) {
    ball.y = FIELD_B - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy) * BALL_WALL_RESTITUTION;
  }

  // Left wall — bounce unless in goal opening
  if (ball.x - BALL_RADIUS < FIELD_L - GOAL_DEPTH) {
    ball.x = FIELD_L - GOAL_DEPTH + BALL_RADIUS;
    ball.vx = Math.abs(ball.vx) * BALL_WALL_RESTITUTION;
  } else if (ball.x - BALL_RADIUS < FIELD_L && (ball.y < GOAL_T || ball.y > GOAL_B)) {
    ball.x = FIELD_L + BALL_RADIUS;
    ball.vx = Math.abs(ball.vx) * BALL_WALL_RESTITUTION;
  }

  // Right wall — bounce unless in goal opening
  if (ball.x + BALL_RADIUS > FIELD_R + GOAL_DEPTH) {
    ball.x = FIELD_R + GOAL_DEPTH - BALL_RADIUS;
    ball.vx = -Math.abs(ball.vx) * BALL_WALL_RESTITUTION;
  } else if (ball.x + BALL_RADIUS > FIELD_R && (ball.y < GOAL_T || ball.y > GOAL_B)) {
    ball.x = FIELD_R - BALL_RADIUS;
    ball.vx = -Math.abs(ball.vx) * BALL_WALL_RESTITUTION;
  }
}

export function resolvePlayerBallCollisions(players: OnlinePlayer[], ball: OnlineBall): string | null {
  let touched: string | null = null;

  for (const p of players) {
    const d = dist(p.x, p.y, ball.x, ball.y);
    const minDist = PLAYER_RADIUS + BALL_RADIUS;
    if (d < minDist && d > 0) {
      const nx = (ball.x - p.x) / d;
      const ny = (ball.y - p.y) / d;

      // Push ball out of overlap
      const overlap = minDist - d;
      ball.x += nx * overlap;
      ball.y += ny * overlap;

      // Apply bump force
      ball.vx += nx * BUMP_FORCE;
      ball.vy += ny * BUMP_FORCE;

      touched = p.id;
    }
  }

  return touched;
}

// Repositions the ball just in front of the kicker along the kick direction,
// before kick velocity is applied. Without this, a kick fired while the ball
// still overlaps the kicker can be partially reversed later in the same tick
// by resolvePlayerBallCollisions(), which pushes the ball away from whichever
// side it overlaps the kicker on — not necessarily the kick direction.
// Mirrors osma-liga/game/physics.ts snapBallInFrontOfKicker().
export function snapBallInFrontOfKicker(
  ball: OnlineBall,
  kickerX: number,
  kickerY: number,
  dirX: number,
  dirY: number,
): void {
  const snapDist = PLAYER_RADIUS + BALL_RADIUS + KICK_SNAP_CLEARANCE;
  ball.x = clamp(kickerX + dirX * snapDist, FIELD_L + BALL_RADIUS, FIELD_R - BALL_RADIUS);
  ball.y = clamp(kickerY + dirY * snapDist, FIELD_T + BALL_RADIUS, FIELD_B - BALL_RADIUS);
}

// Same-team anti-overlap: soft push apart for any two players of the same
// team standing closer than TEAMMATE_SEPARATION_RADIUS. The active player is
// an anchor and never gets pushed — only the support/non-active player on
// the other side of the overlap moves. Two non-active players split the
// push evenly. Cross-team overlap and support-positioning/formation logic
// are intentionally untouched — this is independent of supportSpacing /
// teammateSupportMode so it always applies. KISS fix.
// Mirrors osma-liga/game/physics.ts separateSameTeamPlayers().
export function separateSameTeamPlayers(teamPlayers: OnlinePlayer[], activePlayerId: string | null): void {
  for (let i = 0; i < teamPlayers.length - 1; i++) {
    for (let j = i + 1; j < teamPlayers.length; j++) {
      const a = teamPlayers[i];
      const b = teamPlayers[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < TEAMMATE_SEPARATION_RADIUS) {
        const nx = d > 0.1 ? dx / d : 1;
        const ny = d > 0.1 ? dy / d : 0;
        const totalPush = (TEAMMATE_SEPARATION_RADIUS - d) * TEAMMATE_SEPARATION_STRENGTH;
        const aIsActive = a.id === activePlayerId;
        const bIsActive = b.id === activePlayerId;
        const aFrac = aIsActive ? 0 : (bIsActive ? 1 : 0.5);
        const bFrac = bIsActive ? 0 : (aIsActive ? 1 : 0.5);
        a.x = clamp(a.x - nx * totalPush * aFrac, FIELD_L + PLAYER_RADIUS, FIELD_R - PLAYER_RADIUS);
        a.y = clamp(a.y - ny * totalPush * aFrac, FIELD_T + PLAYER_RADIUS, FIELD_B - PLAYER_RADIUS);
        b.x = clamp(b.x + nx * totalPush * bFrac, FIELD_L + PLAYER_RADIUS, FIELD_R - PLAYER_RADIUS);
        b.y = clamp(b.y + ny * totalPush * bFrac, FIELD_T + PLAYER_RADIUS, FIELD_B - PLAYER_RADIUS);
      }
    }
  }
}

export function checkGoal(ball: OnlineBall): 'home' | 'away' | null {
  if (ball.y >= GOAL_T && ball.y <= GOAL_B) {
    // home scores: ball enters right goal (away's goal)
    if (ball.x > FIELD_R) return 'home';
    // away scores: ball enters left goal (home's goal)
    if (ball.x < FIELD_L) return 'away';
  }
  return null;
}
