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
      "User-Agent": "DPE-NCAA-MCP/1.0"
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

function createServer() {
  const server = new McpServer({
    name: "DPE NCAA Football",
    version: "1.0.0"
  });

  server.tool(
    "get_scoreboard",
    "Get NCAA football games from the NCAA scoreboard for a year, month, and day.",
    {
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      day: z.number().int().min(1).max(31)
    },
    async ({ year, month, day }) => {
      const data = await ncaaFetch(
        `/scoreboard/football/fbs/${year}/${month}/${day}`
      );
      return result(data);
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
    "Get NCAA FBS individual player statistics for a season and stat category.",
    {
      year: z.number().int(),
      category: z.string()
    },
    async ({ year, category }) => {
      const data = await ncaaFetch(
        `/stats/football/fbs/current/individual/${category}?year=${year}`
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
