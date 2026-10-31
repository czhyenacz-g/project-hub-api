import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { updateTemporaryRemovals, DEFAULT_TEMPORARY_REMOVAL_CONFIG } from './temporaryRemoval.js';
import { BENCH_SIDELINE_Y, getSidelineBenchSpot } from './benchSideline.js';
import { FIELD_CY, FIELD_B } from './constants.js';

// Temporary weakening (random substitution) — unchanged rules, bench at the
// bottom touchline: off downwards, back on from below.

const DT = 0.033;

function trigger(team: 'home' | 'away') {
  const state = createInitialState(DEFAULT_TEMPORARY_REMOVAL_CONFIG);
  state.status = 'playing';
  state.randomSubstitutionTriggerSecond = team === 'home' ? { home: 0, away: 999 } : { home: 999, away: 0 };
  updateTemporaryRemovals(state, DT, DEFAULT_TEMPORARY_REMOVAL_CONFIG);
  expect(state.temporaryRemovals).toHaveLength(1);
  const id = state.temporaryRemovals[0].playerId;
  return { state, p: state.players.find((x) => x.id === id)! };
}

describe('temporary weakening — bottom-sideline bench (server)', () => {
  for (const team of ['home', 'away'] as const) {
    it(`${team}: walks down off the pitch, sits out the full bench time, comes back on from below`, () => {
      const { state, p } = trigger(team);
      let prevY = p.y;
      while (state.temporaryRemovals[0].phase === 'leaving') {
        updateTemporaryRemovals(state, DT, DEFAULT_TEMPORARY_REMOVAL_CONFIG);
        expect(p.y).toBeGreaterThanOrEqual(prevY - 1e-9);
        prevY = p.y;
      }
      const spot = getSidelineBenchSpot(team);
      expect(p.y).toBeGreaterThan(BENCH_SIDELINE_Y);
      expect(Math.hypot(p.x - spot.x, p.y - spot.y)).toBeLessThan(5);

      let benchTicks = 0;
      while (state.temporaryRemovals[0].phase === 'bench') {
        updateTemporaryRemovals(state, DT, DEFAULT_TEMPORARY_REMOVAL_CONFIG);
        benchTicks++;
      }
      expect(benchTicks * DT).toBeGreaterThanOrEqual(DEFAULT_TEMPORARY_REMOVAL_CONFIG.benchDurationSeconds - DT);
      expect(benchTicks * DT).toBeLessThanOrEqual(DEFAULT_TEMPORARY_REMOVAL_CONFIG.benchDurationSeconds + DT);

      const ret = state.temporaryRemovals[0].returnPosition;
      expect(ret.y).toBeGreaterThan(FIELD_CY);
      expect(ret.y).toBeLessThan(FIELD_B);
      prevY = p.y;
      while (state.temporaryRemovals.length) {
        updateTemporaryRemovals(state, DT, DEFAULT_TEMPORARY_REMOVAL_CONFIG);
        expect(p.y).toBeLessThanOrEqual(prevY + 1e-9);
        prevY = p.y;
      }
      expect(p.y).toBeLessThan(BENCH_SIDELINE_Y);
    });
  }
});
