import { PlayerStats } from './playerStats.js';

export interface Vec2 { x: number; y: number; }

// Mirrors osma-liga/game/types.ts PlayerRole.
export type PlayerRole = 'field_player' | 'goalkeeper';

// Bench + temporary substitute — separate system from the unrelated
// TemporaryPlayerRemoval mechanic below (random substitution). A player is
// either 'field' (on the pitch as one of the regular starters/goalkeeper),
// 'bench' (off the pitch, not yet used, waiting to be deployed), or
// 'temporarily_deployed' (bench player currently active on the pitch for a
// fixed BENCH_DEPLOY_DURATION_MS window — see benchDeployment.ts). Mirrors
// osma-liga/game/types.ts PlayerMatchStatus.
export type PlayerMatchStatus = 'field' | 'bench' | 'temporarily_deployed';

export interface OnlinePlayer {
  id: string;
  team: 'home' | 'away';
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseX: number;
  baseY: number;
  label: string;
  kickCooldown: number;
  active: boolean;
  role: PlayerRole;
  // Parametric capability profile — see playerStats.ts. Each player owns its
  // own copy (createInitialState.ts clones the defaults).
  stats: PlayerStats;
  // Bench + temporary substitute — see benchDeployment.ts. Goalkeepers never
  // change from 'field'/false (not bench-eligible in this version).
  matchStatus: PlayerMatchStatus;
  benchUsed: boolean;
}

export interface OnlineBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  kick: boolean;
  switchPlayer: boolean;
}

// Generic temporary-removal state — MVP is "randomSubstitution" only, but the
// shape is reused later for stamina/cards/injuries (see temporaryRemoval.ts).
export type TemporaryRemovalReason = 'randomSubstitution' | 'stamina' | 'card' | 'injury' | 'event';
export type TemporaryRemovalPhase = 'leaving' | 'bench' | 'returning';

export interface TemporaryPlayerRemoval {
  playerId: string;
  team: 'home' | 'away';
  reason: TemporaryRemovalReason;
  phase: TemporaryRemovalPhase;
  // Counts down only during the 'bench' phase.
  remainingSeconds: number;
  benchDurationSeconds: number;
  // Recomputed (with occupancy avoidance) right when the bench phase ends.
  returnPosition: { x: number; y: number };
}

export interface OnlineGameState {
  status: 'waiting' | 'playing' | 'finished';
  tick: number;
  timeLeftSeconds: number;
  score: { home: number; away: number };
  ball: OnlineBall;
  players: OnlinePlayer[];
  inputs: { home: InputState; guest: InputState };
  goalMessage: string;
  goalPause: number;
  cornerTimer: number;
  cornerClearCooldown: number;
  // Last touch tracking — used for own goal detection (mirrors game/types.ts on the client)
  lastTouchTeam: 'home' | 'away' | null;
  lastTouchPlayerId: string | null;
  isOwnGoal: boolean;
  // Which team was credited with the most recent goal — lets each connected
  // client work out, from its own role, whether it scored or conceded.
  lastScorer: 'home' | 'away' | null;
  // Manual active-player override (Q / PŘEP.), per team — mirrors the bot
  // engine's game/types.ts. Keyed by engine team ('home'/'away'), not by
  // connection role ('home'/'guest').
  autoActivePlayerId: { home: string | null; away: string | null };
  // Cooldown (seconds) before the automatic pick is allowed to switch again
  // for that team — see AUTO_PLAYER_SWITCH_COOLDOWN_MS.
  autoSwitchCooldownRemaining: { home: number; away: number };
  // Counts down from AUTO_SWITCH_INPUT_LOCK_MS/1000 (seconds), per team,
  // refreshed every tick that team's input holds a movement direction. While
  // > 0, no automatic active-player change is allowed for that team — see
  // AUTO_SWITCH_INPUT_LOCK_MS. Mirrors the bot engine's game/types.ts
  // autoSwitchInputLockRemaining.
  autoSwitchInputLockRemaining: { home: number; away: number };
  manualActivePlayerId: { home: string | null; away: string | null };
  manualLockRemaining: { home: number; away: number };
  switchKeyWasDown: { home: boolean; away: boolean };
  // Charged kick (tap = weaker, hold = stronger), per team — only used when
  // TeamBehaviorConfig.usesChargedKick is true for that team.
  kickWasDown: { home: boolean; away: boolean };
  kickHeldSeconds: { home: number; away: number };
  // Temporary player removal (see temporaryRemoval.ts) — MVP: random substitution.
  temporaryRemovals: TemporaryPlayerRemoval[];
  randomSubstitutionTriggerSecond: { home: number; away: number };
  randomSubstitutionTriggered: { home: boolean; away: boolean };
  // Bench + temporary substitute (separate system — see benchDeployment.ts).
  benchDeployments: BenchDeployment[];
}

// Kept here (alongside TemporaryPlayerRemoval) to avoid a circular import
// between types.ts and benchDeployment.ts; the module re-exports it.
export interface BenchDeployment {
  playerId: string;
  team: 'home' | 'away';
  remainingMs: number;
}
