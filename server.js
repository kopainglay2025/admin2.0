// --- REQUIRED PACKAGES ---
// NOTE: You must install the following packages:
// npm install express telegraf firebase-admin body-parser dotenv

const express = require('express');
const bodyParser = require('body-parser');
const { Telegraf } = require('telegraf');
const admin = require('firebase-admin');

// 1. --- LOAD ENVIRONMENT VARIABLES ---
// In a real setup, you would use require('dotenv').config()
// For this environment, we assume the variables are directly available or mocked.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8599597818:AAGiAJTpzFxV34rSZdLHrd9s3VrR5P0fb-k";
const FIREBASE_SERVICE_ACCOUNT_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Paing@123";
const PORT = process.env.PORT || 80;
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || "verify_token";

// Assume APP_ID is set in the environment or use a default
const APP_ID = process.env.APP_ID || "default-app-id"; 

// 2. --- FIREBASE ADMIN INITIALIZATION WITH NEWLINE FIX ---

// CRITICAL FIX: Replace doubly-escaped newlines (\\n) with single newlines (\n)
// This is necessary because environment variables often escape newlines twice in JSON strings.
let serviceAccountJSON;
try {
    serviceAccountJSON = JSON.parse(FIREBASE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n'));
    console.log("Successfully parsed service account key and fixed newlines.");
} catch (e) {
    console.error("ERROR: Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY JSON.", e);
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccountJSON),
});

const db = admin.firestore();
const auth = admin.auth();

// 3. --- DATABASE UTILITIES ---

/**
 * Gets or creates a chat thread document in Firestore.
 * @param {string} chatId - Unique ID for the chat (e.g., Telegram chat ID).
 * @param {string} platform - 'telegram' or 'facebook'.
 * @param {string} username - Display name for the user.
 * @returns {Promise<string>} The Firestore document ID for the chat.
 */
async function getOrCreateChat(chatId, platform, username) {
    // Path: /artifacts/{APP_ID}/public/data/chats
    const chatRef = db.collection(`artifacts/${APP_ID}/public/data/chats`);
    
    // Query by platform and the user's chat ID
    const q = chatRef.where('externalChatId', '==', chatId).where('platform', '==', platform);
    const snapshot = await q.limit(1).get();

    if (!snapshot.empty) {
        // Chat exists, update username if needed
        const doc = snapshot.docs[0];
        await doc.ref.update({ 
            username: username,
            lastSeen: admin.firestore.FieldValue.serverTimestamp()
        });
        return doc.id;
    } else {
        // Chat does not exist, create a new one
        const newChat = {
            externalChatId: chatId,
            platform: platform,
            username: username,
            unreadCount: 1, // New chat starts with 1 unread message
            lastMessageText: '',
            lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const docRef = await chatRef.add(newChat);
        console.log(`Created new ${platform} chat: ${docRef.id} for ${username}`);
        return docRef.id;
    }
}

/**
 * Saves an incoming message to Firestore and updates the parent chat thread.
 */
async function saveMessage(chatId, messageData, lastMessageText) {
    // Path: /artifacts/{APP_ID}/public/data/chats/{chatDocId}/messages
    const messagesRef = db.collection(`artifacts/${APP_ID}/public/data/chats/${chatId}/messages`);
    const chatDocRef = db.doc(`artifacts/${APP_ID}/public/data/chats/${chatId}`);

    try {
        // 1. Add the message to the messages subcollection
        await messagesRef.add({
            ...messageData,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });

        // 2. Update the parent chat thread
        await chatDocRef.update({
            lastMessageText: lastMessageText,
            lastMessageTime: admin.firestore.FieldValue.serverTimestamp(),
            // Increment unread count for incoming user message
            unreadCount: admin.firestore.FieldValue.increment(1)
        });

        console.log(`Message saved and chat ${chatId} updated.`);

    } catch (error) {
        console.error("Error saving message or updating chat:", error);
    }
}

// 4. --- TELEGRAM BOT SETUP ---

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

bot.start(async (ctx) => {
    const chatId = String(ctx.chat.id);
    const username = ctx.from.username || ctx.from.first_name || 'New User';
    
    const chatDocId = await getOrCreateChat(chatId, 'telegram', username);

    ctx.reply(`Welcome, ${username}! Your messages are now routed to the admin panel (Chat ID: ${chatDocId}).`);
});

bot.on('text', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const username = ctx.from.username || ctx.from.first_name || 'User';
    
    const chatDocId = await getOrCreateChat(chatId, 'telegram', username);
    
    const messageData = {
        sender: 'user',
        text: ctx.message.text,
        mediaPath: null,
        mediaType: null,
        filename: null,
    };

    await saveMessage(chatDocId, messageData, ctx.message.text);
});

// Handle media messages (photos, documents, etc.)
bot.on(['photo', 'document', 'video'], async (ctx) => {
    const chatId = String(ctx.chat.id);
    const username = ctx.from.username || ctx.from.first_name || 'User';
    
    const chatDocId = await getOrCreateChat(chatId, 'telegram', username);

    // Telegram requires an extra step to get the file URL/data. 
    // For simplicity, we just log a placeholder message now.
    const fileType = ctx.message.photo ? 'photo' : (ctx.message.document ? 'document' : 'media');
    const lastMessageText = `[Received ${fileType}]`;

    const messageData = {
        sender: 'user',
        text: ctx.message.caption || '',
        mediaPath: `telegram_file_id_${ctx.message[fileType][0].file_id}`, // Placeholder
        mediaType: fileType,
        filename: ctx.message.document ? ctx.message.document.file_name : null,
    };

    await saveMessage(chatDocId, messageData, lastMessageText);
    
    // Optional: reply to the user that their media was received
    // ctx.reply(`Received your ${fileType}. The admin team has been notified.`);
});

// 5. --- EXPRESS SERVER SETUP ---

const app = express();
app.use(bodyParser.json());
app.use(express.static('public')); // Serve static files (if any)

// --- ROUTES ---

// Health check route
app.get('/', (req, res) => {
    res.status(200).send("Matrix Admin Panel Backend is running.");
});

// 5.1. Firebase Custom Token Endpoint for Frontend Authentication
app.post('/auth/custom-token', async (req, res) => {
    const { username, password } = req.body;

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        try {
            // Create a custom token for the admin user ID
            const customToken = await auth.createCustomToken(ADMIN_USERNAME);
            console.log(`Generated custom token for admin.`);
            return res.status(200).json({ token: customToken });
        } catch (error) {
            console.error('Error generating custom token:', error);
            return res.status(500).json({ error: 'Failed to generate authentication token.' });
        }
    }
    
    // Using a different check for the anonymous token used by the Canvas environment
    if (username === 'anonymous' && password === 'canvas_auth') {
        try {
            const anonymousToken = await auth.createCustomToken(admin.auth.UserId, { isAnonymous: true });
            return res.status(200).json({ token: anonymousToken });
        } catch (error) {
             console.error('Error generating anonymous token:', error);
             return res.status(500).json({ error: 'Failed to generate anonymous token.' });
        }
    }

    return res.status(401).json({ error: 'Invalid admin credentials.' });
});

// 5.2. Telegram Webhook Endpoint
// Telegraf uses an Express route for its webhook
app.post(`/telegram/webhook`, (req, res) => {
    console.log("Telegram webhook received.");
    return bot.handleUpdate(req.body, res);
});

// 5.3. Facebook Messenger Webhook Endpoint
app.get('/facebook/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
            console.log('FB Webhook Verified.');
            return res.status(200).send(challenge);
        } else {
            return res.sendStatus(403);
        }
    }
    return res.sendStatus(400);
});

app.post('/facebook/webhook', (req, res) => {
    // Basic setup for receiving messages
    console.log('FB Message Received:', JSON.stringify(req.body));
    
    const entries = req.body.entry || [];
    for (const entry of entries) {
        for (const event of entry.messaging || []) {
            if (event.message) {
                // In a real implementation, you would:
                // 1. Get sender ID (event.sender.id) and message text (event.message.text)
                // 2. Call getOrCreateChat('FB-SENDER-ID', 'facebook', 'FB User Name')
                // 3. Call saveMessage(chatDocId, messageData, event.message.text)
                console.log(`Processing FB message from sender ${event.sender.id}`);
            }
        }
    }
    
    // Always send a 200 OK response to Messenger
    res.status(200).send('EVENT_RECEIVED');
});


// --- SERVER START ---

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    
    // Set Telegram Webhook URL (Crucial for Telegraf to receive messages)
    try {
        const webhookUrl = `http://localhost:${PORT}/telegram/webhook`; // Use your actual public URL in production
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`Telegram webhook set to: ${webhookUrl}`);
    } catch (e) {
        console.warn('Could not set Telegram webhook. Make sure the server is accessible (e.g., using ngrok in dev).', e.message);
    }
});
