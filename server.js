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
const { Buffer } = require('buffer'); // Ensure Buffer is available

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 80;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// === NEW FACEBOOK CONSTANTS (Requires .env updates) ===
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_CHAT_COLLECTION = 'facebook_chats'; // New collection for FB messages

// 3. Robust Firebase Admin Initialization (Fixes UNAUTHENTICATED Code 16)
let serviceAccount;
try {
    // CRITICAL FIX: Parse the JSON string from the environment variable
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
} catch (e) {
    console.error("ERROR: Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY. Please ensure it is a single, valid JSON string with correctly escaped newlines (\\n).");
    process.exit(1);
}

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin SDK initialized successfully.");
} catch (e) {
    console.error("Firebase Admin Initialization Failed:", e.message);
    process.exit(1);
}

const db = admin.firestore();
const TELEGRAM_CHAT_COLLECTION = 'telegram_chats'; // Renamed for clarity
const MESSAGE_SUB_COLLECTION = 'messages';


// 4. Telegram Bot Setup
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
console.log(`Telegram Bot is polling with token: ${TELEGRAM_BOT_TOKEN ? 'Ready' : 'Missing'}`);

// 5. Express Middleware
app.use(bodyParser.json({ limit: '50mb' })); // Increase limit for Base64 image/file data
app.use(express.static(path.join(__dirname, 'public'))); 

// Basic Authentication Middleware for Admin Panel
const basicAuthMiddleware = basicAuth({
    users: { [ADMIN_USERNAME]: ADMIN_PASSWORD },
    challenge: true,
    unauthorizedResponse: () => 'Unauthorized access. Please check admin credentials.'
});


// ------------------------------------------------------------------
// 6. Database Helper Functions
// ------------------------------------------------------------------

/**
 * Saves a message (user or admin) to Firestore in a specified collection.
 * @param {string} chatId - Chat ID (Telegram or Facebook PSID).
 * @param {string} sender - 'user' or 'admin'.
 * @param {string | null} text - Message text (caption).
 * @param {string | null} mediaPath - File ID (user Telegram) or Base64 (admin reply/FB).
 * @param {string | null} username - User identifier.
 * @param {string | null} filename - Original filename.
 * @param {string} collectionName - Which top-level collection to use (Telegram or FB).
 * @returns {Promise<object>} The saved message data.
 */
async function saveMessage(chatId, sender, text, mediaPath = null, username = 'Unknown User', filename = null, collectionName = TELEGRAM_CHAT_COLLECTION) {
    const chatRef = db.collection(collectionName).doc(String(chatId));

    // Update the main chat document with last message info
    const chatUpdate = {
        lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageText: text || (mediaPath ? (filename || 'Media received/sent') : 'No text'),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (sender === 'user') {
        chatUpdate.username = username; // Update username on user contact
        // Increment unread count for admin
        chatUpdate.unreadCount = admin.firestore.FieldValue.increment(1);
    }
    
    // Ensure the chat document exists or create it
    await chatRef.set(chatUpdate, { merge: true });

    // Add message to subcollection
    const messageData = {
        chatId: String(chatId),
        sender: sender,
        text: text,
        mediaPath: mediaPath, 
        filename: filename, 
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    };

    const messageRef = await chatRef.collection(MESSAGE_SUB_COLLECTION).add(messageData);

    // Return structured data for Socket.io broadcasting
    return {
        id: messageRef.id,
        ...messageData,
        timestamp: new Date().toISOString() // Use client-friendly format
    };
}


// ------------------------------------------------------------------
// 7. Telegram Bot Handlers
// ------------------------------------------------------------------

// Handler for all incoming messages (text and media)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.chat.username || msg.chat.first_name || String(chatId);
    let text = msg.text || '';
    let mediaPath = null;
    let filename = null;

    // Handle Media (Photo, Video, Document)
    if (msg.photo && msg.photo.length > 0) {
        // Get the largest photo size's file_id
        mediaPath = msg.photo[msg.photo.length - 1].file_id;
        text = msg.caption || ''; // Caption is the text for a photo
    } else if (msg.document) {
        mediaPath = msg.document.file_id;
        filename = msg.document.file_name;
        text = msg.caption || '';
    }
    // You could add similar logic for video, audio, etc. if needed

    if (!text && !mediaPath) {
        console.log(`Ignoring unsupported message type from ${username}`);
        return; // Ignore messages without text or media (e.g., sticker, video)
    }

    try {
        // For user messages, save the file_id in mediaPath and the original filename
        const savedMessage = await saveMessage(chatId, 'user', text, mediaPath, username, filename, TELEGRAM_CHAT_COLLECTION);

        // 1. Fetch the updated chat data to get the new unreadCount
        const chatDoc = await db.collection(TELEGRAM_CHAT_COLLECTION).doc(String(chatId)).get();
        const chatData = chatDoc.data();

        // 2. Notify Admin Panel (All connected sockets)
        io.emit('new_telegram_message', { 
            chatId: chatId,
            message: savedMessage,
            user: {
                telegramId: String(chatId),
                username: chatData.username,
                lastMessageTime: savedMessage.timestamp,
                lastMessageText: savedMessage.text,
                unreadCount: chatData.unreadCount || 0, // Send unreadCount
            }
        });
        console.log(`New user message saved and broadcasted: ${username}`);
    } catch (error) {
        console.error("Error processing user message:", error);
    }
});


// ------------------------------------------------------------------
// 8. Admin Panel API Endpoints (Admin required)
// ------------------------------------------------------------------

// API to get all active chat users (Default: Telegram)
app.get('/api/chats/:channel', basicAuthMiddleware, async (req, res) => {
    const { channel } = req.params;
    const collectionName = channel === 'facebook' ? FB_CHAT_COLLECTION : TELEGRAM_CHAT_COLLECTION;

    try {
        // Fetch all documents in the determined collection, ordered by last activity
        const snapshot = await db.collection(collectionName)
            .orderBy('lastMessageTime', 'desc')
            .get();

        const chats = snapshot.docs.map(doc => ({
            id: doc.id, // Use generic 'id' instead of telegramId
            ...doc.data(),
            // Ensure timestamp fields are serialized correctly
            lastMessageTime: doc.data().lastMessageTime ? doc.data().lastMessageTime.toDate().toISOString() : new Date().toISOString(),
            unreadCount: doc.data().unreadCount || 0 // Include unreadCount
        }));

        res.json(chats);
    } catch (error) {
        console.error(`Error fetching chat list for ${channel}:`, error.message);
        res.status(500).json({ error: 'Failed to retrieve chat list.' });
    }
});

// API to mark a chat as read (resetting unreadCount)
app.put('/api/chats/:channel/:chatId/read', basicAuthMiddleware, async (req, res) => {
    const { chatId, channel } = req.params;
    const collectionName = channel === 'facebook' ? FB_CHAT_COLLECTION : TELEGRAM_CHAT_COLLECTION;

    try {
        const chatRef = db.collection(collectionName).doc(chatId);
        await chatRef.update({
            unreadCount: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        // Broadcast an update
        io.emit('chat_read_status', { chatId, unreadCount: 0, channel });
        res.json({ success: true, message: `Chat ${chatId} marked as read.` });
    } catch (error) {
        console.error(`Error marking chat ${chatId} as read:`, error);
        res.status(500).json({ error: 'Failed to mark chat as read.' });
    }
});


// API to get chat history for a specific user
app.get('/api/chats/:channel/:chatId/history', basicAuthMiddleware, async (req, res) => {
    const { chatId, channel } = req.params;
    const limit = parseInt(req.query.limit) || 30;
    const offset = parseInt(req.query.offset) || 0;
    const collectionName = channel === 'facebook' ? FB_CHAT_COLLECTION : TELEGRAM_CHAT_COLLECTION;

    try {
        let query = db.collection(collectionName).doc(chatId)
            .collection(MESSAGE_SUB_COLLECTION)
            .orderBy('timestamp', 'desc'); // Newest first

        // Initial load with limit
        const snapshot = await query.limit(limit).offset(offset).get();
        const history = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp ? doc.data().timestamp.toDate().toISOString() : new Date().toISOString()
        })).reverse(); // Reverse for display (oldest first)
            
        return res.json(history);

    } catch (error) {
        console.error(`Error fetching history for chat ${chatId} (${channel}):`, error);
        res.status(500).json({ error: 'Failed to retrieve chat history.' });
    }
});


// API to get Telegram Media (Image/Photo/Document) - FB uses Graph API/download
app.get('/api/get-telegram-media', basicAuthMiddleware, async (req, res) => {
    const fileId = req.query.file_id;
    // ... Existing Telegram media logic ...
    if (!fileId) {
        return res.status(400).json({ error: 'Missing file_id parameter.' });
    }

    try {
        // 1. Get file information (path) from Telegram
        const file = await bot.getFile(fileId);
        const filePath = file.file_path;
        
        // 2. Construct the direct file URL
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

        // 3. Redirect to the file URL for fast loading
        res.redirect(fileUrl);
        
    } catch (error) {
        console.error(`Error fetching media for file_id ${fileId}:`, error);
        res.status(500).json({ error: 'Failed to retrieve media file from Telegram.' });
    }
});

// === NEW: Placeholder API for sending Facebook replies from Admin Panel ===
app.post('/api/fb/send', basicAuthMiddleware, async (req, res) => {
    const { chatId, text, mediaPath, mediaType, filename } = req.body;

    if (!FB_PAGE_ACCESS_TOKEN) {
        return res.status(500).json({ error: "Facebook Page Access Token is missing. Cannot send." });
    }
    
    // --- TODO: Full implementation of Facebook Graph API POST request (send message) here ---
    // The front-end is ready to send the data. You must implement the POST request to FB.
    
    try {
        // Simulating the successful send response from Facebook
        console.log(`[FB Proxy] Attempting to send message to PSID ${chatId}...`);

        // Save admin's message to Firestore (using FB_CHAT_COLLECTION)
        const savedMessage = await saveMessage(chatId, 'admin', text, mediaPath, null, filename, FB_CHAT_COLLECTION);
        
        // Broadcast the update via Socket.io to other admins
        io.emit('new_fb_message', { chatId: chatId, message: savedMessage });
        io.emit('chat_read_status', { chatId, unreadCount: 0, channel: 'facebook' });


        res.json({ success: true, message: "FB send proxy placeholder processed successfully." });

    } catch (error) {
        console.error("Error processing Facebook admin reply:", error);
        res.status(500).json({ error: 'Failed to proxy message to Facebook Graph API.' });
    }
});


// ------------------------------------------------------------------
// 9. Facebook Messenger Webhook Endpoint (External Access)
// ------------------------------------------------------------------

// 9a. For Facebook to verify the webhook
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            console.log('FB Webhook Verification Failed: Token mismatch.');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(404);
    }
});

// 9b. For handling incoming messages from Facebook
app.post('/webhook', (req, res) => {
    // --- TODO: Full implementation of Facebook message reception logic here ---
    // You need to parse the incoming message and call saveMessage (with FB_CHAT_COLLECTION)
    // Then, broadcast via Socket.io: io.emit('new_fb_message', { ... });
    
    console.log('[FB Webhook] Received message from Facebook.', JSON.stringify(req.body, null, 2));
    res.status(200).send('EVENT_RECEIVED');
});


// ------------------------------------------------------------------
// 10. Socket.io Handler (Admin Reply)
// ------------------------------------------------------------------

io.on('connection', (socket) => {
    console.log('Admin connected via socket.io');

    // Admin sends a reply (Telegram specific)
    socket.on('admin_reply_telegram', async (data, callback) => { // Renamed event
        // Added mediaType and filename for handling different media types
        const { chatId, text, mediaPath, mediaType, filename } = data; 

        try {
            let telegramResponse;
            let fileId = null;

            if (mediaPath && mediaType) {
                // Base64 data URL format: data:[<MIME-type>][;charset=<encoding>][;base64],<data>
                const parts = mediaPath.split(';base64,');
                if (parts.length !== 2) throw new Error("Invalid Base64 format.");
                
                const base64Data = parts[1];
                const buffer = Buffer.from(base64Data, 'base64');
                const mimeType = parts[0].split(':')[1];

                const fileOptions = { 
                    filename: filename || 'admin_file', 
                    contentType: mimeType 
                };
                
                if (mediaType === 'photo') {
                    // Send photo to Telegram
                    telegramResponse = await bot.sendPhoto(chatId, buffer, { caption: text }, fileOptions);
                } else if (mediaType === 'document') {
                    // Send document/file to Telegram
                    telegramResponse = await bot.sendDocument(chatId, buffer, { caption: text }, fileOptions);
                } else {
                    throw new Error(`Unsupported media type: ${mediaType}`);
                }
                
            } else if (text) {
                // Send text message (handles emojis)
                telegramResponse = await bot.sendMessage(chatId, text);
            } else {
                // Should not happen if client side validation works
                throw new Error("Cannot send empty message or file.");
            }

            // Save admin's message to Firestore
            await saveMessage(chatId, 'admin', text, mediaPath, null, filename, TELEGRAM_CHAT_COLLECTION); 

            // Reset unread count
            await db.collection(TELEGRAM_CHAT_COLLECTION).doc(String(chatId)).update({
                unreadCount: 0
            });
            io.emit('chat_read_status', { chatId, unreadCount: 0, channel: 'telegram' }); // Broadcast the reset

            if (callback) callback({ success: true });

        } catch (error) {
            console.error("Error sending admin reply to Telegram/saving to Firestore:", error);
            // Notify the client of the error
            socket.emit('error', { message: error.message || 'Failed to send message to Telegram.' });
            if (callback) callback({ success: false, error: error.message });
        }
    });

    socket.on('disconnect', () => {
        console.log('Admin disconnected from socket.io');
    });
});


// 11. Serve the Admin Panel HTML
app.get('/admin', basicAuthMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_panel.html'));
});

// Default root path
app.get('/', (req, res) => {
    res.redirect('/admin');
});


// 12. Start Server
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Access Admin Panel at: http://localhost:${PORT}/admin`);
});
