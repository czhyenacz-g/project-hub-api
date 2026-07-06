import { describe, expect, it } from 'vitest';
import { applyDeath, applySurviveNight } from './runTransitions.js';

describe('applySurviveNight', () => {
  it('increments currentRun by 1', () => {
    expect(applySurviveNight({ bestRun: 5, currentRun: 2 }).currentRun).toBe(3);
  });

  it('raises bestRun only when currentRun surpasses it', () => {
    expect(applySurviveNight({ bestRun: 2, currentRun: 2 })).toEqual({ bestRun: 3, currentRun: 3 });
  });

  it('keeps bestRun unchanged when currentRun is still below it', () => {
    expect(applySurviveNight({ bestRun: 9, currentRun: 2 })).toEqual({ bestRun: 9, currentRun: 3 });
  });

  it('works from a fresh (0/0) state', () => {
    expect(applySurviveNight({ bestRun: 0, currentRun: 0 })).toEqual({ bestRun: 1, currentRun: 1 });
  });
});

describe('applyDeath', () => {
  it('resets currentRun to 0 and leaves bestRun untouched', () => {
    expect(applyDeath({ bestRun: 7, currentRun: 4 })).toEqual({ bestRun: 7, currentRun: 0 });
  });

  it('is a no-op on an already-inactive run', () => {
    expect(applyDeath({ bestRun: 3, currentRun: 0 })).toEqual({ bestRun: 3, currentRun: 0 });
  });
});
