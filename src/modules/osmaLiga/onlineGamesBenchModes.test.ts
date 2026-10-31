import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  createGame, createTrainingChallenge, joinGame, startGame, requestBenchDeploy, getGame, buildSnapshot,
} from './onlineGames.js';
import { MATCH_DURATION, BENCH_DEPLOY_DURATION_MS } from '../../gameEngine/constants.js';

// Bench across the two server-authoritative modes, through the same entry
// points the socket layer uses (requestBenchDeploy with the connection role
// derived from the join token, and the real startGame tick loop).

type SnapshotPlayer = { id: string; team: string; matchStatus: string; benchUsed: boolean; benchRemainingMs: number | null };

const codes: string[] = [];

afterEach(() => {
  for (const code of codes.splice(0)) {
    const room = getGame(code);
    if (room?.gameInterval) clearInterval(room.gameInterval);
  }
  vi.useRealTimers();
});

function benchOf(code: string, team: 'home' | 'away') {
  return getGame(code)!.gameState!.players.find((p) => p.team === team && p.role === 'field_player' && (p.matchStatus !== 'field'))!;
}

function snapshotBench(code: string, team: 'home' | 'away'): SnapshotPlayer {
  const room = getGame(code)!;
  const snap = buildSnapshot(room.gameState!, room) as { players: SnapshotPlayer[] };
  return snap.players.find((p) => p.team === team && p.matchStatus !== 'field' && p.id.includes('bench'))!;
}

function multiplayerRoom(): string {
  const room = createGame();
  const join = joinGame(room.code);
  if ('error' in join) throw new Error('join failed');
  expect(startGame(room.code, () => {})).toBe(true);
  codes.push(room.code);
  return room.code;
}

function trainingRoom(): string {
  const room = createTrainingChallenge('club-test', 'club-test', 'Testovací klub');
  const join = joinGame(room.code);
  if ('error' in join) throw new Error('join failed');
  expect(startGame(room.code, () => {})).toBe(true);
  codes.push(room.code);
  return room.code;
}

describe('multiplayer bench', () => {
  it('host deploys only the home bench player; guest deploys only the away one', () => {
    const code = multiplayerRoom();
    const homeBench = benchOf(code, 'home');
    const awayBench = benchOf(code, 'away');

    // Cross-team requests (a client sending the opponent's player id) are refused.
    expect(requestBenchDeploy(code, 'home', awayBench.id)).toBe(false);
    expect(requestBenchDeploy(code, 'guest', homeBench.id)).toBe(false);
    expect(awayBench.matchStatus).toBe('bench');
    expect(homeBench.matchStatus).toBe('bench');

    expect(requestBenchDeploy(code, 'home', homeBench.id)).toBe(true);
    expect(homeBench.matchStatus).toBe('temporarily_deployed');
    expect(awayBench.matchStatus).toBe('bench');
    expect(awayBench.benchUsed).toBe(false);

    expect(requestBenchDeploy(code, 'guest', awayBench.id)).toBe(true);
    expect(awayBench.matchStatus).toBe('temporarily_deployed');
  });

  it('simultaneous activation by both players: both deployed, independent timers', () => {
    const code = multiplayerRoom();
    const homeBench = benchOf(code, 'home');
    const awayBench = benchOf(code, 'away');
    expect(requestBenchDeploy(code, 'home', homeBench.id)).toBe(true);
    expect(requestBenchDeploy(code, 'guest', awayBench.id)).toBe(true);
    const deployments = getGame(code)!.gameState!.benchDeployments;
    expect(deployments.map((d) => d.team).sort()).toEqual(['away', 'home']);
  });

  it('double click: the second request for the same player is refused, one deployment only', () => {
    const code = multiplayerRoom();
    const homeBench = benchOf(code, 'home');
    expect(requestBenchDeploy(code, 'home', homeBench.id)).toBe(true);
    expect(requestBenchDeploy(code, 'home', homeBench.id)).toBe(false);
    expect(getGame(code)!.gameState!.benchDeployments).toHaveLength(1);
  });

  it('snapshot carries the bench state both clients render (status, used, remaining time)', () => {
    const code = multiplayerRoom();
    expect(snapshotBench(code, 'home')).toMatchObject({ matchStatus: 'bench', benchUsed: false, benchRemainingMs: null });
    requestBenchDeploy(code, 'home', benchOf(code, 'home').id);
    expect(snapshotBench(code, 'home')).toMatchObject({
      matchStatus: 'temporarily_deployed', benchUsed: true, benchRemainingMs: BENCH_DEPLOY_DURATION_MS,
    });
    expect(snapshotBench(code, 'away')).toMatchObject({ matchStatus: 'bench', benchUsed: false });
  });

  it('the real tick loop removes the substitute after 30 s and the snapshot reports it as used', () => {
    vi.useFakeTimers();
    const code = multiplayerRoom();
    const homeBench = benchOf(code, 'home');
    requestBenchDeploy(code, 'home', homeBench.id);
    // No inputs from either side → no goal pauses (which would hold the timer).
    vi.advanceTimersByTime(BENCH_DEPLOY_DURATION_MS + 1500);
    expect(snapshotBench(code, 'home')).toMatchObject({ matchStatus: 'bench', benchUsed: true, benchRemainingMs: null });
    expect(requestBenchDeploy(code, 'home', homeBench.id)).toBe(false);
  });
});

describe('training challenge bench', () => {
  it('the human (guest) can deploy their own substitute manually', () => {
    const code = trainingRoom();
    const awayBench = benchOf(code, 'away');
    expect(requestBenchDeploy(code, 'guest', awayBench.id)).toBe(true);
    expect(awayBench.matchStatus).toBe('temporarily_deployed');
    // …and that leaves the bot's bench untouched.
    expect(benchOf(code, 'home').benchUsed).toBe(false);
  });

  it('the human cannot deploy the bot\'s substitute', () => {
    const code = trainingRoom();
    expect(requestBenchDeploy(code, 'guest', benchOf(code, 'home').id)).toBe(false);
  });

  it('the bot deploys its own substitute after half-time without touching the human\'s bench', () => {
    vi.useFakeTimers();
    const code = trainingRoom();
    const room = getGame(code)!;
    room.gameState!.timeLeftSeconds = MATCH_DURATION / 2 - 1;
    vi.advanceTimersByTime(100); // a few real ticks
    expect(benchOf(code, 'home').matchStatus).toBe('temporarily_deployed');
    expect(benchOf(code, 'away').matchStatus).toBe('bench');
    expect(benchOf(code, 'away').benchUsed).toBe(false);
    // The human still has theirs.
    expect(requestBenchDeploy(code, 'guest', benchOf(code, 'away').id)).toBe(true);
  });
});
