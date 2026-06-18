import { z } from 'zod';

export const CreateMatchResultSchema = z.object({
  homeScore: z.number().int().min(0).max(99),
  awayScore: z.number().int().min(0).max(99),
  durationSeconds: z.number().int().min(30).max(600),
});

export const ListMatchResultsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export type CreateMatchResultInput = z.infer<typeof CreateMatchResultSchema>;

export const DiscordUpsertSchema = z.object({
  discordId: z.string().min(1),
  username: z.string().min(1),
  globalName: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
});

export type DiscordUpsertInput = z.infer<typeof DiscordUpsertSchema>;
