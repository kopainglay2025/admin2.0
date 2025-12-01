// index.js

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const auth = require('basic-auth');
const path = require('path'); // ✅ CORRECT SYNTAX

// --- 1. Firebase Initialization (DB Setup) ---
try {
    const serviceAccountKeyString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    
    if (!serviceAccountKeyString || typeof serviceAccountKeyString !== 'string') {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is missing or not a string.");
    }
    
    // JSON string ကို parse လုပ်ပါ (ဒီအဆင့်မှာ \\n တွေက \n အဖြစ် ပြောင်းသွားပါမယ်)
    const serviceAccountKey = JSON.parse(serviceAccountKeyString);
    
    admin.initializeApp({
        // Firebase Admin SDK က Private Key ကို စနစ်တကျ လက်ခံနိုင်အောင် cert() ကို သုံးပါ
        credential: admin.credential.cert(serviceAccountKey),
        databaseURL: "https://mksadmin-6ffeb-default-rtdb.firebaseio.com" // သင့်ရဲ့ Database URL ကို ဒီမှာ ထည့်ပေးပါ
    });
    console.log("Firebase initialized successfully.");
} catch (error) {
    console.error("Firebase initialization failed:", error);
    process.exit(1); // Initialization မအောင်မြင်ရင် app ကို ရပ်လိုက်ပါ
}

const db = admin.database();
const usersRef = db.ref('telegram_users');
const messagesRef = db.ref('messages');

// --- 2. Telegram Bot Setup ---
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
// Admin ရဲ့ Telegram ID ကို ဒီမှာ ထည့်ပါ။ (Broadcast/Alert အတွက်)
// လက်ရှိအသုံးပြုသူ ID ကို စမ်းသပ်ရန် သို့မဟုတ် သီးခြား Admin Group ID ကို ထည့်ပါ။
const ADMIN_CHAT_ID = "YOUR_ADMIN_TELEGRAM_ID"; 

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

bot.command('dashboard', (ctx) => ctx.reply('Dashboard အချက်အလက်များ... (Admin panel ကို ကြည့်ရှုရန်)'));
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
    // Child key (userId) အောက်မှာ message တွေကို push ဖြင့် သိမ်းဆည်းခြင်း
    await messagesRef.child(userId).push(newMessage);
    
    // 2. Notify Admin Panel via Socket.IO
    io.emit('new_message_from_user', { 
        userId: userId, 
        username: username,
        message: messageText, 
        time: new Date().toLocaleTimeString() 
    });
    
    // 3. (Optional) Admin ကို Telegram ကနေ Notification ပို့ပါ
    // bot.telegram.sendMessage(ADMIN_CHAT_ID, `New message from ${username} (${userId}): ${messageText}`);
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));


// --- 3. Express Server & Socket.IO Setup (Admin Panel) ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 80;

// Basic HTTP Authentication Middleware
const basicAuth = (req, res, next) => {
    const user = auth(req);
    // Basic Auth စစ်ဆေးခြင်း
    if (!user || user.name !== process.env.ADMIN_USERNAME || user.pass !== process.env.ADMIN_PASSWORD) {
        res.set('WWW-Authenticate', 'Basic realm="Admin Access"');
        return res.status(401).send('Authentication required.');
    }
    next();
};

// Serve static files (HTML, CSS, JS) from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Apply Basic Auth to all routes
app.use(basicAuth); 

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
            // bot.telegram.sendMessage() ကို သုံးပြီး user ဆီ စာပို့ပါ
            await bot.telegram.sendMessage(userId, message);
            console.log(`Sent message to user ${userId}: ${message}`);

            // 2. Save admin message to Firebase
            const newMessage = {
                userId: userId,
                username: 'Admin', // Admin ကိုယ်စားပြုအမည်
                message: message,
                sender: 'admin',
                timestamp: admin.database.ServerValue.TIMESTAMP
            };
            await messagesRef.child(userId).push(newMessage);

            // 3. Acknowledge back to admin panel (စာပို့ပြီးကြောင်း UI မှာ ပြသနိုင်ရန်)
            socket.emit('message_sent_success', newMessage);

        } catch (error) {
            console.error(`Error sending message to user ${userId}:`, error);
            socket.emit('message_sent_error', { error: 'Failed to send message via Telegram.' });
        }
    });

    // Admin requests initial chat history
    socket.on('request_chat_history', async (userId) => {
        try {
            const snapshot = await messagesRef.child(userId).once('value');
            const messages = snapshot.val();
            const messageList = [];
            
            if (messages) {
                // Firebase object ကို array အဖြစ် ပြောင်းပြီး အချိန်အလိုက် စီပါ
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
                // နောက်ဆုံး လှုပ်ရှားမှုအချိန် (lastActive) အလိုက် စီပါ
                userList.sort((a, b) => b.lastActive - a.lastActive);
            }
            socket.emit('active_users_list', userList);
        } catch (error) {
            console.error('Error fetching active users:', error);
        }
    });

    // Broadcast message to all users (TODO: ဤလုပ်ဆောင်ချက်ကို chat.html တွင် ထပ်ထည့်ရန်လိုသည်)
    socket.on('broadcast_message', async (message) => {
         try {
            const snapshot = await usersRef.once('value');
            const users = snapshot.val();
            let successCount = 0;
            
            if (users) {
                const userIds = Object.keys(users);
                for (const userId of userIds) {
                    try {
                        await bot.telegram.sendMessage(userId, `📣 Broadcast Message: ${message}`);
                        successCount++;
                    } catch (e) {
                        console.error(`Failed to send broadcast to user ${userId}:`, e.message);
                    }
                }
            }
            socket.emit('broadcast_result', { success: true, count: successCount });
         } catch (error) {
             socket.emit('broadcast_result', { success: false, error: 'Database error.' });
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
