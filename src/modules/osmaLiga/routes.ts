import { FastifyInstance } from 'fastify';
import { apiKeyAuth } from '../../shared/apiKeyAuth.js';
import { sendError } from '../../shared/errors.js';
import { CreateMatchResultSchema, ListMatchResultsQuerySchema, DiscordUpsertSchema } from './validation.js';
import { createMatchResult, listMatchResults, upsertDiscordUser, listClubs, getClubBySlug } from './service.js';
import { db } from '../../db.js';
import { calculateClubPoints } from './onlineMatchResultService.js';

export async function osmaLigaRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/osma-liga/match-results',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const parsed = CreateMatchResultSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues.map(i => i.message).join(', '));
      }
      const result = await createMatchResult(parsed.data);
      return reply.status(201).send(result);
    },
  );

  app.get(
    '/api/osma-liga/match-results',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const parsed = ListMatchResultsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 400, 'Invalid query params');
      }
      const results = await listMatchResults(parsed.data.limit);
      return reply.send(results);
    },
  );

  app.get(
    '/api/osma-liga/clubs',
    { preHandler: apiKeyAuth },
    async (_request, reply) => {
      const clubs = await listClubs();
      return reply.send(clubs);
    },
  );

  // GET /api/osma-liga/clubs/standings — public, rolling 30-day window
  // Must be declared BEFORE /clubs/:slug to avoid 'standings' being matched as slug
  app.get(
    '/api/osma-liga/clubs/standings',
    async (_request, reply) => {
      const until = new Date();
      const since = new Date(until);
      since.setDate(since.getDate() - 30);

      const clubs = await db.osmaClub.findMany({
        where: { isActive: true },
        select: { id: true, slug: true, name: true, shortName: true, banner: true, logo: true },
        orderBy: { sortOrder: 'asc' },
      });

      const clubIds = clubs.map((c) => c.id);
      const matches = await db.osmaOnlineMatch.findMany({
        where: {
          OR: [{ homeClubId: { in: clubIds } }, { awayClubId: { in: clubIds } }],
          finishedAt: { gte: since },
        },
        select: { homeClubId: true, awayClubId: true, homeScore: true, awayScore: true, homeClubPoints: true, awayClubPoints: true },
      });

      type Stats = { matches: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; points: number };
      const statsMap = new Map<string, Stats>();
      for (const c of clubs) {
        statsMap.set(c.id, { matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 });
      }

      for (const m of matches) {
        if (m.homeClubId && statsMap.has(m.homeClubId)) {
          const s = statsMap.get(m.homeClubId)!;
          s.matches++;
          s.goalsFor += m.homeScore;
          s.goalsAgainst += m.awayScore;
          s.points += m.homeClubPoints ?? calculateClubPoints(m.homeScore, m.awayScore).homeClubPoints;
          if (m.homeScore > m.awayScore) s.wins++;
          else if (m.homeScore === m.awayScore) s.draws++;
          else s.losses++;
        }
        if (m.awayClubId && statsMap.has(m.awayClubId)) {
          const s = statsMap.get(m.awayClubId)!;
          s.matches++;
          s.goalsFor += m.awayScore;
          s.goalsAgainst += m.homeScore;
          s.points += m.awayClubPoints ?? calculateClubPoints(m.homeScore, m.awayScore).awayClubPoints;
          if (m.awayScore > m.homeScore) s.wins++;
          else if (m.awayScore === m.homeScore) s.draws++;
          else s.losses++;
        }
      }

      const standings = clubs
        .map((c) => {
          const s = statsMap.get(c.id)!;
          return { club: { id: c.id, slug: c.slug, name: c.name, shortName: c.shortName, bannerPath: c.banner ?? null, logoPath: c.logo ?? null }, stats: { ...s, goalDifference: s.goalsFor - s.goalsAgainst } };
        })
        .sort((a, b) => {
          if (b.stats.points !== a.stats.points) return b.stats.points - a.stats.points;
          if (b.stats.goalDifference !== a.stats.goalDifference) return b.stats.goalDifference - a.stats.goalDifference;
          if (b.stats.goalsFor !== a.stats.goalsFor) return b.stats.goalsFor - a.stats.goalsFor;
          return a.club.name.localeCompare(b.club.name);
        });

      const period = { type: 'rolling_30_days' as const, days: 30, since: since.toISOString(), until: until.toISOString() };
      return reply.send({ period, standings });
    },
  );

  app.get(
    '/api/osma-liga/clubs/:slug',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const club = await getClubBySlug(slug);
      if (!club) return sendError(reply, 404, 'Club not found');
      return reply.send(club);
    },
  );

  // GET /api/osma-liga/clubs/:slug/stats — public club stats + top players, rolling 30-day window
  app.get(
    '/api/osma-liga/clubs/:slug/stats',
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const club = await db.osmaClub.findUnique({ where: { id: slug }, select: { id: true, slug: true, name: true, shortName: true, isActive: true } });
      if (!club || !club.isActive) return sendError(reply, 404, 'Club not found');

      const until = new Date();
      const since = new Date(until);
      since.setDate(since.getDate() - 30);

      const USER_SELECT = { id: true, username: true, globalName: true, avatar: true, discordId: true } as const;

      const [homeMatches, awayMatches] = await Promise.all([
        db.osmaOnlineMatch.findMany({
          where: { homeClubId: slug, finishedAt: { gte: since } },
          select: { homeScore: true, awayScore: true, homeClubPoints: true, homeUser: { select: USER_SELECT } },
        }),
        db.osmaOnlineMatch.findMany({
          where: { awayClubId: slug, finishedAt: { gte: since } },
          select: { homeScore: true, awayScore: true, awayClubPoints: true, awayUser: { select: USER_SELECT } },
        }),
      ]);

      type RawUser = { id: string; username: string; globalName: string | null; avatar: string | null; discordId: string };
      type PlayerAgg = { username: string; globalName: string | null; avatarUrl: string | null; points: number; matches: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number };
      const playerMap = new Map<string, PlayerAgg>();

      function upsertPlayer(user: RawUser | null, pts: number, gf: number, ga: number, result: 'win' | 'draw' | 'loss'): void {
        if (!user) return;
        const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=64` : null;
        const existing = playerMap.get(user.id);
        if (existing) {
          existing.points += pts;
          existing.matches++;
          existing.goalsFor += gf;
          existing.goalsAgainst += ga;
          if (result === 'win') existing.wins++;
          else if (result === 'draw') existing.draws++;
          else existing.losses++;
        } else {
          playerMap.set(user.id, { username: user.username, globalName: user.globalName, avatarUrl, points: pts, matches: 1, wins: result === 'win' ? 1 : 0, draws: result === 'draw' ? 1 : 0, losses: result === 'loss' ? 1 : 0, goalsFor: gf, goalsAgainst: ga });
        }
      }

      let matches = 0, wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0, points = 0;

      for (const m of homeMatches) {
        matches++;
        goalsFor += m.homeScore;
        goalsAgainst += m.awayScore;
        const pts = m.homeClubPoints ?? calculateClubPoints(m.homeScore, m.awayScore).homeClubPoints;
        points += pts;
        const result: 'win' | 'draw' | 'loss' = m.homeScore > m.awayScore ? 'win' : m.homeScore === m.awayScore ? 'draw' : 'loss';
        if (result === 'win') wins++;
        else if (result === 'draw') draws++;
        else losses++;
        upsertPlayer(m.homeUser, pts, m.homeScore, m.awayScore, result);
      }
      for (const m of awayMatches) {
        matches++;
        goalsFor += m.awayScore;
        goalsAgainst += m.homeScore;
        const pts = m.awayClubPoints ?? calculateClubPoints(m.homeScore, m.awayScore).awayClubPoints;
        points += pts;
        const result: 'win' | 'draw' | 'loss' = m.awayScore > m.homeScore ? 'win' : m.awayScore === m.homeScore ? 'draw' : 'loss';
        if (result === 'win') wins++;
        else if (result === 'draw') draws++;
        else losses++;
        upsertPlayer(m.awayUser, pts, m.awayScore, m.homeScore, result);
      }

      const topPlayers = Array.from(playerMap.entries())
        .map(([userId, agg]) => ({ userId, ...agg }))
        .sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.wins !== a.wins) return b.wins - a.wins;
          const adiff = a.goalsFor - a.goalsAgainst;
          const bdiff = b.goalsFor - b.goalsAgainst;
          if (bdiff !== adiff) return bdiff - adiff;
          if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
          return (a.globalName ?? a.username).localeCompare(b.globalName ?? b.username);
        })
        .slice(0, 5);

      const period = { type: 'rolling_30_days' as const, days: 30, since: since.toISOString(), until: until.toISOString() };
      return reply.send({
        period,
        club: { id: club.id, slug: club.slug, name: club.name, shortName: club.shortName },
        stats: { matches, wins, draws, losses, goalsFor, goalsAgainst, goalDifference: goalsFor - goalsAgainst, points },
        topPlayers,
      });
    },
  );

  app.post(
    '/api/osma-liga/users/discord-upsert',
    { preHandler: apiKeyAuth },
    async (request, reply) => {
      const parsed = DiscordUpsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, parsed.error.issues.map(i => i.message).join(', '));
      }
      const user = await upsertDiscordUser(parsed.data);
      return reply.status(200).send(user);
    },
  );
}
