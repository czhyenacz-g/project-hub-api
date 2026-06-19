import { z } from 'zod';

export const ListOnlineGamesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(10),
});

export const OnlineGameUserInfoSchema = z.object({
  userId:     z.string().nullable().optional(),
  userName:   z.string().nullable().optional(),
  userAvatar: z.string().nullable().optional(),
  clubId:     z.string().min(1).max(100).nullable().optional(),
});

export type OnlineGameUserInfo = z.infer<typeof OnlineGameUserInfoSchema>;

export const LookingForOpponentBodySchema = z.object({
  playerToken: z.string().min(1),
});
