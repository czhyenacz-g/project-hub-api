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

## Obecný hráčský profil Objektu 13 (`Object13PlayerProfile`) — krok 1A + 1B (V1 kontrakt + inventář), rozšířeno o V2 (equipment/zbraně)

Třetí, NEZÁVISLÁ tabulka od `NocniHlidacPlayer` (leaderboard identita + `bestRun`/
`currentRun`) i od `Object13HardcorePlayerProfile` (Hardcore-only odměna/statistiky výše) —
obecný, **mode-agnostic** profil hráče. Žádné sdílené sloupce, žádný `@relation`/cizí klíč na
žádnou z ostatních dvou tabulek — propojeno jen shodnou hodnotou `discordUserId`, stejná
konvence jako `Object13HardcorePlayerProfile` vůči `NocniHlidacPlayer`. Vlastní router
(`playerProfileRoutes.ts` + `playerProfileInventoryRoutes.ts`), service
(`playerProfileService.ts` + `playerProfileInventoryService.ts`), validace
(`playerProfileValidation.ts`), typy/DTO (`playerProfileTypes.ts`) a inventářový
model/registr (`playerProfileInventory.ts`) — nulové sdílení kódu s
`service.ts`/`hardcoreProfileService.ts`.

**Krok 1B dává `profileData` první skutečný, přesně validovaný obsah — `profileVersion: 1`
kontrakt (`Object13PlayerProfileDataV1`, viz `playerProfileInventory.ts`):**

```ts
type Object13InventoryItemId = 'bulb'; // budoucí položky = nový klíč v OBJECT13_INVENTORY_ITEM_REGISTRY
type Object13InventoryItems = Partial<Record<Object13InventoryItemId, number>>;
type Object13PlayerProfileDataV1 = { inventory: { items: Object13InventoryItems } };
```

Jediná dnes podporovaná položka je `bulb` (náhradní žárovky) — žádné zbraně, munice,
baterie ani vybavení kanceláře zatím. Registr (`OBJECT13_INVENTORY_ITEM_REGISTRY`) je
JEDINÝ zdroj pro `defaultQuantity`/`minQuantity`/`maxQuantity` každé položky:

```ts
bulb: { id: 'bulb', defaultQuantity: 10, minQuantity: 0, maxQuantity: 999 }
```

`defaultQuantity: 10` musí odpovídat `nocni-hlidac`'s `game/core/bulbsConfig.ts#BULBS_CONFIG.startingCount`
— žádný automatický cross-repo import (jiný repozitář, jiný build), hodnota je záměrně
duplikovaná na obou stranách; při změně výchozího počtu žárovek ve hře je potřeba změnit i
tuhle konstantu ručně. `maxQuantity: 999` je čistě technický bezpečnostní strop (ochrana
proti poškozené/nesmyslné hodnotě), NE herní limit — hra sama žádný strop na inventář nemá.

Nový profil nikdy nezačíná na `{}` — `createDefaultObject13PlayerProfileDataV1()` vrací
`{ inventory: { items: { bulb: 10 } } }`. Změna `defaultQuantity` v registru ovlivní jen
NOVĚ VYTVOŘENÉ profily, nikdy existující řádky (žádné hromadné přepsání).

**Aktivní kontrakt je od kroku "profilový kontrakt V2 + equipment" `profileVersion: 2`** —
`Object13PlayerProfileDataV1` popsaný výše zůstává v kódu jen jako typ, do kterého se
parsuje STARÝ uložený řádek při V1→V2 migraci (viz sekce "Profilový kontrakt V2 a
equipment" níže). Nový profil, GET i PUT dnes vždy pracují s V2 tvarem —
`OBJECT13_PLAYER_PROFILE_SUPPORTED_VERSIONS` je dnes `[2]`, ne `[1]`.

```
GET /nocni-hlidac/player-profile   — najde/založí profil, vrátí ho
PUT /nocni-hlidac/player-profile   — optimistic-locked zápis (viz revision níže)
```

### GET /nocni-hlidac/player-profile?discordUserId=...

```bash
curl -H "Authorization: Bearer $NOCNI_HLIDAC_API_TOKEN" \
  "https://api.example.com/nocni-hlidac/player-profile?discordUserId=123456789012345678"
```

Najde profil podle `discordUserId`, založí default (`profileVersion: 2`,
`profileData: {inventory: {items: {bulb: 10}}, equipment: {ownedWeapons: [], equippedWeaponId: null}}`,
`revision: 1`), pokud ještě neexistuje, jinak aktualizuje jen `lastSeenAt` (idempotentní —
opakované volání nikdy nevytvoří druhý řádek).

**Normalizace starého/neplatného profilu na GET**: pokud uložené `profileData` u
`profileVersion: 2` řádku NEPROJDE přísnou V2 validací (typicky ručně/jinak poškozený
řádek), GET ho v tichosti přepíše na `createDefaultObject13PlayerProfileDataV2()` a **tuhle
opravu i persistuje** — `revision` se zvýší přesně o 1, protože jde o skutečnou změnu.
Opakované GET už validního profilu `revision` znovu nezvyšuje (žádné churnování při každém
čtení). Používá stejný atomicky podmíněný `updateMany` jako zápis níže; prohraná souběžná
normalizace jen znovu přečte řádek, nikdy nepřepíše vítěze podruhé. **Starý `profileVersion:
1` řádek se navíc při GET nejdřív jednorázově migruje na V2** — viz sekce "Profilový
kontrakt V2 a equipment" níže pro přesný mechanismus.

Odpověď (200):
```json
{
  "discordUserId": "123456789012345678",
  "profileVersion": 2,
  "profileData": { "inventory": { "items": { "bulb": 10 } }, "equipment": { "ownedWeapons": [], "equippedWeaponId": null } },
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
  -d '{"discordUserId":"123456789012345678","expectedRevision":1,"profileVersion":2,"profileData":{"inventory":{"items":{"bulb":10}},"equipment":{"ownedWeapons":[],"equippedWeaponId":null}}}'
```

**Tenhle obecný PUT je určený jen pro technické/dev účely** (např. `nocni-hlidac`'s
dev-only "TEST PROFILE WRITE" v `DebugPanel.tsx`, které profil jen znovu uloží beze
změny). Běžná herní logika (získání/spotřeba náhradní žárovky, odemčení zbraně) NIKDY
nejde přes tenhle endpoint — používá doménové operace `/inventory/bulb/add`/
`/inventory/bulb/consume`/`/equipment/weapon/unlock` (viz níže), které mají vlastní
optimistic locking purpose-built pro jednu konkrétní změnu, ne whole-profile přepis.

Vyžaduje `discordUserId` (stejný přísnější snowflake formát jako GET), `expectedRevision`
(kladné celé číslo), `profileVersion` (kladné celé číslo, musí být v
`OBJECT13_PLAYER_PROFILE_SUPPORTED_VERSIONS`, dnes jen `[2]`) a `profileData`.

**Validace `profileData` je přísná, plně whitelistovaná podle přesného V2 tvaru** — žádný
tichý fallback na bezpečný default (`validateObject13PlayerProfileDataV2`,
`playerProfileValidation.ts`). Musí to být plain JSON objekt s PŘESNĚ dvěma top-level klíči
`inventory`/`equipment` (cokoliv jiného → 400 `invalid_profile_data`, kód
`unknown_top_level_key`); `inventory` validovaná stejně jako v V1 (`items` musí mít klíče
ze `OBJECT13_INVENTORY_ITEM_REGISTRY`, hodnoty celá čísla v `[minQuantity, maxQuantity]`);
`equipment` validovaná přes `validateEquipmentState` (`playerProfileEquipment.ts`) — viz
sekce "Profilový kontrakt V2 a equipment" níže pro přesná pravidla. Protože je tenhle
validátor plně whitelistovaný (pevné literály + konečná množina item/weapon ID),
`__proto__`/`constructor`/`prototype` na jakékoliv úrovni skončí jako "neznámý klíč" dřív,
než by šlo o cokoliv nebezpečného — žádná samostatná rekurzivní dangerous-key kontrola už
není potřeba (`__proto__` navíc blokuje už samotný výchozí Fastify JSON body parser dřív,
než request vůbec dorazí do routy). Serializovaná velikost (`JSON.stringify`, UTF-8 bajty)
se pořád kontroluje proti `OBJECT13_PLAYER_PROFILE_DATA_MAX_BYTES` (32 KB,
`playerProfileInventory.ts`) jako defense-in-depth. Neznámá top-level pole v těle requestu
(cokoliv mimo `discordUserId`/`expectedRevision`/`profileVersion`/`profileData`) se nikdy
neuloží (zod `.safeParse` je tiše odstraní z parsovaného výsledku).

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
  "profile": { "discordUserId": "...", "profileVersion": 2, "profileData": {"inventory":{"items":{"bulb":10}},"equipment":{"ownedWeapons":[],"equippedWeaponId":null}}, "revision": 4, "...": "..." }
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

### POST /nocni-hlidac/player-profile/inventory/bulb/add|consume

Doménové operace pro jednu položku inventáře — jediný způsob, jak ordinary herní logika
(získání/spotřeba náhradní žárovky) smí měnit `profileData`. Jedna dvojice `/add`/`/consume`
routa PER registrovaná položka (`OBJECT13_INVENTORY_ITEM_IDS` smyčka v
`playerProfileInventoryRoutes.ts`) — přidání další položky do registru automaticky
zaregistruje i její routy, žádné nové route-wiring.

```bash
curl -X POST https://api.example.com/nocni-hlidac/player-profile/inventory/bulb/add \
  -H "Authorization: Bearer $NOCNI_HLIDAC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discordUserId":"123456789012345678","amount":1,"expectedRevision":3}'

curl -X POST https://api.example.com/nocni-hlidac/player-profile/inventory/bulb/consume \
  -H "Authorization: Bearer $NOCNI_HLIDAC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discordUserId":"123456789012345678","amount":1,"expectedRevision":3}'
```

`discordUserId` přijímá server stejně jako u obecného PUT — ze server-to-server vrstvy
(`nocni-hlidac`'s vlastní Next.js proxy dosadí hodnotu ze session, browser ji nikdy
nezadává přímo). `amount` musí být kladné celé číslo, `expectedRevision` kladné celé číslo.

Stejný optimistic-locking princip jako obecný PUT (atomický `updateMany` podmíněný na
`discordUserId AND revision = expectedRevision`) — úspěch zvýší `revision` přesně o 1, dva
souběžné požadavky se stejnou `expectedRevision` nemohou oba uspět. Čistá aritmetika
(nová hodnota položky) žije mimo route handler v `playerProfileInventory.ts`
(`addInventoryItem`/`consumeInventoryItem`/`getInventoryItemQuantity`), DB
zápis/optimistic-locking v `playerProfileInventoryService.ts`.

| Stav | Kdy | Tvar |
|---|---|---|
| 200 | Úspěch | stejný tvar jako GET/PUT, `revision` zvýšené o 1 |
| 400 | Neplatné tělo (`amount`/`expectedRevision` chybí, není kladné celé číslo, neplatný `discordUserId`) | `{"error":"invalid_request"}` |
| 404 | Profil pro `discordUserId` neexistuje (nikdy neprošel GET) | `{"error":"profile_not_found"}` |
| 409 | `expectedRevision` neodpovídá aktuální hodnotě v DB | `{"error":"revision_conflict","currentRevision":N,"profile":{...}}` |
| 409 | `add`: výsledná hodnota by přesáhla `maxQuantity` z registru | `{"error":"exceeds_maximum"}` |
| 409 | `consume`: výsledná hodnota by šla pod `minQuantity` (0) | `{"error":"insufficient_inventory"}` |
| 500 | Neočekávaná chyba | `{"error":"internal_error"}` |

## Profilový kontrakt V2 a equipment (vlastnictví zbraní)

Navazuje na V1 inventář výše — řeší nahlášený bug, kdy Hardcore hráč, který si vysloužil
brokovnici, o ni přišel hned v příští misi (viz `nocni-hlidac` `TECH_DESIGN.md` "Profilový
kontrakt V2 a equipment" pro klientskou stranu opravy). Vlastnictví zbraně je od teď
DLOUHODOBÝ profilový stav (`equipment.ownedWeapons`/`equipment.equippedWeaponId`), stejná
server-confirmed architektura jako inventář žárovek. Nabité náboje/probíhající střelba
zůstávají výhradně na `nocni-hlidac` straně (runtime `GameState`) — server o nich neví nic.

### Tvar (`profileVersion: 2`)

```ts
type WeaponId = 'single_shotgun' | 'double_barrel_shotgun';
interface Object13EquipmentState {
  ownedWeapons: WeaponId[];           // trvale vlastněné zbraně, bez duplicit
  equippedWeaponId: WeaponId | null;  // musí být null, nebo prvek ownedWeapons
}
type Object13PlayerProfileDataV2 = {
  inventory: { items: Object13InventoryItems }; // beze změny oproti V1
  equipment: Object13EquipmentState;
};
```

`createDefaultObject13PlayerProfileDataV2()` vrací `{inventory: {items: {bulb: 10}},
equipment: {ownedWeapons: [], equippedWeaponId: null}}`. Weapon registry
(`WEAPON_REGISTRY`, `playerProfileEquipment.ts`) je jediný zdroj kapacity munice pro
`nocni-hlidac` stranu: `single_shotgun` → `ammoCapacity: 1`, `double_barrel_shotgun` →
`ammoCapacity: 2`. Server samotný kapacitu nikde nepoužívá (munice je čistě klientská
runtime hodnota) — registr existuje hlavně kvůli `isWeaponId`/validaci a jako budoucí
rozšiřitelný bod pro další zbraně.

### V1 → V2 migrace (lazy, na GET)

`getOrCreateObject13PlayerProfile` (`playerProfileService.ts`): při GET řádku s
`profileVersion === 1` se profil NEJDŘÍV zparsuje jako V1 (přísná V1 validace; neplatný/
poškozený `{}` řádek padá zpátky na V1 default), počet žárovek se PŘESNĚ zachová, přidá se
prázdný `equipment: {ownedWeapons: [], equippedWeaponId: null}`, `profileVersion` se
nastaví na `2` a `revision` se zvýší PŘESNĚ o 1 (jedna atomická změna, ne dvě). Používá
stejný `updateMany WHERE discordUserId AND revision` vzor jako běžný zápis — prohraná
souběžná migrace jen znovu přečte už zmigrovaný řádek. Opakovaný GET stejného řádku (už
`profileVersion: 2`) migraci znovu nespouští (žádné churnování). Migrace je bezeztrátová
pro žárovky, idempotentní a type-safe (výsledek jde vždy přes stejnou V2 validaci jako
kterýkoliv jiný zápis).

### Validace equipmentu (`validateEquipmentState`, `playerProfileEquipment.ts`)

Plně whitelistovaná, žádný silent fallback — stejný přísný duch jako V1 inventory validace:

| Chybový kód | Kdy |
|---|---|
| `not_object` | `equipment` není plain objekt |
| `unknown_equipment_key` | jiný klíč než `ownedWeapons`/`equippedWeaponId` |
| `ownedWeapons_not_array` | `ownedWeapons` není pole |
| `unknown_weapon_id` | prvek `ownedWeapons` (nebo `equippedWeaponId`) není `single_shotgun`/`double_barrel_shotgun` |
| `duplicate_weapon_id` | `ownedWeapons` obsahuje stejný `WeaponId` dvakrát |
| `invalid_equipped_weapon_id` | `equippedWeaponId` není `null` ani platný `WeaponId` |
| `equipped_weapon_not_owned` | `equippedWeaponId` není `null`, ale chybí v `ownedWeapons` |

### POST /nocni-hlidac/player-profile/equipment/weapon/unlock

Jediná doménová operace pro trvalé odemčení zbraně — běžná herní logika (nález brokovnice v
nouzové výpravě, vysloužení dvouhlavňovky true endingem) NIKDY nejde přes obecný PUT.

```bash
curl -X POST https://api.example.com/nocni-hlidac/player-profile/equipment/weapon/unlock \
  -H "Authorization: Bearer $NOCNI_HLIDAC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"discordUserId":"123456789012345678","weaponId":"single_shotgun","expectedRevision":3}'
```

Pravidla auto-equipu (`unlockWeapon`, pure funkce v `playerProfileEquipment.ts`):
- odemčení `single_shotgun`: přidá do `ownedWeapons` (pokud tam ještě není), vybaví ho JEN
  pokud `equippedWeaponId === null` — nikdy nepřepíše už vybavenou dvouhlavňovku;
- odemčení `double_barrel_shotgun`: přidá do `ownedWeapons`, VŽDY ho rovnou vybaví;
  `single_shotgun` v `ownedWeapons` (pokud tam byl) zůstává jako historicky vlastněná
  zbraň, jen přestává být vybavený.

**Idempotence beze zbytečné revision churny**: pokud je zbraň už vlastněná A správně
vybavená, `unlockWeapon` je čistý no-op (vrací STEJNOU referenci equipment objektu) —
`playerProfileEquipmentService.ts` na tom pozná, že nemá co zapisovat, a vrátí aktuální
profil BEZ zápisu do DB a BEZ inkrementu `revision`. Odpověď (200) je v obou případech
(`updated` i `unchanged`) stejný tvar — klient rozdíl nepotřebuje rozlišovat.

**Optimistic locking** — stejný `findUnique` → spočítat čistý výsledek → atomický
`updateMany WHERE discordUserId AND revision = expectedRevision` → při `count: 0` znovu
přečíst a rozhodnout 404 vs. 409 vzor jako u inventářových operací výše. Nikdy nechráněný
`findUnique` → `update`.

Odpověď (200) při úspěchu (updated i unchanged): stejný tvar jako GET, `revision` zvýšené
o 1 (updated) nebo beze změny (unchanged).

Odpověď (409) při konfliktu revision: stejný tvar jako u inventářových operací
(`{"error":"revision_conflict","currentRevision":N,"profile":{...}}`).

| Stav | Kdy | Tvar |
|---|---|---|
| 200 | Úspěch (nová i idempotentní no-op) | stejný tvar jako GET |
| 400 | Neplatné tělo (`weaponId` není `single_shotgun`/`double_barrel_shotgun`, `expectedRevision` chybí/není kladné celé číslo) | `{"error":"invalid_request"}` |
| 401 | Chybějící/špatný token | `{"error":"unauthorized"}` |
| 404 | Profil pro `discordUserId` neexistuje | `{"error":"profile_not_found"}` |
| 409 | `expectedRevision` neodpovídá aktuální hodnotě v DB | `{"error":"revision_conflict","currentRevision":N,"profile":{...}}` |
| 500 | Neočekávaná chyba | `{"error":"internal_error"}` |

**`POST .../equipment/weapon/equip` záměrně NEEXISTUJE** — pure funkce `equipWeapon`
(přepnutí mezi už vlastněnými zbraněmi) je napsaná a otestovaná v
`playerProfileEquipment.ts`, ale routa se zatím neregistruje, protože `nocni-hlidac` nemá
žádné UI pro přepínání zbraní (jen automatický auto-equip při unlocku výše). Přidání routy
je jen `app.register` navíc, až UI vznikne.

### DB model

`Object13PlayerProfile` (`prisma/schema.prisma`), migrace
`prisma/migrations/20260716115859_add_object13_player_profile/` (vznik tabulky, krok 1A),
`prisma/migrations/20260716134119_object13_player_profile_v1_default/` (sloupcový default
`profileData` změněn z `{}` na validní V1 tvar, krok 1B) a
`prisma/migrations/20260716173106_object13_player_profile_v2_equipment/` (sloupcový default
`profileVersion` `1→2` a `profileData` na validní V2 tvar s prázdným equipmentem, krok
"profilový kontrakt V2 + equipment" — opět jen `ALTER COLUMN ... SET DEFAULT`, nemigruje
žádná existující data; existující V1 řádky se migrují lazy na GET, viz výše):

```prisma
model Object13PlayerProfile {
  id             String   @id @default(cuid())
  discordUserId  String   @unique
  profileVersion Int      @default(2)
  profileData    Json     @default("{\"inventory\":{\"items\":{\"bulb\":10}},\"equipment\":{\"ownedWeapons\":[],\"equippedWeaponId\":null}}")
  revision       Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  lastSeenAt     DateTime @default(now())

  @@index([discordUserId])
  @@index([updatedAt(sort: Desc)])
}
```

Krok 1A migrace: jen `CREATE TABLE` + 3 indexy. Krok 1B a equipment migrace: jen `ALTER
COLUMN` sloupcového defaultu — žádná z nich nemění existující Hardcore/leaderboard tabulku,
nemigruje historická data (schema-level default se týká jen nově vytvářených řádků;
existující řádky migruje lazy GET popsaný výše), nevytváří testovací řádky.

**Produkční nasazení (postup, zatím NEPROVEDENO):**
1. Vytvořit zálohu databáze (viz `docs/operations/backups.md`).
2. Ověřit stav Prisma migrací na produkci (`docker compose exec project-hub-api npx prisma migrate status`).
3. Spustit `docker compose exec project-hub-api npx prisma migrate deploy`.
4. Nasadit novou verzi API (obsahuje equipment routu, V2 validaci, V1→V2 migraci).
5. Smoke test: `GET /nocni-hlidac/player-profile?discordUserId=<reálné testovací ID>` a ověřit
   odpověď 200 s `profileVersion: 2`, `profileData` obsahující `equipment`, a `revision`
   zvýšenou přesně o 1 oproti stavu před nasazením, POKUD šlo o starý V1 řádek (u nově
   vytvořeného/už V2 řádku beze změny).
6. Smoke test unlock: `POST /equipment/weapon/unlock` s testovacím účtem a
   `weaponId: "single_shotgun"`, ověřit `revision` +1, `ownedWeapons` obsahující
   `"single_shotgun"` a `equippedWeaponId: "single_shotgun"`, pak testovací profil smazat.
7. Smoke test add/consume (V1 dědictví, beze změny): `POST /inventory/bulb/add` a
   `/inventory/bulb/consume` s testovacím účtem, ověřit `revision` +1 a správnou hodnotu
   `bulb`, pak testovací profil smazat.

### Testy

`src/modules/nocniHlidac/playerProfileInventory.test.ts` — čistá logika registru a
inventářových operací (`addInventoryItem`/`consumeInventoryItem`/
`getInventoryItemQuantity`/`normalizeInventoryQuantity`), bez DB. Generalizovaná od kroku
V2 na `<T extends WithInventoryItems>`, aby fungovala i nad V2 profilem se zachovaným
`equipment` polem (viz "Profilový kontrakt V2" výše) — beze změny chování pro V1.
`src/modules/nocniHlidac/playerProfileEquipment.test.ts` (NOVÝ, krok V2) — 29 testů čisté
equipment logiky: registry, `isWeaponId`, `hasOwnedWeapon`/`getEquippedWeapon`,
`unlockWeapon` (včetně ověření stejné reference při idempotentním no-opu), `equipWeapon`,
`normalizeOwnedWeapons`, `validateEquipmentState` (každý chybový kód).
`src/modules/nocniHlidac/playerProfileValidation.test.ts` — envelope schema, V1 i V2 shape
validace (`validateObject13PlayerProfileDataV1`/`validateObject13PlayerProfileDataV2`,
posledně jmenovaná včetně `equipment_invalid` error-wrapping), inventory/weapon operation
body schema, bez DB.
`src/modules/nocniHlidac/playerProfileRoutes.test.ts` — plné route testy přes Fastify
`.inject()` proti lokální dev Postgres (GET/PUT s V2 payloady, plus samostatný "V1 -> V2
migration" blok: přesné zachování počtu žárovek, `revision` +1 jen jednou, idempotentní
re-GET, migrace legacy `{}` řádku, souběžnostní test). 31 testů.
`src/modules/nocniHlidac/playerProfileInventoryRoutes.test.ts` — plné route testy pro
`/inventory/bulb/add|consume` (úspěch, `exceeds_maximum`, `insufficient_inventory`,
`revision_conflict`, souběžný `consume`).
`src/modules/nocniHlidac/playerProfileEquipmentRoutes.test.ts` (NOVÝ, krok V2) — 9 route
testů pro `/equipment/weapon/unlock`: odemčení single (přidá+vybaví), idempotentní opakování
(revision beze změny), odemčení double barrel (přidá+vybaví, single zůstává vlastněný),
zastaralá revision → 409, dva souběžné unlocky → přesně jeden 200, neplatný `weaponId` →
400, neexistující profil → 404, chybějící auth → 401.
Testovací `discordUserId` používají rezervované číselné bloky (`90000000000000xxx` pro
`playerProfileRoutes.test.ts`, `90000000000001xxx` pro
`playerProfileInventoryRoutes.test.ts`, `90000000000002xxx` pro
`playerProfileEquipmentRoutes.test.ts` — oddělené bloky, ať souběžný test-run všech souborů
nekoliduje), čistí se po sobě v `afterEach`. Celý `nocni-hlidac` modul: 244 testů, všechny
zelené.

## Plánovaný další krok

- Přesun `nocni-hlidac`'s `bulbsRemaining`/localStorage na VPS jako autoritativní zdroj pro
  přihlášeného hráče (klientská strana kroku 1B) — hotovo, klient je napojený.
- Vlastnictví zbraní (equipment V2, viz výše) — server i klient hotové; zbývá produkční
  nasazení (postup viz "Produkční nasazení" výše, zatím NEPROVEDENO) a volitelná
  `POST .../equipment/weapon/equip` routa, až vznikne UI pro přepínání zbraní.
- Rozšíření equipmentu o další zbraně — nový klíč ve `WEAPON_REGISTRY` (oba repozitáře),
  žádná další architektonická změna. Rozšíření inventáře o další položky (munice, baterie,
  vybavení kanceláře) — nový klíč v `OBJECT13_INVENTORY_ITEM_REGISTRY`, stejně tak.
- Death reason posílaný a ukládaný na `player/death`.
- Samostatná `guard_runs`/incident log tabulka (historie jednotlivých směn, ne jen
  agregovaný `bestRun`/`currentRun`).
- Vzkazy hlídačů, admin/moderace — mimo rozsah tohoto kroku.
- Zbylých 5 Normal-nerozlišených counterů (`hardcoreTotalDeaths` apod.) zatím záměrně
  neimplementováno — čeká na mode-segmentovaný lokální tracking na nocni-hlidac straně.
