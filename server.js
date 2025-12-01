// server.js

// 1. Environment Variables Loading
require('dotenv').config();

// 2. Constants and Dependencies
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const path = require('path');
const axios = require('axios');
const { Buffer } = require('buffer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 80;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Facebook ENV
const FB_PAGE_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;

// -------------------------------------------------------
// 3. Firebase Admin Initialization (Fixes Code 16)
// -------------------------------------------------------
let serviceAccount;
try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
} catch (e) {
    console.error("ERROR: FIREBASE_SERVICE_ACCOUNT_KEY invalid JSON.");
    process.exit(1);
}

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin SDK initialized.");
} catch (e) {
    console.error("Firebase Admin Initialization Failed:", e.message);
    process.exit(1);
}

const db = admin.firestore();
const CHAT_COLLECTION = 'telegram_chats';
const MESSAGE_SUB_COLLECTION = 'messages';

// -------------------------------------------------------
// 4. Telegram Bot Setup
// -------------------------------------------------------
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
console.log(`Telegram Bot polling: ${TELEGRAM_BOT_TOKEN ? "OK" : "MISSING TOKEN"}`);

// -------------------------------------------------------
// 5. Express Middleware
// -------------------------------------------------------
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Basic Auth
const basicAuthMiddleware = basicAuth({
    users: { [ADMIN_USERNAME]: ADMIN_PASSWORD },
    challenge: true,
    unauthorizedResponse: () => 'Unauthorized'
});

// -------------------------------------------------------
// 6. Helper - Save Message to Firestore
// -------------------------------------------------------
async function saveMessage(chatId, sender, text, mediaPath = null, username = null, filename = null) {
    const chatRef = db.collection(CHAT_COLLECTION).doc(String(chatId));

    const chatUpdate = {
        lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageText: text || (mediaPath ? filename || 'Media' : 'No text'),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (sender === "user" && username) chatUpdate.username = username;

    await chatRef.set(chatUpdate, { merge: true });

    const messageData = {
        chatId: String(chatId),
        sender,
        text,
        mediaPath,
        filename,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    const messageRef = await chatRef.collection(MESSAGE_SUB_COLLECTION).add(messageData);

    return {
        id: messageRef.id,
        ...messageData,
        timestamp: new Date().toISOString()
    };
}

// -------------------------------------------------------
// 7. Telegram Bot Handlers
// -------------------------------------------------------
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.chat.username || msg.chat.first_name || String(chatId);
    let text = msg.text || '';
    let mediaPath = null;
    let filename = null;

    if (msg.photo?.length > 0) {
        mediaPath = msg.photo[msg.photo.length - 1].file_id;
        text = msg.caption || '';
    } else if (msg.document) {
        mediaPath = msg.document.file_id;
        filename = msg.document.file_name;
        text = msg.caption || '';
    }

    if (!text && !mediaPath) return;

    try {
        const savedMessage = await saveMessage(chatId, 'user', text, mediaPath, username, filename);

        io.emit('new_message', {
            chatId,
            message: savedMessage,
            user: {
                telegramId: String(chatId),
                username,
                lastMessageTime: savedMessage.timestamp,
                lastMessageText: savedMessage.text,
            },
            platform: "telegram"
        });

    } catch (error) {
        console.error("Telegram Message Error:", error);
    }
});

// -------------------------------------------------------
// 8. Facebook Messenger Integration
// -------------------------------------------------------

// Send API Function
async function sendFacebookMessage(psid, text) {
    try {
        const url = `https://graph.facebook.com/v17.0/me/messages?access_token=${FB_PAGE_TOKEN}`;
        const payload = {
            recipient: { id: psid },
            message: { text }
        };
        const response = await axios.post(url, payload);
        console.log("FB message sent:", response.data);
    } catch (err) {
        console.error("FB Send Error:", err.response?.data || err.message);
        throw err;
    }
}

// Facebook Webhook Verify
app.get("/fb/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === FB_VERIFY_TOKEN) {
        console.log("FB Webhook Verified.");
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

// Facebook Webhook Receiver
app.post("/fb/webhook", async (req, res) => {
    const body = req.body;

    if (body.object !== "page") return res.sendStatus(404);

    body.entry.forEach(async (entry) => {
        const event = entry.messaging[0];
        const psid = event.sender.id;

        if (event.message?.text) {
            const text = event.message.text;

            const saved = await saveMessage(
                psid,
                "user",
                text,
                null,
                "FB_User"
            );

            io.emit("new_message", {
                chatId: psid,
                message: saved,
                user: {
                    telegramId: psid,
                    username: "Facebook User",
                    lastMessageText: text
                },
                platform: "facebook"
            });
        }
    });

    res.sendStatus(200);
});

// -------------------------------------------------------
// 9. Admin Reply Handler (Socket.io)
// -------------------------------------------------------
io.on('connection', (socket) => {
    console.log("Admin connected");

    // Admin → Telegram
    socket.on('admin_reply', async (data, callback) => {
        try {
            const { chatId, text, mediaPath, mediaType, filename } = data;
            let telegramResponse;

            if (mediaPath && mediaType) {
                const parts = mediaPath.split(";base64,");
                const buffer = Buffer.from(parts[1], 'base64');
                const mimeType = parts[0].split(":")[1];
                const fileOptions = { filename, contentType: mimeType };

                if (mediaType === "photo") {
                    telegramResponse = await bot.sendPhoto(chatId, buffer, { caption: text }, fileOptions);
                } else if (mediaType === "document") {
                    telegramResponse = await bot.sendDocument(chatId, buffer, { caption: text }, fileOptions);
                }
            } else {
                telegramResponse = await bot.sendMessage(chatId, text);
            }

            await saveMessage(chatId, "admin", text, mediaPath, null, filename);

            callback?.({ success: true });

        } catch (err) {
            console.error("Telegram Admin Reply Error:", err);
            callback?.({ success: false });
        }
    });

    // Admin → Facebook
    socket.on("admin_reply_facebook", async (data, callback) => {
        try {
            await sendFacebookMessage(data.chatId, data.text);
            await saveMessage(data.chatId, "admin", data.text);

            callback?.({ success: true });
        } catch (err) {
            callback?.({ success: false, error: err.message });
        }
    });

    socket.on("disconnect", () => console.log("Admin disconnected"));
});

// -------------------------------------------------------
// 10. Admin Panel
// -------------------------------------------------------
app.get('/admin', basicAuthMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_panel.html'));
});

// -------------------------------------------------------
// 11. Start Server
// -------------------------------------------------------
server.listen(PORT, () =>
    console.log(`Server running → http://localhost:${PORT}/admin`)
);
