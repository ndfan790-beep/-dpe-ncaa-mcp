import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.use(express.json());

const NCAA_BASE = "https://ncaa-api.henrygd.me";

async function ncaaFetch(path) {
  const response = await fetch(`${NCAA_BASE}${path}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "DPE-NCAA-MCP/1.1"
    }
  });

  if (!response.ok) {
    throw new Error(
      `NCAA API error ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

function result(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ncaaDate(year, month, day) {
  return `${pad2(month)}/${pad2(day)}/${year}`;
}

async function getFilteredScoreboard(year, month, day) {
  const data = await ncaaFetch(
    `/scoreboard/football/fbs/${year}/${month}/${day}`
  );

  const wanted = ncaaDate(year, month, day);
  const games = Array.isArray(data?.games) ? data.games : [];

  return {
    ...data,
    games: games.filter((row) => row?.game?.startDate === wanted)
  };
}

async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

function flattenPlayerStats(boxscore) {
  const teamLookup = new Map(
    (boxscore?.teams || []).map((team) => [
      String(team.teamId),
      {
        teamId: String(team.teamId),
        team: team.nameShort,
        teamFull: team.nameFull,
        isHome: team.isHome
      }
    ])
  );

  const rows = [];

  for (const teamBox of boxscore?.teamBoxscore || []) {
    const team = teamLookup.get(String(teamBox.teamId)) || {
      teamId: String(teamBox.teamId),
      team: null,
      teamFull: null,
      isHome: null
    };

    for (const stat of teamBox?.playerStats || []) {
      rows.push({
        gameId: String(boxscore.contestId),
        game: boxscore.description,
        ...team,
        firstName: stat.firstName ?? null,
        lastName: stat.lastName ?? null,
        number: stat.number ?? null,
        position: stat.position ?? null,
        category: stat.category ?? null,
        ...stat
      });
    }
  }

  return rows;
}

function createServer() {
  const server = new McpServer({
    name: "DPE NCAA Football",
    version: "1.1.0"
  });

  server.tool(
    "get_scoreboard",
    "Get NCAA FBS football games for an exact calendar date.",
    {
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31)
    },
    async ({ year, month, day }) => {
      const data = await getFilteredScoreboard(year, month, day);
      return result(data);
    }
  );

  server.tool(
    "get_date_player_stats",
    "Get all NCAA player box-score stat rows for every FBS game on an exact calendar date. Includes FBS-vs-FCS games listed on the FBS scoreboard.",
    {
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31)
    },
    async ({ year, month, day }) => {
      const scoreboard = await getFilteredScoreboard(year, month, day);
      const games = (scoreboard.games || []).map((row) => row.game);

      const fetched = await mapWithConcurrency(games, 4, async (game) => {
        try {
          const boxscore = await ncaaFetch(`/game/${game.gameID}/boxscore`);

          return {
            gameId: String(game.gameID),
            date: game.startDate,
            title: game.title,
            home: game.home?.names?.short ?? null,
            away: game.away?.names?.short ?? null,
            homeScore: game.home?.score ?? null,
            awayScore: game.away?.score ?? null,
            status: game.gameState,
            players: flattenPlayerStats(boxscore)
          };
        } catch (error) {
          return {
            gameId: String(game.gameID),
            date: game.startDate,
            title: game.title,
            error: error.message,
            players: []
          };
        }
      });

      return result({
        date: ncaaDate(year, month, day),
        gameCount: games.length,
        games: fetched
      });
    }
  );

  server.tool(
    "get_game_boxscore",
    "Get the NCAA box score for a football game using the NCAA game ID.",
    {
      game_id: z.string()
    },
    async ({ game_id }) => {
      const data = await ncaaFetch(`/game/${game_id}/boxscore`);
      return result(data);
    }
  );

  server.tool(
    "get_play_by_play",
    "Get play-by-play data for an NCAA football game.",
    {
      game_id: z.string()
    },
    async ({ game_id }) => {
      const data = await ncaaFetch(`/game/${game_id}/play-by-play`);
      return result(data);
    }
  );

  server.tool(
    "get_game_team_stats",
    "Get team statistics for an NCAA football game.",
    {
      game_id: z.string()
    },
    async ({ game_id }) => {
      const data = await ncaaFetch(`/game/${game_id}/team-stats`);
      return result(data);
    }
  );

  server.tool(
    "get_season_player_stats",
    "Get NCAA FBS individual player statistics for a season and NCAA stat category ID.",
    {
      year: z.number().int(),
      category: z.string()
    },
    async ({ year, category }) => {
      const data = await ncaaFetch(
        `/stats/football/fbs/${year}/individual/${category}`
      );

      return result(data);
    }
  );

  return server;
}

app.get("/", (req, res) => {
  res.json({
    name: "DPE NCAA Football MCP",
    status: "running",
    version: "1.1.0",
    mcp: "/mcp"
  });
});

app.post("/mcp", async (req, res) => {
  const server = createServer();

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "MCP server error"
      });
    }
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DPE NCAA MCP running on port ${PORT}`);
});
