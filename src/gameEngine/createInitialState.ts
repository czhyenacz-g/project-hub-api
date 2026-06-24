import { OnlineGameState, OnlinePlayer, InputState } from './types.js';
import { FIELD_CX, FIELD_CY, MATCH_DURATION } from './constants.js';
import { DEFAULT_TEMPORARY_REMOVAL_CONFIG, TemporaryRemovalConfig, pickRandomTriggerSecond } from './temporaryRemoval.js';

function makeInput(): InputState {
  return { up: false, down: false, left: false, right: false, kick: false, switchPlayer: false };
}

function makePlayer(
  id: string,
  team: 'home' | 'away',
  x: number,
  y: number,
  label: string,
): OnlinePlayer {
  return { id, team, x, y, vx: 0, vy: 0, baseX: x, baseY: y, label, kickCooldown: 0, active: false };
}

export function createInitialState(
  temporaryRemovalConfig: TemporaryRemovalConfig = DEFAULT_TEMPORARY_REMOVAL_CONFIG,
): OnlineGameState {
  const players: OnlinePlayer[] = [
    // Home team (left half)
    makePlayer('h1', 'home', 200, 180, 'H1'),
    makePlayer('h2', 'home', 200, FIELD_CY, 'H2'),
    makePlayer('h3', 'home', 200, 380, 'H3'),
    // Away team (right half)
    makePlayer('a1', 'away', 760, 180, 'A1'),
    makePlayer('a2', 'away', 760, FIELD_CY, 'A2'),
    makePlayer('a3', 'away', 760, 380, 'A3'),
  ];

  return {
    status: 'waiting',
    tick: 0,
    timeLeftSeconds: MATCH_DURATION,
    score: { home: 0, away: 0 },
    ball: { x: FIELD_CX, y: FIELD_CY, vx: 0, vy: 0 },
    players,
    inputs: { home: makeInput(), guest: makeInput() },
    goalMessage: '',
    goalPause: 0,
    cornerTimer: 0,
    cornerClearCooldown: 0,
    lastTouchTeam: null,
    lastTouchPlayerId: null,
    isOwnGoal: false,
    autoActivePlayerId: { home: null, away: null },
    manualActivePlayerId: { home: null, away: null },
    manualLockRemaining: { home: 0, away: 0 },
    switchKeyWasDown: { home: false, away: false },
    kickWasDown: { home: false, away: false },
    kickHeldSeconds: { home: 0, away: 0 },
    temporaryRemovals: [],
    randomSubstitutionTriggerSecond: {
      home: pickRandomTriggerSecond(temporaryRemovalConfig),
      away: pickRandomTriggerSecond(temporaryRemovalConfig),
    },
    randomSubstitutionTriggered: { home: false, away: false },
  };
}
