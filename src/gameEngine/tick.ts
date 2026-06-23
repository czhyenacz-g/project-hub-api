import { OnlineGameState, OnlinePlayer, InputState } from './types.js';
import {
  FIELD_L, FIELD_R, FIELD_T, FIELD_B, FIELD_CX, FIELD_CY,
  PLAYER_SPEED, KICK_RANGE, KICK_FORCE, KICK_COOLDOWN,
  RETURN_SPEED, SUPPORT_PLAYER_SPEED, SUPPORT_KICK_FORCE, ACTIVE_PLAYER_SWITCH_MARGIN, ACTIVE_PLAYER_SWITCH_MARGIN_FADE_DISTANCE,
  MANUAL_SWITCH_LOCK_DURATION, GOAL_PAUSE_DURATION, BALL_RADIUS,
  BALL_CONTROL_RADIUS, BALL_CONTROL_DAMPING, BALL_CONTROL_FORCE, BALL_CONTROL_INPUT_FORCE, BALL_CONTROL_OFFSET,
  CORNER_ZONE_MARGIN, CORNER_CLEAR_DELAY, CORNER_CLEAR_SPEED,
  CORNER_CLEAR_REPOSITION, CORNER_CLEAR_COOLDOWN,
} from './constants.js';
import {
  dist, normalize,
  updateBallPhysics, resolvePlayerBallCollisions, checkGoal,
} from './physics.js';
import {
  GameBehaviorConfig, TeamBehaviorConfig, DEFAULT_BEHAVIOR_CONFIG,
  computeTeamSupportInputs,
} from './teamBehavior.js';
import {
  TemporaryRemovalConfig, DEFAULT_TEMPORARY_REMOVAL_CONFIG,
  updateTemporaryRemovals, getRemovedPlayerIds,
} from './temporaryRemoval.js';
import {
  PassAndSwitchConfig, DEFAULT_PASS_AND_SWITCH_CONFIG,
  hasBallControl, findBestPassTarget, computePassVelocity,
} from './passAndSwitch.js';

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

// Own goal — scored into the scoring team's own net by the last player who
// touched the ball. Mirrors HOME_OWN_GOAL_MESSAGES/AWAY_OWN_GOAL_MESSAGES in
// the client's game/updateGame.ts (bot engine).
const HOME_OWN_GOAL_MESSAGES = [
  'Vlastní gól domácích! To se těžko vysvětluje.',
  'Domácí si to nakopli sami. Bohužel do vlastní sítě.',
  'Brankář čekal střelu soupeře. Přišla od spoluhráče.',
];

const AWAY_OWN_GOAL_MESSAGES = [
  'Vlastní gól hostů! Tohle si do statistik nikdo nepřipíše rád.',
  'Hosté si to obstarali sami. Bohužel do vlastní branky.',
  'Obrana hostů to vyřešila po svém. Špatně.',
];

function randomGoalMessage(): string {
  return GOAL_MESSAGES[Math.floor(Math.random() * GOAL_MESSAGES.length)];
}

function pickMessage(pool: string[]): string {
  return pool[Math.floor(Math.random() * pool.length)];
}

// The current active player normally needs a clear ACTIVE_PLAYER_SWITCH_MARGIN
// lead before losing the role (prevents flicker near the ball). But once the
// ball is far from them — e.g. just kicked across the pitch — that bias should
// fade out so a much-closer teammate takes over almost immediately.
function computeSwitchMargin(currentDist: number): number {
  const scale = Math.max(0, 1 - currentDist / ACTIVE_PLAYER_SWITCH_MARGIN_FADE_DISTANCE);
  return ACTIVE_PLAYER_SWITCH_MARGIN * scale;
}

function resetPositions(state: OnlineGameState): void {
  // Reset players to base positions — except players currently mid-removal
  // (leaving/bench/returning), who stay put; yanking them back onto the
  // pitch on a goal reset would bypass their bench timer.
  const removedIds = getRemovedPlayerIds(state);
  for (const p of state.players) {
    if (removedIds.has(p.id)) continue;
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
  state.lastTouchTeam = null;
  state.lastTouchPlayerId = null;
  state.isOwnGoal = false;
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

function moveTowardSupportTarget(
  player: OnlinePlayer,
  target: { x: number; y: number },
  dt: number,
): void {
  const dx = target.x - player.x;
  const dy = target.y - player.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 2) return;
  const step = Math.min(SUPPORT_PLAYER_SPEED * dt, d);
  player.x += (dx / d) * step;
  player.y += (dy / d) * step;
}

// Hard positional correction: support targets only steer movement, but a
// faster active player can still walk into a slower-moving teammate before
// it reacts. This guarantees the configured minimum distance after every
// tick, regardless of relative speeds — applies the same way to home and
// away.
function enforceMinDistance(player: OnlinePlayer, fromX: number, fromY: number, minDist: number): void {
  const dx = player.x - fromX;
  const dy = player.y - fromY;
  const d = Math.hypot(dx, dy);
  if (d === 0) {
    player.y = clampToField(fromY + minDist, FIELD_T, FIELD_B);
    return;
  }
  if (d < minDist) {
    const scale = minDist / d;
    player.x = clampToField(fromX + dx * scale, FIELD_L, FIELD_R);
    player.y = clampToField(fromY + dy * scale, FIELD_T, FIELD_B);
  }
}

function clampToField(v: number, lo: number, hi: number): number {
  return Math.max(lo + 25, Math.min(hi - 25, v));
}

// Mirrors the bot engine's active-player hysteresis (game/updateGame.ts):
// the current automatic pick keeps the role until a teammate is clearly
// closer to the ball by ACTIVE_PLAYER_SWITCH_MARGIN. Tracked via
// state.autoActivePlayerId rather than p.active, so it keeps running in the
// background while a manual override (see resolveActivePlayer) is active.
function findAutoActivePlayer(state: OnlineGameState, team: 'home' | 'away', removedIds: Set<string>): OnlinePlayer | null {
  let nearest: OnlinePlayer | null = null;
  let nearestDist = Infinity;
  for (const p of state.players) {
    if (p.team !== team || removedIds.has(p.id)) continue;
    const d = dist(p.x, p.y, state.ball.x, state.ball.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = p;
    }
  }

  const currentId = state.autoActivePlayerId[team];
  const currentActive = currentId && !removedIds.has(currentId)
    ? state.players.find((p) => p.team === team && p.id === currentId) ?? null
    : null;
  if (!currentActive || !nearest) return nearest;

  const currentDist = dist(currentActive.x, currentActive.y, state.ball.x, state.ball.y);
  const shouldSwitch = nearest.id !== currentActive.id && nearestDist + computeSwitchMargin(currentDist) < currentDist;
  return shouldSwitch ? nearest : currentActive;
}

// Manual override (Q / PŘEP., see InputState.switchPlayer). Server
// authoritative: the caller passes `input` for the team the connection
// owns (mapped by socket/team at join time), so a client can never switch
// the opponent's players. Edge-detected via switchKeyWasDown so holding the
// key only triggers a single switch; another press during the lock cycles
// to the next teammate and renews it.
function resolveActivePlayer(
  state: OnlineGameState,
  team: 'home' | 'away',
  input: InputState,
  dt: number,
  removedIds: Set<string>,
  passAndSwitchConfig: PassAndSwitchConfig,
): OnlinePlayer | null {
  // A manual pick that became temporarily removed (e.g. random substitution
  // mid-lock) immediately loses the override — automatic selection takes
  // back over rather than waiting out the rest of the 3s lock.
  if (state.manualActivePlayerId[team] && removedIds.has(state.manualActivePlayerId[team]!)) {
    state.manualActivePlayerId[team] = null;
    state.manualLockRemaining[team] = 0;
  }

  const teamPlayers = state.players.filter((p) => p.team === team && !removedIds.has(p.id));
  if (teamPlayers.length === 0) return null;

  const auto = findAutoActivePlayer(state, team, removedIds);
  state.autoActivePlayerId[team] = auto ? auto.id : null;

  const order = teamPlayers.map((p) => p.id);
  const switchEdge = input.switchPlayer && !state.switchKeyWasDown[team];
  state.switchKeyWasDown[team] = input.switchPlayer;

  // Whoever currently holds the role (before this tick's switch decision) —
  // the relevant "does this player have the ball" check is about them, not
  // about whichever player the switch eventually lands on.
  const previousManualPlayer = state.manualLockRemaining[team] > 0 && state.manualActivePlayerId[team]
    ? teamPlayers.find((p) => p.id === state.manualActivePlayerId[team])
    : undefined;
  const previousActive = previousManualPlayer ?? auto;

  if (switchEdge && previousActive) {
    // Q/PŘEP. with the ball under control passes to the best teammate and
    // switches onto them instead of a plain cycle. Server authoritative —
    // only ever evaluated for the team `input` belongs to (see tickGame).
    const opponentTeam: 'home' | 'away' = team === 'home' ? 'away' : 'home';
    const opponents = state.players.filter((p) => p.team === opponentTeam && !removedIds.has(p.id));
    const canPass = passAndSwitchConfig.enabled && hasBallControl(previousActive, state.ball, passAndSwitchConfig);
    const passTarget = canPass ? findBestPassTarget(previousActive, teamPlayers, opponents) : null;

    if (passTarget) {
      const passVel = computePassVelocity(previousActive, passTarget, passAndSwitchConfig);
      state.ball.vx += passVel.x;
      state.ball.vy += passVel.y;
      previousActive.kickCooldown = KICK_COOLDOWN;
      state.lastTouchTeam = team;
      state.lastTouchPlayerId = previousActive.id;
      state.manualActivePlayerId[team] = passTarget.id;
      state.manualLockRemaining[team] = passAndSwitchConfig.manualLockSeconds;
    } else if (state.manualLockRemaining[team] > 0) {
      const curId = state.manualActivePlayerId[team] ?? order[0];
      state.manualActivePlayerId[team] = order[(order.indexOf(curId) + 1) % order.length];
      state.manualLockRemaining[team] = MANUAL_SWITCH_LOCK_DURATION;
    } else if (auto) {
      state.manualActivePlayerId[team] = order[(order.indexOf(auto.id) + 1) % order.length];
      state.manualLockRemaining[team] = MANUAL_SWITCH_LOCK_DURATION;
    }
  } else if (state.manualLockRemaining[team] > 0) {
    state.manualLockRemaining[team] = Math.max(0, state.manualLockRemaining[team] - dt);
  }

  if (state.manualLockRemaining[team] > 0 && state.manualActivePlayerId[team]) {
    const manualPlayer = teamPlayers.find((p) => p.id === state.manualActivePlayerId[team]);
    if (manualPlayer) return manualPlayer;
  }
  return auto;
}

export function tickGame(
  state: OnlineGameState,
  dt: number,
  behaviorConfig: GameBehaviorConfig = DEFAULT_BEHAVIOR_CONFIG,
  temporaryRemovalConfig: TemporaryRemovalConfig = DEFAULT_TEMPORARY_REMOVAL_CONFIG,
  passAndSwitchConfig: PassAndSwitchConfig = DEFAULT_PASS_AND_SWITCH_CONFIG,
): void {
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

  // 2b. Temporary removals (MVP: random substitution) — server authoritative,
  // run before active-player resolution so a freshly removed player is
  // excluded from selection in the same tick it leaves.
  updateTemporaryRemovals(state, dt, temporaryRemovalConfig);
  const removedIds = getRemovedPlayerIds(state);

  // 3 & 4. Move active player per team, return others to base
  const teams: Array<'home' | 'away'> = ['home', 'away'];
  for (const team of teams) {
    const input: InputState = team === 'home' ? state.inputs.home : state.inputs.guest;
    const active = resolveActivePlayer(state, team, input, dt, removedIds, passAndSwitchConfig);
    const teamConfig: TeamBehaviorConfig = behaviorConfig[team];
    const supportTargets = active
      ? computeTeamSupportInputs(
          state.players.filter((p) => !removedIds.has(p.id)), team, active, state.ball, teamConfig,
        )
      : new Map<string, { x: number; y: number }>();

    for (const p of state.players) {
      if (p.team !== team) continue;
      if (removedIds.has(p.id)) {
        // Movement while leaving/on the bench/returning is handled entirely
        // by updateTemporaryRemovals above — not eligible as active or support.
        p.active = false;
        continue;
      }
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
        const supportTarget = supportTargets.get(p.id);
        if (supportTarget) {
          moveTowardSupportTarget(p, supportTarget, dt);
        } else {
          returnToBase(p, dt);
        }

        // reduce cooldown for inactive players too
        if (p.kickCooldown > 0) {
          p.kickCooldown -= dt;
          if (p.kickCooldown < 0) p.kickCooldown = 0;
        }

        // Conservative: support teammates only nudge the ball passively via
        // collisions (physics.ts) unless the mode explicitly allows shooting
        // (training challenge AI support only — never human multiplayer teams).
        if (supportTarget && teamConfig.supportCanShoot && p.kickCooldown <= 0) {
          const d = dist(p.x, p.y, state.ball.x, state.ball.y);
          if (d <= KICK_RANGE) {
            const dir = team === 'home' ? 1 : -1;
            state.ball.vx += dir * SUPPORT_KICK_FORCE;
            state.ball.vy += (Math.random() - 0.5) * 60;
            p.kickCooldown = KICK_COOLDOWN;
          }
        }
      }
    }

    // Hard spacing pass: re-applies the configured minimum distance after
    // movement, so support teammates can't be walked into by a faster
    // active player or end up stacked on each other.
    if (active && teamConfig.teammateSupportMode !== 'none') {
      const teammates = state.players.filter((p) => p.team === team && p.id !== active.id && !removedIds.has(p.id));
      for (const p of teammates) {
        enforceMinDistance(p, active.x, active.y, teamConfig.supportSpacing);
      }
      if (teammates.length === 2) {
        const [t1, t2] = teammates;
        enforceMinDistance(t2, t1.x, t1.y, teamConfig.supportSpacing);
      }
    }
  }

  // 7. Resolve player-ball collisions, tracking last touch for own-goal detection
  // Players currently leaving/on the bench/returning don't physically interact with the ball.
  const touchedId = resolvePlayerBallCollisions(
    state.players.filter((p) => !removedIds.has(p.id)), state.ball,
  );
  if (touchedId !== null) {
    const toucher = state.players.find((p) => p.id === touchedId);
    if (toucher) {
      state.lastTouchTeam = toucher.team;
      state.lastTouchPlayerId = toucher.id;
    }
  }

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
    // Own goal: ball scored into the scoring team's OWN net by their last touch.
    // Scoring stays attributed to `scorer` regardless (that's already
    // footballingly correct) — this only changes which message is shown.
    const isOwnGoal =
      (scorer === 'away' && state.lastTouchTeam === 'home') ||
      (scorer === 'home' && state.lastTouchTeam === 'away');

    state.score[scorer]++;
    state.goalPause = GOAL_PAUSE_DURATION;
    state.isOwnGoal = isOwnGoal;

    if (isOwnGoal && scorer === 'away') {
      state.goalMessage = pickMessage(HOME_OWN_GOAL_MESSAGES);
    } else if (isOwnGoal && scorer === 'home') {
      state.goalMessage = pickMessage(AWAY_OWN_GOAL_MESSAGES);
    } else {
      state.goalMessage = randomGoalMessage();
    }
  }

  // 10. Increment tick
  state.tick++;
}
