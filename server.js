// --- Environment Variables Configuration ---
// Note: This script assumes you are running it in a Node.js environment
// where the environment variables are correctly loaded (e.g., using a .env file and 'dotenv' package, or via VPS settings).

// Use the variables provided by the user
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8599597818:AAGiAJTpzFxV34rSZdLHrd9s3VrR5P0fb-k";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Paing@123";
const PORT = process.env.PORT || 80;

const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const axios = require('axios');
const app = express();

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const APP_ID = 'telegram-chat-app'; // Placeholder for the app identifier

// --- FIREBASE SERVICE ACCOUNT KEY PARSING FIX ---
const serviceAccountKeyString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!serviceAccountKeyString) {
    console.error("FIREBASE_SERVICE_ACCOUNT_KEY environment variable is NOT set.");
    // Exit if the critical key is missing
    process.exit(1);
}

// FIX: Replace doubly-escaped newlines (\\n) with single escaped newlines (\n)
// This is necessary because many environment variable systems (like .env) 
// require this double escaping for the JSON string to be validly parsed.
const safeKeyString = serviceAccountKeyString.replace(/\\n/g, '\n');

let serviceAccount;
try {
    serviceAccount = JSON.parse(safeKeyString);
    console.log("Firebase Service Account Key parsed successfully.");
} catch (e) {
    console.error("Error parsing FIREBASE_SERVICE_ACCOUNT_KEY. Check for incorrect escaping or invalid JSON format.", e);
    process.exit(1);
}

// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    // Database URL is not needed for Firestore
});

const db = admin.firestore();

// Middleware to parse incoming JSON bodies (required for Telegram webhook)
app.use(bodyParser.json());

// --- Authentication Middleware (Basic Auth for Admin Panel API) ---
const basicAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
        return res.status(401).send('Authentication required.');
    }

    const [scheme, credentials] = authHeader.split(' ');
    if (scheme !== 'Basic' || !credentials) {
        return res.status(400).send('Bad Request.');
    }

    const [username, password] = Buffer.from(credentials, 'base64').toString().split(':');

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        next(); // Authentication successful
    } else {
        res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
        res.status(401).send('Invalid credentials.');
    }
};

// --- Helper function to save incoming Telegram message to Firestore ---
async function saveMessage(chatId, userId, username, text, type = 'user') {
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const chatRef = db.collection(`artifacts/${APP_ID}/public/data/chats`).doc(String(chatId));

    try {
        // 1. Create/Update the main chat document (for the Dashboard/User List)
        await chatRef.set({
            chatId: String(chatId),
            telegramUserId: String(userId),
            telegramUsername: username || `User ${userId}`,
            lastMessage: text,
            lastActivity: timestamp,
            unreadCount: admin.firestore.FieldValue.increment(type === 'user' ? 1 : 0) // Increment unread count for user messages
        }, { merge: true });

        // 2. Add the message to the subcollection
        await chatRef.collection('messages').add({
            sender: type, // 'user' or 'admin'
            text: text,
            timestamp: timestamp
        });

        console.log(`Message saved for chat ID ${chatId}.`);
    } catch (error) {
        console.error("Error saving message to Firestore:", error);
    }
}

// --- TELEGRAM WEBHOOK HANDLER ---
app.post('/telegram_webhook', async (req, res) => {
    try {
        const update = req.body;
        
        // Handle incoming message
        if (update.message && update.message.text) {
            const message = update.message;
            const chatId = message.chat.id;
            const userId = message.from.id;
            const username = message.from.username;
            const text = message.text;

            console.log(`Received message from @${username} (${chatId}): ${text}`);
            
            // Save the user's message
            await saveMessage(chatId, userId, username, text, 'user');
        } else {
            console.log("Received non-text update or other update type.");
        }

        // Telegram expects a 200 OK response quickly
        res.status(200).send('OK');
    } catch (error) {
        console.error("Error handling Telegram webhook:", error);
        res.status(500).send('Internal Server Error');
    }
});

// --- ADMIN API TO SEND REPLY ---
// Requires Basic Auth to prevent unauthorized use
app.post('/send_telegram_message', basicAuth, async (req, res) => {
    const { chatId, text } = req.body;

    if (!chatId || !text) {
        return res.status(400).send('Missing chatId or text.');
    }

    try {
        // 1. Send message via Telegram API
        const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: text
        });

        if (response.data.ok) {
            console.log(`Successfully sent message to chat ID ${chatId}`);
            
            // 2. Save the Admin's message to Firestore
            await saveMessage(chatId, 'admin', ADMIN_USERNAME, text, 'admin');

            // 3. Reset unread count since admin has replied
            const chatRef = db.collection(`artifacts/${APP_ID}/public/data/chats`).doc(String(chatId));
            await chatRef.update({ unreadCount: 0 });

            res.status(200).json({ success: true, message: "Message sent and logged." });
        } else {
            console.error("Telegram API Error:", response.data);
            res.status(500).json({ success: false, message: "Failed to send message via Telegram API." });
        }
    } catch (error) {
        console.error("Error in sending message or saving to Firestore:", error.message);
        res.status(500).json({ success: false, message: "Internal Server Error during send operation." });
    }
});

// --- Simple Setup Route to tell the admin where to configure the webhook ---
app.get('/', (req, res) => {
    res.send(`
        <h1>Telegram Bot Admin Backend Running</h1>
        <p>Your Telegram Bot Token: <code>${TELEGRAM_BOT_TOKEN}</code></p>
        <p>To start receiving messages, you MUST set your bot's webhook to:</p>
        <p><code>[YOUR_VPS_DOMAIN_OR_IP]:${PORT}/telegram_webhook</code></p>
        <p>You can set the webhook by making a GET request to: </p>
        <p><code>${TELEGRAM_API}/setWebhook?url=[YOUR_VPS_DOMAIN_OR_IP]:${PORT}/telegram_webhook</code></p>
    `);
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Admin Panel API protected by Basic Auth: ${ADMIN_USERNAME}:${ADMIN_PASSWORD}`);
});
