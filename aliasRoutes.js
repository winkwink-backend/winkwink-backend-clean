import express from "express";
import pool from "./db.js";

const router = express.Router();

/**
 * ------------------------------------------------------------
 * 🔍 CERCA UTENTE PER ALIAS
 * GET /alias/search?alias=xxx
 * ------------------------------------------------------------
 */
router.get("/search", async (req, res) => {
  try {
    const { alias } = req.query;

    if (!alias || alias.trim() === "") {
      return res.json({ exists: false });
    }

    const result = await pool.query(
      `SELECT id, alias, profile_image, peer_id, public_key, version
       FROM users
       WHERE LOWER(alias) = LOWER($1)
       LIMIT 1`,
      [alias]
    );

    if (result.rows.length === 0) {
      return res.json({ exists: false });
    }

    const user = result.rows[0];

    return res.json({
      exists: true,
      alias: user.alias,
      profileImage: user.profile_image,
      userId: user.id,
      peerId: user.peer_id,
      publicKey: user.public_key,
      version: user.version
    });
  } catch (err) {
    console.error("❌ Errore /alias/search:", err.message);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

/**
 * ------------------------------------------------------------
 * 📩 INVIA RICHIESTA ALIAS
 * POST /alias/request
 * ------------------------------------------------------------
 */
router.post("/request", async (req, res) => {
  try {
    const { fromAlias, toAlias } = req.body;

    if (!fromAlias || !toAlias) {
      return res.json({ success: false, error: "INVALID_DATA" });
    }

    // ------------------------------------------------------------
    // ⭐ BLOCKLIST CHECK
    // ------------------------------------------------------------
    const blocked = await pool.query(
      `SELECT 1 FROM blocked_users
       WHERE (blocker_alias = $1 AND blocked_alias = $2)
          OR (blocker_alias = $2 AND blocked_alias = $1)`,
      [toAlias, fromAlias]
    );

    if (blocked.rows.length > 0) {
      console.log(`⛔ RICHIESTA ALIAS BLOCCATA: ${fromAlias} ↔ ${toAlias}`);
      return res.json({ success: false, error: "BLOCKED" });
    }

    // Evita duplicati
    const exists = await pool.query(
      `SELECT id FROM alias_requests
       WHERE from_alias = $1 AND to_alias = $2 AND status = 'pending'`,
      [fromAlias, toAlias]
    );

    if (exists.rows.length > 0) {
      return res.json({ success: true, message: "REQUEST_ALREADY_EXISTS" });
    }

    await pool.query(
      `INSERT INTO alias_requests (from_alias, to_alias)
       VALUES ($1, $2)`,
      [fromAlias, toAlias]
    );

    // ⭐ WebSocket (fase 2)
    // io.to(socketId).emit("alias_request_received", {...})

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Errore /alias/request:", err.message);
    res.status(500).json({ success: false });
  }
});

/**
 * ------------------------------------------------------------
 * 📜 LISTA CONTATTI ALIAS
 * GET /alias/contacts?alias=xxx
 * ------------------------------------------------------------
 */
router.get("/contacts", async (req, res) => {
  try {
    const { alias } = req.query;

    if (!alias) {
      return res.json({ contacts: [] });
    }

    const result = await pool.query(
      `SELECT contact_alias, profile_image, user_id, peer_id, public_key, version
       FROM alias_contacts
       WHERE owner_alias = $1
       ORDER BY created_at DESC`,
      [alias]
    );

    return res.json({
      contacts: result.rows.map((c) => ({
        alias: c.contact_alias,
        profileImage: c.profile_image,
        userId: c.user_id,
        peerId: c.peer_id,
        publicKey: c.public_key,
        version: c.version
      }))
    });
  } catch (err) {
    console.error("❌ Errore /alias/contacts:", err.message);
    res.status(500).json({ contacts: [] });
  }
});

/**
 * ------------------------------------------------------------
 * ✅ ACCETTA RICHIESTA ALIAS
 * POST /alias/accept
 * ------------------------------------------------------------
 */
router.post("/accept", async (req, res) => {
  try {
    const { fromAlias, toAlias } = req.body;

    if (!fromAlias || !toAlias) {
      return res.json({ success: false });
    }

    // ------------------------------------------------------------
    // ⭐ BLOCKLIST CHECK
    // ------------------------------------------------------------
    const blocked = await pool.query(
      `SELECT 1 FROM blocked_users
       WHERE (blocker_alias = $1 AND blocked_alias = $2)
          OR (blocker_alias = $2 AND blocked_alias = $1)`,
      [toAlias, fromAlias]
    );

    if (blocked.rows.length > 0) {
      console.log(`⛔ ACCEPT BLOCCATO: ${fromAlias} ↔ ${toAlias}`);
      return res.json({ success: false, error: "BLOCKED" });
    }

    // 1️⃣ Aggiorna stato richiesta
    await pool.query(
      `UPDATE alias_requests
       SET status = 'accepted'
       WHERE from_alias = $1 AND to_alias = $2`,
      [fromAlias, toAlias]
    );

    // 2️⃣ Recupera dati utente che ha inviato la richiesta
    const userA = await pool.query(
      `SELECT id, alias, profile_image, peer_id, public_key, version
       FROM users
       WHERE alias = $1`,
      [fromAlias]
    );

    const userB = await pool.query(
      `SELECT id, alias, profile_image, peer_id, public_key, version
       FROM users
       WHERE alias = $1`,
      [toAlias]
    );

    if (userA.rows.length === 0 || userB.rows.length === 0) {
      return res.json({ success: false });
    }

    const A = userA.rows[0];
    const B = userB.rows[0];

    // 3️⃣ Salva contatto reciproco
    await pool.query(
      `INSERT INTO alias_contacts
       (owner_alias, contact_alias, profile_image, user_id, peer_id, public_key, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [toAlias, fromAlias, A.profile_image, A.id, A.peer_id, A.public_key, A.version]
    );

    await pool.query(
      `INSERT INTO alias_contacts
       (owner_alias, contact_alias, profile_image, user_id, peer_id, public_key, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [fromAlias, toAlias, B.profile_image, B.id, B.peer_id, B.public_key, B.version]
    );

    // ⭐ WebSocket (fase 2)
    // io.to(socketId).emit("alias_request_accepted", {...})

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Errore /alias/accept:", err.message);
    res.status(500).json({ success: false });
  }
});

/**
 * ------------------------------------------------------------
 * ❌ RIFIUTA RICHIESTA ALIAS
 * POST /alias/reject
 * ------------------------------------------------------------
 */
router.post("/reject", async (req, res) => {
  try {
    const { fromAlias, toAlias } = req.body;

    await pool.query(
      `UPDATE alias_requests
       SET status = 'rejected'
       WHERE from_alias = $1 AND to_alias = $2`,
      [fromAlias, toAlias]
    );

    // ⭐ WebSocket (fase 2)
    // io.to(socketId).emit("alias_request_rejected", {...})

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Errore /alias/reject:", err.message);
    res.status(500).json({ success: false });
  }
});

export default router;
