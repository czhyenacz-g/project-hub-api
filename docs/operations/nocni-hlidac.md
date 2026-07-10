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

## Seed — lore/starter hráči na leaderboardu

`src/modules/nocniHlidac/seed.ts` (`seedNocniHlidac()`, volaný z tenkého CLI runneru
`scripts/seed-nocni-hlidac.ts`) — 5 falešných/lore hráčů (Strážný Novák, Hlídač #13,
NočníPepa, Zaměstnanec 042, Kandidát směny), ať leaderboard po čerstvém nasazení nepůsobí
prázdně. **Nejsou to reální Discord hráči** — `discordUserId` má vždy pevný prefix `seed-`
(`seed-strazny-novak`, ...), skutečná Discord ID jsou vždy číselná, takže nemůže dojít ke
kolizi. Idempotentní (Prisma `upsert` podle `discordUserId`), opakované spuštění jen
přepíše `displayName`/`bestRun`/`currentRun` na aktuální definici, nikdy nevytvoří duplicitu
a nikdy se nedotkne řádku, jehož `discordUserId` nezačíná `seed-`.

```bash
# Lokálně
npx tsx scripts/seed-nocni-hlidac.ts

# Produkce
docker compose exec project-hub-api npx tsx scripts/seed-nocni-hlidac.ts
```

Testy v `src/modules/nocniHlidac/seed.test.ts` — vytvoří všech 5, idempotence (dvojí
spuštění nevytvoří duplicity), nedotýká se reálného hráče, re-seed přepíše zdrolený seed
řádek zpátky na aktuální definici.

## Hardcore profil Objektu 13 (`Object13HardcorePlayerProfile`)

Samostatná tabulka od `NocniHlidacPlayer` výše (ta drží jen leaderboard `bestRun`/
`currentRun`) — Hardcore-only true-ending odměna a nejvyšší dosažená Hardcore noc.
**Normal se sem vůbec neukládá.** Vlastní router (`src/modules/nocniHlidac/hardcoreProfileRoutes.ts`),
service (`hardcoreProfileService.ts`) a čistá merge/validace (`hardcoreProfileMerge.ts`,
`hardcoreProfileValidation.ts`) — izolované od `routes.ts`/`service.ts` výše, stejná
`nocniHlidacAuth` bearer ochrana, žádný nový auth systém.

```
GET  /nocni-hlidac/hardcore-profile          — najde/založí profil, vrátí ho
POST /nocni-hlidac/hardcore-profile/sync     — OR/max merge snapshotu, vrátí uložený profil
```

Cesty jsou schválně `/nocni-hlidac/*`, NE `/object13/*` — přesně odpovídají tomu, co už
dnes volá `lib/hardcoreProfile/remoteHardcoreProfile.ts` v nocni-hlidac repozitáři
(`fetchRemoteHardcoreProfile`/`syncRemoteHardcoreProfile`), tenhle projekt má pro
nocni-hlidac jen jeden prefix.

### GET /nocni-hlidac/hardcore-profile?discordUserId=...

```bash
curl -H "Authorization: Bearer <TOKEN>" \
  "https://api.example.com/nocni-hlidac/hardcore-profile?discordUserId=123456789"
```

Najde profil podle `discordUserId`, založí default (samé nuly/`false`/`{}`), pokud ještě
neexistuje, aktualizuje `lastSeenAt`. GET request nenese `displayName`/`avatarUrl` (viz
`fetchRemoteHardcoreProfile` — posílá jen `discordUserId`), takže je tenhle endpoint
neaktualizuje; ty se refreshují jen přes sync níže. `hardcoreDeathsByNight` se vrací VŽDY
jako objekt (`{}`, pokud v DB chybí/je `null`/neplatný — nikdy `null`/`undefined`).

Odpověď (200):
```json
{
  "discordUserId": "123456789",
  "displayName": null,
  "avatarUrl": null,
  "hardcoreHasDefeatedMonster": false,
  "hardcoreDoubleBarrelUnlocked": false,
  "hardcoreMonsterDefeatsCount": 0,
  "hardcoreBestNight": 0,
  "hardcoreDeathsByNight": {},
  "createdAt": "2026-07-09T21:00:00.000Z",
  "updatedAt": "2026-07-09T21:00:00.000Z",
  "lastSeenAt": "2026-07-09T21:00:00.000Z"
}
```

### POST /nocni-hlidac/hardcore-profile/sync

```bash
curl -X POST https://api.example.com/nocni-hlidac/hardcore-profile/sync \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"discordUserId":"123456789","displayName":"Czhyenacz","avatarUrl":null,"hardcoreHasDefeatedMonster":true,"hardcoreDoubleBarrelUnlocked":true,"hardcoreMonsterDefeatsCount":1,"hardcoreBestNight":9,"hardcoreDeathsByNight":{"1":1}}'
```

Najde/založí profil, sloučí snapshot se stávajícím stavem a uloží — **nikdy neplatí jako
event sourcing, je to idempotentní snapshot merge**:
- `hardcoreHasDefeatedMonster`/`hardcoreDoubleBarrelUnlocked`: OR (jakmile `true`, navždy
  `true`).
- `hardcoreMonsterDefeatsCount`/`hardcoreBestNight`: `max(existing, incoming)`, nikdy
  součet, nikdy snížení.
- `hardcoreDeathsByNight`: merge PO KLÍČI NOCI — `max(existing[night], incoming[night])`
  pro KAŽDOU noc zvlášť, nikdy součet. Příklad: existující `{"1":2,"3":1}` + příchozí
  `{"1":1,"2":4}` → `{"1":2,"2":4,"3":1}`. Jediný povolený death histogram — Normal death
  histogram nemá žádné jméno pole, které by se sem četlo.
- `displayName`/`avatarUrl`/`lastSeenAt` se vždy přepíší podle requestu.

Vstup je whitelistovaný/sanitizovaný (`hardcoreProfileValidation.ts#sanitizeIncomingHardcoreSnapshot`)
— neznámá pole i "Normal-like" pole (`totalDeaths`, `totalRunsStarted`,
`totalNightsSurvived`, `bulbsReplaced`, `generatorsRestarted`, `expeditionsStarted`,
`expeditionsReturned`, `monsterHitsConfirmed`, `monsterKills`, ...) se tiše zahodí, nikdy se
neuloží ani nevrátí. Neplatný typ (string místo čísla, NaN/Infinity, boolean jako string)
tiše spadne na bezpečný default (`false`/`0`), nikdy nezpůsobí 400 — jen chybějící/prázdné
`discordUserId` v identitě dá 400. Čísla se navíc clampují: `hardcoreMonsterDefeatsCount`
max `100000`, `hardcoreBestNight` max `10000`. `hardcoreDeathsByNight` položky: klíč noci
musí být kladný integer (jako string) `1..10000`, hodnota nezáporný integer `0..1000000` —
neplatné položky (noc `<= 0`, `> 10000`, nečíselná; count záporný/necelý/`NaN`/ne-číslo) se
tiše zahodí (jen ta konkrétní položka, ne celý histogram); `null`/pole/string místo objektu
se bere jako `{}`. Server nikdy nepřijme/neuloží zápornou hodnotu.

Odpověď (200): stejný tvar jako GET výše, s aktualizovanými hodnotami.

### Historie: rozdíl oproti nocni-hlidac `ServerHardcorePlayerProfile`

Dřívější verze nocni-hlidac `ServerHardcorePlayerProfile`/`HardcoreProfileSnapshot`
deklarovala 5 polí (`hardcoreTotalDeaths`, `hardcoreTotalRunsStarted`,
`hardcoreTotalNightsSurvived`, `hardcoreMonsterHitsConfirmed`, `hardcoreMonsterKills`), která
tenhle hub nikdy neukládal — **od zadání "Srovnat ServerHardcorePlayerProfile typ a client
mapping s reálným project-hub-api contractem" je nocni-hlidac typ zúžený na přesně to, co
hub vrací**, takže tenhle nesoulad je vyřešený. `hardcoreDeathsByNight` (viz výše) je nové
pole PŘIDANÉ do obou stran zároveň (stejný úkol "Uzavřít Hardcore profil a achievementy"),
ne recidiva stejného problému.

## Plánovaný další krok

- Death reason posílaný a ukládaný na `player/death`.
- Samostatná `guard_runs`/incident log tabulka (historie jednotlivých směn, ne jen
  agregovaný `bestRun`/`currentRun`).
- Vzkazy hlídačů, admin/moderace — mimo rozsah tohoto kroku.
- Zbylých 5 Normal-nerozlišených counterů (`hardcoreTotalDeaths` apod.) zatím záměrně
  neimplementováno — čeká na mode-segmentovaný lokální tracking na nocni-hlidac straně.
