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
app.use(bodyParser.json());
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
 * @param {string} chatId - Telegram chat ID.
 * @param {string} sender - 'user' or 'admin'.
 * @param {string} text - Message text.
 * @param {string | null} mediaPath - File ID (for user) or Base64 (for admin).
 * @param {string | null} username - Telegram username (only for user message on first contact).
 * @returns {Promise<object>} The saved message data.
 */
async function saveMessage(chatId, sender, text, mediaPath = null, username = 'Unknown User') {
    const chatRef = db.collection(CHAT_COLLECTION).doc(String(chatId));

    // Update the main chat document with last message info
    const chatUpdate = {
        lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageText: text || (mediaPath ? 'Image received/sent' : 'No text'),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (sender === 'user') {
        chatUpdate.username = username; // Update username on user contact
    }
    
    // Ensure the chat document exists or create it
    await chatRef.set(chatUpdate, { merge: true });

    // Add message to subcollection
    const messageData = {
        chatId: String(chatId),
        sender: sender,
        text: text,
        mediaPath: mediaPath, // Used for file_id (user) or base64 (admin)
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
    let messageType = 'text';

    // Handle Media (Photo, Video)
    if (msg.photo && msg.photo.length > 0) {
        // Get the largest photo size's file_id
        mediaPath = msg.photo[msg.photo.length - 1].file_id;
        text = msg.caption || ''; // Caption is the text for a photo
        messageType = 'photo';
    } 
    // You could add similar logic for video, document, etc. if needed

    if (!text && !mediaPath) {
        console.log(`Ignoring unsupported message type from ${username}`);
        return; // Ignore messages without text or media (e.g., sticker, video)
    }

    try {
        const savedMessage = await saveMessage(chatId, 'user', text, mediaPath, username);

        // Notify Admin Panel (All connected sockets)
        io.emit('new_message', { 
            chatId: chatId,
            message: savedMessage,
            user: {
                telegramId: String(chatId),
                username: username,
                lastMessageTime: savedMessage.timestamp,
                lastMessageText: savedMessage.text,
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
            lastMessageTime: doc.data().lastMessageTime ? doc.data().lastMessageTime.toDate().toISOString() : new Date().toISOString()
        }));

        res.json(chats);
    } catch (error) {
        console.error("Error fetching chat list:", error.message); // Log error message
        // CRITICAL: Log the full error to understand the issue, likely a missing Firestore index.
        console.error(error); // <--- ဒီနေရာမှာ Index ဖန်တီးဖို့ လင့်ခ်ပါတဲ့ Error အပြည့်အစုံကို တွေ့ရပါလိမ့်မယ်။
        
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


// API to get chat history for a specific user (with pagination)
app.get('/api/chats/:chatId/history', basicAuthMiddleware, async (req, res) => {
    const { chatId } = req.params;
    const limit = parseInt(req.query.limit) || 30;
    const offset = parseInt(req.query.offset) || 0;

    try {
        let query = db.collection(CHAT_COLLECTION).doc(chatId)
            .collection(MESSAGE_SUB_COLLECTION)
            .orderBy('timestamp', 'desc'); // Newest first

        // Simple offset pagination (less efficient but works)
        if (offset > 0) {
            // Firestore does not natively support offset with limit unless using startAfter/endBefore
            // A more robust solution would be to use Cursor-based pagination (startAfter)
            // For simplicity with offset, we rely on the Firestore library's hidden implementation or client-side manipulation.
            // We will fetch `offset + limit` and slice if necessary, or just use the limit on Firestore side 
            // which requires sorting the whole collection.

            // To mimic offset, we rely on the Firestore library's hidden implementation or client-side manipulation.
            // A cleaner approach for simple pagination:
            const allMessagesSnapshot = await query.limit(limit + offset).get();
            const slicedMessages = allMessagesSnapshot.docs.slice(offset, offset + limit);
            const history = slicedMessages.map(doc => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp ? doc.data().timestamp.toDate().toISOString() : new Date().toISOString()
            })).reverse(); // Reverse for display (oldest first)
            
            return res.json(history);

        } else {
            // Initial load
            const snapshot = await query.limit(limit).get();
            const history = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp ? doc.data().timestamp.toDate().toISOString() : new Date().toISOString()
            })).reverse(); // Reverse for display (oldest first)
            
            return res.json(history);
        }

    } catch (error) {
        console.error(`Error fetching history for chat ${chatId}:`, error);
        res.status(500).json({ error: 'Failed to retrieve chat history.' });
    }
});


// API to get Telegram Media (Image/Photo)
// This is called by admin_panel.html to display user images based on file_id
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

        // 3. Instead of streaming the file through our server, we redirect
        // This is much faster and saves server bandwidth/memory.
        res.redirect(fileUrl);
        
        // Alternative (if redirect doesn't work or for security: stream the file)
        // const response = await fetch(fileUrl);
        // response.body.pipe(res);

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
        const { chatId, text, mediaPath } = data; // mediaPath is Base64 string for images

        try {
            let telegramResponse;
            let fileId = null;

            if (mediaPath) {
                // If mediaPath is a Base64 string, decode it for Telegram
                const base64Data = mediaPath.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');
                const fileOptions = { filename: 'admin_image.png', contentType: 'image/png' };
                
                // Send photo to Telegram
                telegramResponse = await bot.sendPhoto(chatId, buffer, { 
                    caption: text,
                    // Use force_reply to keep the conversation structured if needed
                    // reply_to_message_id: msg.message_id
                }, fileOptions);

                // Telegram returns the sent photo info. We need the file_id to save in Firestore 
                // for the admin side echo (to display the image later).
                if (telegramResponse.photo && telegramResponse.photo.length > 0) {
                     fileId = telegramResponse.photo[telegramResponse.photo.length - 1].file_id;
                }
            } else if (text) {
                // Send text message
                telegramResponse = await bot.sendMessage(chatId, text);
            } else {
                // Should not happen if client side validation works
                throw new Error("Cannot send empty message.");
            }

            // Save admin's message to Firestore (use the original base64/text for local echo)
            // If media was sent, we save the Base64 in mediaPath for admin side to display.
            await saveMessage(chatId, 'admin', text, mediaPath); 

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
