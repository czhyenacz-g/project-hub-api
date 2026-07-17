import { z } from 'zod';

export const TOURNAMENT_MIN_PLAYERS = 2;
export const TOURNAMENT_MAX_PLAYERS = 8;

const CreateTournamentTeamSchema = z.object({
  slotNumber: z.number().int().min(1),
  name: z.string().min(1).max(60),
});

// `format` may be sent by the client but is never trusted — the backend
// recomputes it from playerCount (see determineTournamentFormat in
// tournamentService.ts), so it's accepted here only to avoid a strict-schema
// rejection and is otherwise ignored.
export const CreateTournamentSchema = z.object({
  name: z.string().min(1).max(80),
  playerCount: z.number().int().min(TOURNAMENT_MIN_PLAYERS).max(TOURNAMENT_MAX_PLAYERS),
  createdByUserId: z.string().min(1),
  format: z.string().optional(),
  teams: z.array(CreateTournamentTeamSchema).optional(),
}).superRefine((data, ctx) => {
  if (!data.teams) return;

  if (data.teams.length !== data.playerCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `teams must contain exactly playerCount (${data.playerCount}) entries`,
      path: ['teams'],
    });
    return;
  }

  const seenSlots = new Set<number>();
  for (const team of data.teams) {
    if (team.slotNumber < 1 || team.slotNumber > data.playerCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `slotNumber must be between 1 and playerCount (${data.playerCount})`,
        path: ['teams'],
      });
      return;
    }
    if (seenSlots.has(team.slotNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'teams must have unique slotNumber values',
        path: ['teams'],
      });
      return;
    }
    seenSlots.add(team.slotNumber);
  }
});

export type CreateTournamentInput = z.infer<typeof CreateTournamentSchema>;

export const ClaimTournamentTeamSchema = z.object({
  userId: z.string().min(1),
});

export type ClaimTournamentTeamInput = z.infer<typeof ClaimTournamentTeamSchema>;
