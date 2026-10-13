# DPE NCAA Football MCP

Independent read-only MCP hosted on Railway. Primary upstream: `https://ncaa-api.henrygd.me`.

## NCAA football scoreboard safety

Football scoreboard URLs use **season/week**, not calendar year/month/day.
The MCP's `get_scoreboard(year, month, day)` resolves a bounded set of nearby
football weeks, then returns **only** rows whose `game.startDate` equals the
requested calendar date. If a matching date cannot be located, it errors
instead of reporting an empty day's player statistics as a valid zero.
The bulk `get_date_player_stats` uses this same validated discovery.

The lookup makes at most five scoreboard GETs (often one or two). Per-game
boxscore fetching begins only once exact-date discovery has succeeded.
Public API traffic is subject to rate limits. No CFBD or Big Balls keys used.

## Useful MCP tools

- `get_scoreboard`: validated date-limited FBS game discovery
- `get_date_player_stats`: all player-stat rows for a validated FBS scoreboard date
- `get_game_boxscore`: one game by confirmed NCAA game ID
- `get_game_team_stats`: one game's NCAA team stats
- `get_play_by_play`: one game's NCAA play-by-play

Validate ESPN/NCAA game identity (teams, date, result) before attributing
statistics to QUARK. This repo is a separate service from Borg-DPE.
