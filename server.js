// လိုအပ်သော Packages များ ထည့်သွင်းခြင်း
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore'); // Firestore Operations အတွက်

// =========================================================
// --- စိတ်ကြိုက်ပြင်ဆင်ရန်လိုအပ်သော အချက်အလက်များ (Environment Variables ဖြင့် အသုံးပြုရန်) ---

// ဤနေရာတွင် Canvas မှ ထည့်သွင်းပေးထားသော __app_id ကို အသုံးပြုသည်။
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// ၁။ Telegram Bot Token
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8599597818:AAGiAJTpzFxV34rSZdLHrd9s3VrR5P0fb-k';

// ၂။ Firebase Admin SDK Service Account JSON (တစ်ကြောင်းတည်းဖြင့် JSON String အဖြစ် ထည့်သွင်းပါ)
// (အကယ်၍ process.env တွင် မသတ်မှတ်ထားပါက၊ အောက်ပါ Hardcoded Key ကို အသုံးပြုပါမည်)
const FIREBASE_SERVICE_ACCOUNT_KEY = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || {
  "type": "service_account",
  "project_id": "mkschat-5e0b6",
  "private_key_id": "0196dab42c8336d2c567aa6805a88a524a85d32f",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCzqYA2dw6CVAOA\nuszuMMP2LFVQ2QxLCQUvSvWJbZIFLZvWNpERlP0G96QPLS9A9Nnu5vfNiPnNbSfG\nAgOnPRnOGO6C1zuhpzvZVXpazKz0lRVZ/vGZ39ANqPz0awC5JRAZoQtQUuTDgyqI\nPw9B03x3r1etivfaGdsb9/r9SlUkuSkGjybPlaN/7kQBTk6vpqx10qOVKBxTfzpG\nCm2JKAhAXxj9Z0I0S+K0fqTgqpyTky8eaySDOEiy3kJ3r9B+aqfCb7701U0n1MAW\nfK3x2ap0zausARIVBPwVLdJQTNQRmTYhQikKavN+S8nsu2YNF6IsaHwfrAeaLymr\n9ivWOZkbAgMBAAECggEAEitCbRT4jFOPZcr+WIQ+p7xEsIASudqNV1gJoWlJoBPE\nXmh28+6Q8XhvyJ0gLz3TyvuOnzmKpwIH81gBeJM5ndnFnR5ucw2k2XjHKTw+WB8P\njAy38Ctt20PLY7MX3UwTPGmd6Z9Ib+vpjDfHBOLXWTSL9bVHwBsR89p4hnmoR1Cg\nBoQVAx93coKNyEhzcB1ie8ngPnm4OcIK6VBuMY2NtsNF/kxfVzFfOPvpsaM35zgY\nP84KdMgwyIKhwNW/ssaqhMH/9fjBZkL/AjDRl7sip877CnC6oKZNSA3WABO31LdO\nVCYH0NzIQeBDl6gT12P8I6Bb7lonBzDVTAjAXDD0SQKBgQDwuAfyNBiRjWUH0AHZ\nGpBb3l5bci2wkiY0FsE9nVqDT+DLQaAH+tEL//1r+jcx79AhLrYCuUqT38UT2j6w\nxTLMx1JpiAkHQKS+DsLL0agQR9RW4TAD6KD84bJGfpdYrNwxiTtrSr9odmFBAoAK\n/FaKHORCyLacPypFjIL3tmml5wKBgQC/ETl+01/skj3Tcfz3COUH3XgeC+gzdXND\nksXt74viK5dyGNpIs0dSRMfHUZBkEbrpejI38PEIN3vs9WZJvbx5AlSa/c+OB6to\nTfRsQbf+J5sqvPInuqpm3AQZhz+6Vkl10JLgqGgzVmJLvAj7KjPesLjWNftTyxdc\neT2Z7oAkrQKBgQDX9YLLfIl+K8g0Fh1SVU6l3P3yNKFhA/1aRf/f80e8/vDB6YJV\nJmRdy6/kK3tRRcEHxAxurSWHPP5mLSqJFKHargf1vaG76/bgvAVvLg0FbivGNgkJ\nuK6VsTZroC7P02VI28F/JHRMl8fwtvmA4ZoSFpGCiOerjc+yzbjB29k0iQKBgQCx\nkaV4i6NLbkINP5OUVmzcGWRnsDM1l8Lumvpd/dFn+ZE/FX/QLuVqvMdaIyBpD91A\n3TLMsJyhQUdn2k0c3TvKznKotJdvbQtM3Z35+j2v80kOuBjo+V8iRvl8bCi62TRe\nTOAj7/8fLvodXnyOSBN6s4ykb/jKUCW+6GJqq6/l5QKBgHWfiC6CZ+rWnm3V8P67\nL5luOMY+AIDKp8fZtBJ237ltZtG3QmSU6Tls/MQ0VV5JoucyhmPI2Q240/qy5mJi\nqZozmHgez/qblRYSe0ma2/u+7khHAdRPZciFHKK9tgmcfzg+hXGljJNKF7Bszi85\nKMmA+MhJFg0KlDeQrPoiTLjJ\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@mkschat-5e0b6.iam.gserviceaccount.com",
  "client_id": "117927424354770866130",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40mkschat-5e0b6.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
}';

// ၃။ Admin Login အချက်အလက်များ
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Paing@123';
const PORT = process.env.PORT || 80;
// =========================================================

// Firebase Admin SDK ကို စတင်ခြင်း
// Hardcoded Key သို့မဟုတ် Environment Variable မှ ရယူထားသော Key သည် မှန်ကန်သော JSON ဖြစ်ကြောင်း စစ်ဆေးခြင်း
let serviceAccount;
try {
    serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_KEY);
} catch (e) {
    console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_KEY သည် မှန်ကန်သော JSON format မဟုတ်ပါ:', e.message);
    console.log('Firebase Admin SDK စတင်၍ မရပါ၊ server ကို ပိတ်လိုက်ပါမည်။');
    process.exit(1); 
}


// Firebase App ကို စတင်ခြင်း
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Firestore Database ကို ရယူခြင်း
const db = admin.firestore();

// Firestore Collection Reference များ
// Public data (အသုံးပြုသူတိုင်းအတွက် ဖွင့်ထားသော data) ၏ လမ်းကြောင်း
const BASE_PATH = `artifacts/${appId}/public/data`;
const usersColRef = db.collection(`${BASE_PATH}/users`);
const messagesColRef = db.collection(`${BASE_PATH}/messages`);


// Express App နှင့် HTTP Server ဖန်တီးခြင်း
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Telegram Bot ကို စတင်ခြင်း
if (TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    console.error('ERROR: TELEGRAM_BOT_TOKEN ကို သတ်မှတ်ပေးပါ!');
}
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

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
    
    // Bot ကိုယ်တိုင် ပြန်ပို့သော မက်ဆေ့ခ်ျကို (Admin reply) လျစ်လျူရှုခြင်း
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
    const currentTime = new Date();

    try {
        // User စာပို့သောအခါ lastMessageTime ကို အပ်ဒိတ်လုပ်ခြင်း
        // Document ID ကို chatId (String) အဖြစ် သတ်မှတ်ခြင်း
        const userDocRef = usersColRef.doc(chatId.toString());
        
        await userDocRef.set({
            telegramId: chatId,
            username: username,
            lastMessageTime: currentTime,
        }, { merge: true }); // ရှိပြီးသား data များကို မဖျက်ဘဲ အပ်ဒိတ်လုပ်ရန်

        const userSnapshot = await userDocRef.get();
        const user = userSnapshot.data();

        // Message ကို database တွင် သိမ်းဆည်းခြင်း
        const messageData = {
            chatId: chatId,
            sender: 'user',
            text: text,
            mediaPath: mediaPath,
            timestamp: currentTime 
        };
        const messageRef = await messagesColRef.add(messageData);
        const message = { id: messageRef.id, ...messageData };


        console.log(`Telegram မှ message အသစ်: ${chatId} - ${text} (Media: ${!!mediaPath ? 'Yes' : 'No'})`);

        // Admin Panel သို့ Real-time အချက်ပြခြင်း
        io.emit('new_message', {
            chatId: chatId,
            message: message,
            user: user
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
        // lastMessageTime ဖြင့် အချိန်အသစ်ဆုံးကို အပေါ်ဆုံးတွင် ထားရန် စီခြင်း
        const snapshot = await usersColRef.orderBy('lastMessageTime', 'desc').get();
        
        const users = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        res.json(users);
    } catch (error) {
        console.error("User list error:", error);
        res.status(500).json({ error: 'အသုံးပြုသူစာရင်း ရယူရာတွင် အမှား' });
    }
});

// ၂။ Chat History ရယူခြင်း
app.get('/api/chats/:chatId/history', basicAuthMiddleware, async (req, res) => {
    try {
        const chatId = parseInt(req.params.chatId);
        const limit = parseInt(req.query.limit) || 30;
        const offset = parseInt(req.query.offset) || 0; // Firestore တွင် offset သည် စွမ်းဆောင်ရည် နည်းပါးသဖြင့် avoid လုပ်ပါမည်။ limit ကိုသာ အသုံးပြုပါမည်။

        let query = messagesColRef
            .where('chatId', '==', chatId)
            .orderBy('timestamp', 'asc');

        // Firestore တွင် offset မသုံးဘဲ limit ကိုသာ အသုံးပြုခြင်း
        query = query.limit(limit);
            
        const snapshot = await query.get();
        
        const messages = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.json(messages);
    } catch (error) {
        console.error("Chat history error:", error);
        res.status(500).json({ error: 'Chat history ရယူရာတွင် အမှား' });
    }
});

// Socket.io Real-time ချိတ်ဆက်မှု
io.on('connection', (socket) => {
    console.log('Admin Panel မှ ချိတ်ဆက်မှု အသစ်');

    // ၃။ Admin မှ Message ပြန်ပို့ခြင်း (Image Handling နှင့် Last Message Time Update)
    socket.on('admin_reply', async (data) => {
        const { chatId: chatIdStr, text, mediaPath } = data; 
        const chatId = parseInt(chatIdStr); // Telegram အတွက် Number သို့ သေချာပြောင်းလဲခြင်း
        const currentTime = new Date();

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
            const messageData = {
                chatId: chatId,
                sender: 'admin',
                text: text || '',
                mediaPath: mediaPath || null,
                timestamp: currentTime
            };
            const messageRef = await messagesColRef.add(messageData);
            const message = { id: messageRef.id, ...messageData };

            // ၃။ Admin ပြန်ပြောသောအခါ User ၏ lastMessageTime ကို အပ်ဒိတ်လုပ်ခြင်း 
            const userDocRef = usersColRef.doc(chatId.toString());
            await userDocRef.update({ lastMessageTime: currentTime });
            
            const updatedUserSnapshot = await userDocRef.get();
            const updatedUser = updatedUserSnapshot.data();

            // ၄။ Admin Panel ရှိ အခြားသူများအား Real-time အပ်ဒိတ်လုပ်ခြင်း
            io.emit('new_message', {
                chatId: chatId,
                message: message,
                user: updatedUser // အပ်ဒိတ်လုပ်ထားသော user ကို ပို့ပေးရန်
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
    // No explicit close needed for Firebase Admin SDK
    server.close(() => {
        console.log('Server ပိတ်လိုက်ပါပြီ။');
        process.exit(0);
    });
});
