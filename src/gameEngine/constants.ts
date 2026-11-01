export const CANVAS_W = 960;
export const CANVAS_H = 540;
export const FIELD_L = 60;
export const FIELD_R = 900;
export const FIELD_T = 50;
export const FIELD_B = 510;
export const FIELD_CX = 480;
export const FIELD_CY = 280;
export const GOAL_T = 215;
export const GOAL_B = 345;
export const GOAL_DEPTH = 18;
export const PLAYER_RADIUS = 18;
export const BALL_RADIUS = 10;
export const PLAYER_SPEED = 210;
// Human kick reach — mirrors osma-liga/game/constants.ts KICK_RANGE. Must
// stay >= BALL_CONTROL_RADIUS: with control 44 / kick 40 a ball the player
// still controlled (or that rolled a few px ahead while the kick key was
// held) silently didn't fire on release.
export const KICK_RANGE = 57;
// Training-challenge bot (AI-driven team): explicit, unchanged reach — the
// bot's shooting decision (ai.ts) and its kick/support kicks, mirrors the
// local bot's BOT_KICK_RANGE (PLAYER_RADIUS + 22). Part of the bot's
// difficulty, not of the shared physics.
export const AI_KICK_RANGE = 40;
export const KICK_FORCE = 486; // -10% from 540
export const KICK_COOLDOWN = 0.25;
// Kick cooldown for AI-driven teams (training challenge home) — mirrors
// osma-liga/game/constants.ts BOT_KICK_COOLDOWN so the server bot shoots at
// the same rate as the single-player /hra/bot opponent. Longer than a
// human's KICK_COOLDOWN on purpose: the server bot already moves at the full
// human speed (PlayerStats.speed), unlike the slower local BOT_SPEED.
export const AI_KICK_COOLDOWN = 0.85;

// Charged kick — the shot fires on release of the kick button, not on press.
// A quick tap (near-zero hold) still fires at KICK_TAP_FORCE_MULTIPLIER;
// holding longer ramps the force up to KICK_MAX_CHARGE_FORCE_MULTIPLIER over
// KICK_MAX_CHARGE_MS, after which holding longer has no further effect.
// Only applies to teams with TeamBehaviorConfig.usesChargedKick (human-driven).
export const KICK_TAP_FORCE_MULTIPLIER = 0.9;
export const KICK_MAX_CHARGE_FORCE_MULTIPLIER = 1.5;
export const KICK_MAX_CHARGE_MS = 500; // mirrors osma-liga/game/constants.ts
export const BUMP_FORCE = 110;
export const RETURN_SPEED = 115;
export const SUPPORT_PLAYER_SPEED = 120;
export const SUPPORT_KICK_FORCE = 320;
// The margin fades out as the current active player gets farther from the
// ball (see computeSwitchMargin in tick.ts) — once the ball is kicked across
// the pitch, the bias toward the old active player drops away and the
// nearest player takes over almost immediately.
export const ACTIVE_PLAYER_SWITCH_MARGIN = 18;
export const ACTIVE_PLAYER_SWITCH_MARGIN_FADE_DISTANCE = 300;

// KISS guard against active-player flicker: the automatic (distance-based)
// pick may switch to a new player at most once per this many ms, per team,
// regardless of how the margin/fade above evaluate. Manual switching
// (Q / PŘEP.) is unaffected. Mirrors osma-liga/game/constants.ts.
export const AUTO_PLAYER_SWITCH_COOLDOWN_MS = 1000;

// While a team's input is holding a movement direction (and for this long
// afterward), no automatic active-player change is allowed for that team —
// neither the distance-based auto-pick above nor the teammate-ball-receive
// takeover further down in tick.ts. Manual switching (Q / PŘEP.) is
// unaffected. Mirrors osma-liga/game/constants.ts AUTO_SWITCH_INPUT_LOCK_MS.
export const AUTO_SWITCH_INPUT_LOCK_MS = 200;

// Baseline same-team anti-overlap (KISS) — independent of supportSpacing /
// teammateSupportMode below, so it always applies regardless of behavior
// config. Mirrors osma-liga/game/constants.ts.
export const TEAMMATE_SEPARATION_RADIUS = 42;
export const TEAMMATE_SEPARATION_STRENGTH = 0.5;

// Manual active-player switch (Q / PŘEP.) — mirrors the bot engine's
// MANUAL_SWITCH_LOCK_DURATION in game/constants.ts.
export const MANUAL_SWITCH_LOCK_DURATION = 2;
export const BALL_MAX_SPEED = 800;
// Energy retained when the ball bounces off a field wall/edge.
// Mirrors osma-liga/game/constants.ts so /hra/bot and the online engine feel the same.
export const BALL_WALL_RESTITUTION = 0.75;
export const MATCH_DURATION = 90;
export const GOAL_PAUSE_DURATION = 2.5;

// Ball control (soft trap for active player) — human radius mirrors
// osma-liga/game/constants.ts (57, "+30% stickiness"). The AI-driven team
// keeps its previous 44 px (AI_BALL_CONTROL_RADIUS) — bot difficulty is not
// part of this unification.
export const BALL_CONTROL_RADIUS = 57;
export const AI_BALL_CONTROL_RADIUS = 44;
export const BALL_CONTROL_DAMPING = 0.86;
export const BALL_CONTROL_FORCE = 130;
export const BALL_CONTROL_INPUT_FORCE = 210;
export const BALL_CONTROL_OFFSET = 34;

// Tighter retention on top of the base ball control above — kicks in only
// when the active player has basically stopped or sharply changed
// direction, no opponent is closing in, and the ball isn't moving fast
// (i.e. not a ball that was just struck). Only applies to human-driven
// teams (TeamBehaviorConfig.usesChargedKick) — AI-driven teams keep their
// current feel unchanged. Mirrors osma-liga/game/constants.ts.
export const BALL_RETENTION_RADIUS = 55;
export const BALL_RETENTION_NO_OPPONENT_RADIUS = 70;
export const BALL_RETENTION_MAX_BALL_SPEED = 180;
export const BALL_RETENTION_STRENGTH = 0.14;
export const BALL_STOP_DAMPING = 0.82;

// Kicking out of contact/a scrum (an opponent crowding the ball) nudges the
// ball forward along the kick direction before applying force, and gives
// the kick a clearance boost — so it reliably pops the ball clear instead
// of looking like it got swallowed by nearby bodies. A normal open kick
// (no opponent close to the ball) is completely unaffected. Only applies
// to human-driven teams, same as the retention tweak above.
export const KICK_CONTACT_RANGE = 50;
export const KICK_CONTACT_BALL_NUDGE = 12;
export const KICK_CONTACT_FORCE_MULTIPLIER = 1.3;

// On every kick, the ball is snapped to sit just outside the kicker's own
// collision radius (PLAYER_RADIUS + BALL_RADIUS) along the kick direction,
// before kick velocity is applied. Mirrors osma-liga/game/constants.ts —
// see that file for the full rationale.
export const KICK_SNAP_CLEARANCE = 4;

// Lets a non-active, available teammate "receive" a slow/catchable ball
// contact and become the active player, instead of the ball just bouncing
// off them as a random physics obstacle. Own (human-driven, i.e.
// usesChargedKick) teams only — see tick.ts. Mirrors osma-liga/game/constants.ts.
export const TEAMMATE_BALL_RECEIVE_MAX_SPEED = 260;
export const TEAMMATE_BALL_RECEIVE_EXTRA_RADIUS = 4;
export const TEAMMATE_BALL_RECEIVE_LOCK_MS = 1200;

// Goalkeeper — simple zone-clamped AI (see goalkeeperAI.ts). Mirrors
// osma-liga/game/constants.ts (same field/goal geometry in this file, so
// the same numbers apply 1:1).
export const GOALKEEPER_ZONE_DEPTH = 130;
export const GOALKEEPER_ZONE_HEIGHT = (GOAL_B - GOAL_T) + 70;
export const GOALKEEPER_SPEED = 150;
export const GOALKEEPER_DEFAULT_DEPTH = 34;
export const GOALKEEPER_REACT_RANGE = GOALKEEPER_ZONE_DEPTH + 260;
export const GOALKEEPER_BALL_DAMPING = 0.18;
export const GOALKEEPER_BUMP_FORCE = 60;

// Bench + temporary substitute — mirrors osma-liga/game/constants.ts.
export const DEFAULT_BENCH_SIZE = 1;
export const BENCH_DEPLOY_DURATION_MS = 30_000;

// Corner clear
export const CORNER_ZONE_MARGIN = 72;
export const CORNER_CLEAR_DELAY = 8;
export const CORNER_CLEAR_SPEED = 360;
export const CORNER_CLEAR_REPOSITION = 96;
export const CORNER_CLEAR_COOLDOWN = 1.5;

// Ball physics V3 for human-driven teams (TeamBehaviorConfig.preparedTurns)
// — mirrors osma-liga/game/gameplayProfiles.ts BALL_PHYSICS_V2
// (kickSelfTrapProtectionSeconds) and BALL_PHYSICS_V3 1:1. See
// dribblePrep.ts and osma-liga/docs/gameplay-physics-contract.md.
// After a human's own kick, that kicker's ball control is skipped for this
// long so it can't brake its own shot.
export const KICK_SELF_TRAP_PROTECTION_SECONDS = 0.25;
export const BALL_PHYSICS_V3 = {
  dribbleControlRadius: 57,
  dribbleMaxRelativeSpeed: 160,
  dribbleMinControlSeconds: 0.12,
  // 40 = just past body contact (PLAYER_RADIUS + BALL_RADIUS = 28).
  noOpponentRadius: 40,
  // Retention for human teams stays on until an opponent is this close to
  // the ball (replaces BALL_RETENTION_NO_OPPONENT_RADIUS for preparedTurns).
  retentionNoOpponentRadius: 40,
  // The player carrying the ball (close, moving with it) runs at this
  // fraction of stats.speed; not right after its own shot.
  carrierSpeedFactor: 0.9,
  shieldTurnMinAngleDeg: 120,
  shieldContactRadius: 36,
  turnMinAngleDeg: 60,
  prepSeconds: 0.35,
  prepSeconds180: 0.55,
  prepPlayerSpeed: 90,
  recoverSeconds: 0.15,
  maxChainSeconds: 1.2,
  chainResetSeconds: 0.3,
  reaimMinAngleDeg: 45,
  targetDistance: 34,
  arcSpeed: 280,
  angularGain: 8,
  radialGain: 10,
  maxRadialSpeed: 150,
  velocityBlendRate: 30,
  maxAccel: 3000,
  settledAngleDeg: 25,
  settledRelativeSpeed: 90,
} as const;
