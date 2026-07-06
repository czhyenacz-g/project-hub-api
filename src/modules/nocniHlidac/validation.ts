import { z } from 'zod';

export const NocniHlidacPlayerUpsertSchema = z.object({
  discordUserId: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
});

export type NocniHlidacPlayerUpsertInput = z.infer<typeof NocniHlidacPlayerUpsertSchema>;

// Shared by survive-night and death — both take just the player's identity.
export const NocniHlidacDiscordUserIdSchema = z.object({
  discordUserId: z.string().min(1),
});

export type NocniHlidacDiscordUserIdInput = z.infer<typeof NocniHlidacDiscordUserIdSchema>;
