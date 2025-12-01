import express from 'express';
import { Telegraf } from 'telegraf';
import admin from 'firebase-admin'; // FIX: Use default import for robust ES module compatibility
import 'dotenv/config';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

// Use ES module versions of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const FIREBASE_SERVICE_ACCOUNT_KEY_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = "very-secret-key-change-this"; // Should be stored in .env in production
const APP_ID = 'telegram-chat-app-v1'; // Fixed app ID for Firestore path

// --- Firebase Admin Initialization (Server Side) ---
if (!FIREBASE_SERVICE_ACCOUNT_KEY_JSON) {
    console.error("FATAL: FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set.");
    process.exit(1);
}
let serviceAccount;
try {
    // The key is properly escaped with \\n in .env, so JSON.parse will resolve it correctly.
    serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_KEY_JSON);
} catch (e) {
    console.error("FATAL: Could not parse FIREBASE_SERVICE_ACCOUNT_KEY JSON:", e);
    process.exit(1);
}

// FIX: Using the admin namespace for initialization
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore(); // Use admin.firestore()
console.log("Firebase Admin SDK initialized successfully.");

// --- Telegram Bot Initialization ---
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
// IMPORTANT: Update to your VPS domain
bot.telegram.setWebhook(`https://mkschannel.org/webhook`); 
console.log(`Telegram Bot initialized. Webhook set to: /webhook`);

// --- Firestore Helpers ---

// Path to store public chat data
const CHATS_COLLECTION_PATH = `artifacts/${APP_ID}/public/data/telegram_chats`;

/**
 * Saves a message from a user to Firestore.
 * @param {object} message The Telegram message object.
 * @param {string} sender The sender type ('user' or 'admin').
 */
async function saveMessage(message, sender) {
    const chatId = message.chat.id.toString();
    const chatRef = db.collection(CHATS_COLLECTION_PATH).doc(chatId);
    const messageData = {
        text: message.text,
        sender: sender,
        timestamp: admin.firestore.FieldValue.serverTimestamp(), // Use admin.firestore.FieldValue
        // Store original chat info only on user message
        telegramId: message.from.id.toString(),
        username: message.from.username || message.from.first_name || 'N/A'
    };

    try {
        // 1. Save the message to the subcollection
        await chatRef.collection('messages').add(messageData);

        // 2. Update the main chat document (for chat list display)
        await chatRef.set({
            telegramId: chatId,
            username: messageData.username,
            lastMessageTime: messageData.timestamp,
            // Use merge: true to avoid overwriting existing fields
        }, { merge: true });

        console.log(`Message saved from ${sender} (${chatId}): ${message.text.substring(0, 30)}...`);
    } catch (error) {
        console.error("Error saving message to Firestore:", error);
    }
}

// --- Telegram Bot Handlers ---

// Handle all incoming text messages
bot.on('text', async (ctx) => {
    // Save the user's message to Firestore
    await saveMessage(ctx.message, 'user');

    // Optional: Send an automatic reply to the user immediately
    // ctx.reply("Thank you for your message. An admin will respond shortly.");
});

// Handle /start command
bot.start(async (ctx) => {
    await saveMessage(ctx.message, 'user');
    ctx.reply('မင်္ဂလာပါ! အုပ်ချုပ်သူ (Admin) မှ အချိန်မရွေး ပြန်လည်ဖြေကြားပေးပါလိမ့်မယ်။');
});

// --- Express Server and Admin Panel ---
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser(SESSION_SECRET));

// Middleware for Admin Authentication
const requireAuth = (req, res, next) => {
    // Simple cookie-based session check
    if (req.signedCookies.admin_session === 'authenticated') {
        next();
    } else {
        res.redirect('/login');
    }
};

// Route to handle incoming Telegram updates
app.post('/webhook', (req, res) => {
    bot.handleUpdate(req.body);
    res.sendStatus(200); // Important to respond quickly
});

// Serve the admin HTML file
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Main admin protected routes (all served by the same single HTML file)
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/chat', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/broadcast', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/settings', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});


// Admin Login API endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        // Set a signed cookie for session management
        res.cookie('admin_session', 'authenticated', {
            httpOnly: true,
            signed: true,
            maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
        });
        return res.json({ success: true, redirect: '/' });
    } else {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Admin Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('admin_session');
    res.json({ success: true, redirect: '/login' });
});

// Admin API to send a message back to a Telegram user
app.post('/api/send-message', requireAuth, async (req, res) => {
    const { telegramId, text } = req.body;

    if (!telegramId || !text) {
        return res.status(400).json({ success: false, message: 'Missing telegramId or text' });
    }

    try {
        // 1. Send the message via Telegram Bot
        const message = await bot.telegram.sendMessage(telegramId, `[Admin]: ${text}`);
        
        // 2. Save the admin's response to Firestore for history
        // Create a mock message object similar to a user message for consistency
        const adminMessage = {
            chat: { id: telegramId },
            text: text,
            // Mock object for saveMessage consistency
            from: { id: 'ADMIN_ID', username: 'Admin', first_name: 'Admin' } 
        };
        await saveMessage(adminMessage, 'admin');

        return res.json({ success: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error(`Error sending message to Telegram ID ${telegramId}:`, error);
        // Check for common errors (e.g., bot blocked by user)
        if (error.response && error.response.error_code === 403) {
             return res.status(500).json({ success: false, message: 'Failed to send message: Bot blocked by user.' });
        }
        return res.status(500).json({ success: false, message: 'Failed to send message via Telegram' });
    }
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Admin Panel running on http://localhost:${PORT}`);
    console.log("-----------------------------------------");
    console.log("Please make sure your Telegram Webhook is configured correctly (e.g., pointing to your VPS URL/webhook).");
});
