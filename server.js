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
app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// Static uploads
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

// Middleware condiviso
app.use((req, res, next) => {
  req.io = io;
  req.onlineUsers = onlineUsers;
  req.chatRooms = chatRooms;
  next();
});

// ⭐ Rotte HTTP (ORDINE CORRETTO)
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

// ⭐ AGGIUNTA WINKCOIN ROUTES
app.use("/winkcoin", winkcoinRoutes);

// Healthcheck
app.get("/", (req, res) => res.send("Backend WinkWink attivo e modulare"));

// Socket
io.on("connection", (socket) => {
  registerSocketHandlers(io, socket, pool, onlineUsers, chatRooms);
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server + WebSocket pronti sulla porta ${PORT}`);
});

// Cleanup
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
