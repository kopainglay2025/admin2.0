

// လိုအပ်သော Packages များ ထည့်သွင်းခြင်း
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

// =========================================================
// --- စိတ်ကြိုက်ပြင်ဆင်ရန်လိုအပ်သော အချက်အလက်များ (Environment Variables ဖြင့် အသုံးပြုရန်) ---
// လုံခြုံရေးအရ ဤနေရာတွင် တန်ဖိုးများ တိုက်ရိုက်မထည့်သွင်းဘဲ Environment Variables များကို အသုံးပြုပါ။
const TELEGRAM_BOT_TOKEN = '8599597818:AAGiAJTpzFxV34rSZdLHrd9s3VrR5P0fb-k'; // သင့် Telegram Bot Token ထည့်ပါ။
const MONGODB_URI = 'mongodb+srv://painglay123:painglay123@cluster0.b3rucy3.mongodb.net/?appName=Cluster0/telegram_admin_chat'; // သင့် MongoDB URI ထည့်ပါ။
const PORT = process.env.PORT || 80;


// Admin Login အချက်အလက်များ
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Paing@123';
// =========================================================

// Express App နှင့် HTTP Server ဖန်တီးခြင်း
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Telegram Bot ကို စတင်ခြင်း
if (TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    console.error('ERROR: TELEGRAM_BOT_TOKEN ကို သတ်မှတ်ပေးပါ!');
}
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// MongoDB ချိတ်ဆက်မှု
mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB ချိတ်ဆက်မှု အောင်မြင်ပါသည်'))
    .catch(err => console.error('MongoDB ချိတ်ဆက်မှု အမှား:', err.message));

// Database Schema များ
const UserSchema = new mongoose.Schema({
    telegramId: { type: Number, required: true, unique: true },
    username: { type: String, default: 'Unknown User' },
    lastMessageTime: { type: Date, default: Date.now }, // ဤ field ကို sorting အတွက် အသုံးပြုသည်
}, { timestamps: true });

const MessageSchema = new mongoose.Schema({
    chatId: { type: Number, required: true },
    sender: { type: String, enum: ['user', 'admin'], required: true },
    text: { type: String, default: '' },
    mediaPath: { type: String, default: null }, 
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// --- HTTP Basic Authentication Middleware ---
const basicAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
        return res.status(401).send('ခွင့်ပြုချက်မရှိပါ (Unauthorized)');
    }
    const [scheme, encoded] = authHeader.split(' ');
    if (scheme !== 'Basic' || !encoded) {
        return res.status(400).send('တောင်းဆိုမှုပုံစံ မမှန်ကန်ပါ (Bad Request)');
    }
    const decoded = Buffer.from(encoded, 'base64').toString();
    const [username, password] = decoded.split(':');
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
    return res.status(401).send('ခွင့်ပြုချက်မရှိပါ (Invalid Credentials)');
};
// ------------------------------------------

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Telegram Bot Message ကို လက်ခံခြင်း
bot.on('message', async (msg) => {
    
    // Bot ကိုယ်တိုင် ပြန်ပို့သော မက်ဆေ့ခ်ျကို (Admin reply) လျစ်လျူရှုခြင်း (Duplicate Fix)
    if (msg.from && msg.from.is_bot) {
        return; 
    }

    const chatId = msg.chat.id;
    const text = msg.text || msg.caption || '';
    const username = msg.chat.username || msg.chat.first_name || 'Unknown User';

    if (!msg.photo && !msg.document && !text.trim()) {
        console.log(`Telegram မှ message အသစ်: ${chatId} - Media (Not Photo/Text) ကို ကျော်သွားပါသည်`);
        return; 
    }
    
    const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : (msg.document ? msg.document.file_id : null);
    let mediaPath = fileId || null; 

    try {
        // User စာပို့သောအခါ lastMessageTime ကို အပ်ဒိတ်လုပ်ခြင်း
        const user = await User.findOneAndUpdate(
            { telegramId: chatId },
            { $set: { username: username, lastMessageTime: new Date() } },
            { upsert: true, new: true }
        );

        // Message ကို database တွင် သိမ်းဆည်းခြင်း
        const message = new Message({
            chatId: chatId,
            sender: 'user',
            text: text,
            mediaPath: mediaPath,
        });
        await message.save();

        console.log(`Telegram မှ message အသစ်: ${chatId} - ${text} (Media: ${!!mediaPath ? 'Yes' : 'No'})`);

        // Admin Panel သို့ Real-time အချက်ပြခြင်း
        io.emit('new_message', {
            chatId: chatId,
            message: message.toObject(),
            user: user.toObject()
        });

    } catch (error) {
        console.error("Telegram message လက်ခံရာတွင် အမှား:", error);
    }

    // Bot ၏ ပထမဆုံး တုံ့ပြန်မှု
    if (text === '/start') {
        bot.sendMessage(chatId, "မင်္ဂလာပါ! ကျွန်ုပ်တို့ရဲ့ အဖွဲ့ဝင်များနဲ့ စကားပြောဖို့ ဒီမှာ စာပို့နိုင်ပါတယ်။");
    }
});

// Admin Panel API Endpoints များ

// ၁။ အသုံးပြုသူစာရင်း ရယူခြင်း (နောက်ဆုံးစကားပြောချိန်ဖြင့် စီခြင်း)
app.get('/api/chats', basicAuthMiddleware, async (req, res) => {
    try {
        // lastMessageTime: -1 သည် အချိန်အသစ်ဆုံးကို အပေါ်ဆုံးတွင် ထားရန် ဖြစ်သည်။
        const users = await User.find().sort({ lastMessageTime: -1 }); 
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'အသုံးပြုသူစာရင်း ရယူရာတွင် အမှား' });
    }
});

// ၂။ Chat History ရယူခြင်း
app.get('/api/chats/:chatId/history', basicAuthMiddleware, async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const limit = parseInt(req.query.limit) || 30;
        const offset = parseInt(req.query.offset) || 0;

        const messages = await Message.find({ chatId: chatId })
            .sort({ timestamp: 1 }) 
            .skip(offset)
            .limit(limit);
            
        res.json(messages);
    } catch (error) {
        console.error("Chat history pagination error:", error);
        res.status(500).json({ error: 'Chat history ရယူရာတွင် အမှား' });
    }
});

// Socket.io Real-time ချိတ်ဆက်မှု
io.on('connection', (socket) => {
    console.log('Admin Panel မှ ချိတ်ဆက်မှု အသစ်');

    // ၃။ Admin မှ Message ပြန်ပို့ခြင်း (Image Handling နှင့် Last Message Time Update)
    socket.on('admin_reply', async (data) => {
        const { chatId, text, mediaPath } = data; 

        if (!chatId || (!text && !mediaPath)) {
            console.error("Chat ID သို့မဟုတ် စာသား/ပုံ မပါဝင်ပါ");
            return;
        }

        try {
            // ၁။ Message ကို Telegram သို့ ပြန်ပို့ခြင်း
            if (mediaPath) {
                const base64Data = mediaPath.split(';base64,').pop();
                const imageBuffer = Buffer.from(base64Data, 'base64');
                
                await bot.sendPhoto(chatId, imageBuffer, {
                    caption: text,
                    disable_notification: true,
                    filename: 'admin_reply.png',
                    contentType: 'image/png' 
                });

            } else if (text) {
                await bot.sendMessage(chatId, text);
            }

            // ၂။ Message ကို database တွင် သိမ်းဆည်းခြင်း
            const message = new Message({
                chatId: chatId,
                sender: 'admin',
                text: text || '',
                mediaPath: mediaPath || null,
            });
            await message.save();

            // ၃။ Admin ပြန်ပြောသောအခါ User ၏ lastMessageTime ကို အပ်ဒိတ်လုပ်ခြင်း (Sorting ပြဿနာကို ဖြေရှင်းရန်)
            const updatedUser = await User.findOneAndUpdate(
                { telegramId: chatId },
                { $set: { lastMessageTime: new Date() } },
                { new: true } // အပ်ဒိတ်လုပ်ထားသော User document ကို ပြန်ရရန်
            );

            // ၄။ Admin Panel ရှိ အခြားသူများအား Real-time အပ်ဒိတ်လုပ်ခြင်း
            io.emit('new_message', {
                chatId: chatId,
                message: message.toObject(),
                user: updatedUser.toObject() // အပ်ဒိတ်လုပ်ထားသော user ကို ပို့ပေးရန်
            });

            console.log(`Admin မှ ပြန်ပို့သော message: ${chatId} - ${text} (Media: ${!!mediaPath ? 'Yes' : 'No'})`);

        } catch (error) {
            console.error("Admin message ပြန်ပို့ရာတွင် အမှား:", error.response?.body || error.message);
            socket.emit('error', { type: 'send_failed', message: `Telegram သို့ message ပို့မရပါ: ${error.message}` });
        }
    });

    socket.on('disconnect', () => {
        console.log('Admin Panel မှ ချိတ်ဆက်မှု ပြတ်တောက်ပါသည်');
    });
});

// Admin Panel UI အတွက် ပင်မစာမျက်နှာ (Auth Required)
app.get('/admin', basicAuthMiddleware, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin_panel.html'));
});

// Server ကို စတင်ခြင်း
server.listen(PORT, () => {
    console.log(`Server ကို http://localhost:${PORT} တွင် စတင်လိုက်ပါပြီ။`);
    console.log(`Admin Panel ကို http://localhost:${PORT}/admin တွင် ဝင်ရောက်ကြည့်ရှုနိုင်ပါသည်။`);
});

// Process ရပ်တန့်ခြင်းအတွက် Bot ကို ပိတ်ရန်
process.on('SIGINT', () => {
    console.log('\nBot polling ကို ပိတ်လိုက်ပါပြီ...');
    bot.stopPolling();
    mongoose.connection.close();
    server.close(() => {
        console.log('Server ပိတ်လိုက်ပါပြီ။');
        process.exit(0);
    });
});
