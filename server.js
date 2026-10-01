// ========================================================
// GLODON HUB | GLOBAL CHAT SERVER
// ========================================================

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json({ limit: "64kb" }));

// ========================================================
// CONFIG
// ========================================================

const PORT = process.env.PORT || 10000;

const OWNER_USERNAME = "ueu9195";

// ========================================================
// DISCORD IMAGE
// ========================================================
// Pon aquí el ID NUMÉRICO de la imagen de Roblox que quieres
// mostrar al lado de [ Discord server ].
//
// Ejemplo:
// const DISCORD_IMAGE_ID = "1234567890";
//
// Si lo dejas vacío, no aparecerá imagen.

const DISCORD_IMAGE_ID = "";

// ========================================================
// LIMITES
// ========================================================

const MAX_MESSAGES = 150;

const PRESENCE_TIMEOUT = 18 * 1000;

// Cada 7 minutos se eliminan 2 mensajes antiguos.
const MESSAGE_CLEAN_INTERVAL = 7 * 60 * 1000;

// ========================================================
// DATA
// ========================================================

const users = new Map();

const profiles = new Map();

const messages = [];

// ========================================================
// BLOCKED TAGS
// ========================================================

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

// ========================================================
// HELPERS
// ========================================================

function cleanText(value, maxLength = 500) {

    if (typeof value !== "string") {
        return "";
    }

    return value
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .trim()
        .slice(0, maxLength);
}

function cleanUsername(value) {

    return cleanText(value, 30)
        .replace(/[^\w.-]/g, "");
}

function validUserId(value) {

    if (
        value === undefined ||
        value === null
    ) {
        return false;
    }

    return /^[0-9]{1,30}$/.test(
        String(value)
    );
}

function validColor(value) {

    if (typeof value !== "string") {
        return false;
    }

    return /^#[0-9A-Fa-f]{6}$/.test(value);
}

function validSticker(value) {

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return true;
    }

    return /^[0-9]{3,20}$/.test(
        String(value)
    );
}

function normalizeTag(value) {

    return cleanText(value, 30);
}

function isBlockedTag(value) {

    if (!value) {
        return false;
    }

    return BLOCKED_TAGS.has(
        String(value).toLowerCase()
    );
}

function removeOldPresence() {

    const now = Date.now();

    for (
        const [userId, user] of users.entries()
    ) {

        if (
            now - user.lastSeen
            >
            PRESENCE_TIMEOUT
        ) {

            users.delete(userId);

        }

    }

}

function isOwner(username) {

    return (
        String(username || "").toLowerCase()
        ===
        OWNER_USERNAME.toLowerCase()
    );

}

function publicProfile(userId, username) {

    const profile =
        profiles.get(String(userId))
        ||
        {
            color: "#FFFFFF",
            tag: ""
        };

    const owner =
        isOwner(username);

    return {

        userId: String(userId),

        username:
            cleanUsername(username),

        color:
            validColor(profile.color)
                ? profile.color
                : "#FFFFFF",

        tag:
            owner
                ? ""
                : (
                    isBlockedTag(profile.tag)
                        ? ""
                        : profile.tag
                ),

        verified: owner,

        discordImage:
            DISCORD_IMAGE_ID

    };

}

function sanitizeReply(reply) {

    if (
        !reply ||
        typeof reply !== "object"
    ) {
        return null;
    }

    const id =
        cleanText(
            String(reply.id || ""),
            80
        );

    if (!id) {
        return null;
    }

    return {

        id: id,

        username:
            cleanUsername(
                reply.username || "Usuario"
            ),

        message:
            cleanText(
                reply.message || "",
                180
            ),

        sticker:
            validSticker(reply.sticker)
                ? String(reply.sticker || "")
                : ""

    };

}

function createMessageId() {

    try {

        return crypto.randomUUID();

    } catch {

        return (
            Date.now().toString(36)
            +
            Math.random()
                .toString(36)
                .slice(2)
        );

    }

}

// ========================================================
// ROUTES
// ========================================================

app.get("/", (req, res) => {

    res.json({

        ok: true,

        name:
            "Glodon Hub Global Chat",

        status:
            "online",

        discordImage:
            DISCORD_IMAGE_ID

    });

});

// ========================================================
// HEALTH
// ========================================================

app.get("/health", (req, res) => {

    res.json({

        ok: true,

        server: "Glodon Hub",

        uptime:
            Math.floor(process.uptime()),

        messages:
            messages.length,

        users:
            users.size,

        discordImage:
            DISCORD_IMAGE_ID

    });

});

// ========================================================
// PRESENCE
// ========================================================

app.get("/presence", (req, res) => {

    removeOldPresence();

    res.json({

        ok: true,

        online:
            users.size,

        discordImage:
            DISCORD_IMAGE_ID

    });

});

// ========================================================
// HEARTBEAT
// ========================================================

app.post("/heartbeat", (req, res) => {

    removeOldPresence();

    const userId =
        String(req.body?.userId || "");

    const username =
        cleanUsername(
            req.body?.username || ""
        );

    if (!validUserId(userId)) {

        return res.status(400).json({

            ok: false,

            error:
                "Invalid userId"

        });

    }

    if (!username) {

        return res.status(400).json({

            ok: false,

            error:
                "Invalid username"

        });

    }

    users.set(
        userId,
        {

            userId:

                userId,

            username:

                username,

            lastSeen:

                Date.now()

        }
    );

    res.json({

        ok: true,

        online:
            users.size,

        discordImage:
            DISCORD_IMAGE_ID

    });

});

// ========================================================
// LEAVE
// ========================================================

app.post("/leave", (req, res) => {

    const userId =
        String(req.body?.userId || "");

    if (validUserId(userId)) {

        users.delete(userId);

    }

    res.json({

        ok: true

    });

});

// ========================================================
// PROFILE GET
// ========================================================

app.get(
    "/profile/:userId",
    (req, res) => {

        const userId =
            String(
                req.params.userId || ""
            );

        if (!validUserId(userId)) {

            return res.status(400).json({

                ok: false,

                error:
                    "Invalid userId"

            });

        }

        let username = "Usuario";

        const onlineUser =
            users.get(userId);

        if (onlineUser) {

            username =
                onlineUser.username;

        }

        res.json({

            ok: true,

            profile:
                publicProfile(
                    userId,
                    username
                )

        });

    }
);

// ========================================================
// PROFILE POST
// ========================================================

app.post("/profile", (req, res) => {

    const userId =
        String(req.body?.userId || "");

    const username =
        cleanUsername(
            req.body?.username || ""
        );

    if (!validUserId(userId)) {

        return res.status(400).json({

            ok: false,

            error:
                "Invalid userId"

        });

    }

    if (!username) {

        return res.status(400).json({

            ok: false,

            error:
                "Invalid username"

        });

    }

    let profile =
        profiles.get(userId);

    if (!profile) {

        profile = {

            color: "#FFFFFF",

            tag: "",

            colorChanges: 0

        };

        profiles.set(
            userId,
            profile
        );

    }

    // ----------------------------------------------------
    // COLOR
    // ----------------------------------------------------

    if (
        req.body.color !== undefined
    ) {

        const color =
            String(
                req.body.color || ""
            );

        if (!validColor(color)) {

            return res.status(400).json({

                ok: false,

                error:
                    "Invalid color"

            });

        }

        if (
            color !== profile.color
            &&
            profile.colorChanges >= 2
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "Color change limit reached"

            });

        }

        if (
            color !== profile.color
        ) {

            profile.colorChanges += 1;

        }

        profile.color =
            color;

    }

    // ----------------------------------------------------
    // TAG
    // ----------------------------------------------------

    if (
        req.body.tag !== undefined
    ) {

        const tag =
            normalizeTag(
                req.body.tag
            );

        // Owner no puede cambiar su etiqueta.
        if (isOwner(username)) {

            profile.tag = "";

        } else {

            if (
                isBlockedTag(tag)
            ) {

                profile.tag = "";

            } else {

                profile.tag = tag;

            }

        }

    }

    profiles.set(
        userId,
        profile
    );

    res.json({

        ok: true,

        profile:
            publicProfile(
                userId,
                username
            ),

        colorChanges:
            profile.colorChanges,

        colorChangesRemaining:
            Math.max(
                0,
                2 - profile.colorChanges
            )

    });

});

// ========================================================
// GET MESSAGES
// ========================================================

app.get("/messages", (req, res) => {

    const limit =
        Math.min(
            50,
            Math.max(
                1,
                Number(
                    req.query.limit
                )
                ||
                50
            )
        );

    const result =
        messages.slice(
            Math.max(
                0,
                messages.length - limit
            )
        );

    res.json({

        ok: true,

        messages:
            result,

        discordImage:
            DISCORD_IMAGE_ID

    });

});

// ========================================================
// POST MESSAGE
// ========================================================

app.post("/messages", (req, res) => {

    removeOldPresence();

    const userId =
        String(req.body?.userId || "");

    const username =
        cleanUsername(
            req.body?.username || ""
        );

    const message =
        cleanText(
            req.body?.message || "",
            500
        );

    const sticker =
        req.body?.sticker
            ? String(
                req.body.sticker
            )
            : "";

    // ----------------------------------------------------
    // CHECK USER
    // ----------------------------------------------------

    if (!validUserId(userId)) {

        return res.status(400).json({

            ok: false,

            error:
                "Invalid userId"

        });

    }

    if (!username) {

        return res.status(400).json({

            ok: false,

            error:
                "Invalid username"

        });

    }

    const onlineUser =
        users.get(userId);

    if (!onlineUser) {

        return res.status(403).json({

            ok: false,

            error:
                "User is not connected"

        });

    }

    // ----------------------------------------------------
    // CHECK STICKER
    // ----------------------------------------------------

    if (!validSticker(sticker)) {

        return res.status(400).json({

            ok: false,

            error:
                "Invalid sticker"

        });

    }

    if (
        !message &&
        !sticker
    ) {

        return res.status(400).json({

            ok: false,

            error:
                "Empty message"

        });

    }

    // ----------------------------------------------------
    // PROFILE
    // ----------------------------------------------------

    const profile =
        profiles.get(userId)
        ||
        {
            color: "#FFFFFF",
            tag: "",
            colorChanges: 0
        };

    // ----------------------------------------------------
    // REPLY
    // ----------------------------------------------------

    const replyTo =
        sanitizeReply(
            req.body?.replyTo
        );

    // ----------------------------------------------------
    // MESSAGE
    // ----------------------------------------------------

    const newMessage = {

        id:
            createMessageId(),

        userId:
            userId,

        username:
            username,

        tag:
            isOwner(username)
                ? ""
                : (
                    isBlockedTag(
                        profile.tag
                    )
                        ? ""
                        : profile.tag
                ),

        color:
            validColor(profile.color)
                ? profile.color
                : "#FFFFFF",

        verified:
            isOwner(username),

        message:
            message,

        sticker:
            sticker,

        replyTo:
            replyTo,

        discordImage:
            DISCORD_IMAGE_ID,

        timestamp:
            Date.now()

    };

    messages.push(
        newMessage
    );

    // Seguridad adicional de memoria.
    while (
        messages.length >
        MAX_MESSAGES
    ) {

        messages.shift();

    }

    res.json({

        ok: true,

        message:
            newMessage

    });

});

// ========================================================
// AUTO CLEAN
// ========================================================
// Cada 7 minutos elimina exactamente 2 mensajes antiguos.
// Si hay menos de 2, elimina los que existan.

setInterval(() => {

    const amount =
        Math.min(
            2,
            messages.length
        );

    for (
        let i = 0;
        i < amount;
        i++
    ) {

        messages.shift();

    }

    console.log(
        "[Glodon] Limpieza automática:",
        amount,
        "mensajes eliminados."
    );

}, MESSAGE_CLEAN_INTERVAL);

// ========================================================
// PRESENCE CLEAN
// ========================================================

setInterval(() => {

    removeOldPresence();

}, 5000);

// ========================================================
// SERVER
// ========================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "======================================"
        );

        console.log(
            "Glodon Hub Global Chat"
        );

        console.log(
            "Server online"
        );

        console.log(
            "Port:",
            PORT
        );

        console.log(
            "Discord image:",
            DISCORD_IMAGE_ID || "OFF"
        );

        console.log(
            "Auto clean: 2 messages / 7 minutes"
        );

        console.log(
            "======================================"

        );

    }
);
