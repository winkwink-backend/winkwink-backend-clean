console.log("📂 IL SERVER STA USANDO QUESTO FILE:", process.cwd());

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import identityRoutes from "./identityRoutes.js";

import pool from "./db.js";
import authRoutes from "./authRoutes.js";
import uploadRoutes from "./uploadRoutes.js";
import encryptRoutes from "./encryptRoutes.js";
import messagesSecretRoutes from "./messagesSecretRoutes.js";
import userRoutes from "./userRoutes.js";
import { registerSocketHandlers } from "./socketHandlers.js";
import authMiddleware from "./authMiddleware.js";

import p2pRoutes from "./p2pRoutes.js";
import chatRoutes from "./chatRoutes.js";
import aliasRoutes from "./aliasRoutes.js";
import blockRoutes from "./blockRoutes.js";
import profileRoutes from "./profileRoutes.js";

// ⭐ IMPORT CORRETTO ESM
import winkcoinRoutes from "./winkcoin.js";

console.log("📍 IL FILE SOCKETHANDLERS È CARICATO DA QUI:", import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("📂 SERVER LOADED FROM:", __dirname);
console.log("📄 FILE IN ESECUZIONE:", import.meta.url);

const app = express();

/* ------------------------------------------------------------
   ⭐ CORS PATCH — VERSIONE DEFINITIVA
------------------------------------------------------------ */
app.use(
  cors({
    origin: "https://www.winkwink.pro",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Preflight OPTIONS
app.options("*", cors());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Credentials", "true");
  next();
});

/* ------------------------------------------------------------
   ⭐ BODY PARSER
------------------------------------------------------------ */
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

/* ------------------------------------------------------------
   ⭐ STATIC UPLOADS
------------------------------------------------------------ */
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".mp4")) {
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Accept-Ranges", "bytes");
      }
      if (filePath.endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
      }
    }
  })
);

/* ------------------------------------------------------------
   ⭐ SOCKET.IO
------------------------------------------------------------ */
const onlineUsers = new Map();
const chatRooms = new Map();

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
  pingTimeout: 30000,
  pingInterval: 25000,
});

/* ------------------------------------------------------------
   ⭐ MIDDLEWARE CONDIVISO
------------------------------------------------------------ */
app.use((req, res, next) => {
  req.io = io;
  req.onlineUsers = onlineUsers;
  req.chatRooms = chatRooms;
  next();
});

/* ------------------------------------------------------------
   ⭐ ROTTE HTTP (ORDINE CORRETTO)
------------------------------------------------------------ */
app.use(authRoutes);
app.use("/encrypt", encryptRoutes);
app.use("/messages", authMiddleware, messagesSecretRoutes);
app.use(userRoutes);
app.use(p2pRoutes);
app.use(chatRoutes);
app.use("/chat", uploadRoutes);
app.use("/alias", aliasRoutes);
app.use("/blocklist", blockRoutes);
app.use("/profile", profileRoutes);
app.use("/identity", identityRoutes);

// ⭐ WINKCOIN
app.use("/winkcoin", winkcoinRoutes);

/* ------------------------------------------------------------
   ⭐ HEALTHCHECK
------------------------------------------------------------ */
app.get("/", (req, res) => res.send("Backend WinkWink attivo e modulare"));

/* ------------------------------------------------------------
   ⭐ SOCKET HANDLERS
------------------------------------------------------------ */
io.on("connection", (socket) => {
  registerSocketHandlers(io, socket, pool, onlineUsers, chatRooms);
});

/* ------------------------------------------------------------
   ⭐ AVVIO SERVER
------------------------------------------------------------ */
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server + WebSocket pronti sulla porta ${PORT}`);
});

/* ------------------------------------------------------------
   ⭐ CLEANUP PERIODICO
------------------------------------------------------------ */
setInterval(async () => {
  try {
    await pool.query(`
      DELETE FROM chat_messages
      WHERE created_at < NOW() - INTERVAL '72 hours'
    `);
    console.log("🧹 Pulizia messaggi scaduti completata");
  } catch (err) {
    console.error("❌ Errore pulizia messaggi:", err.message);
  }
}, 1000 * 60 * 60);

export default app;
