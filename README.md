# project-hub-api

Backend API vrstva mezi Vercel frontendem a PostgreSQL databází. Aktuálně slouží jako API pro Osmou ligu (osmaliga.cz) — ukládá výsledky zápasů.

Stack: Fastify 5 + Prisma 6 + PostgreSQL 17, běží v Dockeru na Hetzner VPS.

---

## Lokální spuštění

### Prerekvizity
- Node.js 22+
- Docker + Docker Compose

### Kroky

```bash
# 1. Nainstaluj závislosti
npm install

# 2. Zkopíruj env
cp .env.example .env
# Uprav .env — nastav DATABASE_URL a PROJECT_HUB_API_KEY

# 3. Spusť databázi
docker compose up project-hub-postgres -d

# 4. Spusť migrace
npm run db:push

# 5. Spusť API v dev módu
npm run dev
# → http://localhost:3001
```

---

## Env proměnné

| Proměnná | Popis | Příklad |
|---|---|---|
| `NODE_ENV` | Prostředí | `development` / `production` |
| `PORT` | Port pro API | `3001` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `PROJECT_HUB_API_KEY` | API klíč pro autentizaci | min. 32 znaků random hex |
| `POSTGRES_PASSWORD` | Heslo pro Postgres (jen docker-compose) | random hex |
| `CORS_ORIGINS` | Povolené CORS origins (čárkou oddělené) | `https://osmaliga.cz` |

---

## Migrace databáze

```bash
# První nasazení / dev — jen pushne schéma
npm run db:push

# Produkce — spusť uvnitř kontejneru
docker compose exec project-hub-api npx prisma migrate deploy

# Vygeneruj Prisma klienta po změně schématu
npm run db:generate
```

---

## Healthcheck

```bash
curl http://localhost:3001/health
# {"ok":true,"service":"project-hub-api"}
```

---

## API endpointy

Všechny endpointy vyžadují hlavičku `x-project-hub-key: <API_KEY>`.

### POST /api/osma-liga/match-results

Uloží výsledek zápasu.

```bash
curl -X POST http://localhost:3001/api/osma-liga/match-results \
  -H "Content-Type: application/json" \
  -H "x-project-hub-key: YOUR_API_KEY" \
  -d '{"homeScore": 3, "awayScore": 1, "durationSeconds": 120}'
```

Odpověď (201):
```json
{
  "id": "cuid...",
  "homeTeamSlug": "nahoda-fc",
  "homeScore": 3,
  "awayScore": 1,
  ...
}
```

### GET /api/osma-liga/match-results?limit=5

Vrátí posledních N výsledků (max 20, default 5).

```bash
curl "http://localhost:3001/api/osma-liga/match-results?limit=3" \
  -H "x-project-hub-key: YOUR_API_KEY"
```

---

## Deployment na Hetzner

### Prerekvizity na VPS
- Docker + Docker Compose plugin
- Nginx jako reverse proxy (běží)
- Port 3001 dostupný pouze na localhost (nginx forwarduje)

### Kroky

```bash
# 1. Naklonuj repo na VPS
ssh root@178.104.20.225
git clone https://github.com/czhyenacz-g/project-hub-api /opt/project-hub-api
cd /opt/project-hub-api

# 2. Vytvoř .env s náhodnými hodnotami
cat > .env << 'EOF'
NODE_ENV=production
PORT=3001
POSTGRES_PASSWORD=$(openssl rand -hex 32)
PROJECT_HUB_API_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://osmaliga.cz,https://www.osmaliga.cz
EOF

# 3. Spusť kontejnery
docker compose up -d --build

# 4. Spusť migrace
docker compose exec project-hub-api npx prisma db push

# 5. Ověř healthcheck
curl http://127.0.0.1:3001/health
```

---

## DNS nastavení api.osmaliga.cz

Přidej A záznam na DNS poskytovatele:
```
api.osmaliga.cz.  A  178.104.20.225
```

TTL: 300 (5 minut) pro první nasazení, pak zvyš.

---

## Nginx / HTTPS

Na VPS běží Nginx. Přidej do `/etc/nginx/sites-available/api.osmaliga.cz`:

```nginx
server {
    listen 80;
    server_name api.osmaliga.cz;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/api.osmaliga.cz /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# HTTPS přes certbot
certbot --nginx -d api.osmaliga.cz
```

---

## BEZPECNOSTNI VAROVANI

**`docker compose down -v` MAZE DATABAZOVA DATA.**

Tento příkaz nikdy nepoužívej bez vědomého rozhodnutí a zálohy dat. Při restartu služeb používej:
```bash
docker compose restart         # restart kontejnerů
docker compose up -d --build   # rebuild a restart
```

PostgreSQL kontejner `project-hub-postgres` je dostupný POUZE uvnitř Docker sítě `project-hub-net`. Není exponovaný do internetu.

---

## Plánované budoucí kroky

- [ ] Migrace místo db:push (pro produkci)
- [ ] Rate limiting per API key
- [ ] Více modulů / projektů (rozšíření project-hub)
- [ ] Structured logging (JSON logy pro log aggregator)
- [ ] Health endpoint s DB ping
- [ ] CI/CD (GitHub Actions → deploy na Hetzner)
