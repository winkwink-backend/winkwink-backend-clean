import express from "express";
import pool from "./db.js";

const router = express.Router();

// ---------------------------------------------------------
// POST /messages/register
// ---------------------------------------------------------
router.post("/register", async (req, res) => {
  try {
    console.log("📩 [REGISTER] BODY:", req.body);

    const { messageId, kmsg, senderId, recipients, metadata } = req.body;

    if (!messageId || !kmsg || !senderId || !recipients) {
      console.log("❌ [REGISTER] Campi mancanti");
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

    console.log("✅ [REGISTER] SALVATO:", result.rows[0]);

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
// ---------------------------------------------------------
router.get("/fetch-kmsg/:messageId", async (req, res) => {
  console.log("🟦 [KMSG] ROUTE MATCHED!");   // <--- IMPORTANTISSIMO
  console.log("🟦 [KMSG] PARAMS:", req.params);

  try {
    const { messageId } = req.params;
    const userId = req.user?.id;

    console.log("🔍 [KMSG] messageId:", messageId);
    console.log("🔍 [KMSG] userId:", userId);

    if (!userId) {
      console.log("❌ [KMSG] userId mancante nel token");
      return res.status(401).json({ error: "Token mancante" });
    }

    console.log("📡 [KMSG] Eseguo query...");

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

    console.log("📡 [KMSG] RISULTATO QUERY:", result.rows);

    if (result.rows.length === 0) {
      console.log("❌ [KMSG] Nessuna chiave trovata o non autorizzato");
      return res.status(403).json({ error: "Non autorizzato a leggere questa chiave" });
    }

    console.log("✅ [KMSG] KMSG TROVATA:", result.rows[0].kmsg);

    return res.json({
      kmsg: result.rows[0].kmsg
    });

  } catch (err) {
    console.error("❌ Errore /messages/kmsg/:messageId:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// POST /messages/abort
// ---------------------------------------------------------
router.post("/abort", async (req, res) => {
  try {
    console.log("🧹 [ABORT] BODY:", req.body);

    const { messageId } = req.body;

    if (!messageId) {
      console.log("❌ [ABORT] Missing messageId");
      return res.json({ ok: false, error: "Missing messageId" });
    }

    if (global.sessions && global.sessions[messageId]) {
      delete global.sessions[messageId];
      console.log("🧹 [ABORT] Sessione rimossa:", messageId);
    } else {
      console.log("🧹 [ABORT] Nessuna sessione trovata per:", messageId);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Errore /messages/abort:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
