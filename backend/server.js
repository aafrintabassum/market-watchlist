const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://market-watchlistt.netlify.app",
    ],
  })
);

app.use(express.json());


// ==============================
// HEALTH CHECK
// ==============================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Market Watchlist backend is running",
  });
});


// ==============================
// LOGIN
// ==============================

app.post("/api/auth/login", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid name",
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
        user: existingUser.rows[0],
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
      user: createdUser.rows[0],
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not log in",
    });
  }
});


// ==============================
// GET WATCHLIST
// ==============================

app.get("/api/watchlist/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
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

    res.json({
      success: true,
      watchlist: result.rows,
    });
  } catch (error) {
    console.error("WATCHLIST FETCH ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not load watchlist",
    });
  }
});


// ==============================
// ADD STOCK
// ==============================

app.post("/api/watchlist/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    const symbol = String(req.body.symbol || "")
      .trim()
      .toUpperCase();

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: "Stock symbol is required",
      });
    }

    if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) {
      return res.status(400).json({
        success: false,
        message: "Invalid stock symbol",
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
        message: "User not found",
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
        message: `${symbol} is already in your watchlist`,
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

    res.status(201).json({
      success: true,
      watchlist: result.rows[0],
    });
  } catch (error) {
    console.error("ADD STOCK ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not add stock",
    });
  }
});


// ==============================
// REMOVE STOCK
// ==============================

app.delete("/api/watchlist/:userId/:symbol", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    const symbol = String(req.params.symbol || "")
      .trim()
      .toUpperCase();

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: "Stock symbol is required",
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
        message: "Stock not found",
      });
    }

    res.json({
      success: true,
      message: `${symbol} removed`,
    });
  } catch (error) {
    console.error("REMOVE STOCK ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not remove stock",
    });
  }
});


// ==============================
// MARKET DATA
// ==============================

app.get("/api/market/:symbol", async (req, res) => {
  try {
    const symbol = String(req.params.symbol || "")
      .trim()
      .toUpperCase();

    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: "Stock symbol is required",
      });
    }

    if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) {
      return res.status(400).json({
        success: false,
        message: "Invalid stock symbol",
      });
    }

    const yahooSymbol = symbol.includes(".")
      ? symbol
      : `${symbol}.NS`;

    const yahooUrls = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        yahooSymbol
      )}?range=2d&interval=1d`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        yahooSymbol
      )}?range=2d&interval=1d`,
    ];

    let response = null;

    for (const url of yahooUrls) {
      const controller = new AbortController();

      const timeout = setTimeout(() => {
        controller.abort();
      }, 15000);

      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
            Accept: "application/json,text/plain,*/*",
          },
        });

        if (response.ok) {
          break;
        }

        console.error(
          `Yahoo request failed: ${response.status} ${response.statusText}`
        );
      } catch (error) {
        console.error("Yahoo request error:", error.message);
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!response || !response.ok) {
      return res.status(503).json({
        success: false,
        message: `Market data temporarily unavailable for ${symbol}`,
      });
    }

    const json = await response.json();

    const result = json?.chart?.result?.[0];

    if (!result) {
      return res.status(404).json({
        success: false,
        message: `No market data available for ${symbol}`,
      });
    }

    const meta = result.meta || {};

    const price = Number(
      meta.regularMarketPrice ??
        meta.chartPreviousClose
    );

    const previousClose = Number(
      meta.previousClose ??
        meta.chartPreviousClose ??
        price
    );

    if (!Number.isFinite(price)) {
      return res.status(404).json({
        success: false,
        message: `Could not get price for ${symbol}`,
      });
    }

    res.json({
      success: true,
      symbol,
      price,
      previousClose,
      currency: meta.currency || "INR",
      exchange: meta.exchangeName || "NSE",
      marketState: meta.marketState || "UNKNOWN",
      source: "Yahoo Finance",
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("MARKET DATA ERROR:", error);

    res.status(503).json({
      success: false,
      message: "Market data is temporarily unavailable",
    });
  }
});


// ==============================
// SAVE MARKET SNAPSHOT
// ==============================

app.post("/api/snapshots/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    const symbol = String(req.body.symbol || "")
      .trim()
      .toUpperCase();

    const price = Number(req.body.price);

    const previousClose = Number(
      req.body.previousClose
    );

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    if (!symbol || !Number.isFinite(price)) {
      return res.status(400).json({
        success: false,
        message: "Invalid snapshot data",
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
          : null,
      ]
    );

    res.status(201).json({
      success: true,
      snapshot: result.rows[0],
    });
  } catch (error) {
    console.error("SNAPSHOT SAVE ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not save market snapshot",
    });
  }
});


// ==============================
// GET PREVIOUS SNAPSHOT
// ==============================

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
          message: "Invalid user ID",
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

      res.json({
        success: true,
        previous:
          result.rows.length > 0
            ? result.rows[0]
            : null,
      });
    } catch (error) {
      console.error(
        "PREVIOUS SNAPSHOT ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Could not get previous snapshot",
      });
    }
  }
);


// ==============================
// START SERVER
// ==============================

const server = app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log("======================================");
    console.log("Market Watchlist Backend");
    console.log(`Running on port ${PORT}`);
    console.log("======================================");
    console.log("");
  }
);

server.on("error", (error) => {
  console.error("SERVER ERROR:", error);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("UNHANDLED REJECTION:", error);
});