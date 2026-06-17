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
}
