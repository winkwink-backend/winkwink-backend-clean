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
// ⭐ FUNZIONE sendFCM (mancava → errore risolto)
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
    // Nome scelto dall’utente (senza estensione)
    const userFileName = req.body.fileName?.trim() || "file";

    // Estensione .png 
    cb(null, `${userFileName}.png`);

  }
});

const upload = multer({ storage });

// ------------------------------------------------------------
// ⭐ UPLOAD FILE .WWF + NOTIFICA SILENTE
// ------------------------------------------------------------
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { receiverId, fileName } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "File mancante" });
    }

    const fileId = req.file.filename; // ora è il nome scelto dall’utente

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
          type: "encrypted_wwf",
          fileId,
          fileName
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
// ⭐ DOWNLOAD FILE .WWF (byte‑per‑byte, intatto)
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
