import { OnlineGameState, OnlinePlayer, TemporaryPlayerRemoval } from './types.js';
import {
  FIELD_L, FIELD_R, FIELD_B, FIELD_CX, FIELD_CY, MATCH_DURATION, SUPPORT_PLAYER_SPEED,
} from './constants.js';
import { getSidelineBenchSpot } from './benchSideline.js';

// Config for the generic "temporary removal" mechanic — shared groundwork for
// future stamina/cards/injury events. MVP only implements randomSubstitution.
export interface TemporaryRemovalConfig {
  enabled: boolean;
  randomSubstitutionEnabled: boolean;
  minTriggerSecond: number;
  maxTriggerSecond: number;
  benchDurationSeconds: number;
  affectedPlayersPerTeam: number;
}

export const DEFAULT_TEMPORARY_REMOVAL_CONFIG: TemporaryRemovalConfig = {
  enabled: true,
  randomSubstitutionEnabled: true,
  minTriggerSecond: 20,
  maxTriggerSecond: 70,
  benchDurationSeconds: 10,
  affectedPlayersPerTeam: 1,
};

const ARRIVAL_THRESHOLD = 4;
const RETURN_CLEARANCE = 50;

export function pickRandomTriggerSecond(config: TemporaryRemovalConfig): number {
  return config.minTriggerSecond + Math.random() * (config.maxTriggerSecond - config.minTriggerSecond);
}

export function getRemovedPlayerIds(state: OnlineGameState): Set<string> {
  return new Set(state.temporaryRemovals.map((r) => r.playerId));
}

// The bench — just past the bottom touchline (benchSideline.ts), one slot
// per side so removals from both teams don't overlap. The player walks off
// downwards and later comes back on from below.
function getBenchPosition(team: 'home' | 'away'): { x: number; y: number } {
  return getSidelineBenchSpot(team);
}

// Safe return spot: center of the team's own-half quadrant on the bench
// (bottom) side — the mirror of the old top-side spot, so the walk back on
// from the bench is practically as long as before (133px vs 140px). Nudges
// sideways if a teammate is already standing there.
function computeReturnPosition(team: 'home' | 'away', onFieldTeammates: OnlinePlayer[]): { x: number; y: number } {
  const baseX = team === 'home' ? (FIELD_L + FIELD_CX) / 2 : (FIELD_CX + FIELD_R) / 2;
  const baseY = (FIELD_CY + FIELD_B) / 2;

  let x = baseX;
  for (let attempt = 0; attempt < 4; attempt++) {
    const occupied = onFieldTeammates.some((p) => Math.hypot(p.x - x, p.y - baseY) < RETURN_CLEARANCE);
    if (!occupied) return { x, y: baseY };
    x = baseX + (attempt % 2 === 0 ? 1 : -1) * (attempt + 1) * 40;
  }
  return { x, y: baseY };
}

function moveToward(player: OnlinePlayer, target: { x: number; y: number }, dt: number): void {
  const dx = target.x - player.x;
  const dy = target.y - player.y;
  const d = Math.hypot(dx, dy);
  if (d < ARRIVAL_THRESHOLD) return;
  const step = Math.min(SUPPORT_PLAYER_SPEED * dt, d);
  player.x += (dx / d) * step;
  player.y += (dy / d) * step;
}

function pickPlayerToRemove(state: OnlineGameState, team: 'home' | 'away'): OnlinePlayer | null {
  const removedIds = getRemovedPlayerIds(state);
  const eligible = state.players.filter((p) => p.team === team && p.role !== 'goalkeeper' && p.matchStatus !== 'bench' && !removedIds.has(p.id));
  // Never remove the team's last controllable player.
  if (eligible.length <= 1) return null;
  return eligible[Math.floor(Math.random() * eligible.length)];
}

// Server-authoritative: triggers/advances/clears temporary removals in place.
// Call once per tick, before active-player resolution, so a freshly removed
// player is excluded from selection in the same tick it leaves.
export function updateTemporaryRemovals(
  state: OnlineGameState,
  dt: number,
  config: TemporaryRemovalConfig,
): void {
  if (!config.enabled) return;

  if (config.randomSubstitutionEnabled) {
    const elapsed = MATCH_DURATION - state.timeLeftSeconds;
    for (const team of ['home', 'away'] as const) {
      if (state.randomSubstitutionTriggered[team]) continue;
      if (elapsed < state.randomSubstitutionTriggerSecond[team]) continue;
      state.randomSubstitutionTriggered[team] = true;

      for (let i = 0; i < config.affectedPlayersPerTeam; i++) {
        const player = pickPlayerToRemove(state, team);
        if (!player) break;
        state.temporaryRemovals.push({
          playerId: player.id,
          team,
          reason: 'randomSubstitution',
          phase: 'leaving',
          remainingSeconds: config.benchDurationSeconds,
          benchDurationSeconds: config.benchDurationSeconds,
          returnPosition: getBenchPosition(team), // placeholder until recomputed on return
        });
      }
    }
  }

  if (state.temporaryRemovals.length === 0) return;

  const finishedIds = new Set<string>();

  for (const removal of state.temporaryRemovals) {
    const player = state.players.find((p) => p.id === removal.playerId);
    if (!player) {
      finishedIds.add(removal.playerId);
      continue;
    }

    if (removal.phase === 'leaving') {
      const target = getBenchPosition(removal.team);
      moveToward(player, target, dt);
      if (Math.hypot(player.x - target.x, player.y - target.y) < ARRIVAL_THRESHOLD) {
        removal.phase = 'bench';
      }
    } else if (removal.phase === 'bench') {
      removal.remainingSeconds = Math.max(0, removal.remainingSeconds - dt);
      if (removal.remainingSeconds <= 0) {
        removal.phase = 'returning';
        const removedIds = getRemovedPlayerIds(state);
        const onFieldTeammates = state.players.filter(
          (p) => p.team === removal.team && p.id !== removal.playerId && !removedIds.has(p.id),
        );
        removal.returnPosition = computeReturnPosition(removal.team, onFieldTeammates);
      }
    } else {
      moveToward(player, removal.returnPosition, dt);
      if (Math.hypot(player.x - removal.returnPosition.x, player.y - removal.returnPosition.y) < ARRIVAL_THRESHOLD) {
        player.x = removal.returnPosition.x;
        player.y = removal.returnPosition.y;
        finishedIds.add(removal.playerId);
      }
    }
  }

  if (finishedIds.size > 0) {
    state.temporaryRemovals = state.temporaryRemovals.filter((r) => !finishedIds.has(r.playerId));
  }
}
