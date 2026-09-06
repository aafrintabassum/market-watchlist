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
