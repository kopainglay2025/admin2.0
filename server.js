// လိုအပ်သော Packages များ ထည့်သွင်းခြင်း
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

// --- စိတ်ကြိုက်ပြင်ဆင်ရန်လိုအပ်သော အချက်အလက်များ ---
const TELEGRAM_BOT_TOKEN = '8599597818:AAGiAJTpzFxV34rSZdLHrd9s3VrR5P0fb-k'; // သင့် Telegram Bot Token ထည့်ပါ။
const MONGODB_URI = 'mongodb+srv://painglay123:painglay123@cluster0.b3rucy3.mongodb.net/?appName=Cluster0/telegram_admin_chat'; // သင့် MongoDB URI ထည့်ပါ။
const PORT = process.env.PORT || 80;

// Admin Login အချက်အလက်များ (လုံခြုံရေးအတွက် Environment Variable ဖြင့် ထားသင့်သည်)
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'Paing@123';
// ---------------------------------------------------

// Express App နှင့် HTTP Server ဖန်တီးခြင်း
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Telegram Bot ကို စတင်ခြင်း
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// MongoDB ချိတ်ဆက်မှု
mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB ချိတ်ဆက်မှု အောင်မြင်ပါသည်'))
    .catch(err => console.error('MongoDB ချိတ်ဆက်မှု အမှား:', err));

// Database Schema များ
const UserSchema = new mongoose.Schema({
    telegramId: { type: Number, required: true, unique: true },
    username: { type: String, default: 'Unknown User' },
    lastMessageTime: { type: Date, default: Date.now },
}, { timestamps: true });

const MessageSchema = new mongoose.Schema({
    chatId: { type: Number, required: true },
    sender: { type: String, enum: ['user', 'admin'], required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// --- HTTP Basic Authentication Middleware ---
const basicAuthMiddleware = (req, res, next) => {
    // Basic Auth header ကို စစ်ဆေးခြင်း
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        // Auth header မပါရင် Login window ပေါ်လာစေရန် တောင်းဆိုခြင်း
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
        return res.status(401).send('ခွင့်ပြုချက်မရှိပါ (Unauthorized)');
    }

    // "Basic" နောက်က credentials များကို ဖယ်ရှားခြင်း
    const [scheme, encoded] = authHeader.split(' ');

    if (scheme !== 'Basic' || !encoded) {
        return res.status(400).send('တောင်းဆိုမှုပုံစံ မမှန်ကန်ပါ (Bad Request)');
    }

    // Base64 မှ စာသားအဖြစ် ပြောင်းလဲခြင်း (e.g., "admin:Paing@123")
    const decoded = Buffer.from(encoded, 'base64').toString();
    const [username, password] = decoded.split(':');

    // Username နှင့် Password စစ်ဆေးခြင်း
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        return next(); // အောင်မြင်ပါက ဆက်လက်ဆောင်ရွက်ရန်
    }

    // မအောင်မြင်ပါက Login window ပြန်ပေါ်လာစေရန် တောင်းဆိုခြင်း
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
    return res.status(401).send('ခွင့်ပြုချက်မရှိပါ (Invalid Credentials)');
};
// ------------------------------------------

// Middleware
app.use(express.json());

// Public folder ကို အသုံးပြုရန် (Admin Panel သာမက Static Assets များကိုပါ ထိန်းချုပ်ရန်)
app.use(express.static('public')); 

// Telegram Bot Message ကို လက်ခံခြင်း (No Auth Needed)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const username = msg.chat.username || msg.chat.first_name;

    if (!text) return; // စာမဟုတ်သော message များအတွက် ကျော်သွားရန်

    try {
        // User ကို database တွင် သိမ်းဆည်းခြင်း (သို့) update လုပ်ခြင်း
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
        });
        await message.save();

        console.log(`Telegram မှ message အသစ်: ${chatId} - ${text}`);

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

// Admin Panel API Endpoints များ (Auth Required)

// ၁။ အသုံးပြုသူစာရင်း ရယူခြင်း
app.get('/api/chats', basicAuthMiddleware, async (req, res) => {
    try {
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
        const messages = await Message.find({ chatId: chatId }).sort({ timestamp: 1 });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Chat history ရယူရာတွင် အမှား' });
    }
});

// Socket.io Real-time ချိတ်ဆက်မှု (Socket.io သည် Authentication အတွက် client-side token သို့မဟုတ် cookie ကို အသုံးပြုရန် လိုအပ်သော်လည်း၊ ဤနေရာတွင် Server-side API များကိုသာ Auth ဖြင့် ကာကွယ်ထားသည်)
io.on('connection', (socket) => {
    console.log('Admin Panel မှ ချိတ်ဆက်မှု အသစ်');

    // ၃။ Admin မှ Message ပြန်ပို့ခြင်း (ဤ socket event သည် client-side တွင် Admin Panel ဖွင့်ထားမှသာ ဖြစ်ပေါ်သောကြောင့်၊ API endpoint များလောက် လုံခြုံရေး စိုးရိမ်စရာမရှိသော်လည်း၊ ပိုမိုလုံခြုံစေလိုပါက JWT စနစ် ထပ်ထည့်ရပါမည်)
    socket.on('admin_reply', async (data) => {
        const { chatId, text } = data;

        if (!chatId || !text) {
            console.error("Chat ID သို့မဟုတ် စာသား မပါဝင်ပါ");
            return;
        }

        try {
            // ၁။ Message ကို Telegram သို့ ပြန်ပို့ခြင်း
            await bot.sendMessage(chatId, `Admin: ${text}`);

            // ၂။ Message ကို database တွင် သိမ်းဆည်းခြင်း
            const message = new Message({
                chatId: chatId,
                sender: 'admin',
                text: text,
            });
            await message.save();

            // ၃။ Admin Panel ရှိ အခြားသူများအား အပ်ဒိတ်လုပ်ခြင်း
            io.emit('new_message', {
                chatId: chatId,
                message: message.toObject(),
                user: await User.findOne({ telegramId: chatId }).lean()
            });

            console.log(`Admin မှ ပြန်ပို့သော message: ${chatId} - ${text}`);

        } catch (error) {
            console.error("Admin message ပြန်ပို့ရာတွင် အမှား:", error.response.body);
            // Admin Panel ကို အမှားအယွင်း ပြန်အသိပေးရန်
            socket.emit('error', { type: 'send_failed', message: 'Telegram သို့ message ပို့မရပါ' });
        }
    });

    socket.on('disconnect', () => {
        console.log('Admin Panel မှ ချိတ်ဆက်မှု ပြတ်တောက်ပါသည်');
    });
});

// Admin Panel UI အတွက် ပင်မစာမျက်နှာ (Auth Required)
app.get('/admin', basicAuthMiddleware, (req, res) => {
    // ဤ admin_panel.html ဖိုင်ကို 'public' folder ထဲတွင် သိမ်းဆည်းထားရပါမည်။
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
