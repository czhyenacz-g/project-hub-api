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

## Obecný hráčský profil Objektu 13 (`Object13PlayerProfile`) — krok 1A

Třetí, NEZÁVISLÁ tabulka od `NocniHlidacPlayer` (leaderboard identita + `bestRun`/
`currentRun`) i od `Object13HardcorePlayerProfile` (Hardcore-only odměna/statistiky výše) —
obecný, **mode-agnostic** profil hráče, základ pro budoucí inventář/nastavení/dlouhodobý
postup/vybavení kanceláře. Žádné sdílené sloupce, žádný `@relation`/cizí klíč na žádnou z
ostatních dvou tabulek — propojeno jen shodnou hodnotou `discordUserId`, stejná konvence
jako `Object13HardcorePlayerProfile` vůči `NocniHlidacPlayer`. Vlastní router
(`src/modules/nocniHlidac/playerProfileRoutes.ts`), service
(`playerProfileService.ts`), validace (`playerProfileValidation.ts`) a typy/DTO
(`playerProfileTypes.ts`) — nulové sdílení kódu s `service.ts`/`hardcoreProfileService.ts`.

**V tomhle kroku profil NEOBSAHUJE žádná skutečná herní data.** `profileData` je záměrně
prázdný JSON objekt (`{}`) — žárovky, zbraně, nastavení, vybavení kanceláře, postup se
přesunou až v samostatném kroku 1B (nebo pozdější části 2), viz report k zadání.

```
GET /nocni-hlidac/player-profile   — najde/založí profil, vrátí ho
PUT /nocni-hlidac/player-profile   — optimistic-locked zápis (viz revision níže)
```

### GET /nocni-hlidac/player-profile?discordUserId=...

```bash
curl -H "Authorization: Bearer $NOCNI_HLIDAC_API_TOKEN" \
  "https://api.example.com/nocni-hlidac/player-profile?discordUserId=123456789012345678"
```

Najde profil podle `discordUserId`, založí default (`profileVersion: 1`, `profileData: {}`,
`revision: 1`), pokud ještě neexistuje, jinak aktualizuje jen `lastSeenAt` (idempotentní —
opakované volání nikdy nevytvoří druhý řádek ani nezmění `revision`/`profileData`).

Odpověď (200):
```json
{
  "discordUserId": "123456789012345678",
  "profileVersion": 1,
  "profileData": {},
  "revision": 1,
  "createdAt": "2026-07-16T12:00:00.000Z",
  "updatedAt": "2026-07-16T12:00:00.000Z",
  "lastSeenAt": "2026-07-16T12:00:00.000Z"
}
```

Interní `id` (cuid primární klíč) se nikdy nevrací — klient adresuje svůj profil výhradně
přes `discordUserId`.

**`discordUserId` validace je přísnější než u ostatních `/nocni-hlidac/*` endpointů** —
nový `DiscordSnowflakeIdSchema` (`playerProfileValidation.ts`) vyžaduje `^\d{17,20}$`
(jen číslice, 17-20 znaků, odpovídá skutečnému tvaru Discord snowflake ID). Starší
`NocniHlidacDiscordUserIdSchema`/`HardcoreProfileGetQuerySchema` (`z.string().min(1)`)
zůstávají BEZE ZMĚNY na `player/upsert`, `player/survive-night`, `player/death` i
`hardcore-profile` — nová přísnější kontrola se zatím týká jen tohoto nového endpointu, ať
nemohla nic existujícího rozbít.

### PUT /nocni-hlidac/player-profile

```bash
curl -X PUT https://api.example.com/nocni-hlidac/player-profile \
  -H "Authorization: Bearer $NOCNI_HLIDAC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discordUserId":"123456789012345678","expectedRevision":1,"profileVersion":1,"profileData":{}}'
```

Vyžaduje `discordUserId` (stejný přísnější snowflake formát jako GET), `expectedRevision`
(kladné celé číslo), `profileVersion` (kladné celé číslo, musí být v
`OBJECT13_PLAYER_PROFILE_SUPPORTED_VERSIONS`, dnes jen `[1]`) a `profileData`.

**Validace `profileData` je záměrně PŘÍSNÁ, ne lenientní jako Hardcore sync výše** — žádný
tichý fallback na bezpečný default. Musí to být plain JSON objekt (`null`/pole/string/
číslo/boolean se odmítne, 400 `invalid_profile_data`), nesmí obsahovat klíč `__proto__`,
`constructor` ani `prototype` NIKDE v hloubce (rekurzivní kontrola, 400
`invalid_profile_data` — `__proto__` navíc blokuje už samotný výchozí Fastify JSON
body parser dřív, než request vůbec dorazí do routy), a serializovaná velikost (`JSON.stringify`,
UTF-8 bajty) nesmí přesáhnout `OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES` (32 KB, pojmenovaná
konstanta v `playerProfileTypes.ts`) — jinak 413 `profile_data_too_large`. Neznámá top-level
pole v těle requestu (cokoliv mimo `discordUserId`/`expectedRevision`/`profileVersion`/
`profileData`) se nikdy neuloží (zod `.safeParse` je tiše odstraní z parsovaného výsledku).

**Optimistic locking (`revision`)**: zápis NIKDY neprovádí `findUnique` a pak nechráněný
`update` (to by byla lost-update race — dva souběžní volající by mohli oba přečíst stejnou
"aktuální" hodnotu, druhý zápis by první tiše přepsal beze stopy). Místo toho jeden atomický
`updateMany` s podmínkou `WHERE discordUserId = ... AND revision = expectedRevision` — Postgres
řadí souběžné `UPDATE` příkazy nad stejným řádkem přes vlastní row lock, takže ze dvou
opravdu současných volání se stejným `expectedRevision` může uspět nejvýš jedno. Prohraný
zápis (`updateMany` vrátí `{count: 0}`) NEPŘEPÍŠE nic — teprve POTOM se řádek znovu přečte,
čistě aby se rozhodlo, jestli profil vůbec neexistuje (404 `profile_not_found`), nebo šlo o
konflikt revision (409). Tohle druhé čtení se nikdy nevrací zpátky do rozhodnutí o zápisu.

Odpověď (200) při úspěchu: stejný tvar jako GET, `revision` zvýšené přesně o 1.

Odpověď (409) při konfliktu revision:
```json
{
  "error": "revision_conflict",
  "currentRevision": 4,
  "profile": { "discordUserId": "...", "profileVersion": 1, "profileData": {}, "revision": 4, "...": "..." }
}
```

### Chybové odpovědi (`/nocni-hlidac/player-profile`)

| Stav | Kdy | Tvar |
|---|---|---|
| 400 | Neplatné tělo/query (zod), neplatné `profileData` (`invalid_profile_data`), nepodporovaná `profileVersion` (`unsupported_profile_version`) | `{"error":"invalid_request"}` / `{"error":"invalid_profile_data"}` / `{"error":"unsupported_profile_version"}` |
| 401 | Chybějící/špatný token | `{"error":"unauthorized"}` |
| 404 | PUT proti `discordUserId`, který nikdy neprošel GET (profil neexistuje) | `{"error":"profile_not_found"}` |
| 409 | `expectedRevision` neodpovídá aktuální hodnotě v DB | `{"error":"revision_conflict","currentRevision":N,"profile":{...}}` |
| 413 | Serializované `profileData` přesahuje `OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES` | `{"error":"profile_data_too_large"}` |
| 500 | Neočekávaná chyba | `{"error":"internal_error"}` |

### DB model

`Object13PlayerProfile` (`prisma/schema.prisma`), migrace
`prisma/migrations/20260716115859_add_object13_player_profile/`:

```prisma
model Object13PlayerProfile {
  id             String   @id @default(cuid())
  discordUserId  String   @unique
  profileVersion Int      @default(1)
  profileData    Json     @default("{}")
  revision       Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  lastSeenAt     DateTime @default(now())

  @@index([discordUserId])
  @@index([updatedAt(sort: Desc)])
}
```

Migrace jen `CREATE TABLE` + 3 indexy (unique `discordUserId`, lookup `discordUserId`,
`updatedAt` desc) — nemění žádnou existující tabulku, nemigruje žádná Hardcore/leaderboard
data, nevytváří žádné testovací/seedovací řádky.

**Produkční nasazení (postup, zatím NEPROVEDENO):**
1. Vytvořit zálohu databáze (viz `docs/operations/backups.md`).
2. Ověřit stav Prisma migrací na produkci (`docker compose exec project-hub-api npx prisma migrate status`).
3. Spustit `docker compose exec project-hub-api npx prisma migrate deploy`.
4. Ověřit, že tabulka `Object13PlayerProfile` v produkční DB skutečně vznikla.
5. Nasadit novou verzi API (obsahuje nové routy).
6. Smoke test: `GET /nocni-hlidac/player-profile?discordUserId=<reálné testovací ID>` a ověřit
   odpověď 200 s `profileVersion: 1`, `profileData: {}`, `revision: 1`.

### Testy

`src/modules/nocniHlidac/playerProfileValidation.test.ts` — čistá logika (discordUserId
regex, envelope schema, rekurzivní detekce nebezpečných klíčů, limit velikosti), bez DB.
`src/modules/nocniHlidac/playerProfileRoutes.test.ts` — plné route testy přes Fastify
`.inject()` proti lokální dev Postgres, včetně souběžnostního testu (dva paralelní PUT se
stejnou `expectedRevision` — přesně jeden uspěje). Testovací `discordUserId` používají
rezervovaný číselný blok `90000000000000xxx` (18 číslic, vždy projde
`DiscordSnowflakeIdSchema`, nikdy nekoliduje se skutečným Discord ID ani s `seed-` lore
hráči), čistí se po sobě v `afterEach`.

## Plánovaný další krok

- Krok 1B (nebo část 2): přesun žárovek (`bulbsRemaining`/`roomBulbs`) do
  `Object13PlayerProfile.profileData` — teprve TEĎ, po ověření obecného profilu/API/migrace/
  revision v produkci.
- Death reason posílaný a ukládaný na `player/death`.
- Samostatná `guard_runs`/incident log tabulka (historie jednotlivých směn, ne jen
  agregovaný `bestRun`/`currentRun`).
- Vzkazy hlídačů, admin/moderace — mimo rozsah tohoto kroku.
- Zbylých 5 Normal-nerozlišených counterů (`hardcoreTotalDeaths` apod.) zatím záměrně
  neimplementováno — čeká na mode-segmentovaný lokální tracking na nocni-hlidac straně.
