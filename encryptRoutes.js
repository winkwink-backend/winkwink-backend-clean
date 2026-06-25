import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import pool from "./db.js";
import admin from "./firebase-config.js";

const router = express.Router();

// 📌 Cartella dove Railway monta il volume
const UPLOAD_DIR = "/app/uploads";

// Se non esiste, la creiamo
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ------------------------------------------------------------
// ⭐ FUNZIONE sendFCM
// ------------------------------------------------------------
async function sendFCM({ token, data }) {
  try {
    await admin.messaging().send({
      token,
      data,
      android: { priority: "high" }
    });

    console.log("📨 Notifica silente inviata");
  } catch (err) {
    console.error("❌ Errore invio FCM:", err.message);
  }
}

// ------------------------------------------------------------
// ⭐ MULTER — salva il file con il NOME SCELTO dall’utente
// ------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),

  filename: (req, file, cb) => {
    const userFileName = req.body.fileName?.trim() || "file";
    cb(null, `${userFileName}.png`);
  }
});

const upload = multer({ storage });

// ------------------------------------------------------------
// ⭐ UPLOAD FILE .PNG + NOTIFICA SILENTE
// ------------------------------------------------------------
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { receiverId, fileName, senderId } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "File mancante" });
    }

    // ------------------------------------------------------------
    // ⭐ CHECK BLOCKLIST (blocca utenti molesti)
    // ------------------------------------------------------------

    // Recupero alias mittente e ricevente
    const senderAliasRes = await pool.query(
      "SELECT alias FROM users WHERE id = $1",
      [senderId]
    );
    const receiverAliasRes = await pool.query(
      "SELECT alias FROM users WHERE id = $1",
      [receiverId]
    );

    const senderAlias = senderAliasRes.rows[0]?.alias;
    const receiverAlias = receiverAliasRes.rows[0]?.alias;

    if (!senderAlias || !receiverAlias) {
      return res.status(400).json({ error: "INVALID_ALIAS" });
    }

    // 🔥 A) Il ricevente ha bloccato il mittente
    const blockedByReceiver = await pool.query(
      `SELECT 1 FROM blocked_users
       WHERE blocker_alias = $1 AND blocked_alias = $2`,
      [receiverAlias, senderAlias]
    );

    if (blockedByReceiver.rows.length > 0) {
      console.log(`⛔ FILE BLOCCATO: ${receiverAlias} ha bloccato ${senderAlias}`);
      return res.json({ ok: false, error: "BLOCKED_BY_RECEIVER" });
    }

    // 🔥 B) Il mittente ha bloccato il ricevente (opzionale)
    const blockedBySender = await pool.query(
      `SELECT 1 FROM blocked_users
       WHERE blocker_alias = $1 AND blocked_alias = $2`,
      [senderAlias, receiverAlias]
    );

    if (blockedBySender.rows.length > 0) {
      console.log(`⛔ FILE BLOCCATO: ${senderAlias} ha bloccato ${receiverAlias}`);
      return res.json({ ok: false, error: "BLOCKED_BY_SENDER" });
    }

    // ------------------------------------------------------------
    // ⭐ SE ARRIVIAMO QUI → NON BLOCCATO → PROSEGUI
    // ------------------------------------------------------------

    const fileId = req.file.filename;

    console.log(`📦 [ENCRYPT] File PNG ricevuto → ${fileId}`);

    // Recupero token FCM del ricevente
    const tokenRes = await pool.query(
      "SELECT fcm_token FROM users WHERE id = $1",
      [receiverId]
    );

    const token = tokenRes.rows[0]?.fcm_token;

    if (token) {
      console.log("📩 Invio notifica silente al ricevente");

      await sendFCM({
        token,
        data: {
          type: "encrypted_png",
          fileId,
          fileName,
          senderId: req.body.senderId?.toString() ?? "",
          senderName: req.body.senderName ?? "",
          timestamp: Date.now().toString()
        }
      });
    } else {
      console.log("⚠️ Nessun token FCM per il ricevente");
    }

    return res.json({
      ok: true,
      fileId
    });

  } catch (err) {
    console.error("❌ Errore upload .png:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// ⭐ DOWNLOAD FILE .PNG
// ------------------------------------------------------------
router.get("/download/:fileId", (req, res) => {
  const fileId = req.params.fileId;
  const filePath = path.join(UPLOAD_DIR, fileId);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File non trovato" });
  }

  console.log(`⬇️ [ENCRYPT] Download file → ${fileId}`);

  res.download(filePath);
});

export default router;
