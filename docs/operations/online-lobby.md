# Online Lobby — provozní poznámky

## Architektura (MVP)

Aktivní hry jsou uloženy **pouze v RAM** (Node.js `Map`). Po restartu kontejneru zmizí.
Toto je záměr MVP — DB se pro lobby nepoužívá.

## Endpointy

```
POST /api/osma-liga/online-games          — vytvoří novou hru, vrátí hostToken
GET  /api/osma-liga/online-games          — seznam her (bez tokenů), ?limit=10
GET  /api/osma-liga/online-games/:code    — detail hry (bez tokenů)
POST /api/osma-liga/online-games/:code/join — připojí guest hráče, vrátí guestToken
```

Všechny endpointy vyžadují `X-Project-Hub-Key` hlavičku (stejný klíč jako zbytek API).

## TTL

Místnosti expirují po **30 minutách** od vytvoření. Cleanup probíhá lazy (při každém čtení/zápisu).

## Chybové stavy

- Neexistující nebo expirovaný kód → `404 {"error":"Online game not found"}`
- Třetí hráč (místnost je plná) → `409 {"error":"Game is full"}`

## Tokeny

- `hostToken` — vrácen při vytvoření hry, uložen v sessionStorage klienta
- `guestToken` — vrácen při join, uložen v sessionStorage klienta
- Tokeny jsou náhodné 32-znakové hex stringy
- API je **nevaliduje** — klient si je uchovává jen pro budoucí použití (WebSocket autentizace)

## Bezpečnost

- `PROJECT_HUB_API_KEY` zůstává server-side (Next.js API routes)
- Client volá `/api/online-games` (lokální Next.js proxy), nikdy Hub API přímo

## Restartování

Po restartu `project-hub-api` kontejneru zmizí všechny aktivní lobby místnosti.
Hráči musí vytvořit novou hru. Toto je přijatelné pro MVP.

## Plánovaný další krok

- WebSocket gameplay — přenos pohybu, stavů hry v reálném čase
- Perzistence místností v DB (pokud bude potřeba delší TTL nebo přežití restartů)
