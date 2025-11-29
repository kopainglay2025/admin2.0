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
// `polling: true` ကို သုံးထားသောကြောင့် Bot သည် Server ကို restart လုပ်တိုင်း မက်ဆေ့ခ်ျအသစ်များကို လက်ခံရရှိမည်ဖြစ်သည်။
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

// Message Schema ကို ပြင်ဆင်ခြင်း: text ကို optional လုပ်ပြီး imageUrl ထည့်သွင်းခြင်း
const MessageSchema = new mongoose.Schema({
    chatId: { type: Number, required: true },
    sender: { type: String, enum: ['user', 'admin'], required: true },
    text: { type: String, default: '' }, // စာသားမပါဘဲ ပုံသာ ပါနိုင်သည်။
    imageUrl: { type: String, default: null }, // Image Base64 Data (Admin Outgoing) သို့မဟုတ် Image URL (User Incoming)
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
app.use(express.json({ limit: '50mb' })); // Base64 Image data ကြီးမားမှုကို လက်ခံရန် limit တိုးမြှင့်ခြင်း

// Public folder ကို အသုံးပြုရန် (Admin Panel သာမက Static Assets များကိုပါ ထိန်းချုပ်ရန်)
app.use(express.static('public')); 

// Telegram Bot Message ကို လက်ခံခြင်း (No Auth Needed)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption || ''; // စာသား သို့မဟုတ် ဓာတ်ပုံစာတန်း
    const username = msg.chat.username || msg.chat.first_name || 'Unknown User';

    // ဓာတ်ပုံ သို့မဟုတ် စာသား/ဗီဒီယိုစာတန်း မပါလျှင် ပြန်ထွက်ရန်
    if (!msg.photo && !msg.document && !text.trim()) {
        console.log(`Telegram မှ message အသစ်: ${chatId} - Media (Not Photo/Text) ကို ကျော်သွားပါသည်`);
        return; 
    }
    
    // Image ၏ File ID ကို ရယူခြင်း (အကြီးဆုံး image ကို ရယူခြင်း)
    const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
    let imageUrl = null; 

    if (fileId) {
        // Telegram မှ ယာယီ file link ကို ရယူပြီး သိမ်းဆည်းခြင်း (real-world အတွက် permanent storage လိုအပ်သည်)
        try {
            const fileLink = await bot.getFileLink(fileId);
            imageUrl = fileLink;
        } catch (linkError) {
            console.error("Telegram file link ရယူရာတွင် အမှား:", linkError.message);
            // Link မရပါက အသုံးပြုသူ၏ image ID ကို သိမ်းဆည်းရန်
            imageUrl = `file_id_fallback: ${fileId}`; 
        }
    }

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
            imageUrl: imageUrl, // Image URL/ID ကို ထည့်သွင်းခြင်း
        });
        await message.save();

        console.log(`Telegram မှ message အသစ်: ${chatId} - ${text} (Image: ${!!imageUrl ? 'Yes' : 'No'})`);

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

// ၂။ Chat History ရယူခြင်း (Pagination ထည့်သွင်းခြင်း)
app.get('/api/chats/:chatId/history', basicAuthMiddleware, async (req, res) => {
    try {
        const chatId = req.params.chatId;
        const limit = parseInt(req.query.limit) || 30; // တစ်ကြိမ်တောင်းဆိုမှုအတွက် အများဆုံး မက်ဆေ့ခ်ျအရေအတွက်
        const offset = parseInt(req.query.offset) || 0; // မက်ဆေ့ခ်ျများကို ကျော်သွားမည့် အရေအတွက် (အစောဆုံးမှ စတင်ရေတွက်သည်)

        // စာရင်းဟောင်းမှ စာရင်းအသစ်သို့ တောင်းခံရန် `timestamp: 1` ဖြင့် စီခြင်း
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

    // ၃။ Admin မှ Message ပြန်ပို့ခြင်း (Image Handling ထည့်သွင်းခြင်း)
    socket.on('admin_reply', async (data) => {
        const { chatId, text, imageUrl } = data; // imageUrl (Base64) ကို လက်ခံခြင်း

        if (!chatId || (!text && !imageUrl)) {
            console.error("Chat ID သို့မဟုတ် စာသား/ပုံ မပါဝင်ပါ");
            return;
        }

        try {
            // ၁။ Message ကို Telegram သို့ ပြန်ပို့ခြင်း
            if (imageUrl) {
                // Base64 မှ Buffer ကို ရယူခြင်း
                const base64Data = imageUrl.split(';base64,').pop();
                const imageBuffer = Buffer.from(base64Data, 'base64');
                
                // Telegram သို့ ဓာတ်ပုံပို့ခြင်း
                await bot.sendPhoto(chatId, imageBuffer, {
                    caption: text, // စာသားပါလျှင် caption အဖြစ် ပို့ခြင်း
                    disable_notification: true 
                });

            } else if (text) {
                // ဓာတ်ပုံမပါဘဲ စာသားသာ ပို့ခြင်း
                await bot.sendMessage(chatId, `Admin: ${text}`);
            }

            // ၂။ Message ကို database တွင် သိမ်းဆည်းခြင်း
            const message = new Message({
                chatId: chatId,
                sender: 'admin',
                text: text || '',
                imageUrl: imageUrl || null, // Base64 data ကို သိမ်းဆည်းခြင်း (ကြီးမားသောကြောင့် real-world တွင် URL သာ သိမ်းသင့်သည်)
            });
            await message.save();

            // ၃။ Admin Panel ရှိ အခြားသူများအား အပ်ဒိတ်လုပ်ခြင်း
            io.emit('new_message', {
                chatId: chatId,
                message: message.toObject(),
                user: await User.findOne({ telegramId: chatId }).lean()
            });

            console.log(`Admin မှ ပြန်ပို့သော message: ${chatId} - ${text} (Image: ${!!imageUrl ? 'Yes' : 'No'})`);

        } catch (error) {
            console.error("Admin message ပြန်ပို့ရာတွင် အမှား:", error.response?.body || error.message);
            // Admin Panel ကို အမှားအယွင်း ပြန်အသိပေးရန်
            socket.emit('error', { type: 'send_failed', message: `Telegram သို့ message ပို့မရပါ: ${error.message}` });
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
