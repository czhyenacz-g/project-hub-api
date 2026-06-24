export interface Vec2 { x: number; y: number; }

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
  // Manual active-player override (Q / PŘEP.), per team — mirrors the bot
  // engine's game/types.ts. Keyed by engine team ('home'/'away'), not by
  // connection role ('home'/'guest').
  autoActivePlayerId: { home: string | null; away: string | null };
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
}
