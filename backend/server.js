require("dotenv").config();

const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

/* =========================
   CORS
========================= */

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://market-watchlist-3j9e.onrender.com"
];

if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(express.json());

/* =========================
   DATABASE INITIALIZATION
========================= */

async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS watchlist_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        UNIQUE(user_id, symbol)
      );

      CREATE TABLE IF NOT EXISTS "market snapshot" (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        price NUMERIC,
        previous_close NUMERIC,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("DATABASE TABLES READY");
  } catch (error) {
    console.error("DATABASE INITIALIZATION ERROR:", error);
    throw error;
  }
}

/* =========================
   BASIC ROUTES
========================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Market Watchlist backend is running"
  });
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      database: "connected"
    });
  } catch (error) {
    console.error("HEALTH ERROR:", error);

    res.status(503).json({
      success: false,
      database: "disconnected"
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/auth/login", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required"
      });
    }

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid name"
      });
    }

    const existingUser = await pool.query(
      `
      SELECT id, name
      FROM users
      WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
      ORDER BY id ASC
      LIMIT 1
      `,
      [name]
    );

    if (existingUser.rows.length > 0) {
      return res.json({
        success: true,
        message: "Login successful",
        user: existingUser.rows[0]
      });
    }

    const createdUser = await pool.query(
      `
      INSERT INTO users (name)
      VALUES ($1)
      RETURNING id, name
      `,
      [name]
    );

    return res.status(201).json({
      success: true,
      message: "Account created",
      user: createdUser.rows[0]
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not log in"
    });
  }
});

/* =========================
   WATCHLIST - GET
========================= */

app.get("/api/watchlist/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    const result = await pool.query(
      `
      SELECT id, user_id, symbol
      FROM watchlist_items
      WHERE user_id = $1
      ORDER BY id ASC
      `,
      [userId]
    );

    return res.json({
      success: true,
      watchlist: result.rows
    });
  } catch (error) {
    console.error("WATCHLIST FETCH ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not load watchlist"
    });
  }
});

/* =========================
   WATCHLIST - ADD
========================= */

app.post("/api/watchlist/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    const symbol = String(req.body.symbol || "")
      .trim()
      .toUpperCase();

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: "Stock symbol is required"
      });
    }

    if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) {
      return res.status(400).json({
        success: false,
        message: "Invalid stock symbol"
      });
    }

    const userResult = await pool.query(
      `
      SELECT id
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const existing = await pool.query(
      `
      SELECT id, user_id, symbol
      FROM watchlist_items
      WHERE user_id = $1
        AND UPPER(symbol) = UPPER($2)
      LIMIT 1
      `,
      [userId, symbol]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `${symbol} is already in your watchlist`
      });
    }

    const result = await pool.query(
      `
      INSERT INTO watchlist_items (user_id, symbol)
      VALUES ($1, $2)
      RETURNING id, user_id, symbol
      `,
      [userId, symbol]
    );

    return res.status(201).json({
      success: true,
      watchlist: result.rows[0]
    });
  } catch (error) {
    console.error("ADD STOCK ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not add stock"
    });
  }
});

/* =========================
   WATCHLIST - DELETE
========================= */

app.delete("/api/watchlist/:userId/:symbol", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    const symbol = String(req.params.symbol || "")
      .trim()
      .toUpperCase();

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: "Stock symbol is required"
      });
    }

    const result = await pool.query(
      `
      DELETE FROM watchlist_items
      WHERE user_id = $1
        AND UPPER(symbol) = UPPER($2)
      RETURNING id, user_id, symbol
      `,
      [userId, symbol]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Stock not found"
      });
    }

    return res.json({
      success: true,
      message: `${symbol} removed`
    });
  } catch (error) {
    console.error("REMOVE STOCK ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not remove stock"
    });
  }
});

/* =========================
   MARKET DATA - YAHOO FINANCE
========================= */

app.get("/api/market/:symbol", async (req, res) => {
  try {
    const symbol = String(req.params.symbol || "")
      .trim()
      .toUpperCase();

    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: "Stock symbol is required"
      });
    }

    if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) {
      return res.status(400).json({
        success: false,
        message: "Invalid stock symbol"
      });
    }

    const yahooSymbol = symbol.includes(".")
      ? symbol
      : `${symbol}.NS`;

    const now = Math.floor(Date.now() / 1000);

    const period1 = now - 7 * 24 * 60 * 60;
    const period2 = now + 60 * 60;

    const urls = [
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        yahooSymbol
      )}?period1=${period1}&period2=${period2}&interval=1d&events=history`,

      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        yahooSymbol
      )}?period1=${period1}&period2=${period2}&interval=1d&events=history`
    ];

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://finance.yahoo.com/"
    };

    let yahooResult = null;
    let lastStatus = null;
    let lastYahooError = null;

    for (const url of urls) {
      const controller = new AbortController();

      const timeout = setTimeout(() => {
        controller.abort();
      }, 15000);

      try {
        console.log(`YAHOO REQUEST: ${yahooSymbol}`);

        const response = await fetch(url, {
          method: "GET",
          headers,
          signal: controller.signal
        });

        lastStatus = response.status;

        console.log(
          `YAHOO RESPONSE: ${response.status} ${response.statusText}`
        );

        if (!response.ok) {
          continue;
        }

        const json = await response.json();

        if (json?.chart?.error) {
          console.error(
            "YAHOO CHART ERROR:",
            JSON.stringify(json.chart.error)
          );

          lastYahooError = json.chart.error;
          continue;
        }

        const result = json?.chart?.result?.[0];

        if (!result) {
          console.error(
            `YAHOO EMPTY RESULT FOR ${yahooSymbol}`
          );

          continue;
        }

        yahooResult = result;
        break;
      } catch (error) {
        lastYahooError = error;

        console.error(
          `YAHOO REQUEST ERROR FOR ${yahooSymbol}:`,
          error.message
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!yahooResult) {
      console.error(
        `YAHOO FAILED FOR ${yahooSymbol}. LAST STATUS: ${lastStatus}`,
        lastYahooError?.message ||
          lastYahooError?.description ||
          ""
      );

      return res.status(503).json({
        success: false,
        message: `Yahoo Finance is temporarily unavailable for ${symbol}`
      });
    }

    const meta = yahooResult.meta || {};

    const quote =
      yahooResult?.indicators?.quote?.[0] || {};

    const closes = Array.isArray(quote.close)
      ? quote.close
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      : [];

    let price = Number(meta.regularMarketPrice);

    if (!Number.isFinite(price) && closes.length > 0) {
      price = closes[closes.length - 1];
    }

    let previousClose = Number(meta.previousClose);

    if (!Number.isFinite(previousClose)) {
      previousClose = Number(meta.chartPreviousClose);
    }

    if (!Number.isFinite(previousClose) && closes.length >= 2) {
      previousClose = closes[closes.length - 2];
    }

    if (!Number.isFinite(previousClose)) {
      previousClose = price;
    }

    if (!Number.isFinite(price)) {
      return res.status(503).json({
        success: false,
        message: `Could not determine the current price for ${symbol}`
      });
    }

    const change = price - previousClose;

    const changePercent =
      previousClose !== 0
        ? (change / previousClose) * 100
        : 0;

    return res.json({
      success: true,
      symbol,
      price,
      previousClose,
      change,
      changePercent,
      currency: meta.currency || "INR",
      exchange:
        meta.exchangeName ||
        meta.fullExchangeName ||
        "NSE",
      marketState: meta.marketState || "UNKNOWN",
      source: "Yahoo Finance",
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("MARKET DATA ERROR:", error);

    return res.status(503).json({
      success: false,
      message: "Market data is temporarily unavailable"
    });
  }
});

/* =========================
   SAVE SNAPSHOT
========================= */

app.post("/api/snapshots/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    const symbol = String(req.body.symbol || "")
      .trim()
      .toUpperCase();

    const price = Number(req.body.price);
    const previousClose = Number(req.body.previousClose);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    if (!symbol || !Number.isFinite(price)) {
      return res.status(400).json({
        success: false,
        message: "Invalid snapshot data"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO "market snapshot"
        (user_id, symbol, price, previous_close)
      VALUES
        ($1, $2, $3, $4)
      RETURNING *
      `,
      [
        userId,
        symbol,
        price,
        Number.isFinite(previousClose)
          ? previousClose
          : null
      ]
    );

    return res.status(201).json({
      success: true,
      snapshot: result.rows[0]
    });
  } catch (error) {
    console.error("SNAPSHOT SAVE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not save market snapshot"
    });
  }
});

/* =========================
   GET PREVIOUS SNAPSHOT
========================= */

app.get(
  "/api/snapshots/:userId/:symbol/previous",
  async (req, res) => {
    try {
      const userId = Number(req.params.userId);

      const symbol = String(req.params.symbol || "")
        .trim()
        .toUpperCase();

      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID"
        });
      }

      if (!symbol) {
        return res.status(400).json({
          success: false,
          message: "Stock symbol is required"
        });
      }

      const result = await pool.query(
        `
        SELECT *
        FROM "market snapshot"
        WHERE user_id = $1
          AND UPPER(symbol) = UPPER($2)
        ORDER BY id DESC
        OFFSET 1
        LIMIT 1
        `,
        [userId, symbol]
      );

      return res.json({
        success: true,
        previous:
          result.rows.length > 0
            ? result.rows[0]
            : null
      });
    } catch (error) {
      console.error("PREVIOUS SNAPSHOT ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Could not get previous snapshot"
      });
    }
  }
);

/* =========================
   START SERVER
========================= */

async function startServer() {
  try {
    await initDatabase();

    const server = app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log("");
        console.log("======================================");
        console.log("Market Watchlist Backend");
        console.log(`Running on port ${PORT}`);
        console.log("Yahoo Finance integration enabled");
        console.log("======================================");
        console.log("");
      }
    );

    server.on("error", (error) => {
      console.error("SERVER ERROR:", error);
    });
  } catch (error) {
    console.error("SERVER STARTUP FAILED:", error);
    process.exit(1);
  }
}

/* =========================
   ERROR HANDLERS
========================= */

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("UNHANDLED REJECTION:", error);
});

/* =========================
   RUN SERVER
========================= */

startServer();
