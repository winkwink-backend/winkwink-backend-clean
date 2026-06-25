import { sendFCM } from "./firebase-config.js";

export const registerSocketHandlers = (io, socket, pool, onlineUsers, chatRooms) => {
  // log di tutti gli eventi
  socket.onAny((eventName, ...args) => {
    console.log(`📡 [WS EVENT] Ricevuto: "${eventName}" con dati:`, JSON.stringify(args));
  });

  // ------------------------------------------------------------
  // ⭐ FUNZIONI WEBSOCKET ALIAS REALTIME
  // ------------------------------------------------------------
  async function notifyAliasRequest(toAlias, payload) {
    try {
      const userRes = await pool.query(
        "SELECT id FROM users WHERE alias = $1",
        [toAlias]
      );

      if (userRes.rows.length === 0) return;

      const userId = userRes.rows[0].id;
      const socketId = onlineUsers.get(userId);

      if (socketId) {
        io.to(socketId).emit("alias_request_received", payload);
        console.log("📨 WS → alias_request_received inviato a", toAlias);
      }
    } catch (err) {
      console.error("❌ notifyAliasRequest:", err.message);
    }
  }

  async function notifyAliasAccepted(toAlias, payload) {
    try {
      const userRes = await pool.query(
        "SELECT id FROM users WHERE alias = $1",
        [toAlias]
      );

      if (userRes.rows.length === 0) return;

      const userId = userRes.rows[0].id;
      const socketId = onlineUsers.get(userId);

      if (socketId) {
        io.to(socketId).emit("alias_request_accepted", payload);
        console.log("📨 WS → alias_request_accepted inviato a", toAlias);
      }
    } catch (err) {
      console.error("❌ notifyAliasAccepted:", err.message);
    }
  }

  async function notifyAliasRejected(toAlias, payload) {
    try {
      const userRes = await pool.query(
        "SELECT id FROM users WHERE alias = $1",
        [toAlias]
      );

      if (userRes.rows.length === 0) return;

      const userId = userRes.rows[0].id;
      const socketId = onlineUsers.get(userId);

      if (socketId) {
        io.to(socketId).emit("alias_request_rejected", payload);
        console.log("📨 WS → alias_request_rejected inviato a", toAlias);
      }
    } catch (err) {
      console.error("❌ notifyAliasRejected:", err.message);
    }
  }

  // ------------------------------------------------------------
  // PRESENZA
  // ------------------------------------------------------------
  socket.on("register", (userId) => {
    console.log("📡 [DEBUG] REGISTER CHIAMATO", { userId, socketId: socket.id });
    socket.userId = userId;
    onlineUsers.set(userId, socket.id);
    console.log("📡 [WS] Utente registrato:", userId);
    console.log("📡 [DEBUG] onlineUsers:", Array.from(onlineUsers.entries()));
    io.emit("user_online", { userId });
  });

  socket.on("disconnect", (reason) => {
    console.log("📡 [WS] Disconnessione:", {
      socketId: socket.id,
      userId: socket.userId,
      reason,
    });

    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      console.log("📡 [DEBUG] DELETE ESEGUITO → onlineUsers:", Array.from(onlineUsers.entries()));
      io.emit("user_offline", { userId: socket.userId });
    } else {
      console.log("📡 [DEBUG] DISCONNECT SENZA USERID");
    }
  });

  // ------------------------------------------------------------
  // CHAT (stanze)
  // ------------------------------------------------------------
  socket.on("enter_chat", ({ chat_id, user_id }) => {
    if (!chatRooms.has(chat_id)) chatRooms.set(chat_id, new Set());
    chatRooms.get(chat_id).add(socket.id);

    socket.join(`chat_${chat_id}`);
    io.to(socket.id).emit("chat_joined", { chat_id });
    io.emit("user_in_chat", { chat_id, user_id });

    console.log(`📡 Utente ${user_id} entrato nella chat ${chat_id}`);
  });

  socket.on("leave_chat", ({ chat_id, user_id }) => {
    if (chatRooms.has(chat_id)) {
      chatRooms.get(chat_id).delete(socket.id);
      if (chatRooms.get(chat_id).size === 0) chatRooms.delete(chat_id);
    }
    socket.leave(`chat_${chat_id}`);
    console.log(`↩️ Utente ${user_id} uscito dalla chat ${chat_id}`);
  });

  socket.on("send_message", async ({ chat_id, message }) => {
    try {
      const result = await pool.query(
        `INSERT INTO chat_messages (chat_id, sender_id, receiver_id, content, type, status)
         VALUES ($1, $2, $3, $4, $5, 'sent')
         RETURNING *`,
       [
         chat_id,
         message.sender_id,
         message.receiver_id,
         message.content,
         message.type ?? "text"
       ]
     );

      const saved = result.rows[0];

      io.to(`chat_${chat_id}`).emit("new_message", {
        chat_id: parseInt(chat_id),
        sender_id: saved.sender_id,
        receiver_id: saved.receiver_id,
        content: saved.content,
        type: saved.type,
        status: saved.status,
        created_at: saved.created_at,
      });

      console.log(`✅ Messaggio Realtime: Chat ${chat_id}`);
    } catch (err) {
      console.error("❌ ERRORE SQL SOCKET:", err.message);
    }
  });

  // ------------------------------------------------------------
  // SIGNALING WEBRTC (con BLOCKLIST già patchata)
  // ------------------------------------------------------------
  socket.on("offer", async ({ toUserId, offer }) => {
    try {
      const fromUserId = socket.userId;

      const fromAliasRes = await pool.query(
        "SELECT alias FROM users WHERE id = $1",
        [fromUserId]
      );
      const toAliasRes = await pool.query(
        "SELECT alias FROM users WHERE id = $1",
        [toUserId]
      );

      const fromAlias = fromAliasRes.rows[0]?.alias;
      const toAlias = toAliasRes.rows[0]?.alias;

      if (!fromAlias || !toAlias) return;

      const blocked = await pool.query(
        `SELECT 1 FROM blocked_users
         WHERE (blocker_alias = $1 AND blocked_alias = $2)
            OR (blocker_alias = $2 AND blocked_alias = $1)`,
        [fromAlias, toAlias]
      );

      if (blocked.rows.length > 0) {
        console.log(`⛔ OFFER BLOCCATA tra ${fromAlias} e ${toAlias}`);
        return;
      }

      const target = onlineUsers.get(toUserId);
      if (target) io.to(target).emit("offer", { from: socket.userId, offer });

    } catch (err) {
      console.error("❌ Errore OFFER:", err.message);
    }
  });

  socket.on("answer", async ({ toUserId, answer }) => {
    try {
      const fromUserId = socket.userId;

      const fromAliasRes = await pool.query(
        "SELECT alias FROM users WHERE id = $1",
        [fromUserId]
      );
      const toAliasRes = await pool.query(
        "SELECT alias FROM users WHERE id = $1",
        [toUserId]
      );

      const fromAlias = fromAliasRes.rows[0]?.alias;
      const toAlias = toAliasRes.rows[0]?.alias;

      const blocked = await pool.query(
        `SELECT 1 FROM blocked_users
         WHERE (blocker_alias = $1 AND blocked_alias = $2)
            OR (blocker_alias = $2 AND blocked_alias = $1)`,
        [fromAlias, toAlias]
      );

      if (blocked.rows.length > 0) {
        console.log(`⛔ ANSWER BLOCCATA tra ${fromAlias} e ${toAlias}`);
        return;
      }

      const target = onlineUsers.get(toUserId);
      if (target) io.to(target).emit("answer", { from: socket.userId, answer });

    } catch (err) {
      console.error("❌ Errore ANSWER:", err.message);
    }
  });

  socket.on("ice_candidate", async ({ toUserId, candidate }) => {
    try {
      const fromUserId = socket.userId;

      const fromAliasRes = await pool.query(
        "SELECT alias FROM users WHERE id = $1",
        [fromUserId]
      );
      const toAliasRes = await pool.query(
        "SELECT alias FROM users WHERE id = $1",
        [toUserId]
      );

      const fromAlias = fromAliasRes.rows[0]?.alias;
      const toAlias = toAliasRes.rows[0]?.alias;

      const blocked = await pool.query(
        `SELECT 1 FROM blocked_users
         WHERE (blocker_alias = $1 AND blocked_alias = $2)
            OR (blocker_alias = $2 AND blocked_alias = $1)`,
        [fromAlias, toAlias]
      );

      if (blocked.rows.length > 0) {
        console.log(`⛔ ICE BLOCCATO tra ${fromAlias} e ${toAlias}`);
        return;
      }

      console.log("❄️ [ICE] da", socket.userId, "→", toUserId, candidate?.candidate);

      const target = onlineUsers.get(toUserId);
      if (target) io.to(target).emit("ice_candidate", { from: socket.userId, candidate });

    } catch (err) {
      console.error("❌ Errore ICE:", err.message);
    }
  });

  // ------------------------------------------------------------
  // ⭐ EVENTI ALIAS REALTIME (chiamati da aliasRoutes.js)
  // ------------------------------------------------------------
  socket.on("alias_request_emit", async ({ toAlias, fromAlias }) => {
    await notifyAliasRequest(toAlias, {
      type: "alias_request_received",
      alias: fromAlias,
      date: new Date().toISOString()
    });
  });

  socket.on("alias_accept_emit", async ({ toAlias, fromAlias }) => {
    await notifyAliasAccepted(toAlias, {
      type: "alias_request_accepted",
      alias: fromAlias,
      date: new Date().toISOString()
    });
  });

  socket.on("alias_reject_emit", async ({ toAlias, fromAlias }) => {
    await notifyAliasRejected(toAlias, {
      type: "alias_request_rejected",
      alias: fromAlias,
      date: new Date().toISOString()
    });
  });
};
