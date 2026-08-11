import { PLAYER_RADIUS, PLAYER_SPEED, GOALKEEPER_SPEED } from './constants.js';

// Mirrors osma-liga/game/playerStats.ts. Parametric per-player capability
// profile — `role` (types.ts) still decides UNIQUE role behavior (goalkeeper
// zone/AI, exclusion from active-player resolution/support/substitution),
// but physical capabilities live here instead of scattered role-conditional
// constants, so two players sharing a role can differ later.
export interface PlayerStats {
  // Movement speed in px/s — read directly wherever a specific player's own
  // movement is computed (movePlayerByInput/ball-retention in tick.ts,
  // goalkeepers in goalkeeperAI.ts). This engine treats home/away
  // symmetrically and has no separate "bot difficulty" movement constant
  // like the single-player frontend's ai.ts BOT_SPEED, so speed maps
  // cleanly onto every player here.
  speed: number;
  // Multiplier applied on top of whichever kick force constant is already
  // in play at a given kick site (KICK_FORCE for a normal/charged shot,
  // SUPPORT_KICK_FORCE for a passive support kick) — those differ by KICK
  // TYPE/mechanic, not player identity, and stay as-is. 1 = today's
  // baseline (no change).
  shotPower: number;
  // How strongly this player damps/absorbs the ball's velocity on contact
  // instead of just bumping it away — see resolvePlayerBallCollisions() in
  // physics.ts. 0 = today's field-player baseline (no damping, standard
  // bump). 1 = today's goalkeeper baseline (heavy damping, reduced bump).
  stoppingPower: number;
  // Visual size in px, relative to the real PLAYER_RADIUS collision hitbox
  // (a single global physical constant, unchanged). Drives only the
  // client's rendering scale (sent in the socket snapshot) — never the
  // actual collision radius.
  size: number;
}

// No turnSpeed/stamina/position — see osma-liga/game/playerStats.ts for the
// full rationale (no turning/acceleration model exists yet; stamina is
// depletable state, not a fixed capability; position is currently a dead
// field with no behavior to read it).

export const DEFAULT_FIELD_PLAYER_STATS: PlayerStats = {
  speed: PLAYER_SPEED,
  shotPower: 1,
  stoppingPower: 0,
  size: PLAYER_RADIUS,
};

export const DEFAULT_GOALKEEPER_STATS: PlayerStats = {
  speed: GOALKEEPER_SPEED,
  shotPower: 1,
  stoppingPower: 1,
  // Reproduces the pre-refactor goalkeeper visual bump (PLAYER_RADIUS * 1.15).
  size: PLAYER_RADIUS * 1.15,
};
