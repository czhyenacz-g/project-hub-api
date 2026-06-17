# Hetzner VPS — backup inventura

Datum: 2026-06-17

## Server

| Položka | Hodnota |
|---|---|
| Hostname | ubuntu-4gb-nbg1-1-zasobovani-plus |
| IP | 178.104.20.225 |
| OS | Ubuntu 24.04 LTS |
| Disk | 38 GB, 8.3 GB použito (24 %), 28 GB volno |
| RAM | 1.9 GB |

## Docker kontejnery project-hub

| Kontejner | Image | Status |
|---|---|---|
| `project-hub-api` | project-hub-api-project-hub-api | Up, port 127.0.0.1:3001 |
| `project-hub-postgres` | postgres:17-alpine | Up, healthy, bez veřejného portu |

## Docker volumes

| Volume | Poznámka |
|---|---|
| `project_hub_postgres_data` | data PostgreSQL pro project-hub |

## Projekt na serveru

```
/opt/project-hub-api/   ← zdrojové soubory, docker-compose.yml, .env
```

## Stav záloh

`/opt/backups` neexistoval — bude vytvořen při prvním spuštění backup skriptu.

## Crontab (existující záznamy jiných projektů — nedotknuto)

```
* * * * *  cd /var/www/za-sobovani && php artisan schedule:run
* * * * *  cd /var/www/levnemenu-cz && php artisan schedule:run
* * * * *  cd /var/www/zdravotniterapie && php8.4 artisan schedule:run
0 3 * * *  /usr/local/bin/backup-zdravotniterapie.sh
*/5 * * * * /usr/local/bin/uptime-check-zdravotniterapie.sh
```

## Ověřené parametry pro backup

| Parametr | Hodnota |
|---|---|
| Container | `project-hub-postgres` |
| Database | `project_hub` |
| User | `project_hub_user` |
| Backup dir | `/opt/backups/project-hub/daily` |
| Log dir | `/opt/backups/project-hub/logs` |
| Cron čas | 03:17 (nezasahuje do 03:00 backup zdravotniterapie) |
