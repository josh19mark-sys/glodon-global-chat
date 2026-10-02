//============================================================
// GLODON HUB | GLOBAL CHAT
// SERVER.JS
//============================================================

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "64kb" }));

//============================================================
// CONFIG
//============================================================

const PORT = process.env.PORT || 3000;

const OWNER_USERNAME = "ueu9195";

const MAX_MESSAGES = 150;

const PRESENCE_TIMEOUT = 18000;

// Cada 7 minutos
const AUTO_DELETE_INTERVAL = 7 * 60 * 1000;

// Borrar 2 mensajes
const AUTO_DELETE_COUNT = 2;

// Máximo de notificaciones pendientes por usuario
const MAX_PENDING_NOTIFICATIONS = 100;

//============================================================
// MEMORY
//============================================================

const users = new Map();

const messages = [];

const profiles = new Map();

// Usuarios conocidos.
// usernameLower -> {
//     userId,
//     username
// }
const knownUsers = new Map();

// Notificaciones pendientes.
//
// userId -> [
//     {
//         id,
//         type,
//         messageId,
//         fromUserId,
//         fromUsername,
//         message,
//         timestamp
//     }
// ]
//
const pendingNotifications = new Map();

// IDs eliminados recientemente.
// El cliente puede usarlos para quitar mensajes de su GUI.
const recentlyDeleted = [];

let messageSequence = 0;

let notificationSequence = 0;

//============================================================
// BLOCKED TAGS
//============================================================

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

//============================================================
// HELPERS
//============================================================

function cleanText(value, maxLength) {

    if (typeof value !== "string") {
        return "";
    }

    return value
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .trim()
        .slice(0, maxLength);
}

//============================================================

function cleanUsername(value) {

    return cleanText(value, 32)
        .replace(/[<>]/g, "");
}

//============================================================

function validUserId(value) {

    if (
        typeof value !== "string" &&
        typeof value !== "number"
    ) {
        return false;
    }

    const id = String(value);

    return /^\d+$/.test(id) && id.length <= 20;
}

//============================================================

function normalizeUserId(value) {

    return String(value);
}

//============================================================

function validColor(value) {

    if (typeof value !== "string") {
        return false;
    }

    return /^#[0-9A-Fa-f]{6}$/.test(value);
}

//============================================================

function isBlockedTag(tag) {

    if (!tag) {
        return false;
    }

    return BLOCKED_TAGS.has(
        String(tag).trim().toLowerCase()
    );
}

//============================================================
// OWNER
//============================================================

function isOwnerUsername(username) {

    return (
        String(username).trim().toLowerCase() ===
        OWNER_USERNAME.toLowerCase()
    );
}

//============================================================
// KNOWN USERS
//============================================================

function rememberUser(userId, username) {

    if (
        !validUserId(userId) ||
        !username
    ) {
        return;
    }

    const cleanName =
        cleanUsername(username);

    if (!cleanName) {
        return;
    }

    knownUsers.set(
        cleanName.toLowerCase(),
        {
            userId: String(userId),
            username: cleanName
        }
    );
}

//============================================================
// FIND USER BY USERNAME
//============================================================

function findKnownUser(username) {

    if (!username) {
        return null;
    }

    const cleanName =
        String(username)
            .trim()
            .toLowerCase();

    const known =
        knownUsers.get(cleanName);

    if (known) {
        return known;
    }

    // También revisar usuarios conectados
    // por seguridad si todavía no están
    // registrados en knownUsers.
    for (
        const user of users.values()
    ) {

        if (
            String(user.username).toLowerCase() ===
            cleanName
        ) {

            rememberUser(
                user.userId,
                user.username
            );

            return {
                userId: user.userId,
                username: user.username
            };
        }
    }

    return null;
}

//============================================================
// NOTIFICATION ID
//============================================================

function createNotificationId() {

    notificationSequence += 1;

    return (
        Date.now().toString(36)
        +
        "-"
        +
        notificationSequence.toString(36)
    );
}

//============================================================
// ADD PENDING NOTIFICATION
//============================================================

function addPendingNotification(
    targetUserId,
    notification
) {

    if (!validUserId(targetUserId)) {
        return;
    }

    let list =
        pendingNotifications.get(
            String(targetUserId)
        );

    if (!list) {

        list = [];

        pendingNotifications.set(
            String(targetUserId),
            list
        );
    }

    list.push(
        notification
    );

    while (
        list.length >
        MAX_PENDING_NOTIFICATIONS
    ) {

        list.shift();
    }
}

//============================================================
// CREATE MENTION NOTIFICATION
//============================================================

function createMentionNotification(
    targetUserId,
    type,
    messageObject
) {

    return {

        id:
            createNotificationId(),

        type,

        messageId:
            messageObject.id,

        fromUserId:
            messageObject.userId,

        fromUsername:
            messageObject.username,

        message:
            messageObject.message,

        timestamp:
            Date.now(),

        targetUserId:
            String(targetUserId)
    };
}

//============================================================
// USER MENTION EXTRACTION
//============================================================

function extractMentionNames(message) {

    if (
        typeof message !== "string" ||
        message === ""
    ) {
        return [];
    }

    const result = [];

    // Roblox usernames normalmente usan
    // letras, números y "_".
    const regex =
        /@([A-Za-z0-9_]{1,20})/g;

    let match;

    while (
        (match = regex.exec(message)) !== null
    ) {

        const username =
            match[1];

        if (!username) {
            continue;
        }

        const lower =
            username.toLowerCase();

        if (
            !result.some(
                name =>
                    name.toLowerCase() === lower
            )
        ) {

            result.push(username);
        }
    }

    return result;
}

//============================================================
// PROCESS MENTIONS
//============================================================

function processMentions(
    messageObject,
    isOwner
) {

    const messageText =
        messageObject.message || "";

    if (!messageText) {
        return [];
    }

    const mentionNames =
        extractMentionNames(
            messageText
        );

    if (mentionNames.length === 0) {
        return [];
    }

    const notifiedUserIds = new Set();

    //--------------------------------------------------------
    // @ALL
    //--------------------------------------------------------

    const hasAll =
        mentionNames.some(
            name =>
                name.toLowerCase() === "all"
        );

    if (
        hasAll &&
        isOwner
    ) {

        for (
            const known of knownUsers.values()
        ) {

            if (
                String(known.userId) ===
                String(messageObject.userId)
            ) {
                // No notificar al propio creador.
                continue;
            }

            if (
                notifiedUserIds.has(
                    String(known.userId)
                )
            ) {
                continue;
            }

            notifiedUserIds.add(
                String(known.userId)
            );

            const notification =
                createMentionNotification(
                    known.userId,
                    "all",
                    messageObject
                );

            addPendingNotification(
                known.userId,
                notification
            );
        }

        // También revisar usuarios conectados
        // por si todavía no estaban en knownUsers.
        for (
            const user of users.values()
        ) {

            if (
                String(user.userId) ===
                String(messageObject.userId)
            ) {
                continue;
            }

            if (
                notifiedUserIds.has(
                    String(user.userId)
                )
            ) {
                continue;
            }

            rememberUser(
                user.userId,
                user.username
            );

            notifiedUserIds.add(
                String(user.userId)
            );

            const notification =
                createMentionNotification(
                    user.userId,
                    "all",
                    messageObject
                );

            addPendingNotification(
                user.userId,
                notification
            );
        }
    }

    //--------------------------------------------------------
    // MENCIONES INDIVIDUALES
    //--------------------------------------------------------

    for (
        const mentionName of mentionNames
    ) {

        // @all no vuelve a procesarse
        // como mención individual.
        if (
            mentionName.toLowerCase() ===
            "all"
        ) {
            continue;
        }

        const target =
            findKnownUser(
                mentionName
            );

        if (!target) {
            continue;
        }

        if (
            String(target.userId) ===
            String(messageObject.userId)
        ) {
            // No auto-notificarse.
            continue;
        }

        if (
            notifiedUserIds.has(
                String(target.userId)
            )
        ) {
            continue;
        }

        notifiedUserIds.add(
            String(target.userId)
        );

        const notification =
            createMentionNotification(
                target.userId,
                "mention",
                messageObject
            );

        addPendingNotification(
            target.userId,
            notification
        );
    }

    return Array.from(
        notifiedUserIds
    );
}

//============================================================
// DISCORD ICON
//============================================================

function normalizeDiscordIcon(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "";
    }

    let valueString =
        String(value).trim();

    if (/^\d+$/.test(valueString)) {

        return (
            "rbxthumb://type=Asset&id=" +
            valueString +
            "&w=150&h=150"
        );
    }

    if (
        /^rbxassetid:\/\/\d+$/.test(
            valueString
        )
    ) {

        const id =
            valueString.replace(
                "rbxassetid://",
                ""
            );

        return (
            "rbxthumb://type=Asset&id=" +
            id +
            "&w=150&h=150"
        );
    }

    if (
        valueString.startsWith(
            "rbxthumb://"
        )
    ) {

        return valueString.slice(
            0,
            300
        );
    }

    return "";
}

//============================================================
// STICKER
//============================================================

function validSticker(value) {

    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return true;
    }

    const sticker =
        String(value);

    return (
        /^rbxassetid:\/\/\d+$/.test(
            sticker
        )
        ||
        /^rbxthumb:\/\/type=Asset&id=\d+&w=\d+&h=\d+$/.test(
            sticker
        )
    );
}

//============================================================
// PROFILE
//============================================================

function getDefaultProfile(username) {

    const isOwner =
        isOwnerUsername(
            username
        );

    return {

        tag: "",

        color: "#9641FF",

        colorChanges: 0,

        discordIcon: "",

        verified:
            isOwner
    };
}

//============================================================

function getProfile(
    userId,
    username
) {

    let profile =
        profiles.get(
            String(userId)
        );

    if (!profile) {

        profile =
            getDefaultProfile(
                username
            );

        profiles.set(
            String(userId),
            profile
        );
    }

    profile.verified =
        isOwnerUsername(
            username
        );

    rememberUser(
        userId,
        username
    );

    return profile;
}

//============================================================
// PUBLIC PROFILE
//============================================================

function publicProfile(
    userId,
    username
) {

    const profile =
        getProfile(
            userId,
            username
        );

    const isOwner =
        isOwnerUsername(
            username
        );

    return {

        tag:
            isOwner
                ? ""
                : profile.tag,

        color:
            profile.color,

        colorChanges:
            profile.colorChanges,

        discordIcon:
            profile.discordIcon,

        verified:
            isOwner
    };
}

//============================================================
// PRESENCE CLEANUP
//============================================================

function removeOldPresence() {

    const now =
        Date.now();

    for (
        const [
            userId,
            user
        ] of users.entries()
    ) {

        if (
            now - user.lastSeen >
            PRESENCE_TIMEOUT
        ) {

            users.delete(
                userId
            );
        }
    }
}

//============================================================
// DELETE MESSAGE
//============================================================

function deleteOldMessages(
    count
) {

    if (
        messages.length <= 0
    ) {
        return [];
    }

    const amount =
        Math.min(
            count,
            messages.length
        );

    const deleted = [];

    for (
        let i = 0;
        i < amount;
        i++
    ) {

        const old =
            messages.shift();

        if (old) {

            deleted.push(
                old.id
            );

            recentlyDeleted.push(
                old.id
            );
        }
    }

    while (
        recentlyDeleted.length >
        100
    ) {

        recentlyDeleted.shift();
    }

    return deleted;
}

//============================================================
// AUTO DELETE
//============================================================

setInterval(
    function() {

        removeOldPresence();

        const deleted =
            deleteOldMessages(
                AUTO_DELETE_COUNT
            );

        if (
            deleted.length > 0
        ) {

            console.log(
                "[Glodon Hub] Auto-delete:",
                deleted.join(", ")
            );
        }

    },
    AUTO_DELETE_INTERVAL
);

//============================================================
// ROOT
//============================================================

app.get(
    "/",
    function(req, res) {

        res.json({

            ok: true,

            service:
                "Glodon Hub Global Chat",

            version:
                "4.0.0",

            status:
                "online"
        });
    }
);

//============================================================
// HEALTH
//============================================================

app.get(
    "/health",
    function(req, res) {

        res.json({

            ok: true,

            status:
                "online",

            messages:
                messages.length,

            users:
                users.size,

            knownUsers:
                knownUsers.size,

            pendingNotificationUsers:
                pendingNotifications.size,

            uptime:
                process.uptime()
        });
    }
);

//============================================================
// PRESENCE
//============================================================

app.get(
    "/presence",
    function(req, res) {

        removeOldPresence();

        res.json({

            ok: true,

            online:
                users.size
        });
    }
);

//============================================================
// HEARTBEAT
//============================================================

app.post(
    "/heartbeat",
    function(req, res) {

        const userId =
            normalizeUserId(
                req.body?.userId
            );

        const username =
            cleanUsername(
                req.body?.username
            );

        if (
            !validUserId(userId)
            ||
            !username
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "Invalid user"
            });
        }

        users.set(
            userId,
            {

                userId,

                username,

                lastSeen:
                    Date.now()
            }
        );

        // Registrar usuario para menciones.
        rememberUser(
            userId,
            username
        );

        // También crea/actualiza perfil.
        getProfile(
            userId,
            username
        );

        removeOldPresence();

        res.json({

            ok: true,

            online:
                users.size
        });
    }
);

//============================================================
// NOTIFICATIONS
//============================================================
//
// Este endpoint se usa cuando el usuario
// vuelve a ejecutar el script.
//
// Entrega sus menciones pendientes
// y luego las elimina.
//
//============================================================

app.get(
    "/notifications",
    function(req, res) {

        const userId =
            normalizeUserId(
                req.query.userId
            );

        if (
            !validUserId(userId)
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "Invalid userId"
            });
        }

        const list =
            pendingNotifications.get(
                String(userId)
            ) || [];

        // Consumimos las notificaciones.
        pendingNotifications.delete(
            String(userId)
        );

        res.json({

            ok: true,

            notifications:
                list
        });
    }
);

//============================================================
// LEAVE
//============================================================

app.post(
    "/leave",
    function(req, res) {

        const userId =
            normalizeUserId(
                req.body?.userId
            );

        if (
            validUserId(userId)
        ) {

            users.delete(
                userId
            );
        }

        res.json({

            ok: true
        });
    }
);

//============================================================
// PROFILE GET
//============================================================

app.get(
    "/profile/:userId",
    function(req, res) {

        const userId =
            normalizeUserId(
                req.params.userId
            );

        if (
            !validUserId(userId)
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "Invalid userId"
            });
        }

        const user =
            users.get(
                userId
            );

        const username =
            user
                ? user.username
                : "Usuario";

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

//============================================================
// PROFILE POST
//============================================================

app.post(
    "/profile",
    function(req, res) {

        const userId =
            normalizeUserId(
                req.body?.userId
            );

        const username =
            cleanUsername(
                req.body?.username
            );

        if (
            !validUserId(userId)
            ||
            !username
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "Invalid user"
            });
        }

        // Registrar usuario.
        rememberUser(
            userId,
            username
        );

        const profile =
            getProfile(
                userId,
                username
            );

        const isOwner =
            isOwnerUsername(
                username
            );

        //====================================================
        // TAG
        //====================================================

        if (
            req.body.tag !== undefined
        ) {

            const tag =
                cleanText(
                    req.body.tag,
                    24
                );

            if (
                !isOwner
                &&
                isBlockedTag(tag)
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "Blocked tag"
                });
            }

            if (isOwner) {

                profile.tag = "";

            } else {

                profile.tag = tag;
            }
        }

        //====================================================
        // COLOR
        //====================================================

        if (
            req.body.color !== undefined
        ) {

            const color =
                String(
                    req.body.color
                );

            if (
                !validColor(color)
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "Invalid color"
                });
            }

            if (
                profile.colorChanges >= 2
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "Color change limit reached"
                });
            }

            profile.color =
                color.toUpperCase();

            profile.colorChanges += 1;
        }

        //====================================================
        // DISCORD ICON
        //====================================================

        if (
            req.body.discordIcon !== undefined
        ) {

            profile.discordIcon =
                normalizeDiscordIcon(
                    req.body.discordIcon
                );
        }

        //====================================================
        // VERIFIED
        //====================================================

        profile.verified =
            isOwner;

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

//============================================================
// GET MESSAGES
//============================================================

app.get(
    "/messages",
    function(req, res) {

        const limit =
            Math.min(
                Math.max(
                    parseInt(
                        req.query.limit
                    ) || 50,
                    1
                ),
                100
            );

        removeOldPresence();

        const start =
            Math.max(
                0,
                messages.length - limit
            );

        res.json({

            ok: true,

            messages:
                messages.slice(start),

            deletedIds:
                recentlyDeleted.slice()
        });
    }
);

//============================================================
// MESSAGE ID
//============================================================

function createMessageId() {

    messageSequence += 1;

    return (
        Date.now().toString(36)
        +
        "-"
        +
        messageSequence.toString(36)
    );
}

//============================================================
// REPLY DATA
//============================================================

function cleanReply(reply) {

    if (
        !reply
        ||
        typeof reply !== "object"
    ) {

        return null;
    }

    const id =
        cleanText(
            reply.id,
            80
        );

    if (!id) {
        return null;
    }

    const original =
        messages.find(
            message =>
                message.id === id
        );

    if (!original) {
        return null;
    }

    return {

        id:
            original.id,

        username:
            cleanUsername(
                original.username
            ),

        message:
            cleanText(
                original.message,
                180
            ),

        sticker:
            validSticker(
                original.sticker
            )
                ? original.sticker
                : ""
    };
}

//============================================================
// POST MESSAGE
//============================================================

app.post(
    "/messages",
    function(req, res) {

        const userId =
            normalizeUserId(
                req.body?.userId
            );

        const username =
            cleanUsername(
                req.body?.username
            );

        const message =
            cleanText(
                req.body?.message,
                500
            );

        const sticker =
            req.body?.sticker
                ? String(
                    req.body.sticker
                ).trim()
                : "";

        if (
            !validUserId(userId)
        ) {

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

        //====================================================
        // MUST BE CONNECTED
        //====================================================

        removeOldPresence();

        const currentUser =
            users.get(
                userId
            );

        if (
            !currentUser
            ||
            Date.now() -
                currentUser.lastSeen
                >
                PRESENCE_TIMEOUT
        ) {

            users.delete(
                userId
            );

            return res.status(403).json({

                ok: false,

                error:
                    "Not connected"
            });
        }

        // Registrar/actualizar usuario.
        rememberUser(
            userId,
            username
        );

        //====================================================
        // STICKER
        //====================================================

        if (
            sticker
            &&
            !validSticker(sticker)
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "Invalid sticker"
            });
        }

        //====================================================
        // MESSAGE OR STICKER
        //====================================================

        if (
            message === ""
            &&
            sticker === ""
        ) {

            return res.status(400).json({

                ok: false,

                error:
                    "Empty message"
            });
        }

        //====================================================
        // PROFILE
        //====================================================

        const profile =
            getProfile(
                userId,
                username
            );

        const isOwner =
            isOwnerUsername(
                username
            );

        //====================================================
        // @ALL SECURITY
        //====================================================

        const containsAll =
            /(^|\s)@all\b/i.test(
                message
            );

        if (
            containsAll
            &&
            !isOwner
        ) {

            return res.status(403).json({

                ok: false,

                error:
                    "Only the owner can use @all"
            });
        }

        //====================================================
        // REPLY
        //====================================================

        let replyTo = null;

        if (
            req.body.replyTo
        ) {

            replyTo =
                cleanReply(
                    req.body.replyTo
                );

            if (
                !replyTo
            ) {

                return res.status(400).json({

                    ok: false,

                    error:
                        "Reply message not found"
                });
            }
        }

        //====================================================
        // CREATE MESSAGE
        //====================================================

        const newMessage = {

            id:
                createMessageId(),

            userId,

            username,

            tag:
                isOwner
                    ? "Owner"
                    : profile.tag,

            color:
                profile.color,

            verified:
                isOwner,

            discordIcon:
                profile.discordIcon || "",

            message,

            sticker,

            replyTo,

            timestamp:
                Date.now()
        };

        messages.push(
            newMessage
        );

        //====================================================
        // PROCESS MENTIONS
        //====================================================

        const mentionedUserIds =
            processMentions(
                newMessage,
                isOwner
            );

        // Se devuelve al cliente para que
        // pueda saber que la mención fue procesada.
        newMessage.mentionedUserIds =
            mentionedUserIds;

        //====================================================
        // HARD LIMIT
        //====================================================

        while (
            messages.length >
            MAX_MESSAGES
        ) {

            const deleted =
                messages.shift();

            if (deleted) {

                recentlyDeleted.push(
                    deleted.id
                );
            }
        }

        while (
            recentlyDeleted.length >
            100
        ) {

            recentlyDeleted.shift();
        }

        res.json({

            ok: true,

            message:
                newMessage
        });
    }
);

//============================================================
// START
//============================================================

app.listen(
    PORT,
    function() {

        console.log(
            "=========================================="
        );

        console.log(
            "Glodon Hub | Global Chat"
        );

        console.log(
            "Server running on port " +
            PORT
        );

        console.log(
            "Auto delete: 2 messages / 7 minutes"
        );

        console.log(
            "Mentions: ENABLED"
        );

        console.log(
            "@all: OWNER ONLY"
        );

        console.log(
            "Owner: " +
            OWNER_USERNAME
        );

        console.log(
            "=========================================="
        );
    }
);
