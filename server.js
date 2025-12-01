// server.js

// 1. Environment Variables
require('dotenv').config();

// 2. Imports
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const axios = require('axios'); // Facebook Messenger
const path = require('path');
const { Buffer } = require('buffer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 80;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;

// ------------------------------------------
// Firebase Initialization
// ------------------------------------------

let serviceAccount;
try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
} catch (e) {
    console.error("ERROR parsing FIREBASE_SERVICE_ACCOUNT_KEY");
    process.exit(1);
}

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin Initialized");
} catch (e) {
    console.error("Firebase Initialization Failed:", e);
    process.exit(1);
}

const db = admin.firestore();
const CHAT_COLLECTION = 'telegram_chats';
const MESSAGE_SUB_COLLECTION = 'messages';

// ------------------------------------------
// Telegram Bot
// ------------------------------------------

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
console.log("Telegram Bot Started");

// ------------------------------------------
// Express Middleware
// ------------------------------------------

app.use(bodyParser.json({ limit: "100mb" }));
app.use(express.static(path.join(__dirname, "public")));

const basicAuthMiddleware = basicAuth({
    users: { [ADMIN_USERNAME]: ADMIN_PASSWORD },
    challenge: true
});

// ------------------------------------------
// Save Message to Firestore
// ------------------------------------------

async function saveMessage(chatId, sender, text, mediaPath = null, username = "Unknown", filename = null) {
    const chatRef = db.collection(CHAT_COLLECTION).doc(String(chatId));

    await chatRef.set(
        {
            username: username,
            lastMessageText: text || filename || 'Media',
            lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
    );

    const messageData = {
        chatId: String(chatId),
        sender,
        text,
        mediaPath,
        filename,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    const savedRef = await chatRef.collection(MESSAGE_SUB_COLLECTION).add(messageData);

    return {
        id: savedRef.id,
        ...messageData,
        timestamp: new Date().toISOString()
    };
}

// ------------------------------------------
// Telegram Incoming
// ------------------------------------------

bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.chat.username || msg.chat.first_name || "TelegramUser";

    let text = msg.text || "";
    let mediaPath = null;
    let filename = null;

    if (msg.photo) {
        mediaPath = msg.photo[msg.photo.length - 1].file_id;
        text = msg.caption || "";
    } else if (msg.document) {
        mediaPath = msg.document.file_id;
        filename = msg.document.file_name;
        text = msg.caption || "";
    }

    const saved = await saveMessage(chatId, "user", text, mediaPath, username, filename);

    io.emit("new_message", {
        platform: "telegram",
        chatId,
        user: { username },
        message: saved
    });
});

// ------------------------------------------
// FACEBOOK Send API
// ------------------------------------------

async function sendFacebookMessage(psid, text) {
    try {
        const url = `https://graph.facebook.com/v17.0/me/messages?access_token=${FB_PAGE_ACCESS_TOKEN}`;
        await axios.post(url, {
            recipient: { id: psid },
            message: { text }
        });

        console.log("FB: Message Sent");
    } catch (err) {
        console.error("FB Send Error:", err.response?.data || err);
        throw err;
    }
}

// ------------------------------------------
// FACEBOOK Webhook VERIFY
// ------------------------------------------

app.get("/fb/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === FB_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

// ------------------------------------------
// FACEBOOK Incoming Messages
// ------------------------------------------

app.post("/fb/webhook", async (req, res) => {
    const body = req.body;

    if (body.object === "page") {
        body.entry.forEach(async (entry) => {
            const event = entry.messaging[0];
            const psid = event.sender.id;

            if (event.message && event.message.text) {
                const text = event.message.text;

                const saved = await saveMessage(psid, "user", text, null, "FB User");

                io.emit("new_message", {
                    platform: "facebook",
                    chatId: psid,
                    user: { username: "FB User" },
                    message: saved
                });
            }
        });

        return res.status(200).send("OK");
    }

    res.sendStatus(404);
});

// ------------------------------------------
// Admin Reply - Telegram & Facebook
// ------------------------------------------

io.on("connection", (socket) => {
    console.log("Admin connected");

    // Telegram Reply
    socket.on("admin_reply", async (data, callback) => {
        const { chatId, text, mediaPath, mediaType, filename } = data;

        try {
            if (mediaPath && mediaType) {
                const parts = mediaPath.split(";base64,");
                const buffer = Buffer.from(parts[1], "base64");
                const mimeType = parts[0].split(":")[1];

                const fileOptions = { filename: filename || "file", contentType: mimeType };

                if (mediaType === "photo") {
                    await bot.sendPhoto(chatId, buffer, { caption: text }, fileOptions);
                } else {
                    await bot.sendDocument(chatId, buffer, { caption: text }, fileOptions);
                }
            } else {
                await bot.sendMessage(chatId, text);
            }

            await saveMessage(chatId, "admin", text, mediaPath, null, filename);

            callback({ success: true });
        } catch (e) {
            callback({ success: false });
        }
    });

    // Facebook Reply
    socket.on("admin_reply_facebook", async (data, callback) => {
        const { chatId, text } = data;

        try {
            await sendFacebookMessage(chatId, text);
            await saveMessage(chatId, "admin", text);

            callback({ success: true });
        } catch (e) {
            callback({ success: false, error: e.message });
        }
    });
});

// ------------------------------------------
// Admin Panel Route
// ------------------------------------------

app.get("/admin", basicAuthMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, "admin_panel.html"));
});

app.get("/", (req, res) => res.redirect("/admin"));

// ------------------------------------------
// START SERVER
// ------------------------------------------

server.listen(PORT, () => {
    console.log("Server running:", PORT);
});
