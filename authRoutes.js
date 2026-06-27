import express from "express";
import bcryptjs from "bcryptjs";
import pool from "./db.js";
import { otpStore, generateOtp } from "./utils.js";

const router = express.Router();

// ------------------------------------------------------------
// AUTH — REGISTER (Email + Password)  (NON USATA DA FLUTTER)
// ------------------------------------------------------------
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: "User already exists" });

    const password_hash = await bcryptjs.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at",
      [email, password_hash]
    );

    res.json({ status: "ok", user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// AUTH — LOGIN (ECC / PHONE + PUBLIC KEY + ALIAS)
// ------------------------------------------------------------
router.post("/login", async (req, res) => {
  try {
    const { phone, name, last_name, public_key, qr_data, alias } = req.body;

    // 1️⃣ Alias obbligatorio
    if (!alias || alias.trim() === "") {
      return res.status(400).json({ error: "ALIAS_REQUIRED" });
    }

    // 2️⃣ Alias unico
    const aliasCheck = await pool.query(
      "SELECT id FROM users WHERE alias = $1",
      [alias.trim()]
    );

    if (aliasCheck.rows.length > 0) {
      return res.status(409).json({ error: "ALIAS_TAKEN" });
    }

    // 3️⃣ Inserisci o aggiorna l'utente
    const result = await pool.query(
      `INSERT INTO users (phone, name, last_name, public_key, qr_data, alias, peer_id)
       VALUES ($1, $2, $3, $4, $5, $6, '0')
       ON CONFLICT (phone)
       DO UPDATE SET 
         name = EXCLUDED.name,
         last_name = EXCLUDED.last_name,
         public_key = EXCLUDED.public_key,
         qr_data = EXCLUDED.qr_data,
         alias = EXCLUDED.alias
       RETURNING *;`,
      [phone, name, last_name, public_key, qr_data, alias.trim()]
    );

    let user = result.rows[0];

    // ⭐ INIZIALIZZA WINKCOIN SE NON ESISTE
    await pool.query(
      `INSERT INTO winkcoin (user_id, balance, last_thanks_time)
      VALUES ($1, 20, NULL)
      ON CONFLICT (user_id) DO NOTHING`,
     [user.id]
    );


    // 4️⃣ Se peer_id è 0 → aggiorna
    if (user.peer_id === "0" || !user.peer_id) {
      await pool.query("UPDATE users SET peer_id = $1 WHERE id = $1", [user.id]);
      user.peer_id = user.id.toString();
    }

    // 5️⃣ Genera token persistente SE NON ESISTE
    if (!user.auth_token) {
      const crypto = await import("crypto");
      const newToken = crypto.randomBytes(32).toString("hex");

      await pool.query(
        "UPDATE users SET auth_token = $1 WHERE id = $2",
        [newToken, user.id]
      );

      user.auth_token = newToken;
    }

    // 6️⃣ GENERA LA WINKWINK IDENTITY KEY (PNG)
    try {
      await fetch(`${process.env.BASE_URL}/identity/generateKey`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          alias: alias.trim(),
          password: "", // per ora password non usata
        }),
      });
    } catch (err) {
      console.error("❌ Errore generazione identity key:", err);
    }

    // 7️⃣ Risposta
    res.json({
      success: true,
      user: user,
      authToken: user.auth_token,
    });

  } catch (err) {
    console.error("❌ Errore login:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// PASSWORD RESET — REQUEST, VERIFY, NEW
// ------------------------------------------------------------
router.post("/password-reset/request", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email mancante" });

    const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0)
      return res.json({ message: "Se l'email esiste, riceverai un codice" });

    const code = generateOtp();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    otpStore.set(email, { code, expiresAt });

    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: "WinkWink - Codice recupero password",
      text: `Il tuo codice è: ${code}\nValido 10 minuti.`,
    });

    return res.json({ message: "Codice inviato" });
  } catch (err) {
    return res.status(500).json({ error: "Errore durante l'invio del codice" });
  }
});

router.post("/password-reset/verify", (req, res) => {
  try {
    const { email, otp } = req.body;
    const entry = otpStore.get(email);

    if (!entry || entry.code !== otp || Date.now() > entry.expiresAt) {
      return res.status(400).json({ error: "Codice non valido o scaduto" });
    }

    return res.json({ message: "Codice verificato" });
  } catch (err) {
    return res.status(500).json({ error: "Errore durante la verifica" });
  }
});

router.post("/password-reset/new", async (req, res) => {
  try {
    const { email, password } = req.body;
    const hash = await bcryptjs.hash(password, 10);

    await pool.query("UPDATE users SET password_hash = $1 WHERE email = $2", [
      hash,
      email,
    ]);

    otpStore.delete(email);

    return res.json({ message: "Password aggiornata" });
  } catch (err) {
    return res.status(500).json({ error: "Errore salvataggio password" });
  }
});

// ------------------------------------------------------------
// USERS — CHECK PHONE & EMAIL
// ------------------------------------------------------------
router.post("/auth/check-email", async (req, res) => {
  try {
    const { email } = req.body;
    const result = await pool.query("SELECT id FROM users WHERE email = $1", [
      email,
    ]);
    return res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/users/check", async (req, res) => {
  try {
    let phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: "Phone required" });

    phone = decodeURIComponent(phone).replace(/\s+/g, "").replace(/^\+/, "");
    if (!phone.startsWith("39")) phone = "39" + phone;
    phone = "+" + phone;

    const result = await pool.query(
      "SELECT id, public_key FROM users WHERE phone = $1",
      [phone]
    );

    if (result.rows.length === 0) return res.json({ exists: false });

    res.json({
      exists: true,
      userId: result.rows[0].id,
      publicKey: result.rows[0].public_key,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------------
// FCM TOKEN UPDATE
// ------------------------------------------------------------
router.post("/update_fcm_token", async (req, res) => {
  const { userId, token } = req.body;

  try {
    await pool.query("UPDATE users SET fcm_token = $1 WHERE id = $2", [
      token,
      userId,
    ]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Errore server" });
  }
});

export default router;
