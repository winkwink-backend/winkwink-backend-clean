import express from "express";
import pool from "./db.js";

const router = express.Router();

// ⭐ Blocca un alias
router.post("/block", async (req, res) => {
  try {
    const { blockerAlias, blockedAlias } = req.body;

    if (!blockerAlias || !blockedAlias) {
      return res.json({ success: false, error: "INVALID_DATA" });
    }

    await pool.query(
      `INSERT INTO blocked_users (blocker_alias, blocked_alias)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [blockerAlias, blockedAlias]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Errore /block:", err.message);
    res.status(500).json({ success: false });
  }
});

// ⭐ Sblocca un alias
router.post("/unblock", async (req, res) => {
  try {
    const { blockerAlias, blockedAlias } = req.body;

    await pool.query(
      `DELETE FROM blocked_users
       WHERE blocker_alias = $1 AND blocked_alias = $2`,
      [blockerAlias, blockedAlias]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Errore /unblock:", err.message);
    res.status(500).json({ success: false });
  }
});

// ⭐ Lista utenti bloccati
router.get("/blocked", async (req, res) => {
  try {
    const { alias } = req.query;

    const result = await pool.query(
      `SELECT blocked_alias FROM blocked_users
       WHERE blocker_alias = $1`,
      [alias]
    );

    return res.json({
      blocked: result.rows.map((r) => r.blocked_alias),
    });
  } catch (err) {
    console.error("❌ Errore /blocked:", err.message);
    res.status(500).json({ blocked: [] });
  }
});

export default router;
