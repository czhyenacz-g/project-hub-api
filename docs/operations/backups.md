# Project Hub PostgreSQL — zálohy

## Architektura

PostgreSQL databáze `project_hub` běží v Docker kontejneru `project-hub-postgres` na Hetzner VPS (178.104.20.225). Data jsou uložena ve volume `project_hub_postgres_data`.

```
/opt/project-hub-api/          ← projekt (docker-compose, kód)
/opt/backups/project-hub/
  daily/                       ← komprimované .sql.gz zálohy
  logs/
    backup.log                 ← výstup backup skriptu
    cron.log                   ← výstup z cronu
```

## Ruční spuštění backup

```bash
ssh root@178.104.20.225
/opt/project-hub-api/scripts/backup-project-hub-db.sh
```

## Kontrola poslední zálohy

```bash
# Seznam záloh
ls -lh /opt/backups/project-hub/daily

# Log posledního běhu
tail -n 20 /opt/backups/project-hub/logs/backup.log

# Ověření integrity souboru (nahraď názvem posledního .sql.gz)
gzip -t /opt/backups/project-hub/daily/<file>.sql.gz && echo "OK"
```

## Cron

Denní backup v 03:17 (nezasahuje do 03:00 backup zdravotniterapie na stejném serveru):

```
17 3 * * * /opt/project-hub-api/scripts/backup-project-hub-db.sh >> /opt/backups/project-hub/logs/cron.log 2>&1
```

Zobrazit aktuální crontab:

```bash
crontab -l
```

## Rotace

Skript automaticky maže zálohy starší než **14 dní** ze složky `daily/`.
Nemaže nic jiného — Docker volumes ani databáze se nedotýká.

## Bezpečnostní varování

> **`docker compose down -v` maže Docker volumes včetně DB dat.**
> Tento příkaz NESMÍ být spuštěn bez vědomého rozhodnutí.
> Zálohy vol chránit pouze před chybou v datech, ne před smazáním volume.

> **Lokální záloha na stejném VPS nechrání před ztrátou celého serveru.**
> Pokud VPS shoří, zálohy jsou pryč spolu s daty.

## Další doporučený krok: off-server zálohy

Pro skutečnou ochranu přidat kopii mimo VPS, například:

- **Hetzner Storage Box** — síťový storage od stejného providera
- **Backblaze B2** — levný S3-kompatibilní object storage
- **Rclone** — univerzální nástroj pro kopírování na remote storage

Příklad rozšíření backup skriptu o rclone (jen návrh, vyžaduje konfiguraci):

```bash
rclone copy "$BACKUP_FILE" b2:muj-bucket/project-hub/
```

## Parametry backup skriptu

Skript: `/opt/project-hub-api/scripts/backup-project-hub-db.sh`

| Proměnná | Hodnota |
|---|---|
| `POSTGRES_CONTAINER` | `project-hub-postgres` |
| `POSTGRES_USER` | `project_hub_user` |
| `POSTGRES_DB` | `project_hub` |
| `BACKUP_DIR` | `/opt/backups/project-hub/daily` |
| `LOG_FILE` | `/opt/backups/project-hub/logs/backup.log` |
| `RETENTION_DAYS` | `14` |
