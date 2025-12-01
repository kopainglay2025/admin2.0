// index.js (Node.js/Express Server Example)

// ဤ code သည် Node.js/Express ကို အသုံးပြုထားပါသည်။
// dependencies များ ထည့်သွင်းရန် လိုအပ်သည်: express, cookie-parser, body-parser

const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');

// --- Configuration Constants ---
// TODO: ဤတန်ဖိုးများကို သင့် Admin အချက်အလက်နှင့် လျှို့ဝှက်ချက်များဖြင့် အစားထိုးပါ။
const ADMIN_USERNAME = 'admin'; // သင့်စိတ်ကြိုက်ပြောင်းလဲနိုင်သည်
const ADMIN_PASSWORD = 'supersecretpassword'; // လုံခြုံမှုအတွက် ပိုရှည်ပြီး ခက်ခဲသော password ကိုသုံးပါ

// Telegram Bot Token ကို ဤနေရာတွင် ထားပါ။
const TELEGRAM_BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN'; 

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware Setup ---
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'))); // သင့်ရဲ့ admin.html သည် public folder ထဲမှာ ရှိသည်ဟု ယူဆပါမည်

// --- Simple Session Management (In-memory for this example) ---
// ကြီးမားသော application များအတွက် Firestore သို့မဟုတ် Redis ကဲ့သို့သော database ကိုသုံးသင့်သည်။
const activeSessions = new Map();

/**
 * Session ID ကို ထုတ်လုပ်ပေးခြင်း
 */
const generateSessionId = () => crypto.randomBytes(32).toString('hex');

/**
 * Admin Session ကို စစ်ဆေးပေးခြင်း
 * @param {express.Request} req - Express request object
 * @param {express.Response} res - Express response object
 * @param {function} next - Next middleware function
 */
const requireAdminSession = (req, res, next) => {
    const sessionId = req.cookies.admin_session;
    if (sessionId && activeSessions.has(sessionId)) {
        // Session ရှိလျှင် ဆက်သွားပါ
        next();
    } else {
        // Session မရှိလျှင် Login မျက်နှာပြင်သို့ ပြန်ပို့ပါ။
        res.redirect('/login');
    }
};

// --- API Endpoints ---

/**
 * POST /api/login: Admin ဝင်ရောက်ခြင်းကို စစ်ဆေးပေးသည်။
 */
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        // အချက်အလက် မှန်ကန်လျှင် Session အသစ် ဖန်တီးပါ။
        const sessionId = generateSessionId();
        activeSessions.set(sessionId, { userId: username, timestamp: Date.now() });

        // Session ID ကို Cookie အဖြစ် သတ်မှတ်ပါ။ (လုံခြုံရေးအတွက် httpOnly ကို အသုံးပြုပါ)
        res.cookie('admin_session', sessionId, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production', 
            maxAge: 1000 * 60 * 60 * 24 // 24 နာရီ 
        });

        return res.json({ success: true, message: 'Login successful.', redirect: '/' });
    } else {
        // အချက်အလက် မမှန်ကန်လျှင်
        return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }
});

/**
 * POST /api/logout: Admin ထွက်ခွာခြင်း။
 */
app.post('/api/logout', (req, res) => {
    const sessionId = req.cookies.admin_session;
    if (sessionId) {
        activeSessions.delete(sessionId);
        res.clearCookie('admin_session');
    }
    res.json({ success: true, message: 'Logged out successfully.' });
});


/**
 * POST /api/send-message: Telegram သို့ မက်ဆေ့ချ် ပေးပို့ခြင်း။
 * (Admin Panel တွင် အသုံးပြုသည်)
 */
app.post('/api/send-message', requireAdminSession, async (req, res) => {
    const { telegramId, text } = req.body;

    if (!telegramId || !text) {
        return res.status(400).json({ message: 'Missing telegramId or text.' });
    }

    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    try {
        const telegramResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramId,
                text: text
            })
        });

        const data = await telegramResponse.json();
        
        if (telegramResponse.ok && data.ok) {
            // မက်ဆေ့ချ် အောင်မြင်စွာ ပို့ဆောင်ပြီးပါက၊ Front-end သည် Firestore listener မှတစ်ဆင့် အပ်ဒိတ်လုပ်မည်။
            return res.status(200).json({ success: true, message: 'Message sent via Telegram API.' });
        } else {
            console.error('Telegram API Error:', data);
            return res.status(500).json({ success: false, message: data.description || 'Failed to send message via Telegram API.' });
        }
    } catch (error) {
        console.error('Network or Fetch Error:', error);
        return res.status(500).json({ success: false, message: 'Server error during Telegram communication.' });
    }
});

// --- Routing ---

/**
 * GET /login: Login မျက်နှာပြင်
 */
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

/**
 * GET /: Admin Panel ၏ အဓိက မျက်နှာပြင်
 * Admin Session လိုအပ်ပါသည်။
 */
app.get('/', requireAdminSession, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Admin Panel အတွက် လမ်းကြောင်းများကို လုံခြုံအောင်ထားသည်။
app.get('/chat', requireAdminSession, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/broadcast', requireAdminSession, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/settings', requireAdminSession, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});


// --- Server Start ---
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Access the admin panel at: http://localhost:${PORT}/`);
});
