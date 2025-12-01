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
const { Buffer } = require('buffer'); // Ensure Buffer is available

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 80;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

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
const CHAT_COLLECTION = 'telegram_chats';
const MESSAGE_SUB_COLLECTION = 'messages';


// 4. Telegram Bot Setup
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
console.log(`Telegram Bot is polling with token: ${TELEGRAM_BOT_TOKEN ? 'Ready' : 'Missing'}`);

// 5. Express Middleware
app.use(bodyParser.json({ limit: '50mb' })); // Increase limit for Base64 image/file data
app.use(express.static(path.join(__dirname, 'public'))); // Assuming admin_panel.html is served from root or a 'public' dir

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
 * Saves a message (user or admin) to Firestore.
 * NOTE: If sender is 'user', unreadCount is incremented.
 * @param {string} chatId - Telegram chat ID.
 * @param {string} sender - 'user' or 'admin'.
 * @param {string | null} text - Message text (caption).
 * @param {string | null} mediaPath - File ID (for user) or Base64 (for admin).
 * @param {string | null} username - Telegram username (only for user message on first contact).
 * @param {string | null} filename - Original filename (for admin document replies).
 * @returns {Promise<object>} The saved message data.
 */
async function saveMessage(chatId, sender, text, mediaPath = null, username = 'Unknown User', filename = null) {
    const chatRef = db.collection(CHAT_COLLECTION).doc(String(chatId));

    // Update the main chat document with last message info
    const chatUpdate = {
        lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageText: text || (mediaPath ? (filename || 'Media received/sent') : 'No text'),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (sender === 'user') {
        chatUpdate.username = username; // Update username on user contact
        // === NEW: Increment unread count for admin ===
        chatUpdate.unreadCount = admin.firestore.FieldValue.increment(1);
    }
    
    // Ensure the chat document exists or create it
    await chatRef.set(chatUpdate, { merge: true });

    // Add message to subcollection
    const messageData = {
        chatId: String(chatId),
        sender: sender,
        text: text,
        mediaPath: mediaPath, // Used for file_id (user) or base64 (admin)
        filename: filename, // New field for admin side document/file display
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
        const savedMessage = await saveMessage(chatId, 'user', text, mediaPath, username, filename);

        // 1. Fetch the updated chat data to get the new unreadCount
        const chatDoc = await db.collection(CHAT_COLLECTION).doc(String(chatId)).get();
        const chatData = chatDoc.data();

        // 2. Notify Admin Panel (All connected sockets)
        io.emit('new_message', { 
            chatId: chatId,
            message: savedMessage,
            user: {
                telegramId: String(chatId),
                username: chatData.username,
                lastMessageTime: savedMessage.timestamp,
                lastMessageText: savedMessage.text,
                unreadCount: chatData.unreadCount || 0, // === NEW: Send unreadCount ===
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

// API to get all active chat users (sorted by last message time)
app.get('/api/chats', basicAuthMiddleware, async (req, res) => {
    try {
        // Fetch all documents in the CHAT_COLLECTION, ordered by last activity
        const snapshot = await db.collection(CHAT_COLLECTION)
            .orderBy('lastMessageTime', 'desc')
            .get();

        const chats = snapshot.docs.map(doc => ({
            telegramId: doc.id,
            ...doc.data(),
            // Ensure timestamp fields are serialized correctly
            lastMessageTime: doc.data().lastMessageTime ? doc.data().lastMessageTime.toDate().toISOString() : new Date().toISOString(),
            unreadCount: doc.data().unreadCount || 0 // === NEW: Include unreadCount ===
        }));

        res.json(chats);
    } catch (error) {
        console.error("Error fetching chat list:", error.message); 
        console.error(error); 
        
        if (error.code === 16) {
             console.error("Firestore Error Code 16: UNAUTHENTICATED. Check service account credentials parsing in server.js!");
        } else if (error.code === 7) {
             console.error("Firestore Error Code 7: SERVICE_DISABLED. Check if Cloud Firestore API is enabled in your Google Cloud project.");
        } else if (error.code === 9) {
             console.error("Firestore Error Code 9: FAILED_PRECONDITION (Missing Index). Check the full error message above for the index creation URL!");
        }
        res.status(500).json({ error: 'Failed to retrieve chat list.' });
    }
});

// === NEW: API to mark a chat as read (resetting unreadCount) ===
app.put('/api/chats/:chatId/read', basicAuthMiddleware, async (req, res) => {
    const { chatId } = req.params;

    try {
        const chatRef = db.collection(CHAT_COLLECTION).doc(chatId);
        await chatRef.update({
            unreadCount: 0,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        // Broadcast an update to all connected admins to instantly clear the badge
        io.emit('chat_read_status', { chatId, unreadCount: 0 });
        res.json({ success: true, message: `Chat ${chatId} marked as read.` });
    } catch (error) {
        console.error(`Error marking chat ${chatId} as read:`, error);
        res.status(500).json({ error: 'Failed to mark chat as read.' });
    }
});


// API to get chat history for a specific user (with pagination)
app.get('/api/chats/:chatId/history', basicAuthMiddleware, async (req, res) => {
    const { chatId } = req.params;
    const limit = parseInt(req.query.limit) || 30;
    const offset = parseInt(req.query.offset) || 0;

    try {
        let query = db.collection(CHAT_COLLECTION).doc(chatId)
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
        console.error(`Error fetching history for chat ${chatId}:`, error);
        res.status(500).json({ error: 'Failed to retrieve chat history.' });
    }
});


// API to get Telegram Media (Image/Photo/Document)
app.get('/api/get-media', basicAuthMiddleware, async (req, res) => {
    const fileId = req.query.file_id;

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


// 9. Socket.io Handler (Admin Reply)
io.on('connection', (socket) => {
    console.log('Admin connected via socket.io');

    // Admin sends a reply
    socket.on('admin_reply', async (data, callback) => {
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

            // Save admin's message to Firestore (use the original base64/text for local echo)
            // If media was sent, we save the Base64 in mediaPath for admin side to display.
            await saveMessage(chatId, 'admin', text, mediaPath, null, filename); 

            // Send chat_read_status update since admin just replied (implies reading)
            // Although /read API is better for click events, this ensures the count is reset on reply.
            await db.collection(CHAT_COLLECTION).doc(String(chatId)).update({
                unreadCount: 0
            });
            io.emit('chat_read_status', { chatId, unreadCount: 0 }); // Broadcast the reset

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


// 10. Serve the Admin Panel HTML
app.get('/admin', basicAuthMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_panel.html'));
});

// Default root path
app.get('/', (req, res) => {
    res.redirect('/admin');
});


// 11. Start Server
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Access Admin Panel at: http://localhost:${PORT}/admin`);
});
