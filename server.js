const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "32kb" }));

const PORT = process.env.PORT || 3000;

// ==============================
// CONFIGURACIÓN
// ==============================

const PRESENCE_TIMEOUT = 20000;
const MAX_MESSAGES = 250;
const MAX_MESSAGE_LENGTH = 300;
const MESSAGE_COOLDOWN = 700;

// ==============================
// DATOS DEL SERVIDOR
// ==============================

const users = new Map();
const messages = [];

let nextMessageId = 1;

// ==============================
// LIMPIAR USUARIOS OFFLINE
// ==============================

function cleanUsers() {
    const now = Date.now();

    for (const [userId, user] of users.entries()) {
        if (now - user.lastSeen > PRESENCE_TIMEOUT) {
            users.delete(userId);
        }
    }
}

// ==============================
// VALIDAR TEXTO
// ==============================

function validText(value, maxLength) {
    return (
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= maxLength
    );
}

// ==============================
// INICIO
// ==============================

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "Glodon Hub Global Chat",
        status: "online"
    });
});

// ==============================
// HEALTH CHECK
// ==============================

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        status: "online"
    });
});

// ==============================
// PRESENCIA
// ==============================

app.get("/presence", (req, res) => {

    cleanUsers();

    res.json({
        ok: true,
        online: users.size
    });
});

// ==============================
// HEARTBEAT
// ==============================

app.post("/heartbeat", (req, res) => {

    cleanUsers();

    const {
        userId,
        username,
        avatar
    } = req.body || {};

    if (!validText(String(userId || ""), 100)) {
        return res.status(400).json({
            ok: false,
            error: "Invalid userId"
        });
    }

    const id = String(userId);

    const existing = users.get(id);

    users.set(id, {
        userId: id,

        username:
            validText(username, 40)
                ? username.trim()
                : "Usuario",

        avatar:
            validText(avatar, 500)
                ? avatar
                : "",

        lastSeen: Date.now(),

        lastMessage:
            existing?.lastMessage || 0
    });

    res.json({
        ok: true,
        online: users.size
    });
});

// ==============================
// SALIR DEL CHAT
// ==============================

app.post("/leave", (req, res) => {

    const {
        userId
    } = req.body || {};

    if (userId !== undefined && userId !== null) {
        users.delete(String(userId));
    }

    res.json({
        ok: true
    });
});

// ==============================
// OBTENER MENSAJES
// ==============================

app.get("/messages", (req, res) => {

    const requestedLimit =
        parseInt(req.query.limit, 10) || 50;

    const limit = Math.min(
        Math.max(requestedLimit, 1),
        50
    );

    const result = messages.slice(-limit);

    res.json({
        ok: true,
        messages: result
    });
});

// ==============================
// ENVIAR MENSAJE
// ==============================

app.post("/messages", (req, res) => {

    cleanUsers();

    const {
        userId,
        username,
        avatar,
        color,
        tag,
        message
    } = req.body || {};

    if (!validText(String(userId || ""), 100)) {
        return res.status(400).json({
            ok: false,
            error: "Invalid userId"
        });
    }

    if (!validText(username, 40)) {
        return res.status(400).json({
            ok: false,
            error: "Invalid username"
        });
    }

    if (!validText(message, MAX_MESSAGE_LENGTH)) {
        return res.status(400).json({
            ok: false,
            error: "Invalid message"
        });
    }

    const id = String(userId);

    // Solo usuarios conectados pueden escribir
    if (!users.has(id)) {
        return res.status(403).json({
            ok: false,
            error: "Not connected"
        });
    }

    // Anti-spam
    const now = Date.now();

    const user = users.get(id);

    const previousMessage =
        user.lastMessage || 0;

    if (now - previousMessage < MESSAGE_COOLDOWN) {
        return res.status(429).json({
            ok: false,
            error: "Too fast"
        });
    }

    user.lastMessage = now;

    // Crear mensaje
    const newMessage = {
        id: nextMessageId++,

        userId: id,

        username: username.trim(),

        avatar:
            validText(avatar, 500)
                ? avatar
                : "",

        color:
            validText(color, 30)
                ? color
                : "FFFFFF",

        tag:
            validText(tag, 50)
                ? tag
                : "",

        message: message.trim(),

        timestamp: now
    };

    messages.push(newMessage);

    // Mantener solamente los últimos mensajes
    while (messages.length > MAX_MESSAGES) {
        messages.shift();
    }

    res.json({
        ok: true,
        message: newMessage
    });
});

// ==============================
// ERROR DEL SERVIDOR
// ==============================

app.use((err, req, res, next) => {

    console.error(err);

    res.status(500).json({
        ok: false,
        error: "Internal server error"
    });
});

// ==============================
// INICIAR SERVIDOR
// ==============================

app.listen(PORT, "0.0.0.0", () => {

    console.log(
        "Glodon Hub Global Chat running on port " + PORT
    );

});