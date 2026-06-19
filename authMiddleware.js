import pool from "./db.js";

export default async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;

    if (!header) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    // Estrarre il token
    const token = header.replace("Bearer", "").trim();

    if (!token) {
      return res.status(401).json({ error: "Invalid token format" });
    }

    // Cercare l'utente con quel token
    const result = await pool.query(
      "SELECT id, phone, name, last_name, public_key FROM users WHERE auth_token = $1",
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Utente autenticato
    req.user = result.rows[0];
    next();

  } catch (err) {
    console.error("❌ Errore authMiddleware:", err.message);
    return res.status(500).json({ error: "Server auth error" });
  }
}
