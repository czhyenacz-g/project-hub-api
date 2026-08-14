import { describe, it, expect, afterEach } from 'vitest';
import { createGame, joinGame, startGame, requestBenchDeploy, getGame } from './onlineGames.js';
import { updateBenchDeployments } from '../../gameEngine/benchDeployment.js';

// requestBenchDeploy() is what the 'deploy_bench_player' socket handler
// (src/ws/onlineGameSocket.ts) calls after mapping the connection's team —
// tested directly here the same way buildSnapshot() is tested directly in
// onlineGamesSnapshot.test.ts, without spinning up a real socket.

function setUpPlayingRoom(): { code: string; hostToken: string; guestToken: string } {
  const room = createGame();
  const join = joinGame(room.code);
  if ('error' in join) throw new Error('unexpected join error');
  const started = startGame(room.code, () => {});
  if (!started) throw new Error('failed to start game');
  return { code: room.code, hostToken: room.hostToken, guestToken: join.guestToken };
}

function stopRoom(code: string): void {
  const room = getGame(code);
  if (room?.gameInterval) clearInterval(room.gameInterval);
}

describe('requestBenchDeploy', () => {
  let activeCode: string | null = null;

  afterEach(() => {
    if (activeCode) stopRoom(activeCode);
    activeCode = null;
  });

  it('accepts a valid deploy from the home connection for its own bench player', () => {
    const { code } = setUpPlayingRoom();
    activeCode = code;
    const room = getGame(code)!;
    const homeBench = room.gameState!.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    const ok = requestBenchDeploy(code, 'home', homeBench.id);
    expect(ok).toBe(true);
  });

  it('rejects a deploy for a player belonging to the other team (wrong team id)', () => {
    const { code } = setUpPlayingRoom();
    activeCode = code;
    const room = getGame(code)!;
    const awayBench = room.gameState!.players.find((p) => p.team === 'away' && p.matchStatus === 'bench')!;
    // Home connection tries to deploy away's bench player.
    const ok = requestBenchDeploy(code, 'home', awayBench.id);
    expect(ok).toBe(false);
  });

  it('rejects a deploy for an already-used bench player (expired once, benchUsed permanent)', () => {
    const { code } = setUpPlayingRoom();
    activeCode = code;
    const room = getGame(code)!;
    const homeBench = room.gameState!.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    expect(requestBenchDeploy(code, 'home', homeBench.id)).toBe(true);
    // Force the deployment to expire synchronously (independent of the
    // room's real setInterval tick loop) so benchUsed becomes permanent.
    updateBenchDeployments(room.gameState!, 999);
    expect(room.gameState!.players.find((p) => p.id === homeBench.id)!.matchStatus).toBe('bench');
    expect(requestBenchDeploy(code, 'home', homeBench.id)).toBe(false);
  });

  it('rejects a deploy for a player that is already deployed (concurrent double-deploy)', () => {
    const { code } = setUpPlayingRoom();
    activeCode = code;
    const room = getGame(code)!;
    const homeBench = room.gameState!.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    expect(requestBenchDeploy(code, 'home', homeBench.id)).toBe(true);
    expect(requestBenchDeploy(code, 'home', homeBench.id)).toBe(false);
  });

  it('rejects when the game is not in playing status', () => {
    const room = createGame();
    const join = joinGame(room.code);
    if ('error' in join) throw new Error('unexpected join error');
    // Not started — gameState is still null / status 'waiting'.
    const ok = requestBenchDeploy(room.code, 'home', 'h-bench-0');
    expect(ok).toBe(false);
  });

  it('rejects for an unknown room code', () => {
    const ok = requestBenchDeploy('NOPE99', 'home', 'h-bench-0');
    expect(ok).toBe(false);
  });
});
