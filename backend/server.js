require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const pool = require("./db");

const app = express();

app.use(express.json());

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
    origin: allowedOrigins
  })
);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Market Watchlist API is running"
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

    res.status(500).json({
      success: false,
      database: "disconnected"
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required"
      });
    }

    const userResult = await pool.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );

    let user;

    if (userResult.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(password, 10);

      const insertResult = await pool.query(
        `INSERT INTO users (username, password)
         VALUES ($1, $2)
         RETURNING id, username`,
        [username, hashedPassword]
      );

      user = insertResult.rows[0];
    } else {
      user = userResult.rows[0];

      const validPassword = await bcrypt.compare(
        password,
        user.password
      );

      if (!validPassword) {
        return res.status(401).json({
          success: false,
          message: "Invalid username or password"
        });
      }
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
});

app.get("/api/watchlist/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    const result = await pool.query(
      `SELECT *
       FROM watchlist
       WHERE user_id = $1
       ORDER BY id DESC`,
      [userId]
    );

    res.json({
      success: true,
      watchlist: result.rows
    });
  } catch (error) {
    console.error("GET WATCHLIST ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not fetch watchlist"
    });
  }
});

app.post("/api/watchlist", async (req, res) => {
  try {
    const {
      user_id,
      symbol,
      company_name,
      price,
      change,
      change_percent
    } = req.body;

    if (!user_id || !symbol) {
      return res.status(400).json({
        success: false,
        message: "User ID and symbol are required"
      });
    }

    const existing = await pool.query(
      `SELECT *
       FROM watchlist
       WHERE user_id = $1 AND symbol = $2`,
      [user_id, symbol]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Stock already exists in watchlist"
      });
    }

    const result = await pool.query(
      `INSERT INTO watchlist
       (user_id, symbol, company_name, price, change, change_percent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        user_id,
        symbol,
        company_name || symbol,
        price || 0,
        change || 0,
        change_percent || 0
      ]
    );

    res.json({
      success: true,
      stock: result.rows[0]
    });
  } catch (error) {
    console.error("ADD WATCHLIST ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not add stock"
    });
  }
});

app.delete("/api/watchlist/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    await pool.query(
      "DELETE FROM watchlist WHERE id = $1",
      [id]
    );

    res.json({
      success: true,
      message: "Stock removed"
    });
  } catch (error) {
    console.error("DELETE WATCHLIST ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not remove stock"
    });
  }
});

app.put("/api/watchlist/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const {
      price,
      change,
      change_percent
    } = req.body;

    const result = await pool.query(
      `UPDATE watchlist
       SET price = $1,
           change = $2,
           change_percent = $3
       WHERE id = $4
       RETURNING *`,
      [
        price || 0,
        change || 0,
        change_percent || 0,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Stock not found"
      });
    }

    res.json({
      success: true,
      stock: result.rows[0]
    });
  } catch (error) {
    console.error("UPDATE WATCHLIST ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not update stock"
    });
  }
});

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

    const encodedSymbol = encodeURIComponent(yahooSymbol);

    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - 172800;

    const urls = [
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`,
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?period1=${period1}&period2=${period2}&interval=1d&events=history&includeAdjustedClose=true`
    ];

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      "Accept": "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://finance.yahoo.com/"
    };

    let json = null;
    let lastStatus = null;

    for (const url of urls) {
      try {
        const controller = new AbortController();

        const timeout = setTimeout(() => {
          controller.abort();
        }, 10000);

        let response;

        try {
          response = await fetch(url, {
            method: "GET",
            headers,
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeout);
        }

        lastStatus = response.status;

        if (!response.ok) {
          continue;
        }

        const data = await response.json();

        if (data?.chart?.result?.[0]) {
          json = data;
          break;
        }
      } catch (error) {
        console.error(
          "Yahoo request failed:",
          error.message
        );
      }
    }

    if (!json) {
      console.error(
        `Yahoo Finance failed for ${yahooSymbol}. Last status: ${lastStatus}`
      );

      return res.status(503).json({
        success: false,
        message: `Yahoo Finance is temporarily unavailable for ${symbol}`
      });
    }

    const result = json.chart.result[0];

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
        message: `Could not get price for ${symbol}`
      });
    }

    const change = price - previousClose;

    const changePercent =
      previousClose !== 0
        ? (change / previousClose) * 100
        : 0;

    res.json({
      success: true,
      symbol,
      price,
      previousClose,
      change,
      changePercent,
      currency: meta.currency || "INR",
      exchange: meta.exchangeName || "NSE",
      marketState: meta.marketState || "UNKNOWN",
      source: "Yahoo Finance",
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(
      "MARKET DATA ERROR:",
      error
    );

    res.status(503).json({
      success: false,
      message: "Market data is temporarily unavailable"
    });
  }
});

app.get("/api/snapshots/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    const result = await pool.query(
      `SELECT *
       FROM snapshots
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      snapshots: result.rows
    });
  } catch (error) {
    console.error("GET SNAPSHOTS ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not fetch snapshots"
    });
  }
});

app.post("/api/snapshots", async (req, res) => {
  try {
    const {
      user_id,
      total_value,
      total_change,
      total_change_percent
    } = req.body;

    const result = await pool.query(
      `INSERT INTO snapshots
       (user_id, total_value, total_change, total_change_percent)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        user_id,
        total_value || 0,
        total_change || 0,
        total_change_percent || 0
      ]
    );

    res.json({
      success: true,
      snapshot: result.rows[0]
    });
  } catch (error) {
    console.error("CREATE SNAPSHOT ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not create snapshot"
    });
  }
});

app.delete("/api/snapshots/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    await pool.query(
      "DELETE FROM snapshots WHERE id = $1",
      [id]
    );

    res.json({
      success: true,
      message: "Snapshot deleted"
    });
  } catch (error) {
    console.error("DELETE SNAPSHOT ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Could not delete snapshot"
    });
  }
});

const PORT = process.env.PORT || 5000;

const server = app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Server running on port ${PORT}`
    );
  }
);

server.on("error", (error) => {
  console.error(
    "SERVER ERROR:",
    error
  );
});
