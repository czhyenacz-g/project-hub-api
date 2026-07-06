// Pure display-name fallback: displayName || username || "Neznámý hlídač".
// Separate from service.ts so it's testable without a database.
export function guardName(player: { displayName?: string | null; username: string }): string {
  return player.displayName ?? player.username ?? 'Neznámý hlídač';
}
