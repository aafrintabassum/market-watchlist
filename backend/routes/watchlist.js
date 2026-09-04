const express = require("express");
const pool = require("../db");

const router = express.Router();

// Get a user's watchlist
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      "SELECT * FROM watchlist_items WHERE user_id = $1 ORDER BY added_at DESC",
      [userId]
    );

    res.json({
      success: true,
      watchlist: result.rows,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch watchlist",
    });
  }
});

// Add a stock
router.post("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({
        success: false,
        message: "Stock symbol is required",
      });
    }

    const result = await pool.query(
      `INSERT INTO watchlist_items (user_id, symbol)
       VALUES ($1, $2)
       RETURNING *`,
      [userId, symbol.toUpperCase()]
    );

    res.status(201).json({
      success: true,
      item: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to add stock",
    });
  }
});

// Remove a stock
router.delete("/:userId/:symbol", async (req, res) => {
  try {
    const { userId, symbol } = req.params;

    await pool.query(
      "DELETE FROM watchlist_items WHERE user_id = $1 AND symbol = $2",
      [userId, symbol.toUpperCase()]
    );

    res.json({
      success: true,
      message: "Stock removed",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to remove stock",
    });
  }
});

module.exports = router;