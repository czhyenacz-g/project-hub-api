import { FIELD_B, FIELD_CX } from './constants.js';

// The bench is at the BOTTOM touchline (FIELD_B) for both teams in every
// mode — the client's bench controls sit below the pitch too, so players
// visibly leave downwards and come back on from below. Home bench left,
// away bench right of the halfway line. Mirrors
// osma-liga/game/benchSideline.ts (the client also renders the žolík's
// entrance/exit against these coordinates).

export const BENCH_SIDELINE_Y = FIELD_B;

// Where a player who is off the pitch at the bench stands: just past the
// bottom line, inside the canvas's bottom margin (CANVAS_H - FIELD_B = 30px),
// so it's still visible while it sits out.
export const BENCH_OFF_PITCH_Y = FIELD_B + 18;

export function getSidelineBenchSpot(team: 'home' | 'away'): { x: number; y: number } {
  return { x: team === 'home' ? FIELD_CX - 100 : FIELD_CX + 100, y: BENCH_OFF_PITCH_Y };
}
