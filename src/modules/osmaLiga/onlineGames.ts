export const ONLINE_GAME_TTL_MINUTES = 30;

export type OnlineGameRoom = {
  code: string;
  status: 'waiting' | 'full' | 'expired';
  hostToken: string;
  guestToken: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
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

export function listGames(limit: number): Omit<OnlineGameRoom, 'hostToken' | 'guestToken'>[] {
  cleanupExpired();
  const games: Omit<OnlineGameRoom, 'hostToken' | 'guestToken'>[] = [];
  for (const room of store.values()) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hostToken, guestToken, ...safe } = room;
    games.push(safe);
    if (games.length >= limit) break;
  }
  return games;
}
