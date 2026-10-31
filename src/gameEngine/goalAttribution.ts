// Who a goal belongs to — the same rule in project-hub-api and osma-liga
// (game/goalAttribution.ts, the local engine), keep them in sync.
//
// Only an ACTIVE play decides it: a kick or a pass (human, bot or AI
// support), recorded as OnlineGameState.lastKickTeam. A passive contact — a
// defender or goalkeeper the ball merely bumps into, a block, a deflection,
// a goalkeeper save — never takes a goal away from the team that kicked
// last.
//
//   - the conceding team kicked last (a clearance, a back-pass or a shot
//     into its own net, however soon after an opponent's shot) → own goal;
//   - the scoring team kicked last → its goal, whatever touched the ball
//     on the way in;
//   - nobody kicked since the kick-off (or the game's corner clear moved
//     the ball) → a plain goal, never an own goal.
//
// A shot heading wide that a defender happens to turn in therefore counts
// for the shooter: from position and velocity alone that can't be told
// apart from a block of a shot on target, and a plain goal is preferred
// over a wrong own goal. The score itself never depends on this — only the
// goal message and the goal event's isOwnGoal flag.
export function isOwnGoal(scoringTeam: 'home' | 'away', lastKickTeam: 'home' | 'away' | null): boolean {
  return lastKickTeam !== null && lastKickTeam !== scoringTeam;
}
