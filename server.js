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
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const MONGODB_URI = process.env.MONGODB_URI || 'YOUR_MONGODB_URI_HERE';
const PORT = process.env.PORT || 80;

// Admin Login အချက်အလက်များ (လုံခြုံရေးအတွက် Environment Variable ကိုသာ အမြဲသုံးပါ)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Paing@123';
// =========================================================

// Express App နှင့် HTTP Server ဖန်တီးခြင်း
const app = express();
// HTTP Basic Auth ကို HTTPS/SSL နောက်ကွယ်မှသာ အသုံးပြုရန် အကြံပြုလိုပါသည်။
const server = http.createServer(app);
const io = socketIo(server);

// Telegram Bot ကို စတင်ခြင်း
// `polling: true` ကို သုံးထားသောကြောင့် Bot သည် Server ကို restart လုပ်တိုင်း မက်ဆေ့ခ်ျအသစ်များကို လက်ခံရရှိမည်ဖြစ်သည်။
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
    lastMessageTime: { type: Date, default: Date.now },
}, { timestamps: true });

// Message Schema ကို ပြင်ဆင်ခြင်း: text ကို optional လုပ်ပြီး mediaPath (File ID/URL/Base64) ထည့်သွင်းခြင်း
const MessageSchema = new mongoose.Schema({
    chatId: { type: Number, required: true },
    sender: { type: String, enum: ['user', 'admin'], required: true },
    text: { type: String, default: '' }, // စာသားမပါဘဲ ပုံသာ ပါနိုင်သည်။
    // incoming အတွက် Telegram File ID ကိုသာ သိမ်းဆည်းမည်။ outgoing (admin reply) အတွက် Base64 ကို သိမ်းဆည်းမည် (ကောင်းသော practice တော့ မဟုတ်ပါ)။
    mediaPath: { type: String, default: null }, 
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// --- HTTP Basic Authentication Middleware ---
const basicAuthMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        // Auth header မပါရင် Login window ပေါ်လာစေရန် တောင်းဆိုခြင်း
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
        return res.status(401).send('ခွင့်ပြုချက်မရှိပါ (Unauthorized)');
    }

    const [scheme, encoded] = authHeader.split(' ');

    if (scheme !== 'Basic' || !encoded) {
        return res.status(400).send('တောင်းဆိုမှုပုံစံ မမှန်ကန်ပါ (Bad Request)');
    }

    const decoded = Buffer.from(encoded, 'base64').toString();
    const [username, password] = decoded.split(':');

    // Username နှင့် Password စစ်ဆေးခြင်း
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        return next(); // အောင်မြင်ပါက ဆက်လက်ဆောင်ရွက်ရန်
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
    return res.status(401).send('ခွင့်ပြုချက်မရှိပါ (Invalid Credentials)');
};
// ------------------------------------------

// Middleware
app.use(express.json({ limit: '50mb' })); // Base64 Image data ကြီးမားမှုကို လက်ခံရန် limit တိုးမြှင့်ခြင်း

// Public folder ကို အသုံးပြုရန်
app.use(express.static('public')); 

// Telegram Bot Message ကို လက်ခံခြင်း (No Auth Needed)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || msg.caption || '';
    const username = msg.chat.username || msg.chat.first_name || 'Unknown User';

    // ဓာတ်ပုံ သို့မဟုတ် စာသား/ဗီဒီယိုစာတန်း မပါလျှင် ပြန်ထွက်ရန်
    if (!msg.photo && !msg.document && !text.trim()) {
        console.log(`Telegram မှ message အသစ်: ${chatId} - Media (Not Photo/Text) ကို ကျော်သွားပါသည်`);
        return; 
    }
    
    // ပုံ/ဖိုင် ၏ File ID ကို ရယူခြင်း (အကြီးဆုံး image ကို ရယူခြင်း)
    // ယာယီ file link အစား File ID ကိုသာ Database တွင် သိမ်းဆည်းခြင်း
    const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : (msg.document ? msg.document.file_id : null);
    let mediaPath = null; 

    if (fileId) {
        // Production တွင် ဤ File ID ကို အသုံးပြု၍ Cloud Storage (e.g., S3/Firebase Storage) သို့ ပုံကို ဒေါင်းလုတ်ဆွဲပြီး URL ကို သိမ်းဆည်းသင့်သည်။
        // ဤနေရာတွင်မူ File ID ကိုသာ သိမ်းဆည်းထားမည်။
        mediaPath = fileId; 
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
            mediaPath: mediaPath, // File ID သို့မဟုတ် null ကို ထည့်သွင်းခြင်း
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
        const offset = parseInt(req.query.offset) || 0; // မက်ဆေ့ခ်ျများကို ကျော်သွားမည့် အရေအတွက်

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
        // data တွင် chatId, text, mediaPath (Base64 string) တို့ ပါဝင်သည်။
        const { chatId, text, mediaPath } = data; 

        if (!chatId || (!text && !mediaPath)) {
            console.error("Chat ID သို့မဟုတ် စာသား/ပုံ မပါဝင်ပါ");
            return;
        }

        try {
            // ၁။ Message ကို Telegram သို့ ပြန်ပို့ခြင်း
            if (mediaPath) {
                // WARNING: ကြီးမားသော Base64 string ကို Database တွင် သိမ်းဆည်းခြင်းသည် စွမ်းဆောင်ရည်ကို ကျဆင်းစေပြီး Document Limit ကို ကျော်လွန်စေနိုင်သည်။
                // Real-world တွင် ဤ Base64 ကို Cloud Storage (S3/Firebase) သို့ တင်ပြီး ရလာသော URL ကိုသာ Database တွင် သိမ်းဆည်းသင့်သည်။
                
                // Base64 မှ Buffer ကို ရယူခြင်း
                const base64Data = mediaPath.split(';base64,').pop();
                const imageBuffer = Buffer.from(base64Data, 'base64');
                
                // Telegram သို့ ဓာတ်ပုံပို့ခြင်း
                await bot.sendPhoto(chatId, imageBuffer, {
                    caption: text, // စာသားပါလျှင် caption အဖြစ် ပို့ခြင်း
                    disable_notification: true,
                    // photo ကို Buffer ပို့သောအခါ Telegram Bot API မှ File Options များ လိုအပ်နိုင်သည်
                    filename: 'admin_reply.png',
                    contentType: 'image/png' 
                });

            } else if (text) {
                // ဓာတ်ပုံမပါဘဲ စာသားသာ ပို့ခြင်း
                // Admin: prefix ကို ဖယ်ရှားလိုက်ပါပြီ။
                await bot.sendMessage(chatId, text);
            }

            // ၂။ Message ကို database တွင် သိမ်းဆည်းခြင်း
            const message = new Message({
                chatId: chatId,
                sender: 'admin',
                text: text || '',
                mediaPath: mediaPath || null, // Base64 data (သို့မဟုတ် URL) ကို သိမ်းဆည်းခြင်း
            });
            await message.save();

            // ၃။ Admin Panel ရှိ အခြားသူများအား အပ်ဒိတ်လုပ်ခြင်း
            io.emit('new_message', {
                chatId: chatId,
                message: message.toObject(),
                user: await User.findOne({ telegramId: chatId }).lean()
            });

            console.log(`Admin မှ ပြန်ပို့သော message: ${chatId} - ${text} (Media: ${!!mediaPath ? 'Yes' : 'No'})`);

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
    console.log(`\n======================================================`);
    console.log(`\nလုံခြုံရေး အကြံပြုချက်: Production အတွက် HTTPS/SSL ကို အသုံးပြုပါ။`);
    console.log(`လျို့ဝှက်ချက်များအားလုံးကို Environment Variables များမှသာ ရယူပါ။`);
    console.log(`======================================================\n`);
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
