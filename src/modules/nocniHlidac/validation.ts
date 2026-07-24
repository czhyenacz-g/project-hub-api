import { z } from 'zod';

export const NocniHlidacPlayerUpsertSchema = z.object({
  discordUserId: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});

export type NocniHlidacPlayerUpsertInput = z.infer<typeof NocniHlidacPlayerUpsertSchema>;

// Shared by survive-night and death — both take the player's identity plus
// an OPTIONAL nightNumber (see activityService.ts — used only for the
// player_activity_events audit log, never affects bestRun/currentRun
// transitions). The nocni-hlidac Next.js client never sends `gameMode` here
// (its own server-side gate in guardRunRequestHandlers.ts already stops
// non-hardcore requests before they reach this hub at all) — see
// activityService.ts for the resulting "always hardcore" event constant.
export const NocniHlidacDiscordUserIdSchema = z.object({
  discordUserId: z.string().min(1),
  nightNumber: z.number().int().positive().optional(),
});

export type NocniHlidacDiscordUserIdInput = z.infer<typeof NocniHlidacDiscordUserIdSchema>;
