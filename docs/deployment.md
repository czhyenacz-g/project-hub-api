# Deployment guide — Hetzner VPS

## Prerekvizity

### Instalace Dockeru na VPS (jednou)
```bash
ssh root@178.104.20.225
apt update && apt install -y docker.io docker-compose-plugin
systemctl enable --now docker
docker --version
docker compose version
```

## První nasazení

```bash
# 1. Naklonuj repo
git clone https://github.com/czhyenacz-g/project-hub-api /opt/project-hub-api
cd /opt/project-hub-api

# 2. Vytvoř .env
cat > .env << ENVEOF
NODE_ENV=production
PORT=3001
POSTGRES_PASSWORD=$(openssl rand -hex 32)
PROJECT_HUB_API_KEY=$(openssl rand -hex 32)
CORS_ORIGINS=https://osmaliga.cz,https://www.osmaliga.cz
ENVEOF

# Zkopíruj si API key — budeš ho potřebovat ve Vercel env vars
grep PROJECT_HUB_API_KEY .env

# 3. Spusť kontejnery
docker compose up -d --build

# 4. Spusť migrace / schéma
docker compose exec project-hub-api npx prisma db push

# 5. Ověř
curl http://127.0.0.1:3001/health
```

## Nginx konfigurace

```bash
# Záloha
cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.backup-$(date +%Y%m%d)

# Vytvoř nový site
cat > /etc/nginx/sites-available/api.osmaliga.cz << 'NGINXEOF'
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
NGINXEOF

ln -s /etc/nginx/sites-available/api.osmaliga.cz /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# HTTPS
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.osmaliga.cz
```

## Aktualizace po push do main

```bash
cd /opt/project-hub-api
git pull
docker compose up -d --build
```

## Logy

```bash
docker compose logs -f project-hub-api
docker compose logs -f project-hub-postgres
```

## Restart bez smazání dat

```bash
docker compose restart
# nebo
docker compose up -d --build
```

## BEZPECNOSTNI VAROVANI

NIKDY nepouzivej `docker compose down -v` — smaze databazova data nenávratně.
