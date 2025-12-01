// index.js

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const auth = require('basic-auth');
const path = require('path');

// --- 1. Firebase Initialization (DB Setup) ---
try {
    const serviceAccountKey = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccountKey),
        databaseURL: "https://mksadmin-6ffeb-default-rtdb.firebaseio.com" // Replace with your actual database URL
    });
    console.log("Firebase initialized successfully.");
} catch (error) {
    console.error("Firebase initialization failed:", error);
    process.exit(1);
}

const db = admin.database();
const usersRef = db.ref('telegram_users');
const messagesRef = db.ref('messages');

// --- 2. Telegram Bot Setup ---
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const ADMIN_CHAT_ID = "YOUR_ADMIN_TELEGRAM_ID"; // Admin ရဲ့ Telegram ID ကို ဒီမှာထည့်ပါ (Broadcast/Alert အတွက်)

// Custom Menu Keyboard
const menuKeyboard = Markup.keyboard([
    ['/dashboard', '/chat'],
    ['/broadcast', '/settings']
]).resize();

// Command Handlers
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    
    // Save/Update user info in Firebase
    await usersRef.child(userId).set({ 
        id: userId, 
        username: username, 
        lastActive: admin.database.ServerValue.TIMESTAMP 
    });

    ctx.reply(`မင်္ဂလာပါ ${username}။ 👋\n\nမည်သည့် အကူအညီ လိုအပ်ပါသလဲ? Admin နဲ့ တိုက်ရိုက် စကားပြောလိုပါက **Chat** ကို နှိပ်ပါ သို့မဟုတ် တိုက်ရိုက် စာပို့နိုင်ပါတယ်။`, menuKeyboard);
});

bot.command('dashboard', (ctx) => ctx.reply('Dashboard အချက်အလက်များ... (e.g., website link)'));
bot.command('chat', (ctx) => ctx.reply('Admin နဲ့ စကားစပြောနိုင်ပါပြီ။ စာရေးပြီး ပို့နိုင်ပါတယ်။ Admin ဘက်မှ အမြန်ဆုံး ပြန်ဖြေပေးပါမယ်။'));
bot.command('broadcast', (ctx) => ctx.reply('Broadcast လုပ်ရန် Admin Panel ကို အသုံးပြုပါ။'));
bot.command('settings', (ctx) => ctx.reply('Bot ဆက်တင်များ...'));

// Message Handler - Real-Time Forwarding to Admin Panel
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    const messageText = ctx.message.text;
    const timestamp = admin.database.ServerValue.TIMESTAMP;

    // 1. Save message to Firebase
    const newMessage = {
        userId: userId,
        username: username,
        message: messageText,
        sender: 'user', // 'user' or 'admin'
        timestamp: timestamp
    };
    await messagesRef.child(userId).push(newMessage);
    
    // 2. Notify Admin Panel via Socket.IO
    io.emit('new_message_from_user', { 
        userId: userId, 
        username: username,
        message: messageText, 
        time: new Date().toLocaleTimeString() 
    });

    // 3. (Optional) Auto-reply for non-chat messages
    if (ctx.message.text.startsWith('/')) {
        // Command တွေကို စစ်ပြီး start က reply ပြီးသားမို့ ဘာမှ မလုပ်ပါ
    } else {
        // စကားပြောမုဒ်လို သဘောထားပြီး auto-reply မလုပ်တော့ပါ
    }
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));


// --- 3. Express Server & Socket.IO Setup (Admin Panel) ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Basic HTTP Authentication Middleware
const basicAuth = (req, res, next) => {
    const user = auth(req);
    if (!user || user.name !== process.env.ADMIN_USERNAME || user.pass !== process.env.ADMIN_PASSWORD) {
        res.set('WWW-Authenticate', 'Basic realm="Admin Access"');
        return res.status(401).send('Authentication required.');
    }
    next();
};

// Serve static files (HTML, CSS, JS) from the public folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(basicAuth); // Protect all routes with basic auth

// Routes
app.get('/', (req, res) => {
    // Dashboard (index.html)
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/chat/:userId', (req, res) => {
    // Chat Interface (chat.html)
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Socket.IO for Real-Time Communication
io.on('connection', (socket) => {
    console.log('Admin connected to socket.io');

    // Admin sends a message to a Telegram user
    socket.on('send_message_to_user', async (data) => {
        const { userId, message } = data;
        
        // 1. Send message via Telegram Bot
        try {
            await bot.telegram.sendMessage(userId, message);
            console.log(`Sent message to user ${userId}: ${message}`);

            // 2. Save admin message to Firebase
            const newMessage = {
                userId: userId,
                username: 'Admin', // For display purposes in chat history
                message: message,
                sender: 'admin',
                timestamp: admin.database.ServerValue.TIMESTAMP
            };
            await messagesRef.child(userId).push(newMessage);

            // 3. Acknowledge back to admin panel (to display the message immediately)
            socket.emit('message_sent_success', newMessage);

        } catch (error) {
            console.error(`Error sending message to user ${userId}:`, error);
            socket.emit('message_sent_error', { error: 'Failed to send message.' });
        }
    });

    // Admin requests initial chat history
    socket.on('request_chat_history', async (userId) => {
        try {
            const snapshot = await messagesRef.child(userId).once('value');
            const messages = snapshot.val();
            const messageList = [];
            
            if (messages) {
                // Convert Firebase object to a sorted array
                Object.keys(messages).forEach(key => {
                    messageList.push(messages[key]);
                });
                messageList.sort((a, b) => a.timestamp - b.timestamp);
            }

            socket.emit('chat_history', messageList);
        } catch (error) {
            console.error('Error fetching chat history:', error);
        }
    });

    // Admin requests list of all active users
    socket.on('request_active_users', async () => {
        try {
            const snapshot = await usersRef.once('value');
            const users = snapshot.val();
            const userList = [];

            if (users) {
                Object.keys(users).forEach(key => {
                    userList.push(users[key]);
                });
                // Sort by last active time
                userList.sort((a, b) => b.lastActive - a.lastActive);
            }
            socket.emit('active_users_list', userList);
        } catch (error) {
            console.error('Error fetching active users:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('Admin disconnected from socket.io');
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Admin Panel URL: http://localhost:${PORT}`);
});
