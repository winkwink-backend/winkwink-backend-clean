import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import db from "./db.js";
import authMiddleware from "./authMiddleware.js";

const router = express.Router();

// __dirname per ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 📁 Cartella upload profilo
const PROFILE_DIR = path.join(__dirname, "uploads/profile");

// Se non esiste, la crea
if (!fs.existsSync(PROFILE_DIR)) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
}

// ⚙️ Configurazione Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PROFILE_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});

const upload = multer({ storage });

// 📤 ENDPOINT UPLOAD IMMAGINE PROFILO
router.post("/upload", authMiddleware, upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: "Nessun file ricevuto" });
  }

  const alias = req.user.alias;
  const fileUrl = `/uploads/profile/${req.file.filename}`;

  const fullUrl = `https://winkwink-backend1-production.up.railway.app${fileUrl}`;

  await db.query(
    "UPDATE users SET profile_image_url = $1 WHERE alias = $2",
    [fullUrl, alias]
  );

  res.json({ success: true, url: fullUrl });
});

export default router;
