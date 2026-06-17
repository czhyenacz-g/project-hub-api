# Online multiplayer

## WebSocket
- Socket.IO na `https://api.osmaliga.cz` (path: `/socket.io/`)
- Aktivní hry jsou v RAM — po restartu serveru zmizí
- Server je autorita — klient posílá jen input, server počítá fyziku

## Tick rate & snapshot rate

| Parametr | Hodnota |
|---|---|
| Server tick interval | 33 ms (~30 ticks/s) |
| dt per tick | 0.033 s |
| Snapshot každých N ticků | 2 |
| Efektivní snapshot rate | ~15 snapshotů/s |
| Client input send rate | ~30 Hz (33 ms) |
| Client render | RAF s lerp (LERP=0.3) |

Klient interpoluje pozice hráčů a míče pomocí lerp v každém RAF framu
pro vizuální plynulost mezi snapshoty. Skóre, čas a hlášky se berou
přímo z posledního snapshotu (bez lerp).

MVP — bez client prediction, rollbacku ani bufferu.

## Eventy client→server
- `join_game` `{ gameCode, playerToken }`
- `start_game` (jen hostitel)
- `input` `{ up, down, left, right, kick }`

## Eventy server→client
- `joined_game` `{ role, status }`
- `game_started`
- `state` snapshot každých ~67ms (každé 2 ticky při 30 tick/s)
- `game_finished` `{ score }`
- `error` `{ message }`

## Výsledky
Online výsledky se zatím neukládají do DB.
Další krok: WebSocket reconnect, uložení výsledku přes match-results API.
