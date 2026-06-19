import express from "express";
import pool from "./db.js";

const router = express.Router();

// ---------------------------------------------------------
// POST /messages/register
// Salva messageId + kmsg + sender + recipients + metadata
// ---------------------------------------------------------
router.post("/register", async (req, res) => {
  try {
    const { messageId, kmsg, senderId, recipients, metadata } = req.body;

    if (!messageId || !kmsg || !senderId || !recipients) {
      return res.status(400).json({ error: "Campi mancanti" });
    }

    const result = await pool.query(
      `INSERT INTO secret_messages
        (message_id, kmsg, sender_id, recipients, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (message_id) DO UPDATE
         SET kmsg = EXCLUDED.kmsg,
             sender_id = EXCLUDED.sender_id,
             recipients = EXCLUDED.recipients,
             metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        messageId,
        kmsg,
        senderId,
        JSON.stringify(recipients),
        metadata ? JSON.stringify(metadata) : null
      ]
    );

    return res.json({
      ok: true,
      message: result.rows[0]
    });
  } catch (err) {
    console.error("❌ Errore /messages/register:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// GET /messages/kmsg/:messageId
// Restituisce solo kmsg (base64) SOLO SE AUTORIZZATO
// ---------------------------------------------------------
router.get("/kmsg/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.id; // 🔥 preso dal token persistente

    const result = await pool.query(
      `SELECT kmsg 
       FROM secret_messages
       WHERE message_id = $1
         AND (
              sender_id = $2
              OR recipients @> $3
         )`,
      [
        messageId,
        userId,
        JSON.stringify([{ id: userId }])
      ]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: "Non autorizzato a leggere questa chiave" });
    }

    return res.json({
      kmsg: result.rows[0].kmsg
    });

  } catch (err) {
    console.error("❌ Errore /messages/kmsg/:messageId:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// 🧹 POST /messages/abort
// Cleanup sessioni sporche lato backend
// ---------------------------------------------------------
router.post("/abort", async (req, res) => {
  try {
    const { messageId } = req.body;

    if (!messageId) {
      return res.json({ ok: false, error: "Missing messageId" });
    }

    if (global.sessions && global.sessions[messageId]) {
      delete global.sessions[messageId];
      console.log("🧹 [CLEANUP] Sessione rimossa per messageId:", messageId);
    } else {
      console.log("🧹 [CLEANUP] Nessuna sessione trovata per:", messageId);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Errore /messages/abort:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
