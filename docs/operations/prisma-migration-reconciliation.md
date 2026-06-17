# Prisma Migration Reconciliation — Online Match Event Log

**Datum:** 2026-06-17  
**Ticket/kontext:** Přidání `OsmaOnlineMatch` a `OsmaOnlineMatchEvent` modelů

---

## Co se stalo

Při přidávání persistence online zápasů byly dvě nové tabulky vytvořeny přímým SQL (pomocí `docker exec ... psql`), protože lokální prostředí nemá přístup k produkční PostgreSQL:

```bash
docker exec project-hub-postgres psql -U project_hub_user -d project_hub -c "CREATE TABLE ..."
```

Tabulky vznikly správně a funkčně odpovídají `schema.prisma`. Ale:

- `_prisma_migrations` tabulka neexistovala (nikdy nebylo použito `prisma migrate`)
- Prisma nevědělo, že tyto tabulky jsou "managed"
- Při budoucím `prisma migrate deploy` by Prisma chtělo spustit migraci, která by selhala (tabulky již existují)

---

## Nesoulad před reconciliací

| Zdroj | Stav |
|---|---|
| `schema.prisma` | obsahoval všechny 3 tabulky |
| Produkční DB | tabulky fyzicky existovaly |
| `_prisma_migrations` | tabulka neexistovala vůbec |

---

## Postup reconciliace (bezpečný, bez destruktivních kroků)

### 1. Vytvoření migration souboru

Protože `prisma migrate dev --create-only` vyžaduje přístup k DB, byl soubor vytvořen ručně:

```
prisma/migrations/20260617000000_add_osma_online_match_events/migration.sql
```

SQL v souboru odpovídá **celé** aktuální DB (všechny 3 tabulky), protože `_prisma_migrations` dosud neexistoval.

SQL byl ověřen oproti `\d "OsmaMatchResult"`, `\d "OsmaOnlineMatch"`, `\d "OsmaOnlineMatchEvent"` — struktura odpovídá.

### 2. Označení migrace jako již aplikované

```bash
docker compose exec project-hub-api node_modules/.bin/prisma migrate resolve \
  --applied 20260617000000_add_osma_online_match_events
```

Tím Prisma:
- Vytvořilo tabulku `_prisma_migrations`
- Zaznamenalo migraci jako `applied`
- Nespustilo žádný SQL (žádná destruktivní změna)

### 3. Ověření stavu

```
Database schema is up to date!
```

---

## Co NEBYLO použito

- `prisma migrate reset` ← zakázáno
- `prisma migrate dev` (bez `--create-only`) ← zakázáno na produkci
- `docker compose down -v` ← zakázáno
- DROP TABLE / TRUNCATE / DROP DATABASE ← zakázáno
- Žádné mazání dat

---

## Název migrace

```
20260617000000_add_osma_online_match_events
```

---

## Výsledek `prisma migrate status` po reconciliaci

```
1 migration found in prisma/migrations
Database schema is up to date!
```

---

## Doporučení pro budoucí změny schématu

Nové modely přidávej vždy přes Prisma migrate workflow, ne přímým SQL:

```bash
# 1. Uprav schema.prisma lokálně
# 2. Vytvoř migration file (bez přístupu k produkci):
DATABASE_URL="postgresql://..." npx prisma migrate dev --name new_feature --create-only
# 3. Zkontroluj vygenerovaný SQL v prisma/migrations/
# 4. Commitni a pushni
# 5. Na serveru aplikuj:
docker compose exec project-hub-api node_modules/.bin/prisma migrate deploy
```

Pro lokální development bez produkční DB: nastav `.env` s lokální databází nebo použij Docker.

---

## Varování: `docker compose down -v` je destruktivní

```
NIKDY nespouštěj: docker compose down -v
```

Příznak `-v` smaže všechny Docker volumes, včetně `project_hub_postgres_data` — tím by zanikla celá databáze (zálohy jsou na `/opt/backups/project-hub/daily/`).
