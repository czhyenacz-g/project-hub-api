import { OnlineGameState, InputState } from '../../gameEngine/types.js';
import { createInitialState } from '../../gameEngine/createInitialState.js';
import { tickGame } from '../../gameEngine/tick.js';
import { MATCH_DURATION } from '../../gameEngine/constants.js';
import { saveOnlineMatchResult } from './onlineMatchResultService.js';

export const ONLINE_GAME_TTL_MINUTES = 30;

export type OnlineMatchEventDraft = {
  type: string;
  matchSecond?: number;
  teamSide?: 'home' | 'away';
  teamName?: string;
  actorLabel?: string;
  homeScoreAfter?: number;
  awayScoreAfter?: number;
  message?: string;
  metadataJson?: Record<string, unknown>;
};

export type OnlineGameRoom = {
  code: string;
  status: 'waiting' | 'full' | 'playing' | 'finished' | 'expired';
  hostToken: string;
  guestToken: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  gameState: OnlineGameState | null;
  gameInterval: ReturnType<typeof setInterval> | null;
  events: OnlineMatchEventDraft[];
  startedAt: Date | null;
  resultSavedAt: Date | null;
  onlineMatchId: string | null;
  homeUserId: string | null;
  awayUserId: string | null;
  homeUserName: string | null;
  awayUserName: string | null;
  homeUserAvatar: string | null;
  awayUserAvatar: string | null;
  homeClubId: string | null;
  awayClubId: string | null;
};

type UserInfo = { userId?: string | null; userName?: string | null; userAvatar?: string | null; clubId?: string | null };

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

export function createGame(userInfo?: UserInfo): OnlineGameRoom {
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
    events: [],
    startedAt: null,
    resultSavedAt: null,
    onlineMatchId: null,
    homeUserId: userInfo?.userId ?? null,
    awayUserId: null,
    homeUserName: userInfo?.userName ?? null,
    awayUserName: null,
    homeUserAvatar: userInfo?.userAvatar ?? null,
    awayUserAvatar: null,
    homeClubId: userInfo?.clubId ?? null,
    awayClubId: null,
  };
  store.set(room.code, room);
  return room;
}

export function getGame(code: string): OnlineGameRoom | null {
  cleanupExpired();
  return store.get(code) ?? null;
}

export function joinGame(code: string, userInfo?: UserInfo): { room: OnlineGameRoom; guestToken: string } | { error: 'not_found' | 'full' } {
  cleanupExpired();
  const room = store.get(code);
  if (!room) return { error: 'not_found' };
  if (room.guestToken !== null) return { error: 'full' };
  const guestToken = generateToken();
  room.guestToken = guestToken;
  room.status = 'full';
  room.updatedAt = new Date().toISOString();
  room.awayUserId = userInfo?.userId ?? null;
  room.awayUserName = userInfo?.userName ?? null;
  room.awayUserAvatar = userInfo?.userAvatar ?? null;
  room.awayClubId = userInfo?.clubId ?? null;
  return { room, guestToken };
}

type SafeRoom = Omit<OnlineGameRoom,
  'hostToken' | 'guestToken' | 'gameState' | 'gameInterval' | 'events' |
  'startedAt' | 'resultSavedAt' |
  'homeUserId' | 'awayUserId' | 'homeUserName' | 'awayUserName' | 'homeUserAvatar' | 'awayUserAvatar' |
  'homeClubId' | 'awayClubId'
>;

export function listGames(limit: number): SafeRoom[] {
  cleanupExpired();
  const games: SafeRoom[] = [];
  for (const room of store.values()) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { hostToken, guestToken, gameState, gameInterval, events, startedAt, resultSavedAt, homeUserId, awayUserId, homeUserName, awayUserName, homeUserAvatar, awayUserAvatar, homeClubId, awayClubId, ...safe } = room;
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
  room.status = 'playing';
  room.startedAt = new Date();
  room.events.push({
    type: 'match_started',
    matchSecond: 0,
    homeScoreAfter: 0,
    awayScoreAfter: 0,
    message: 'Zápas začal.',
  });

  const TICK_MS = 33;              // ~30 ticks/s
  const DT = TICK_MS / 1000;       // 0.033 s per tick
  const TICKS_PER_SNAPSHOT = 2;    // emit snapshot every 2 ticks = ~15 snapshots/s

  let ticksSinceSnapshot = 0;

  room.gameInterval = setInterval(() => {
    if (!room.gameState) return;

    const prevHome = room.gameState.score.home;
    const prevAway = room.gameState.score.away;

    tickGame(room.gameState, DT);
    ticksSinceSnapshot++;

    // Detect goals by score diff
    if (room.gameState.score.home > prevHome) {
      const matchSecond = Math.round(MATCH_DURATION - room.gameState.timeLeftSeconds);
      room.events.push({
        type: 'goal',
        matchSecond,
        teamSide: 'home',
        teamName: 'Náhoda FC',
        homeScoreAfter: room.gameState.score.home,
        awayScoreAfter: room.gameState.score.away,
        message: `Gól domácích! ${room.gameState.score.home}:${room.gameState.score.away}`,
      });
    } else if (room.gameState.score.away > prevAway) {
      const matchSecond = Math.round(MATCH_DURATION - room.gameState.timeLeftSeconds);
      room.events.push({
        type: 'goal',
        matchSecond,
        teamSide: 'away',
        teamName: 'FK Pařezov',
        homeScoreAfter: room.gameState.score.home,
        awayScoreAfter: room.gameState.score.away,
        message: `Gól hostů! ${room.gameState.score.home}:${room.gameState.score.away}`,
      });
    }

    if (ticksSinceSnapshot >= TICKS_PER_SNAPSHOT) {
      ticksSinceSnapshot = 0;
      emitFn('state', buildSnapshot(room.gameState));
    }

    if (room.gameState.status === 'finished') {
      room.events.push({
        type: 'match_finished',
        matchSecond: MATCH_DURATION,
        homeScoreAfter: room.gameState.score.home,
        awayScoreAfter: room.gameState.score.away,
        message: 'Konec zápasu.',
      });
      clearInterval(room.gameInterval!);
      room.gameInterval = null;
      room.status = 'finished';
      emitFn('game_finished', { score: room.gameState.score });
      void saveOnlineMatchResult(room).catch((e: unknown) => {
        console.error('[onlineGames] Failed to save online match result:', e);
      });
    }
  }, TICK_MS);

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
