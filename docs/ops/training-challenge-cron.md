# Training challenge cron (Hetzner)

## K čemu slouží

Aby online multiplayer Osmé ligy nepůsobil mrtvě, když zrovna nečeká žádný
reálný hráč, generuje se jednou za hodinu (06:00–22:00) automatická
"tréninková výzva" jednoho fiktivního klubu. Vytvoří se běžná online herní
room, kterou si může jako soupeř vzít první reálný hráč, který klikne na
callout na homepage nebo v `/hra/multiplayer`.

Veřejně se nikde nepíše, že jde o bota — UI mluví jen o "tréninkovém zápase".

## Jaký endpoint cron volá

```
POST https://api.osmaliga.cz/internal/training-challenges/generate
Authorization: Bearer ${TRAINING_CRON_SECRET}
```

Chování:

- pokud už existuje aktivní (nevypršelá) tréninková výzva, endpoint nic
  nevytvoří a vrátí `{"ok":true,"status":"skipped",...}`,
- jinak vybere náhodný aktivní fiktivní klub, vytvoří room a vrátí
  `{"ok":true,"status":"created","game":{...}}`,
- výzva platí 10 minut (`TRAINING_CHALLENGE_TTL_MINUTES` v
  `src/modules/osmaLiga/onlineGames.ts`).

Endpoint je chráněný `TRAINING_CRON_SECRET`, ne `PROJECT_HUB_API_KEY`.

## Jak nastavit env secret

1. Vygeneruj dlouhý náhodný token, např.:

   ```bash
   openssl rand -hex 32
   ```

2. Na Hetzneru doplň do `/opt/project-hub-api/.env`:

   ```
   TRAINING_CRON_SECRET=<vygenerovaný token>
   ```

3. `docker-compose.yml` už token mapuje do kontejneru
   (`TRAINING_CRON_SECRET: ${TRAINING_CRON_SECRET:-}`), staačí restart:

   ```bash
   cd /opt/project-hub-api
   docker compose up -d --build project-hub-api
   ```

Pokud `TRAINING_CRON_SECRET` není nastavený (prázdný), endpoint vrací
`503 Training cron is not configured` — nikdy nefunguje "potichu" bez
nastaveného secretu.

## Jak ověřit endpoint

```bash
# Se secretem — má vytvořit nebo skipnout výzvu
curl -i -X POST https://api.osmaliga.cz/internal/training-challenges/generate \
  -H "Authorization: Bearer $TRAINING_CRON_SECRET"

# Bez secretu — musí vrátit 401 (nebo 503, pokud secret není nastavený vůbec)
curl -i -X POST https://api.osmaliga.cz/internal/training-challenges/generate
```

Aktivní výzvu lze ověřit i přes veřejný (přes osma-liga proxy) endpoint:

```bash
curl -s https://osmaliga.cz/api/training-challenges/active
```

## Jak přidat crontab

Skript `scripts/generate-training-challenge.sh` načte `TRAINING_CRON_SECRET`
z `/opt/project-hub-api/.env` a zavolá endpoint. Skript je už v repozitáři
(nasadí se spolu s `git pull`), zkontroluj jen že má spustitelná práva:

```bash
chmod +x /opt/project-hub-api/scripts/generate-training-challenge.sh
```

Přidání crontabu (každou hodinu mezi 06:00–22:00):

```bash
crontab -e
```

```
0 6-22 * * * /opt/project-hub-api/scripts/generate-training-challenge.sh >/dev/null 2>&1
```

Cron je třeba přidat **manuálně** — nebyl přidán automaticky.

## Jak cron vypnout

- Smaž nebo zakomentuj řádek v `crontab -e`, nebo
- vyprázdni/odeber `TRAINING_CRON_SECRET` z `.env` a restartuj kontejner —
  endpoint pak vrací `503` a nic nevytváří, i kdyby cron běžel dál.
