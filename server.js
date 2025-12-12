// server.js

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const { Telegraf } = require('telegraf');
const firebaseAdmin = require('firebase-admin');
const path = require('path');

// --- Initialization ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// Initialize Firebase Admin SDK (FIXED CODE BLOCK)
try {
    const keyPath = process.env.FIREBASE_KEY_PATH;
    
    if (!keyPath) {
        throw new Error("FIREBASE_KEY_PATH not set in .env file.");
    }
    
    // Load the JSON file directly from the path
    const serviceAccount = require(path.resolve(keyPath));

    firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccount),
        // Use your Firebase project ID for the databaseURL
        databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com` 
    });
    console.log("✅ Firebase Admin Initialized Successfully.");
} catch (error) {
    console.error("❌ Firebase Initialization Error. Check firebase-key.json and FIREBASE_KEY_PATH:", error.message);
    // CRITICAL: Prevent the server from starting if Firebase fails
    process.exit(1); 
}

const db = firebaseAdmin.database();
const telegramUsersRef = db.ref('telegram_users');

// Initialize Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
// Note: Ensure your server is accessible via the TELEGRAM_WEBHOOK_URL (e.g., using ngrok or a public domain)
bot.telegram.setWebhook(process.env.TELEGRAM_WEBHOOK_URL).catch(e => console.error("Webhook Setup Error (May proceed if already set):", e.message));


// --- MongoDB Setup ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => {
        console.error('❌ MongoDB Connection Error:', err);
        process.exit(1);
    });

// --- MongoDB Schemas (models/User.js, models/Message.js, etc.) ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['superadmin', 'admin'], default: 'admin' }
});

UserSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

const User = mongoose.model('AdminUser', UserSchema);

// Schema for storing incoming messages
const MessageSchema = new mongoose.Schema({
    chatId: { type: String, required: true }, // Unique ID for the conversation (e.g., telegram_12345, fb_pageid_userid)
    platform: { type: String, enum: ['telegram', 'facebook', 'viber', 'whatsapp'], required: true },
    senderId: { type: String, required: true },
    senderName: { type: String },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    isFromAdmin: { type: Boolean, default: false },
    read: { type: Boolean, default: false }
});

const Message = mongoose.model('Message', MessageSchema);


// --- Middleware ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: 'secret_key_for_session_Paing@123_Secure', // Change this!
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 hours
}));

// --- Passport & Auth Setup ---
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        const user = await User.findOne({ username });
        if (!user) return done(null, false, { message: 'Incorrect username.' });
        if (!await bcrypt.compare(password, user.password)) {
            return done(null, false, { message: 'Incorrect password.' });
        }
        return done(null, user);
    } catch (err) {
        return done(err);
    }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// Function to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
};

// --- Initial Admin Creation (Run once if needed) ---
(async () => {
    try {
        const exists = await User.findOne({ username: process.env.ADMIN_USERNAME });
        if (!exists) {
            const admin = new User({
                username: process.env.ADMIN_USERNAME,
                password: process.env.ADMIN_PASSWORD, // Hashing is handled by pre-save hook
                role: 'superadmin'
            });
            await admin.save();
            console.log('Default Admin User Created.');
        }
    } catch (e) {
        console.error('Admin Creation Error:', e);
    }
})();

// --- Helper Functions (Same as previous, included for completeness) ---

/**
 * Saves an incoming message to MongoDB and emits it to all connected admins via Socket.io.
 * @param {object} msgData - The message object
 */
async function handleIncomingMessage(msgData) {
    try {
        const newMessage = new Message(msgData);
        await newMessage.save();

        const chatId = msgData.chatId;
        const chatInfo = await getChatInfo(chatId);

        // Emit new message event to all connected admin clients
        io.emit('new_message', {
            ...newMessage.toObject(),
            chatInfo: chatInfo
        });
    } catch (e) {
        console.error('Error handling incoming message:', e);
    }
}

/**
 * Gets the latest list of unique chats/conversations.
 * Group by chatId, get the latest message for the timestamp, and unread count.
 */
async function getLatestChats(platform = null) {
    const match = platform ? { platform } : {};
    
    // Aggregate to get the last message and unread count for each unique chatId
    const chats = await Message.aggregate([
        { $match: match },
        { $sort: { timestamp: -1 } },
        {
            $group: {
                _id: "$chatId",
                lastMessage: { $first: "$$ROOT" },
                unreadCount: { 
                    $sum: { 
                        $cond: [{ $and: [{ $eq: ["$isFromAdmin", false] }, { $eq: ["$read", false] }] }, 1, 0] 
                    } 
                }
            }
        },
        { $sort: { 'lastMessage.timestamp': -1 } }
    ]);

    // Map the results to a cleaner format and fetch chat info
    const finalChats = await Promise.all(chats.map(async chat => {
        const chatInfo = await getChatInfo(chat._id);
        return {
            chatId: chat._id,
            platform: chat.lastMessage.platform,
            lastMessageText: chat.lastMessage.text,
            lastMessageTimestamp: chat.lastMessage.timestamp,
            unreadCount: chat.unreadCount,
            ...chatInfo // Includes senderName, etc.
        };
    }));

    return finalChats;
}

/**
 * Fetches user info (name, platform icon) for the chat list.
 */
async function getChatInfo(chatId) {
    // Simple logic to extract info from chatId for now
    const parts = chatId.split('_');
    const platform = parts[0];
    let senderName = "Unknown User";
    let senderId = parts.slice(1).join('_');

    if (platform === 'telegram') {
        const userSnapshot = await telegramUsersRef.child(senderId).once('value');
        const userData = userSnapshot.val();
        if (userData) {
            senderName = userData.first_name + (userData.last_name ? ' ' + userData.last_name : '');
        }
    } else if (platform === 'facebook') {
        // In a real app, you would call the Facebook Graph API to get user info.
        senderName = `FB User ${senderId.substring(0, 4)}...`;
    } 
    // Add logic for Viber and WhatsApp

    return { senderName, platform, senderId };
}


// --- Routes ---

// Login
app.get('/login', (req, res) => res.render('login'));
app.post('/login', passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
    failureFlash: false // Use a proper flash system in a real app
}));

// Logout
app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) { return next(err); }
        res.redirect('/login');
    });
});

// Dashboard (Main Chat Panel)
app.get('/', isAuthenticated, async (req, res) => {
    const chats = await getLatestChats();
    res.render('dashboard', { 
        adminUser: req.user,
        chats: chats
    });
});

// Chats API endpoint
app.get('/api/chats', isAuthenticated, async (req, res) => {
    const platform = req.query.platform;
    const chats = await getLatestChats(platform);
    res.json(chats);
});

// Messages API endpoint for a specific chat
app.get('/api/chats/:chatId/messages', isAuthenticated, async (req, res) => {
    const chatId = req.params.chatId;
    const messages = await Message.find({ chatId }).sort({ timestamp: 1 });
    
    // Mark as read
    await Message.updateMany(
        { chatId: chatId, isFromAdmin: false, read: false },
        { $set: { read: true } }
    );
    
    // Notify clients to update unread count
    io.emit('chat_read', { chatId });

    res.json(messages);
});


// --- Platform Webhook Routes ---

// 1. Telegram Webhook
app.post('/telegram/webhook', (req, res) => {
    bot.handleUpdate(req.body, res);
});

// Telegram Bot Message Handler
bot.on('text', async (ctx) => {
    const chatId = 'telegram_' + ctx.from.id;
    const senderName = ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '');
    
    // 1. Save Telegram User Info to Firebase
    await telegramUsersRef.child(ctx.from.id).set({
        id: ctx.from.id,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
        username: ctx.from.username,
        language_code: ctx.from.language_code,
        is_bot: ctx.from.is_bot,
        last_active: new Date().toISOString()
    });

    // 2. Handle Incoming Message
    handleIncomingMessage({
        chatId: chatId,
        platform: 'telegram',
        senderId: ctx.from.id.toString(), // Ensure senderId is a string
        senderName: senderName,
        text: ctx.message.text,
        isFromAdmin: false
    });

    // Telegram webhook must return 200 OK immediately
    // ctx.reply() calls are asynchronous, so we trust the webhook handler in Telegraf is quick.
    // If running with Express webhook, ensure you send status quickly.
});

// Handle /start command to make sure user info is saved
bot.command('start', async (ctx) => {
    const chatId = 'telegram_' + ctx.from.id;
    // Save User info
    await telegramUsersRef.child(ctx.from.id).set({
        id: ctx.from.id,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
        username: ctx.from.username,
        language_code: ctx.from.language_code,
        is_bot: ctx.from.is_bot,
        last_active: new Date().toISOString()
    });
    
    // Respond to the user (optional)
    ctx.reply('Thank you for starting the bot! We will get back to you soon.');
    
    // Trigger message handling for the /start command itself
    handleIncomingMessage({
        chatId: chatId,
        platform: 'telegram',
        senderId: ctx.from.id.toString(),
        senderName: ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : ''),
        text: '/start',
        isFromAdmin: false
    });
});


// 2. Facebook Webhook (Verification)
app.get('/facebook/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// 2. Facebook Webhook (Messages)
app.post('/facebook/webhook', (req, res) => {
    const body = req.body;
    if (body.object === 'page') {
        body.entry.forEach(entry => {
            entry.messaging.forEach(event => {
                if (event.message && !event.message.is_echo) {
                    const senderId = event.sender.id;
                    const chatId = 'facebook_' + senderId;
                    const text = event.message.text || "Attachment/Other Message";
                    
                    // Note: You need to call FB Graph API to get the sender's name with the token
                    handleIncomingMessage({
                        chatId: chatId,
                        platform: 'facebook',
                        senderId: senderId,
                        senderName: 'FB User',
                        text: text,
                        isFromAdmin: false
                    });
                }
            });
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// 3. Viber & 4. WhatsApp Webhooks (Stubs - Needs actual implementation)
app.post('/viber/webhook', (req, res) => {
    // Logic to handle Viber incoming messages and call handleIncomingMessage()
    res.sendStatus(200);
});

app.post('/whatsapp/webhook', (req, res) => {
    // Logic to handle WhatsApp incoming messages (e.g., Twilio/Meta API) and call handleIncomingMessage()
    res.sendStatus(200);
});


// --- Admin Reply/Broadcast Logic ---

/**
 * Sends a reply message back to the respective platform.
 */
async function sendReply(platform, senderId, text) {
    if (platform === 'telegram') {
        return bot.telegram.sendMessage(senderId, text);
    } else if (platform === 'facebook') {
        const messageData = {
            recipient: { id: senderId },
            message: { text: text }
        };
        const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${process.env.FB_PAGE_ACCESS_TOKEN}`;
        return require('axios').post(url, messageData);
    }
    // Add logic for Viber and WhatsApp APIs
    console.log(`Sending reply to ${platform} user ${senderId}: ${text}`);
    return Promise.resolve(); // Mock for other platforms
}

// Telegram User List and Broadcast Route
app.get('/telegram-users', isAuthenticated, async (req, res) => {
    const snapshot = await telegramUsersRef.once('value');
    const users = snapshot.val() ? Object.values(snapshot.val()) : [];
    res.render('telegram_users', { adminUser: req.user, users: users });
});

app.post('/telegram-broadcast', isAuthenticated, async (req, res) => {
    const { message } = req.body;
    const snapshot = await telegramUsersRef.once('value');
    const users = snapshot.val() ? Object.values(snapshot.val()) : [];
    let successCount = 0;
    
    // Use a basic rate limiter/batching in a production scenario
    for (const user of users) {
        try {
            await bot.telegram.sendMessage(user.id, message);
            successCount++;
        } catch (e) {
            console.error(`Failed to send broadcast to user ${user.id}:`, e.message);
        }
    }

    // Reload users list for the view
    const updatedSnapshot = await telegramUsersRef.once('value');
    const updatedUsers = updatedSnapshot.val() ? Object.values(updatedSnapshot.val()) : [];
    
    res.render('telegram_users', { 
        adminUser: req.user, 
        users: updatedUsers, 
        broadcastMessage: `Broadcast sent to ${successCount} users out of ${users.length} attempts.` 
    });
});


// --- Socket.io Real-Time Connection ---
io.on('connection', (socket) => {
    console.log('Admin connected to socket.io');

    // Admin sends a message back
    socket.on('admin_reply', async (data) => {
        const { chatId, senderId, platform, message, adminUsername } = data;

        if (!chatId || !senderId || !platform || !message) {
            return;
        }

        try {
            // 1. Send the reply via the platform API
            await sendReply(platform, senderId, message);

            // 2. Save the admin's reply to the database
            const adminMessage = new Message({
                chatId: chatId,
                platform: platform,
                senderId: adminUsername, // Use admin's username as senderId for admin messages
                senderName: adminUsername,
                text: message,
                isFromAdmin: true,
                read: true // Admin messages are always read
            });
            await adminMessage.save();

            // 3. Emit the new message to all connected admins to update their UI
            const chatInfo = await getChatInfo(chatId);
            io.emit('new_message_for_chat', {
                ...adminMessage.toObject(),
                chatInfo: chatInfo
            });

        } catch (e) {
            console.error('Error sending admin reply:', e.message);
            // Optionally, emit an error to the specific admin user
            socket.emit('reply_error', { chatId, error: e.message });
        }
    });

    socket.on('disconnect', () => {
        console.log('Admin disconnected from socket.io');
    });
});


// --- Start Server ---
server.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}.`);
});
