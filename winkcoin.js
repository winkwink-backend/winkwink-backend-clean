import express from "express";
import db from "./db.js";

const router = express.Router();

// ------------------------------------------------------
// GET SALDO UTENTE
// ------------------------------------------------------
router.get("/:userId", async (req, res) => {
  const { userId } = req.params;

  const result = await db.query(
    "SELECT balance, last_thanks_time FROM winkcoin WHERE user_id = $1",
    [userId]
  );

  if (result.rows.length === 0) {
    await db.query(
      "INSERT INTO winkcoin (user_id, balance, last_thanks_time) VALUES ($1, 20, NULL)",
      [userId]
    );

    return res.json({
      balance: 20,
      lastThanksTime: null
    });
  }

  res.json({
    balance: result.rows[0].balance,
    lastThanksTime: result.rows[0].last_thanks_time
  });
});

// ------------------------------------------------------
// PREMIO "GRAZIE" (+10 ogni 15 minuti)
// ------------------------------------------------------
router.post("/thanks", async (req, res) => {
  const { userId } = req.body;

  const result = await db.query(
    "SELECT balance, last_thanks_time FROM winkcoin WHERE user_id = $1",
    [userId]
  );

  if (result.rows.length === 0) {
    return res.status(400).json({ error: "User not found" });
  }

  const last = result.rows[0].last_thanks_time;
  const now = new Date();

  if (last && (now - last) / 60000 < 15) {
    return res.status(429).json({ error: "Too early" });
  }

  const updated = await db.query(
    "UPDATE winkcoin SET balance = balance + 10, last_thanks_time = $2 WHERE user_id = $1 RETURNING balance, last_thanks_time",
    [userId, now]
  );

  res.json({
    balance: updated.rows[0].balance,
    lastThanksTime: updated.rows[0].last_thanks_time
  });
});

// ------------------------------------------------------
// +3 INVIO FILE
// ------------------------------------------------------
router.post("/send", async (req, res) => {
  const { userId } = req.body;

  const updated = await db.query(
    "UPDATE winkcoin SET balance = balance + 3 WHERE user_id = $1 RETURNING balance, last_thanks_time",
    [userId]
  );

  res.json({
    balance: updated.rows[0].balance,
    lastThanksTime: updated.rows[0].last_thanks_time
  });
});

// ------------------------------------------------------
// +1 RICEZIONE FILE
// ------------------------------------------------------
router.post("/receive", async (req, res) => {
  const { userId } = req.body;

  const updated = await db.query(
    "UPDATE winkcoin SET balance = balance + 1 WHERE user_id = $1 RETURNING balance, last_thanks_time",
    [userId]
  );

  res.json({
    balance: updated.rows[0].balance,
    lastThanksTime: updated.rows[0].last_thanks_time
  });
});

export default router;
