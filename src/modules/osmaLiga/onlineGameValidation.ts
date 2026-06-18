import { z } from 'zod';

export const ListOnlineGamesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(10),
});

export const OnlineGameUserInfoSchema = z.object({
  userId:     z.string().nullable().optional(),
  userName:   z.string().nullable().optional(),
  userAvatar: z.string().nullable().optional(),
});

export type OnlineGameUserInfo = z.infer<typeof OnlineGameUserInfoSchema>;
