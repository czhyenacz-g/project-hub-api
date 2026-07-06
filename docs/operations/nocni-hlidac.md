# Noční hlídač (nocni-hlidac) — provozní poznámky

## Architektura

`nocni-hlidac` (nocni-hlidac.vercel.app, Next.js na Vercelu) je samostatný projekt, nesouvisí
s Osmou ligou. Vercel appka nemá přímé DB připojení — volá tenhle API přes
`lib/hubClient.ts` (`NOCNI_HLIDAC_API_URL` + `NOCNI_HLIDAC_API_TOKEN` jako
`Authorization: Bearer <token>`), stejný princip jako Osma liga → project-hub-api, jen
samostatný token a samostatná sada endpointů (`src/modules/nocniHlidac/`).

Ukládá se jen minimální hráč (`NocniHlidacPlayer` — `discordUserId`, `username`,
`displayName`, `avatarUrl`, `bestRun`, `currentRun`, `lastLoginAt`). Žádný death reason,
žádná historie jednotlivých směn (`guard_runs`), žádné vzkazy hlídačů — to jsou budoucí kroky.

## Autorizace

Vlastní `Authorization: Bearer <token>` (NE `x-project-hub-key`, který používá zbytek API
pro Osmou ligu) — `NOCNI_HLIDAC_API_TOKEN` env proměnná, ověřeno constant-time porovnáním
(`src/shared/nocniHlidacAuth.ts`). Chybějící/špatný token → vždy `401 {"error":"unauthorized"}`,
nikdy 500. Pokud `NOCNI_HLIDAC_API_TOKEN` není na serveru vůbec nastavený, endpointy selžou
uzavřeně (fail closed) — vrátí 401 na jakýkoliv požadavek, ne 503 ani průchod bez kontroly.

## Endpointy

```
GET  /nocni-hlidac/leaderboard              — Top 10, bestRun desc / currentRun desc / updatedAt desc
POST /nocni-hlidac/player/upsert            — založí/aktualizuje hráče (volá se po Discord loginu)
POST /nocni-hlidac/player/survive-night     — currentRun += 1, bestRun = max(bestRun, currentRun)
POST /nocni-hlidac/player/death             — currentRun = 0, bestRun beze změny
```

Všechny čtyři vyžadují `Authorization: Bearer $NOCNI_HLIDAC_API_TOKEN`.

### GET /nocni-hlidac/leaderboard

```bash
curl -H "Authorization: Bearer $NOCNI_HLIDAC_API_TOKEN" \
  https://api.example.com/nocni-hlidac/leaderboard
```

Odpověď (200):
```json
[
  { "guardName": "czhyenacz", "bestRun": 9, "currentRun": 6 },
  { "guardName": "Hlídač #13", "bestRun": 7, "currentRun": 0 }
]
```

`guardName` = `displayName || username || "Neznámý hlídač"`. Nikdy víc než 10 záznamů.

### POST /nocni-hlidac/player/upsert

Volá se po úspěšném Discord loginu (nocni-hlidac `app/api/auth/callback/route.ts`).
Založí hráče, pokud ještě neexistuje (s `bestRun: 0, currentRun: 0`), jinak aktualizuje jen
`username`/`displayName`/`avatarUrl`/`lastLoginAt` — **nikdy nepřepíše `bestRun`/`currentRun`**.

```bash
curl -X POST https://api.example.com/nocni-hlidac/player/upsert \
  -H "Authorization: Bearer $NOCNI_HLIDAC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discordUserId":"123456789","username":"czhyenacz","displayName":"Czhyenacz"}'
```

Odpověď (200): stejný tvar jako leaderboard záznam (`guardName`/`bestRun`/`currentRun`).

### POST /nocni-hlidac/player/survive-night

Volá se při přechodu hry na "win" obrazovku (přežitá směna). Najde hráče podle
`discordUserId` — **pokud neexistuje, vrací 404** (hráč musí projít `player/upsert` při
loginu dřív, tenhle endpoint ho nezakládá). `currentRun += 1`, `bestRun = max(bestRun,
currentRun)`, atomicky přes Prisma `$transaction` (read-then-write uvnitř jedné transakce).

Opakované volání bez odpovídajícího `death` mezi tím zvýší `currentRun`/`bestRun` víckrát —
deduplikace run eventů NENÍ řešená v tomhle kroku (klient volá jen na skutečný přechod
obrazovky, ne opakovaně).

```bash
curl -X POST https://api.example.com/nocni-hlidac/player/survive-night \
  -H "Authorization: Bearer $NOCNI_HLIDAC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discordUserId":"123456789"}'
```

### POST /nocni-hlidac/player/death

Volá se při přechodu hry na "death" obrazovku. `currentRun = 0`, `bestRun` beze změny.
404, pokud hráč neexistuje. Žádný `deathReason` se zatím neposílá ani neukládá (další krok,
plánovaný `guard_runs`/incident log).

```bash
curl -X POST https://api.example.com/nocni-hlidac/player/death \
  -H "Authorization: Bearer $NOCNI_HLIDAC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discordUserId":"123456789"}'
```

## Chybové odpovědi

| Stav | Kdy | Tvar |
|---|---|---|
| 400 | Neplatné tělo requestu (zod) | `{"error":"invalid_request"}` |
| 401 | Chybějící/špatný token, nebo `NOCNI_HLIDAC_API_TOKEN` vůbec nenastavený | `{"error":"unauthorized"}` |
| 404 | `discordUserId` u survive-night/death neodpovídá žádnému hráči | `{"error":"player_not_found"}` |
| 500 | Neočekávaná chyba (DB výpadek apod.) | `{"error":"internal_error"}` |

Tenhle formát je specifický pro `/nocni-hlidac/*` — zbytek API (Osma liga) má vlastní
konvenci s čitelnými zprávami (`{"error":"Club not found"}` apod.), obě konvence žijí vedle
sebe beze změny existujícího chování.

## DB model

`NocniHlidacPlayer` (`prisma/schema.prisma`), migrace
`prisma/migrations/20260706000000_add_nocni_hlidac_player/`:

```prisma
model NocniHlidacPlayer {
  id            String    @id @default(cuid())
  discordUserId String    @unique
  username      String
  displayName   String?
  avatarUrl     String?
  bestRun       Int       @default(0)
  currentRun    Int       @default(0)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  lastLoginAt   DateTime?

  @@index([discordUserId])
  @@index([bestRun(sort: Desc), currentRun(sort: Desc)])
}
```

Nasazení na produkci (stejný postup jako pro ostatní migrace, viz README "Migrace
databáze"):
```bash
docker compose exec project-hub-api npx prisma migrate deploy
```

## Testy

`src/modules/nocniHlidac/runTransitions.test.ts`, `guardName.test.ts` — čistá logika, bez DB.
`src/shared/nocniHlidacAuth.test.ts` — auth preHandler (Fastify `.inject()`, bez DB).
`src/modules/nocniHlidac/routes.test.ts` — plné route testy přes Fastify `.inject()` proti
lokální dev Postgres (`docker compose up project-hub-postgres`, `.env` s `DATABASE_URL`
mířícím na `localhost:5433`), čistí si po sobě testovací řádky
(`discordUserId` s prefixem `test-discord-`).

```bash
npm run test
```

## Plánovaný další krok

- Death reason posílaný a ukládaný na `player/death`.
- Samostatná `guard_runs`/incident log tabulka (historie jednotlivých směn, ne jen
  agregovaný `bestRun`/`currentRun`).
- Vzkazy hlídačů, admin/moderace — mimo rozsah tohoto kroku.
