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
const USERS_COLLECTION = 'system_users'; // New collection for User List

// -------------------------
// 3. Initialize Firebase Admin
// -------------------------
let serviceAccount;
try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        // Exit early if key is missing to prevent Firebase errors
        console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_KEY not set in environment. Check your .env file.');
        process.exit(1);
    }
    // Parse the escaped JSON string from the environment variable
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
} catch (err) {
    console.error("ERROR: Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY. Ensure it is a valid, escaped JSON string.", err.message);
    process.exit(1);
}

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin initialized successfully.");
} catch (err) {
    console.error("Firebase Admin initialization failed:", err.message);
    process.exit(1);
}

const db = admin.firestore();

// -------------------------
// 4. Telegram bot setup
// -------------------------
if (!TELEGRAM_BOT_TOKEN) {
    console.warn("WARNING: TELEGRAM_BOT_TOKEN is missing. Telegram integration will not work.");
}
const bot = TELEGRAM_BOT_TOKEN ? new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true }) : null;

// -------------------------
// 5. Express middleware
// -------------------------
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
// Serve the admin dashboard file
app.use(express.static(path.join(__dirname))); 

// Basic Auth
const basicAuthMiddleware = basicAuth({
    users: { [ADMIN_USERNAME]: ADMIN_PASSWORD },
    challenge: true
});

// -------------------------
// 6. Helper: Save message (Updated with Platform)
// -------------------------
async function saveMessage(chatId, sender, text, mediaPath = null, username = null, filename = null, platform = 'telegram') {
    try {
        const chatRef = db.collection(CHAT_COLLECTION).doc(String(chatId));

        const chatUpdate = {
            lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
            lastMessageText: text || (mediaPath ? (filename || 'Media') : 'No text'),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            platform: platform // Store platform type
        };

        if (sender === 'user' && username) {
            chatUpdate.username = username;
            chatUpdate.telegramId = String(chatId); // ID is saved (used for both platforms now)
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

        // Fetch the user data again to get the actual server timestamp for real-time update
        const docSnapshot = await messageRef.get();
        const docData = docSnapshot.data();

        return {
            id: messageRef.id,
            ...docData,
            timestamp: docData.timestamp?.toDate().toISOString() || new Date().toISOString()
        };
    } catch (err) {
        console.error("saveMessage error:", err);
        throw err;
    }
}

// -------------------------
// 7. Telegram message handler
// -------------------------
if (bot) {
    bot.on('message', async (msg) => {
        try {
            const chatId = msg.chat.id;
            const username = msg.chat.username || msg.chat.first_name || String(chatId);
            let text = msg.text || '';
            let mediaPath = null;
            let filename = null;

            if (msg.photo) {
                mediaPath = msg.photo[msg.photo.length - 1].file_id;
                text = msg.caption || '';
            } else if (msg.document) {
                mediaPath = msg.document.file_id;
                filename = msg.document.file_name;
                text = msg.caption || '';
            } else if (msg.sticker) {
                 mediaPath = msg.sticker.file_id;
                 text = "Sticker";
            } else if (msg.voice) {
                 mediaPath = msg.voice.file_id;
                 text = "Voice Message";
                 filename = msg.voice.mime_type;
            } else if (msg.video) {
                 mediaPath = msg.video.file_id;
                 text = msg.caption || "Video";
                 filename = msg.video.mime_type;
            }

            if (!text && !mediaPath) return;

            const savedMessage = await saveMessage(chatId, 'user', text, mediaPath, username, filename, 'telegram');

            io.emit('new_message', {
                chatId,
                message: savedMessage,
                user: {
                    telegramId: String(chatId),
                    username,
                    lastMessageTime: savedMessage.timestamp,
                    lastMessageText: savedMessage.text,
                    platform: 'telegram'
                },
                platform: 'telegram'
            });
        } catch (err) {
            console.error("Telegram Error:", err);
        }
    });
}

// -------------------------
// 8. Facebook Messenger Integration
// -------------------------
// Helper: Send FB Message
async function sendFacebookMessage(psid, text) {
    if (!FB_PAGE_TOKEN) throw new Error("FB_PAGE_ACCESS_TOKEN missing");
    const url = `https://graph.facebook.com/v17.0/me/messages?access_token=${FB_PAGE_TOKEN}`;
    await axios.post(url, {
        recipient: { id: psid },
        message: { text }
    });
}

// FB Webhook Verification
app.get('/fb/webhook', (req, res) => {
    if (!FB_VERIFY_TOKEN) {
        console.warn("FB_VERIFY_TOKEN is missing. Facebook integration will not work.");
        return res.sendStatus(403);
    }
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// FB Message Handling
app.post('/fb/webhook', async (req, res) => {
    try {
        const body = req.body;
        if (body.object === 'page') {
            body.entry.forEach(async (entry) => {
                if (!entry.messaging) return;
                for (const event of entry.messaging) {
                    const psid = event.sender.id;
                    // Skip messages from the page itself
                    if (event.recipient.id === psid) continue; 
                    
                    if (event.message && event.message.text) {
                        const text = event.message.text;
                        // Use a distinct username for FB users
                        const username = `FB User ${psid.substring(0,6)}`;
                        const saved = await saveMessage(psid, 'user', text, null, username, null, 'facebook');
                        
                        io.emit('new_message', {
                            chatId: psid,
                            message: saved,
                            user: {
                                telegramId: String(psid), // Used as chatId
                                username: username,
                                lastMessageText: text,
                                lastMessageTime: saved.timestamp,
                                platform: 'facebook'
                            },
                            platform: 'facebook'
                        });
                    }
                    // TODO: Handle media/attachments for Facebook messages
                }
            });
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } catch (err) {
        console.error("FB Webhook Error:", err);
        res.sendStatus(500);
    }
});

// -------------------------
// 9. API Endpoints (Admin Protected)
// -------------------------

// GET Chats (Filterable by platform)
app.get('/api/chats', basicAuthMiddleware, async (req, res) => {
    try {
        const platform = req.query.platform; // 'telegram' or 'facebook' or undefined
        let query = db.collection(CHAT_COLLECTION).orderBy('lastMessageTime', 'desc');
        
        if (platform) {
            query = query.where('platform', '==', platform);
        }

        const snapshot = await query.get();
        const chats = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                chatId: doc.id,
                ...data,
                lastMessageTime: data.lastMessageTime?.toDate().toISOString()
            };
        });
        res.json(chats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET Chat History
app.get('/api/chats/:chatId/history', basicAuthMiddleware, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '50');
        const snapshot = await db.collection(CHAT_COLLECTION)
            .doc(req.params.chatId)
            .collection(MESSAGE_SUB_COLLECTION)
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();

        const history = snapshot.docs.map(d => {
            const data = d.data();
            return {
                id: d.id,
                ...data,
                timestamp: data.timestamp?.toDate().toISOString()
            };
        }).reverse();
        
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- NEW: Telegram Media Fetch (Protected) ---
app.get('/api/media/telegram/:fileId', basicAuthMiddleware, async (req, res) => {
    if (!bot) return res.status(503).send("Telegram bot not initialized.");

    try {
        const fileId = req.params.fileId;
        // 1. Get file path
        const file = await bot.getFile(fileId);
        const filePath = file.file_path;

        // 2. Construct download URL
        const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

        // 3. Download the file
        const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        
        // 4. Determine MIME type (simplified, usually bot.getFile has more info)
        let contentType = response.headers['content-type'] || 'application/octet-stream';
        
        // 5. Send file data to client
        res.setHeader('Content-Type', contentType);
        res.send(Buffer.from(response.data));

    } catch (err) {
        console.error("Telegram Media Fetch Error:", err.message);
        res.status(500).json({ error: 'Failed to retrieve media file from Telegram.', details: err.message });
    }
});

// --- User List APIs (Protected) ---

// GET All System Users
app.get('/api/users', basicAuthMiddleware, async (req, res) => {
    try {
        const snapshot = await db.collection(USERS_COLLECTION).get();
        const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CREATE New User
app.post('/api/users', basicAuthMiddleware, async (req, res) => {
    try {
        const { name, role, status } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        
        const newUser = {
            name,
            role: role || 'Viewer',
            status: status || 'Active',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        const ref = await db.collection(USERS_COLLECTION).add(newUser);
        // Fetch the created user data to include the timestamp (for consistency)
        const docSnapshot = await ref.get();
        const data = docSnapshot.data();
        res.json({ id: ref.id, ...data, createdAt: data.createdAt?.toDate().toISOString() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE User
app.delete('/api/users/:id', basicAuthMiddleware, async (req, res) => {
    try {
        await db.collection(USERS_COLLECTION).doc(req.params.id).delete();
        res.json({ success: true, id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve Frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket IO
io.on('connection', (socket) => {
    // Single handler for admin replies to both Telegram and Facebook
    socket.on('admin_reply', async (data, callback) => {
        const { chatId, text } = data;
        let platform = 'telegram'; // Default platform

        try {
            // 1. Get Chat details to determine platform
            const chatRef = db.collection(CHAT_COLLECTION).doc(String(chatId));
            const chatDoc = await chatRef.get();
            
            if (chatDoc.exists) {
                platform = chatDoc.data().platform || 'telegram';
            }

            // 2. Send reply based on platform
            if (platform === 'facebook') {
                await sendFacebookMessage(chatId, text);
            } else if (platform === 'telegram') {
                if (!bot) throw new Error("Telegram bot is not initialized.");
                await bot.sendMessage(chatId, text);
            } else {
                return callback({ success: false, error: `Unknown platform: ${platform}` });
            }

            // 3. Save message to Firestore
            const savedMessage = await saveMessage(chatId, 'admin', text, null, null, null, platform);

            // 4. Notify admin dashboard via Socket.io
            io.emit('message_sent', { chatId, message: savedMessage });
            
            callback({ success: true, message: "Reply sent successfully.", savedMessage });
        } catch (err) {
            console.error(`Admin Reply Error for Chat ${chatId} on platform ${platform}:`, err);
            callback({ success: false, error: err.message });
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
