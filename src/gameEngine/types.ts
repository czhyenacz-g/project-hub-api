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
}
