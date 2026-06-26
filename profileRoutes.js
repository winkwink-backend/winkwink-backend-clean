import express from "express";
import upload from "./uploadMiddleware.js";   // <-- se usi multer in un file separato
import db from "./db.js";
import authMiddleware from "./authMiddleware.js";

const router = express.Router();

// ⭐ UPLOAD IMMAGINE PROFILO
router.post("/upload", authMiddleware, upload.single("image"), async (req, res) => {
  // 🔥 MIGLIORIA 1 — validazione file
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: "Nessun file ricevuto"
    });
  }

  const alias = req.user.alias;
  const fileUrl = "/uploads/profile/" + req.file.filename;

  // 🔥 MIGLIORIA 2 — URL assoluto (BASE_URL Railway)
  const fullUrl = `https://winkwink-backend1-production.up.railway.app${fileUrl}`;

  await db.query(
    "UPDATE users SET profile_image_url = $1 WHERE alias = $2",
    [fullUrl, alias]
  );

  res.json({ success: true, url: fullUrl });
});

export default router;
