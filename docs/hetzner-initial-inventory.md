# Hetzner VPS — Initial Inventory

Datum: 2026-06-17

## Server

| Položka | Hodnota |
|---|---|
| Hostname | ubuntu-4gb-nbg1-1-zasobovani-plus |
| OS | Ubuntu 24.04.4 LTS (Noble) |
| Veřejná IP | 178.104.20.225 |
| RAM | 3.7 GiB total, ~1.1 GiB used, ~2.6 GiB available |
| Disk | 38 GiB total, 5.7 GiB used, 31 GiB volné (16%) |

## Docker

Docker **NENÍ nainstalován** (`docker: command not found`).

Nutno nainstalovat před deploymentem:
```bash
apt update && apt install -y docker.io docker-compose-plugin
systemctl enable --now docker
```

## Existující Docker volumes

Žádné — Docker není nainstalován.

## Existující Docker kontejnery

Žádné — Docker není nainstalován.

## Konflikty názvů

**Žádné konflikty** — kontejnery `project-hub-api`, `project-hub-postgres`, volume `project_hub_postgres_data` a síť `project-hub-net` jsou všechny volné.

## Běžící služby (porty)

| Port | Služba | Poznámka |
|---|---|---|
| 22 | sshd | SSH přístup |
| 80 | nginx | HTTP |
| 443 | nginx | HTTPS |
| 3306 | mysqld | MySQL (jen localhost) |
| 33060 | mysqld | MySQL X Protocol (jen localhost) |

## Nginx

- Stav: **active (running)**
- Spuštěn: Thu 2026-06-11 06:06:53 UTC
- Konfiguraci je třeba doplnit o blok pro `api.osmaliga.cz → 127.0.0.1:3001`

## Caddy

**Není nainstalován.** Nginx se používá jako reverse proxy.

## MySQL

Běží na `127.0.0.1:3306` (jen localhost) — **nedotýkat se**.

## PostgreSQL (systemd)

**Není nainstalován** jako systemd service. Bude běžet jako Docker kontejner `project-hub-postgres` v izolované síti.

## /opt adresář

Prázdný — pouze `.` a `..`. `/opt/project-hub-api` neexistuje.

## DNS api.osmaliga.cz

Při inventuře nebyl `dig` dostupný. DNS záznam je třeba ověřit a nastavit A záznam na `178.104.20.225`.

## Bezpečnostní hodnocení

- PostgreSQL nebude exponován do internetu (pouze Docker interní síť `project-hub-net`)
- Nginx bude forwardovat HTTPS → localhost:3001
- Port 3001 bude vázán pouze na `127.0.0.1` (docker-compose.yml: `127.0.0.1:3001:3001`)
- MySQL je neovlivněný — jiný port, jiný kontejner, jiná databáze

## Závěr

Deployment je bezpečný. Žádné konflikty. Nutno nejprve nainstalovat Docker.
