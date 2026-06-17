import { OnlineGameState, OnlinePlayer, InputState } from './types.js';
import {
  FIELD_L, FIELD_R, FIELD_T, FIELD_B, FIELD_CX, FIELD_CY,
  PLAYER_SPEED, KICK_RANGE, KICK_FORCE, KICK_COOLDOWN,
  RETURN_SPEED, GOAL_PAUSE_DURATION, BALL_RADIUS,
  BALL_CONTROL_RADIUS, BALL_CONTROL_DAMPING, BALL_CONTROL_FORCE, BALL_CONTROL_INPUT_FORCE, BALL_CONTROL_OFFSET,
  CORNER_ZONE_MARGIN, CORNER_CLEAR_DELAY, CORNER_CLEAR_SPEED,
  CORNER_CLEAR_REPOSITION, CORNER_CLEAR_COOLDOWN,
} from './constants.js';
import {
  dist, normalize,
  updateBallPhysics, resolvePlayerBallCollisions, checkGoal,
} from './physics.js';

const GOAL_MESSAGES = [
  'Hlavní věc je, že to padlo!',
  'Gól jako bič!',
  'To se povedlo!',
  'Hezká práce!',
  'Parádní trefa!',
  'Šikovnej!',
  'Brankář zůstal stát!',
  'Do sítě jako basa!',
];

function randomGoalMessage(): string {
  return GOAL_MESSAGES[Math.floor(Math.random() * GOAL_MESSAGES.length)];
}

function resetPositions(state: OnlineGameState): void {
  // Reset players to base positions
  for (const p of state.players) {
    p.x = p.baseX;
    p.y = p.baseY;
    p.vx = 0;
    p.vy = 0;
    p.kickCooldown = 0;
    p.active = false;
  }
  // Reset ball to center
  state.ball.x = FIELD_CX;
  state.ball.y = FIELD_CY;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.goalMessage = '';
  state.cornerTimer = 0;
  state.cornerClearCooldown = 0;
}

function movePlayerByInput(player: OnlinePlayer, input: InputState, dt: number): void {
  let dx = 0;
  let dy = 0;
  if (input.up) dy -= 1;
  if (input.down) dy += 1;
  if (input.left) dx -= 1;
  if (input.right) dx += 1;

  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 0) {
    dx /= len;
    dy /= len;
    player.x += dx * PLAYER_SPEED * dt;
    player.y += dy * PLAYER_SPEED * dt;
  }
}

function returnToBase(player: OnlinePlayer, dt: number): void {
  const dx = player.baseX - player.x;
  const dy = player.baseY - player.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 2) {
    player.x = player.baseX;
    player.y = player.baseY;
    return;
  }
  const step = Math.min(RETURN_SPEED * dt, d);
  player.x += (dx / d) * step;
  player.y += (dy / d) * step;
}

function findActivePlayer(players: OnlinePlayer[], team: 'home' | 'away', ball: { x: number; y: number }): OnlinePlayer | null {
  let closest: OnlinePlayer | null = null;
  let closestDist = Infinity;
  for (const p of players) {
    if (p.team !== team) continue;
    const d = dist(p.x, p.y, ball.x, ball.y);
    if (d < closestDist) {
      closestDist = d;
      closest = p;
    }
  }
  return closest;
}

export function tickGame(state: OnlineGameState, dt: number): void {
  // 1. Handle goal pause
  if (state.goalPause > 0) {
    state.goalPause -= dt;
    if (state.goalPause <= 0) {
      state.goalPause = 0;
      resetPositions(state);
    }
    return;
  }

  // 2. Count down time
  state.timeLeftSeconds -= dt;
  if (state.timeLeftSeconds <= 0) {
    state.timeLeftSeconds = 0;
    state.status = 'finished';
    return;
  }

  // 3 & 4. Move active player per team, return others to base
  const teams: Array<'home' | 'away'> = ['home', 'away'];
  for (const team of teams) {
    const input: InputState = team === 'home' ? state.inputs.home : state.inputs.guest;
    const active = findActivePlayer(state.players, team, state.ball);

    for (const p of state.players) {
      if (p.team !== team) continue;
      p.active = p === active;

      if (p === active) {
        // 5. Reduce kick cooldown
        if (p.kickCooldown > 0) {
          p.kickCooldown -= dt;
          if (p.kickCooldown < 0) p.kickCooldown = 0;
        }

        movePlayerByInput(p, input, dt);

        // Ball control: strong when player holds direction, gentle otherwise
        if (!input.kick) {
          const bcDist = dist(p.x, p.y, state.ball.x, state.ball.y);
          if (bcDist < BALL_CONTROL_RADIUS) {
            state.ball.vx *= BALL_CONTROL_DAMPING;
            state.ball.vy *= BALL_CONTROL_DAMPING;
            const hasInput = input.left || input.right || input.up || input.down;
            let tdx = 0, tdy = 0;
            if (hasInput) {
              if (input.right) tdx += 1;
              if (input.left) tdx -= 1;
              if (input.down) tdy += 1;
              if (input.up) tdy -= 1;
            } else {
              tdx = team === 'home' ? 1 : -1;
            }
            const tNorm = normalize(tdx, tdy);
            const targetX = p.x + tNorm.x * BALL_CONTROL_OFFSET;
            const targetY = p.y + tNorm.y * BALL_CONTROL_OFFSET;
            const fx = targetX - state.ball.x;
            const fy = targetY - state.ball.y;
            const fLen = Math.sqrt(fx * fx + fy * fy);
            if (fLen > 4) {
              const force = hasInput ? BALL_CONTROL_INPUT_FORCE : BALL_CONTROL_FORCE;
              state.ball.vx += (fx / fLen) * force * dt;
              state.ball.vy += (fy / fLen) * force * dt;
            }
          }
        }

        // 6. Kick
        if (input.kick && p.kickCooldown <= 0) {
          const d = dist(p.x, p.y, state.ball.x, state.ball.y);
          if (d <= KICK_RANGE) {
            // Kick direction: toward movement direction, or toward goal
            let kx = 0;
            let ky = 0;
            if (input.left || input.right || input.up || input.down) {
              if (input.right) kx += 1;
              if (input.left) kx -= 1;
              if (input.down) ky += 1;
              if (input.up) ky -= 1;
            } else {
              // Kick toward opposite goal
              kx = team === 'home' ? 1 : -1;
            }
            const norm = normalize(kx, ky);
            state.ball.vx += norm.x * KICK_FORCE;
            state.ball.vy += norm.y * KICK_FORCE;
            p.kickCooldown = KICK_COOLDOWN;
          }
        }
      } else {
        returnToBase(p, dt);
        // reduce cooldown for inactive players too
        if (p.kickCooldown > 0) {
          p.kickCooldown -= dt;
          if (p.kickCooldown < 0) p.kickCooldown = 0;
        }
      }
    }
  }

  // 7. Resolve player-ball collisions
  resolvePlayerBallCollisions(state.players, state.ball);

  // 8. Update ball physics
  updateBallPhysics(state.ball, dt);

  // 8b. Corner clear: unstick ball stuck in corner
  if (state.cornerClearCooldown > 0) {
    state.cornerClearCooldown = Math.max(0, state.cornerClearCooldown - dt);
  }
  const nearLeft  = state.ball.x - FIELD_L < CORNER_ZONE_MARGIN;
  const nearRight = FIELD_R - state.ball.x < CORNER_ZONE_MARGIN;
  const nearTop   = state.ball.y - FIELD_T < CORNER_ZONE_MARGIN;
  const nearBot   = FIELD_B - state.ball.y < CORNER_ZONE_MARGIN;
  const inCorner  = (nearLeft || nearRight) && (nearTop || nearBot);
  if (inCorner && state.cornerClearCooldown <= 0) {
    state.cornerTimer += dt;
    if (state.cornerTimer >= CORNER_CLEAR_DELAY) {
      const cdx = FIELD_CX - state.ball.x;
      const cdy = FIELD_CY - state.ball.y;
      const cDir = normalize(cdx, cdy);
      state.ball.x = Math.max(FIELD_L + BALL_RADIUS, Math.min(FIELD_R - BALL_RADIUS,
        state.ball.x + cDir.x * CORNER_CLEAR_REPOSITION));
      state.ball.y = Math.max(FIELD_T + BALL_RADIUS, Math.min(FIELD_B - BALL_RADIUS,
        state.ball.y + cDir.y * CORNER_CLEAR_REPOSITION));
      state.ball.vx = cDir.x * CORNER_CLEAR_SPEED + (Math.random() - 0.5) * 40;
      state.ball.vy = cDir.y * CORNER_CLEAR_SPEED + (Math.random() - 0.5) * 40;
      state.cornerTimer = 0;
      state.cornerClearCooldown = CORNER_CLEAR_COOLDOWN;
    }
  } else if (!inCorner) {
    state.cornerTimer = 0;
  }

  // 9. Check for goal
  const scorer = checkGoal(state.ball);
  if (scorer !== null) {
    state.score[scorer]++;
    state.goalPause = GOAL_PAUSE_DURATION;
    state.goalMessage = randomGoalMessage();
  }

  // 10. Increment tick
  state.tick++;
}
