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
