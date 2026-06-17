import { z } from 'zod';

export const ListOnlineGamesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(10),
});
