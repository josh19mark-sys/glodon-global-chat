const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 3000;

const OWNER_USERNAME = "ueu9195";

const MAX_MESSAGES = 150;
const PRESENCE_TIMEOUT = 18000;
const MAX_COLOR_CHANGES = 2;

const BLOCKED_TAGS = new Set([
  "admin",
  "creator",
  "67",
  "xd",
  "haa",
  "verificado",
  "desarrollador",
  "mod",
  "moderador"
]);

const users = new Map();
const messages = [];
const profiles = new Map();

function now() {
  return Date.now();
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";

  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanUsername(value) {
  return cleanText(value, 32) || "Usuario";
}

function validUserId(value) {
  if (typeof value !== "string") return false;

  return (
    value.length >= 1 &&
    value.length <= 80 &&
    /^[a-zA-Z0-9_.:-]+$/.test(value)
  );
}

function validColor(value) {
  if (typeof value !== "string") return false;

  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

function validSticker(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value !== "string") return "";

  // Acepta:
  // rbxassetid://123456
  // https://www.roblox.com/asset/?id=123456
  // https://create.roblox.com/asset/?id=123456
  if (
    /^rbxassetid:\/\/\d+$/.test(value) ||
    /^https:\/\/www\.roblox\.com\/asset\/\?id=\d+$/.test(value) ||
    /^https:\/\/create\.roblox\.com\/asset\/\?id=\d+$/.test(value)
  ) {
    return value;
  }

  return "";
}

function isBlockedTag(tag) {
  if (!tag) return false;

  return BLOCKED_TAGS.has(tag.toLowerCase());
}

function removeOldPresence() {
  const limit = now() - PRESENCE_TIMEOUT;

  for (const [userId, user] of users.entries()) {
    if (user.lastSeen < limit) {
      users.delete(userId);
    }
  }
}

function isConnected(userId) {
  removeOldPresence();

  const user = users.get(userId);

  if (!user) return false;

  return now() - user.lastSeen <= PRESENCE_TIMEOUT;
}

function publicProfile(userId, username) {
  const existing = profiles.get(userId);

  const safeUsername = cleanUsername(username);

  if (!existing) {
    return {
      userId,
      username: safeUsername,
      tag: "",
      color: "#FFFFFF",
      colorChanges: 0,
      verified: safeUsername.toLowerCase() === OWNER_USERNAME.toLowerCase()
    };
  }

  return {
    userId,
    username: existing.username,
    tag: existing.tag,
    color: existing.color,
    colorChanges: existing.colorChanges,
    verified: existing.verified
  };
}

/* =========================
   HOME / HEALTH
========================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Glodon Hub Global Chat",
    status: "online",
    version: "2.0.0"
  });
});

app.get("/health", (req, res) => {
  removeOldPresence();

  res.json({
    ok: true,
    status: "online",
    users: users.size,
    messages: messages.length,
    timestamp: now()
  });
});

/* =========================
   PRESENCE
========================= */

app.get("/presence", (req, res) => {
  removeOldPresence();

  res.json({
    ok: true,
    online: users.size,
    timestamp: now()
  });
});

app.post("/heartbeat", (req, res) => {
  const userId = cleanText(req.body?.userId, 80);
  const username = cleanUsername(req.body?.username);

  if (!validUserId(userId)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid userId"
    });
  }

  users.set(userId, {
    userId,
    username,
    lastSeen: now()
  });

  // Crear perfil automáticamente
  if (!profiles.has(userId)) {
    profiles.set(userId, {
      userId,
      username,
      tag: "",
      color: "#FFFFFF",
      colorChanges: 0,
      verified:
        username.toLowerCase() === OWNER_USERNAME.toLowerCase()
    });
  } else {
    const profile = profiles.get(userId);

    profile.username = username;

    // La verificación del propietario se mantiene basada
    // en el nombre recibido.
    profile.verified =
      username.toLowerCase() === OWNER_USERNAME.toLowerCase();
  }

  res.json({
    ok: true,
    online: users.size,
    profile: publicProfile(userId, username)
  });
});

app.post("/leave", (req, res) => {
  const userId = cleanText(req.body?.userId, 80);

  if (userId) {
    users.delete(userId);
  }

  res.json({
    ok: true,
    online: users.size
  });
});

/* =========================
   PROFILES
========================= */

app.get("/profile/:userId", (req, res) => {
  const userId = cleanText(req.params.userId, 80);

  if (!validUserId(userId)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid userId"
    });
  }

  const user = users.get(userId);

  const username =
    user?.username ||
    profiles.get(userId)?.username ||
    "Usuario";

  res.json({
    ok: true,
    profile: publicProfile(userId, username)
  });
});

app.post("/profile", (req, res) => {
  const userId = cleanText(req.body?.userId, 80);
  const username = cleanUsername(req.body?.username);

  if (!validUserId(userId)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid userId"
    });
  }

  if (!isConnected(userId)) {
    return res.status(403).json({
      ok: false,
      error: "Not connected"
    });
  }

  let profile = profiles.get(userId);

  if (!profile) {
    profile = {
      userId,
      username,
      tag: "",
      color: "#FFFFFF",
      colorChanges: 0,
      verified:
        username.toLowerCase() === OWNER_USERNAME.toLowerCase()
    };

    profiles.set(userId, profile);
  }

  profile.username = username;

  const isOwner =
    username.toLowerCase() === OWNER_USERNAME.toLowerCase();

  profile.verified = isOwner;

  /* ---------- TAG ---------- */

  if (Object.prototype.hasOwnProperty.call(req.body, "tag")) {
    const requestedTag = cleanText(req.body.tag, 24);

    // El propietario puede usar su tag personalizado.
    if (isOwner) {
      profile.tag = requestedTag;
    } else {
      // Usuarios normales no pueden usar tags bloqueados.
      if (isBlockedTag(requestedTag)) {
        return res.status(400).json({
          ok: false,
          error: "Blocked tag"
        });
      }

      profile.tag = requestedTag;
    }
  }

  /* ---------- COLOR ---------- */

  if (Object.prototype.hasOwnProperty.call(req.body, "color")) {
    const requestedColor = req.body.color;

    if (!validColor(requestedColor)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid color"
      });
    }

    if (requestedColor !== profile.color) {
      if (profile.colorChanges >= MAX_COLOR_CHANGES) {
        return res.status(403).json({
          ok: false,
          error: "Color change limit reached",
          limit: MAX_COLOR_CHANGES
        });
      }

      profile.color = requestedColor;
      profile.colorChanges++;
    }
  }

  profiles.set(userId, profile);

  res.json({
    ok: true,
    profile: publicProfile(userId, username)
  });
});

/* =========================
   MESSAGES
========================= */

app.get("/messages", (req, res) => {
  const requestedLimit = Number.parseInt(req.query.limit, 10);

  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 50)
      : 50;

  const result = messages.slice(-limit);

  res.json({
    ok: true,
    messages: result
  });
});

app.post("/messages", (req, res) => {
  const userId = cleanText(req.body?.userId, 80);
  const username = cleanUsername(req.body?.username);

  if (!validUserId(userId)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid userId"
    });
  }

  if (!isConnected(userId)) {
    return res.status(403).json({
      ok: false,
      error: "Not connected"
    });
  }

  const messageText = cleanText(req.body?.message, 500);
  const sticker = validSticker(req.body?.sticker);

  if (!messageText && !sticker) {
    return res.status(400).json({
      ok: false,
      error: "Empty message"
    });
  }

  let profile = profiles.get(userId);

  if (!profile) {
    profile = {
      userId,
      username,
      tag: "",
      color: "#FFFFFF",
      colorChanges: 0,
      verified:
        username.toLowerCase() === OWNER_USERNAME.toLowerCase()
    };

    profiles.set(userId, profile);
  }

  profile.username = username;

  const isOwner =
    username.toLowerCase() === OWNER_USERNAME.toLowerCase();

  profile.verified = isOwner;

  const message = {
    id:
      `${Date.now()}-` +
      Math.random().toString(36).slice(2, 10),

    userId,

    username: profile.username,

    tag: profile.tag,

    color: profile.color,

    verified: profile.verified,

    message: messageText,

    sticker,

    timestamp: now()
  };

  messages.push(message);

  // Máximo 150 mensajes en memoria.
  while (messages.length > MAX_MESSAGES) {
    messages.shift();
  }

  res.json({
    ok: true,
    message
  });
});

/* =========================
   404
========================= */

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found"
  });
});

/* =========================
   ERROR HANDLER
========================= */

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    ok: false,
    error: "Internal server error"
  });
});

/* =========================
   START
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Glodon Hub Global Chat running on port ${PORT}`
  );
});
