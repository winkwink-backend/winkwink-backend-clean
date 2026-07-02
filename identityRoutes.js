import express from "express";
import multer from "multer";
import crypto from "crypto";
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";
import pool from "./db.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Hash SHA256 → hex string
const sha256 = (str) =>
  crypto.createHash("sha256").update(str).digest("hex");

// Firma digitale mock
const signPayload = (payload) =>
  crypto.createHash("sha256").update(payload).digest("hex");

const verifySignature = (payload, signature) =>
  signPayload(payload) === signature;

// 🔧 Normalizza input da Web/Flutter
function normalizeHash(value, shouldHash) {
  if (Array.isArray(value)) {
    return value.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  if (typeof value === "string") {
    return shouldHash ? sha256(value.trim()) : value.trim();
  }
  return "";
}

// ------------------------------------------------------------
// ⭐ 1) GENERA PNG CON CHIAVE (Flutter)
// ------------------------------------------------------------
router.post("/generateKey", async (req, res) => {
  try {
    const { userId, alias, password } = req.body;

    const payload = {
      id: crypto.randomUUID(),
      aliasHash: sha256(alias),
      passwordHash: sha256(password),
      createdAt: Date.now(),
    };

    const payloadString = JSON.stringify(payload);
    const signature = signPayload(payloadString);

    const metadata = JSON.stringify({ payload, signature });

    const filePath = path.join(process.cwd(), "uploads", `identity_${userId}.png`);

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const basePng = fs.readFileSync(path.join(__dirname, "assets", "winkwink_card.png"));

    const finalPng = Buffer.concat([
      basePng,
      Buffer.from("\n<!--WINKWINK_IDENTITY:" + metadata + "-->\n"),
    ]);

    fs.writeFileSync(filePath, finalPng);

    await pool.query(
      `INSERT INTO identity_keys (user_id, alias_hash, password_hash, signature, file_path)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, payload.aliasHash, payload.passwordHash, signature, filePath]
    );

    res.json({
      success: true,
      identityKeyUrl: `/uploads/identity_${userId}.png`,
    });
  } catch (err) {
    console.error("Errore generateKey:", err);
    res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// ------------------------------------------------------------
// ⭐ 2) RECUPERO PROFILO (alias + password)
// ------------------------------------------------------------
router.post("/recoverProfile", async (req, res) => {
  try {
    const { alias, password } = req.body;

    if (!alias || !password) {
      return res.json({ success: false, error: "MISSING_FIELDS" });
    }

    const aliasHash = normalizeHash(alias, true);
    const passwordHash = normalizeHash(password, true);

    const result = await pool.query(
      `SELECT * FROM identity_keys WHERE alias_hash = $1 AND password_hash = $2`,
      [aliasHash, passwordHash]
    );

    if (result.rowCount === 0) {
      return res.json({ success: false, error: "NOT_FOUND" });
    }

    const key = result.rows[0];

    const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [
      key.user_id,
    ]);

    const user = userRes.rows[0];

    res.json({
      success: true,
      user,
      authToken: crypto.randomBytes(32).toString("hex"),
    });
  } catch (err) {
    console.error("Errore recoverProfile:", err);
    res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// ------------------------------------------------------------
// ⭐ 3) RECUPERO PROFILO CON PNG
// ------------------------------------------------------------
router.post("/recoverWithKey", upload.single("file"), async (req, res) => {
  try {
    const buffer = req.file?.buffer;
    if (!buffer) {
      return res.json({ success: false, error: "MISSING_FILE" });
    }

    const text = buffer.toString();
    const marker = "<!--WINKWINK_IDENTITY:";
    const start = text.indexOf(marker);

    if (start === -1) {
      return res.json({ success: false, error: "INVALID_FILE" });
    }

    const jsonStart = start + marker.length;
    const jsonEnd = text.indexOf("-->", jsonStart);

    const metadataString = text.substring(jsonStart, jsonEnd);
    const { payload, signature } = JSON.parse(metadataString);

    const payloadString = JSON.stringify(payload);

    if (!verifySignature(payloadString, signature)) {
      return res.json({ success: false, error: "INVALID_SIGNATURE" });
    }

    const result = await pool.query(
      `SELECT * FROM identity_keys WHERE alias_hash = $1 AND password_hash = $2`,
      [payload.aliasHash, payload.passwordHash]
    );

    if (result.rowCount === 0) {
      return res.json({ success: false, error: "NOT_FOUND" });
    }

    const key = result.rows[0];

    const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [
      key.user_id,
    ]);

    const user = userRes.rows[0];

    res.json({
      success: true,
      user,
      authToken: crypto.randomBytes(32).toString("hex"),
    });
  } catch (err) {
    console.error("Errore recoverWithKey:", err);
    res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

// ------------------------------------------------------------
// ⭐ 4) UPLOAD AVATAR (Flutter + Web)
// ------------------------------------------------------------
router.post("/uploadAvatar", upload.single("avatar"), async (req, res) => {
  try {
    const userId = req.body.userId;

    if (!req.file) {
      return res.json({ success: false, error: "NO_FILE" });
    }

    const filename = `avatar_${userId}.png`;
    const avatarPath = path.join(process.cwd(), "uploads", filename);
    fs.writeFileSync(avatarPath, req.file.buffer);

    const fullUrl = `${process.env.BASE_URL}/uploads/${filename}`;

    await pool.query(
      `UPDATE users 
       SET avatar_url = $1,
           profile_image_url = $1
       WHERE id = $2`,
      [fullUrl, userId]
    );

    res.json({
      success: true,
      avatarUrl: fullUrl,
    });
  } catch (err) {
    console.error("Errore uploadAvatar:", err);
    res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});


// ------------------------------------------------------------
// ⭐ 5) PROFILO /identity/me (Web + Flutter)
// ------------------------------------------------------------
router.get("/me", async (req, res) => {
  try {
    const userId = req.query.userId; // oppure req.user.id

    const result = await pool.query(
     `SELECT 
        alias,
        phone,
        avatar_url,
        profile_image_url
      FROM users 
      WHERE id = $1`,
     [userId]
   );

    if (result.rowCount === 0) {
      return res.json({ success: false, error: "NOT_FOUND" });
    }

    const user = result.rows[0];

    res.json({
     success: true,
     user: {
       alias: user.alias,
       phone: user.phone,
       avatarUrl: user.avatar_url,
       profileImageUrl: user.profile_image_url
      },
    });
  } catch (err) {
    console.error("Errore /identity/me:", err);
    res.status(500).json({ success: false, error: "SERVER_ERROR" });
  }
});

export default router;
