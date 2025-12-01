// server.js
// Full integrated server: Telegram + Facebook Messenger + Firestore + Socket.io + Admin

// -------------------------
// 1. Load environment
// -------------------------
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const { Buffer } = require('buffer');

// -------------------------
// 2. App & config
// -------------------------
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    // you can configure CORS for socket.io if needed:
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 80;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';

// Facebook
const FB_PAGE_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || '';
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'verify_token';

// Firestore collection names
const CHAT_COLLECTION = 'telegram_chats';
const MESSAGE_SUB_COLLECTION = 'messages';

// -------------------------
// 3. Initialize Firebase Admin (robust parsing)
// -------------------------
let serviceAccount;
try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not set in environment');
    }
    // The env must be a JSON string
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
} catch (err) {
    console.error("ERROR: Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY. Make sure it's a valid JSON string.");
    console.error(err);
    process.exit(1);
}

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin initialized successfully.");
} catch (err) {
    console.error("Firebase Admin initialization failed:", err.message || err);
    process.exit(1);
}

const db = admin.firestore();

// -------------------------
// 4. Telegram bot setup
// -------------------------
if (!TELEGRAM_BOT_TOKEN) {
    console.warn("WARNING: TELEGRAM_BOT_TOKEN is not set. Telegram features will fail.");
}
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

bot.on('polling_error', (err) => {
    console.error('Telegram polling error:', err);
});

console.log(`Telegram Bot polling: ${TELEGRAM_BOT_TOKEN ? "ENABLED" : "DISABLED"}`);

// -------------------------
// 5. Express middleware
// -------------------------
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // allow large base64 files from admin
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Basic auth for admin panel and protected APIs
const basicAuthMiddleware = basicAuth({
    users: { [ADMIN_USERNAME]: ADMIN_PASSWORD },
    challenge: true,
    unauthorizedResponse: () => 'Unauthorized access. Check credentials.'
});

// -------------------------
// 6. Helper: Save message to Firestore
// -------------------------
/**
 * Save message into Firestore under a chat doc and messages subcollection.
 * Returns structured saved message (with id and ISO timestamp)
 */
async function saveMessage(chatId, sender, text, mediaPath = null, username = null, filename = null) {
    try {
        const chatRef = db.collection(CHAT_COLLECTION).doc(String(chatId));

        // Update the chat doc's last message fields
        const chatUpdate = {
            lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
            lastMessageText: text || (mediaPath ? (filename || 'Media') : 'No text'),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (sender === 'user' && username) {
            chatUpdate.username = username;
        }

        await chatRef.set(chatUpdate, { merge: true });

        const messageData = {
            chatId: String(chatId),
            sender,
            text: text || '',
            mediaPath: mediaPath || null,
            filename: filename || null,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };

        const messageRef = await chatRef.collection(MESSAGE_SUB_COLLECTION).add(messageData);

        return {
            id: messageRef.id,
            ...messageData,
            // Provide client friendly timestamp (server timestamp isn't immediately available)
            timestamp: new Date().toISOString()
        };
    } catch (err) {
        console.error("saveMessage error:", err);
        throw err;
    }
}

// -------------------------
// 7. Telegram message handler
// -------------------------
bot.on('message', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const username = msg.chat.username || msg.chat.first_name || String(chatId);
        let text = msg.text || '';
        let mediaPath = null;
        let filename = null;

        if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
            // pick largest size (last)
            mediaPath = msg.photo[msg.photo.length - 1].file_id;
            text = msg.caption || '';
        } else if (msg.document) {
            mediaPath = msg.document.file_id;
            filename = msg.document.file_name || null;
            text = msg.caption || '';
        } else if (msg.video) {
            mediaPath = msg.video.file_id;
            text = msg.caption || '';
        } else if (msg.audio) {
            mediaPath = msg.audio.file_id;
            text = msg.caption || '';
        }

        if (!text && !mediaPath) {
            // ignore stickers, contacts, etc. or optionally handle them
            console.log("Ignoring unsupported message type from", username);
            return;
        }

        const savedMessage = await saveMessage(chatId, 'user', text, mediaPath, username, filename);

        // Broadcase to admin panel (socket.io)
        io.emit('new_message', {
            chatId,
            message: savedMessage,
            user: {
                telegramId: String(chatId),
                username,
                lastMessageTime: savedMessage.timestamp,
                lastMessageText: savedMessage.text
            },
            platform: 'telegram'
        });

        console.log(`Saved and emitted Telegram message from ${username} (${chatId})`);
    } catch (err) {
        console.error("Error handling incoming Telegram message:", err);
    }
});

// -------------------------
// 8. Facebook Messenger integration
// -------------------------

// Helper: send message via Facebook Send API (text only here; file support could be added)
async function sendFacebookMessage(psid, text) {
    if (!FB_PAGE_TOKEN) throw new Error("FB_PAGE_ACCESS_TOKEN not configured.");

    try {
        const url = `https://graph.facebook.com/v17.0/me/messages?access_token=${FB_PAGE_TOKEN}`;
        const payload = {
            recipient: { id: psid },
            message: { text }
        };
        const resp = await axios.post(url, payload);
        return resp.data;
    } catch (err) {
        console.error("Error sending FB message:", err.response?.data || err.message);
        throw err;
    }
}

// Webhook verification endpoint (GET)
app.get('/fb/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
        console.log("Facebook webhook verified.");
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});

// Webhook receiver (POST)
app.post('/fb/webhook', async (req, res) => {
    try {
        const body = req.body;
        if (body.object !== 'page') {
            return res.sendStatus(404);
        }

        // We iterate through each entry; each may contain multiple messaging events
        body.entry.forEach(async (entry) => {
            if (!entry.messaging) return;
            for (const event of entry.messaging) {
                const psid = event.sender && event.sender.id ? event.sender.id : null;
                if (!psid) continue;

                // Text messages
                if (event.message && event.message.text) {
                    const text = event.message.text;
                    const saved = await saveMessage(psid, 'user', text, null, 'FB_User', null);

                    io.emit('new_message', {
                        chatId: psid,
                        message: saved,
                        user: {
                            telegramId: String(psid),
                            username: 'Facebook User',
                            lastMessageText: text
                        },
                        platform: 'facebook'
                    });

                    console.log(`Saved FB message from ${psid}`);
                }

                // You can handle attachments (images/files) here if needed
            }
        });

        res.sendStatus(200);
    } catch (err) {
        console.error("FB webhook error:", err);
        res.sendStatus(500);
    }
});

// -------------------------
// 9. API endpoints (admin-protected)
// -------------------------

// Get all chats (ordered by lastMessageTime desc)
app.get('/api/chats', basicAuthMiddleware, async (req, res) => {
    try {
        const snapshot = await db.collection(CHAT_COLLECTION)
            .orderBy('lastMessageTime', 'desc')
            .get();

        const chats = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                telegramId: doc.id,
                ...data,
                lastMessageTime: data.lastMessageTime ? data.lastMessageTime.toDate().toISOString() : null
            };
        });

        res.json(chats);
    } catch (err) {
        console.error("Error fetching chat list:", err);
        // Helpful logs for common firestore errors
        if (err.code === 16) {
            console.error("Firestore UNAUTHENTICATED (code 16) — check service account credentials.");
        } else if (err.code === 7) {
            console.error("Firestore SERVICE_DISABLED (code 7) — enable Firestore API in GCP.");
        } else if (err.code === 9) {
            console.error("Firestore FAILED_PRECONDITION (code 9) — index missing?");
        }
        res.status(500).json({ error: 'Failed to retrieve chat list.' });
    }
});

// Get chat history for a specific chatId (with pagination)
// Query params: ?limit=30&offset=0
app.get('/api/chats/:chatId/history', basicAuthMiddleware, async (req, res) => {
    try {
        const { chatId } = req.params;
        const limit = parseInt(req.query.limit || '30', 10);
        const offset = parseInt(req.query.offset || '0', 10);

        // Firestore doesn't support offset efficiently for large datasets; this is simple approach
        let query = db.collection(CHAT_COLLECTION).doc(String(chatId))
            .collection(MESSAGE_SUB_COLLECTION)
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .offset(offset);

        const snapshot = await query.get();

        // Map and reverse for chronological ascending (oldest first)
        const history = snapshot.docs.map(d => {
            const data = d.data();
            return {
                id: d.id,
                ...data,
                timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null
            };
        }).reverse();

        res.json(history);
    } catch (err) {
        console.error(`Error fetching history for ${req.params.chatId}:`, err);
        res.status(500).json({ error: 'Failed to retrieve chat history.' });
    }
});

// Endpoint to fetch Telegram media by file_id and redirect to Telegram file URL
// Usage: /api/get-media?file_id=ABC
app.get('/api/get-media', basicAuthMiddleware, async (req, res) => {
    const fileId = req.query.file_id;
    if (!fileId) return res.status(400).json({ error: 'Missing file_id parameter.' });

    try {
        const file = await bot.getFile(fileId);
        const filePath = file.file_path;
        const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
        // Redirect client directly to Telegram file URL
        res.redirect(url);
    } catch (err) {
        console.error("Error fetching media from Telegram:", err);
        res.status(500).json({ error: 'Failed to retrieve media file from Telegram.' });
    }
});

// Serve admin HTML (protected)
app.get('/admin', basicAuthMiddleware, (req, res) => {
    // ensure admin_panel.html exists in project root or public dir
    res.sendFile(path.join(__dirname, 'admin_panel.html'));
});

// default root -> admin
app.get('/', (req, res) => res.redirect('/admin'));

// -------------------------
// 10. Socket.io for admin replies & realtime
// -------------------------
io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    // Admin replying to Telegram (supports text and base64 media)
    // data: { chatId, text, mediaPath (data:[mime];base64,AAA...), mediaType: 'photo'|'document', filename }
    socket.on('admin_reply', async (data, callback) => {
        try {
            const { chatId, text = '', mediaPath = null, mediaType = null, filename = null } = data;

            if (!chatId) {
                const errMsg = "chatId is required for admin_reply";
                console.error(errMsg);
                if (callback) callback({ success: false, error: errMsg });
                return;
            }

            let telegramResponse = null;

            if (mediaPath && mediaType) {
                // Expect "data:<mime>;base64,<data>"
                const parts = mediaPath.split(';base64,');
                if (parts.length !== 2) throw new Error("Invalid Base64 media format.");

                const mimePart = parts[0]; // data:<mime>
                const base64Data = parts[1];
                const buffer = Buffer.from(base64Data, 'base64');
                const mimeType = mimePart.split(':')[1] || 'application/octet-stream';
                const fileOptions = { filename: filename || 'admin_file', contentType: mimeType };

                if (mediaType === 'photo') {
                    // sendPhoto supports Buffer
                    telegramResponse = await bot.sendPhoto(chatId, buffer, { caption: text }, fileOptions);
                } else if (mediaType === 'document') {
                    telegramResponse = await bot.sendDocument(chatId, buffer, { caption: text }, fileOptions);
                } else {
                    throw new Error(`Unsupported mediaType: ${mediaType}`);
                }
            } else if (text) {
                telegramResponse = await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
            } else {
                throw new Error("Empty reply: either text or mediaPath must be provided.");
            }

            // Save admin message to Firestore (we save the base64 if present so admin side can show it)
            await saveMessage(chatId, 'admin', text, mediaPath, null, filename);

            if (callback) callback({ success: true, result: telegramResponse || null });
        } catch (err) {
            console.error("Error in admin_reply:", err);
            if (callback) callback({ success: false, error: err.message || String(err) });
            socket.emit('error', { message: err.message || 'Failed to send admin reply' });
        }
    });

    // Admin replying to Facebook
    // data: { chatId: psid, text: "hello" }
    socket.on('admin_reply_facebook', async (data, callback) => {
        try {
            const { chatId, text } = data;
            if (!chatId) {
                const errMsg = "chatId (PSID) required for admin_reply_facebook";
                console.error(errMsg);
                if (callback) callback({ success: false, error: errMsg });
                return;
            }
            if (!text) {
                const errMsg = "text required for admin_reply_facebook";
                console.error(errMsg);
                if (callback) callback({ success: false, error: errMsg });
                return;
            }

            await sendFacebookMessage(chatId, text);
            await saveMessage(chatId, 'admin', text, null, null, null);

            if (callback) callback({ success: true });
        } catch (err) {
            console.error("Error in admin_reply_facebook:", err);
            if (callback) callback({ success: false, error: err.message || String(err) });
            socket.emit('error', { message: err.message || 'Failed to send FB reply' });
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', socket.id, reason);
    });
});

// -------------------------
// 11. Start server
// -------------------------
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/admin`);
    console.log(`Socket.io ready. Telegram: ${!!TELEGRAM_BOT_TOKEN}, Facebook: ${!!FB_PAGE_TOKEN}`);
});

// -------------------------
// End of file
// -------------------------
