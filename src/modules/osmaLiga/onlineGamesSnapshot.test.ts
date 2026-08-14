import { describe, it, expect } from 'vitest';
import { buildSnapshot, type OnlineGameRoom } from './onlineGames.js';
import { createInitialState } from '../../gameEngine/createInitialState.js';
import { deployBenchPlayer } from '../../gameEngine/benchDeployment.js';

// buildSnapshot() is the wire shape sent to every connected client — this
// asserts it doesn't silently drop the goalkeeper role-refactor fields
// (isGoalkeeper, size) that the client needs for rendering, while confirming
// it still doesn't leak server-only physics stats (speed/shotPower/
// stoppingPower) the client has no use for.

const MINIMAL_ROOM: OnlineGameRoom = {
  code: 'ABC123',
  status: 'playing',
  hostToken: 't1',
  guestToken: 't2',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  expiresAt: new Date().toISOString(),
  gameState: null,
  gameInterval: null,
  events: [],
  startedAt: null,
  resultSavedAt: null,
  onlineMatchId: null,
  homeUserId: null,
  awayUserId: null,
  homeUserName: null,
  awayUserName: null,
  homeUserAvatar: null,
  awayUserAvatar: null,
  homeClubId: null,
  awayClubId: null,
  homeClubSlug: null,
  awayClubSlug: null,
  homeClubName: 'Náhoda FC',
  awayClubName: 'FK Pařezov',
  lookingForOpponent: false,
  lookingForOpponentAt: null,
  lookingForOpponentExpiresAt: null,
  isTrainingChallenge: false,
  trainingChallengeCreatedAt: null,
  trainingChallengeExpiresAt: null,
  trainingChallengeClubId: null,
  opponentProfile: 'standard',
  tournamentId: null,
  tournamentMatchId: null,
};

describe('buildSnapshot — player payload', () => {
  it('includes isGoalkeeper and size for every player', () => {
    const state = createInitialState();
    const snapshot = buildSnapshot(state, MINIMAL_ROOM) as {
      players: Array<{ id: string; isGoalkeeper: boolean; size: number }>;
    };

    expect(snapshot.players).toHaveLength(state.players.length);
    for (const p of snapshot.players) {
      expect(typeof p.isGoalkeeper).toBe('boolean');
      expect(typeof p.size).toBe('number');
    }
    const gkPayload = snapshot.players.find((p) => p.isGoalkeeper)!;
    const fieldPayload = snapshot.players.find((p) => !p.isGoalkeeper)!;
    expect(gkPayload.size).toBeGreaterThan(fieldPayload.size);
  });

  it('does not leak server-only physics stats (speed/shotPower/stoppingPower)', () => {
    const state = createInitialState();
    const snapshot = buildSnapshot(state, MINIMAL_ROOM) as { players: Array<Record<string, unknown>> };
    for (const p of snapshot.players) {
      expect(p).not.toHaveProperty('speed');
      expect(p).not.toHaveProperty('shotPower');
      expect(p).not.toHaveProperty('stoppingPower');
      expect(p).not.toHaveProperty('stats');
    }
  });
});

describe('buildSnapshot — bench payload', () => {
  it('includes matchStatus, benchUsed, benchRemainingMs for every player', () => {
    const state = createInitialState();
    const snapshot = buildSnapshot(state, MINIMAL_ROOM) as {
      players: Array<{ id: string; matchStatus: string; benchUsed: boolean; benchRemainingMs: number | null }>;
    };
    expect(snapshot.players).toHaveLength(state.players.length);
    for (const p of snapshot.players) {
      expect(['field', 'bench', 'temporarily_deployed']).toContain(p.matchStatus);
      expect(typeof p.benchUsed).toBe('boolean');
      expect(p.benchRemainingMs === null || typeof p.benchRemainingMs === 'number').toBe(true);
    }
  });

  it('reflects a bench player before deploy: matchStatus bench, benchRemainingMs null', () => {
    const state = createInitialState();
    const snapshot = buildSnapshot(state, MINIMAL_ROOM) as {
      players: Array<{ id: string; matchStatus: string; benchUsed: boolean; benchRemainingMs: number | null }>;
    };
    const benchPayload = snapshot.players.find((p) => p.matchStatus === 'bench')!;
    expect(benchPayload).toBeDefined();
    expect(benchPayload.benchUsed).toBe(false);
    expect(benchPayload.benchRemainingMs).toBeNull();
  });

  it('reflects a deployed player: matchStatus temporarily_deployed, benchUsed true, benchRemainingMs = 30000', () => {
    const state = createInitialState();
    const benchPlayer = state.players.find((p) => p.team === 'home' && p.matchStatus === 'bench')!;
    const ok = deployBenchPlayer(state, 'home', benchPlayer.id);
    expect(ok).toBe(true);
    const snapshot = buildSnapshot(state, MINIMAL_ROOM) as {
      players: Array<{ id: string; matchStatus: string; benchUsed: boolean; benchRemainingMs: number | null }>;
    };
    const deployedPayload = snapshot.players.find((p) => p.id === benchPlayer.id)!;
    expect(deployedPayload.matchStatus).toBe('temporarily_deployed');
    expect(deployedPayload.benchUsed).toBe(true);
    expect(deployedPayload.benchRemainingMs).toBe(30_000);
  });

  it('reflects a regular field starter: matchStatus field, benchUsed false, benchRemainingMs null', () => {
    const state = createInitialState();
    const snapshot = buildSnapshot(state, MINIMAL_ROOM) as {
      players: Array<{ id: string; matchStatus: string; benchUsed: boolean; benchRemainingMs: number | null }>;
    };
    const fieldPayload = snapshot.players.find((p) => p.matchStatus === 'field')!;
    expect(fieldPayload).toBeDefined();
    expect(fieldPayload.benchUsed).toBe(false);
    expect(fieldPayload.benchRemainingMs).toBeNull();
  });
});
