import { OnlineGameState, InputState } from '../../gameEngine/types.js';
import { createInitialState } from '../../gameEngine/createInitialState.js';
import { tickGame } from '../../gameEngine/tick.js';

export const ONLINE_GAME_TTL_MINUTES = 30;

export type OnlineGameRoom = {
  code: string;
  status: 'waiting' | 'full' | 'expired';
  hostToken: string;
  guestToken: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  gameState: OnlineGameState | null;
  gameInterval: ReturnType<typeof setInterval> | null;
};

const store = new Map<string, OnlineGameRoom>();

const SAFE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1

export function generateCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 6 }, () =>
      SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)],
    ).join('');
  } while (store.has(code));
  return code;
}

export function generateToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function cleanupExpired(): void {
  const now = new Date();
  for (const [code, room] of store.entries()) {
    if (new Date(room.expiresAt) < now) {
      if (room.gameInterval) clearInterval(room.gameInterval);
      store.delete(code);
    }
  }
}

export function createGame(): OnlineGameRoom {
  cleanupExpired();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ONLINE_GAME_TTL_MINUTES * 60 * 1000);
  const room: OnlineGameRoom = {
    code: generateCode(),
    status: 'waiting',
    hostToken: generateToken(),
    guestToken: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    gameState: null,
    gameInterval: null,
  };
  store.set(room.code, room);
  return room;
}

export function getGame(code: string): OnlineGameRoom | null {
  cleanupExpired();
  return store.get(code) ?? null;
}

export function joinGame(code: string): { room: OnlineGameRoom; guestToken: string } | { error: 'not_found' | 'full' } {
  cleanupExpired();
  const room = store.get(code);
  if (!room) return { error: 'not_found' };
  if (room.guestToken !== null) return { error: 'full' };
  const guestToken = generateToken();
  room.guestToken = guestToken;
  room.status = 'full';
  room.updatedAt = new Date().toISOString();
  return { room, guestToken };
}

export function listGames(limit: number): Omit<OnlineGameRoom, 'hostToken' | 'guestToken' | 'gameState' | 'gameInterval'>[] {
  cleanupExpired();
  const games: Omit<OnlineGameRoom, 'hostToken' | 'guestToken' | 'gameState' | 'gameInterval'>[] = [];
  for (const room of store.values()) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hostToken, guestToken, gameState, gameInterval, ...safe } = room;
    games.push(safe);
    if (games.length >= limit) break;
  }
  return games;
}

type EmitFn = (event: string, data: unknown) => void;

export function startGame(code: string, emitFn: EmitFn): boolean {
  const room = store.get(code);
  if (!room) return false;
  if (room.gameInterval) return false; // already running

  const state = createInitialState();
  state.status = 'playing';
  room.gameState = state;

  let ticksSinceSnapshot = 0;
  const TICKS_PER_SNAPSHOT = 3; // emit snapshot every 3 ticks = ~15/s

  room.gameInterval = setInterval(() => {
    if (!room.gameState) return;

    tickGame(room.gameState, 0.05);
    ticksSinceSnapshot++;

    if (ticksSinceSnapshot >= TICKS_PER_SNAPSHOT) {
      ticksSinceSnapshot = 0;
      emitFn('state', buildSnapshot(room.gameState));
    }

    if (room.gameState.status === 'finished') {
      clearInterval(room.gameInterval!);
      room.gameInterval = null;
      emitFn('game_finished', { score: room.gameState.score });
    }
  }, 50); // 20 ticks/s

  return true;
}

function buildSnapshot(state: OnlineGameState): object {
  return {
    tick: state.tick,
    status: state.status,
    timeLeftSeconds: state.timeLeftSeconds,
    score: state.score,
    ball: { x: state.ball.x, y: state.ball.y },
    players: state.players.map((p) => ({
      id: p.id,
      team: p.team,
      x: p.x,
      y: p.y,
      active: p.active,
      label: p.label,
    })),
    goalMessage: state.goalMessage,
  };
}

export function updateInput(code: string, team: 'home' | 'guest', input: InputState): void {
  const room = store.get(code);
  if (!room || !room.gameState) return;
  if (team === 'home') {
    room.gameState.inputs.home = input;
  } else {
    room.gameState.inputs.guest = input;
  }
}
