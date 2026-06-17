# Online multiplayer

## WebSocket
- Socket.IO na `https://api.osmaliga.cz` (path: `/socket.io/`)
- Aktivní hry jsou v RAM — po restartu serveru zmizí
- Server je autorita — klient posílá jen input, server počítá fyziku

## Eventy client→server
- `join_game` `{ gameCode, playerToken }`
- `start_game` (jen hostitel)
- `input` `{ up, down, left, right, kick }`

## Eventy server→client
- `joined_game` `{ role, status }`
- `game_started`
- `state` snapshot každých ~67ms (každé 3 ticky při 20 tick/s)
- `game_finished` `{ score }`
- `error` `{ message }`

## Výsledky
Online výsledky se zatím neukládají do DB.
Další krok: WebSocket reconnect, uložení výsledku přes match-results API.
