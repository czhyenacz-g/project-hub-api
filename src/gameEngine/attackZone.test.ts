import { describe, it, expect } from 'vitest';
import { createInitialState } from './createInitialState.js';
import { tickGame } from './tick.js';
import {
  ATTACK_LIMIT_DEPTH, attackLimitX, capOffBallTarget, computeTeamSupportInputs,
  MULTIPLAYER_TEAM_BEHAVIOR, TRAINING_CHALLENGE_BEHAVIOR_CONFIG,
} from './teamBehavior.js';
import { FIELD_L, FIELD_R, SUPPORT_PLAYER_SPEED } from './constants.js';
import type { OnlineGameState } from './types.js';

const DT = 1 / 60;
const byId = (s: OnlineGameState, id: string) => s.players.find((p) => p.id === id)!;

describe('off-ball limit: last eighth before the opponent goal', () => {
  it('is one eighth of the pitch length, mirrored for both teams', () => {
    expect(ATTACK_LIMIT_DEPTH).toBe((FIELD_R - FIELD_L) / 8);
    expect(attackLimitX('home')).toBe(FIELD_R - ATTACK_LIMIT_DEPTH);
    expect(attackLimitX('away')).toBe(FIELD_L + ATTACK_LIMIT_DEPTH);
    expect(capOffBallTarget('home', { x: FIELD_R - 5, y: 1 })).toEqual({ x: attackLimitX('home'), y: 1 });
    expect(capOffBallTarget('home', { x: attackLimitX('home'), y: 1 })).toEqual({ x: attackLimitX('home'), y: 1 });
    expect(capOffBallTarget('away', { x: FIELD_L + 5, y: 1 })).toEqual({ x: attackLimitX('away'), y: 1 });
    expect(capOffBallTarget('away', { x: FIELD_R - 5, y: 1 })).toEqual({ x: FIELD_R - 5, y: 1 });
  });

  it.each(['home', 'away'] as const)('support targets of %s never enter the zone, even when pushed apart', (team) => {
    const s = createInitialState();
    const goalX = team === 'home' ? FIELD_R : FIELD_L;
    const dir = team === 'home' ? 1 : -1;
    const mates = s.players.filter((p) => p.team === team && p.role !== 'goalkeeper');
    const active = mates[0];
    // Active player deep in attack: the runner would be pushed further in.
    active.x = goalX - dir * 160;
    active.y = 280;
    s.ball.x = goalX - dir * 140;
    s.ball.y = 280;
    for (const cfg of [MULTIPLAYER_TEAM_BEHAVIOR, TRAINING_CHALLENGE_BEHAVIOR_CONFIG.home]) {
      const targets = computeTeamSupportInputs(s.players, team, active, s.ball, cfg);
      expect(targets.size).toBeGreaterThan(0);
      for (const t of targets.values()) {
        if (team === 'home') expect(t.x).toBeLessThanOrEqual(attackLimitX('home'));
        else expect(t.x).toBeGreaterThanOrEqual(attackLimitX('away'));
      }
      expect(targets.has(active.id)).toBe(false);
    }
  });

  it('a support player already inside walks back at normal speed (no teleport, no freeze)', () => {
    const s = createInitialState();
    const active = byId(s, 'h1');
    active.x = FIELD_R - 180;
    s.ball.x = FIELD_R - 160;
    s.ball.y = 180;
    s.manualActivePlayerId.home = 'h1';
    s.manualLockRemaining.home = 99;
    const lost = byId(s, 'h3');
    lost.x = FIELD_R - 30;
    lost.y = 420;
    let prevX = lost.x;
    for (let i = 0; i < 180; i++) {
      tickGame(s, DT);
      expect(prevX - lost.x).toBeLessThanOrEqual(SUPPORT_PLAYER_SPEED * DT + 1e-6);
      prevX = lost.x;
    }
    expect(lost.x).toBeLessThanOrEqual(attackLimitX('home') + 2);
  });

  it('the human-controlled player is not limited', () => {
    const s = createInitialState();
    const h1 = byId(s, 'h1');
    h1.x = FIELD_R - 140;
    h1.y = 150;
    s.ball.x = 300;
    s.ball.y = 450;
    s.inputs.home = { ...s.inputs.home, right: true };
    s.manualActivePlayerId.home = 'h1';
    s.manualLockRemaining.home = 99;
    for (let i = 0; i < 40; i++) tickGame(s, DT);
    expect(h1.x).toBeGreaterThan(attackLimitX('home'));
  });
});
