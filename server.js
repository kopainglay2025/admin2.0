// server.js အတွက် လိုအပ်သော packages များ
const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const admin = require('firebase-admin');
const axios = require('axios'); // Telegram Bot API ကိုခေါ်ရန်အတွက်

// .env ဖိုင်မှ ပတ်ဝန်းကျင်ဆိုင်ရာ ဗားရီယေဘယ်များကို တင်ရန်
dotenv.config();

// --- GLOBAL CONFIGURATION & INITIALIZATION ---

const app = express();
const PORT = process.env.PORT || 80; // .env တွင် သတ်မှတ်ထားသော Port (80) ကို အသုံးပြုသည်
const APP_ID = process.env.CANVAS_APP_ID || 'default-app-id'; // Client ဘက်မှ 'default-app-id' ကို သုံးထားသဖြင့် ဤနေရာတွင် တူညီအောင် သတ်မှတ်သည်
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Firebase Admin SDK ကို Initialization လုပ်ခြင်း
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized successfully.');
} catch (e) {
    console.error('Firebase Admin SDK initialization FAILED. Check FIREBASE_SERVICE_ACCOUNT_KEY in .env.', e);
    // Continue to allow non-DB dependent endpoints to work
}

const db = admin.firestore();

// Helper function to get correct Firestore paths
const getConversationsCollectionRef = () => db.collection(`artifacts/${APP_ID}/public/data/conversations`);
const getMessagesCollectionRef = (conversationId) => getConversationsCollectionRef().doc(conversationId).collection('messages');

// Middleware များ
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. စတက်တစ်ဖိုင်များ ပံ့ပိုးပေးခြင်း (index.html ကို တည်ရှိရာ ဖိုဒါမှ ပံ့ပိုးရန်)
app.use(express.static(path.join(__dirname)));

// 2. Bot Integration Webhook နေရာ (Telegram မှ မက်ဆေ့ချ်လက်ခံရန်)
// ဤ endpoint သည် Admin Panel ၏ အဆင့် ၁ (Telegram မှ Firestore သို့) အတွက် ဖြစ်သည်။
app.post('/api/webhook/telegram', async (req, res) => {
    console.log('--- Telegram Webhook Call Received ---');
    const update = req.body;
    
    // Telegram မှ ရရှိသော data ကို စစ်ဆေးခြင်း
    if (!update || !update.message) {
        // Non-message updates (e.g., edited_message) ကို လျစ်လျူရှုပြီး 200 ပြန်ပို့သည်
        res.status(200).send('OK (Non-message update)');
        return;
    }

    const message = update.message;
    const chatId = message.chat.id.toString(); // Telegram Chat ID ကို Conversation ID အဖြစ် သုံးသည်
    const userName = message.chat.username || message.chat.first_name || `User ${chatId}`;
    let text = message.text || message.caption || '';
    
    // Media detection
    let messageType = 'text';
    let mediaType = null;
    let fileSize = 0;
    
    if (message.photo) {
        messageType = 'media';
        mediaType = 'image/jpeg';
        fileSize = message.photo[message.photo.length - 1].file_size || 0;
        text = text || 'ပုံတစ်ပုံ ပို့လိုက်သည်'; // Use a default text if caption is empty
    } else if (message.video) {
        messageType = 'media';
        mediaType = message.video.mime_type;
        fileSize = message.video.file_size || 0;
        text = text || 'ဗီဒီယိုတစ်ခု ပို့လိုက်သည်';
    } else if (message.document) {
        messageType = 'media';
        mediaType = message.document.mime_type;
        fileSize = message.document.file_size || 0;
        text = text || message.document.file_name || 'ဖိုင်တစ်ခု ပို့လိုက်သည်';
    }

    console.log(`[Telegram User] ID: ${chatId}, Type: ${messageType}, Content: ${text.substring(0, 50)}...`);

    try {
        // 1. Message ကို Subcollection သို့ ထည့်သွင်းခြင်း
        const messageData = {
            type: messageType,
            content: text,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            fromAdmin: false, // User မှ ပို့သောစာ
            mediaType: mediaType,
            fileSize: fileSize,
        };
        
        await getMessagesCollectionRef(chatId).add(messageData);
        
        // 2. Conversation List အတွက် Parent Document ကို Update လုပ်ခြင်း
        const lastMessageText = messageType === 'media' 
            ? `User: [${mediaType.startsWith('image') ? 'ပုံ' : 'မီဒီယာ'}]`
            : `User: ${text}`;
            
        await getConversationsCollectionRef().doc(chatId).set({
            name: userName,
            lastMessage: lastMessageText.substring(0, 100),
            lastMessageTimestamp: admin.firestore.FieldValue.serverTimestamp(),
            // unreadCount ကို ဤနေရာတွင် increment လုပ်ရန်လည်း ဖြစ်နိုင်သည်
        }, { merge: true });

        // Webhook ၏ လိုအပ်ချက်အရ ၂၀၀ OK ကို ချက်ချင်းပြန်ပို့ခြင်း
        res.status(200).send('OK');

    } catch (error) {
        console.error("Error writing message to Firestore:", error);
        res.status(500).send('Firestore Write Error');
    }
});

// 3. Firestore Trigger Simulation API (Admin မှ စာပြန်ပို့ခြင်းအတွက်)
// ဤ API သည် Admin Panel ၏ အဆင့် ၂ (Firestore မှ Telegram သို့) အတွက် Cloud Function ကဲ့သို့ လုပ်ဆောင်ရန် နေရာဖြစ်သည်။
app.post('/api/trigger/firestore_admin_reply', async (req, res) => {
    const { conversationId, messageContent } = req.body;
    
    if (!conversationId || !messageContent) {
        return res.status(400).json({ success: false, message: 'Missing conversationId or messageContent.' });
    }

    // ဤနေရာသည် Admin Panel ၏ index.html မှ message ပို့ပြီးနောက်၊ message သည် Firestore တွင် ရေးသွင်းပြီးသည်ကို တွေ့ရှိရသည့် Cloud Function ၏ အခန်းကဏ္ဍကို အတုယူခြင်းဖြစ်သည်။
    
    console.log(`--- Firestore Admin Reply Triggered (Simulated) ---`);
    console.log(`[Telegram Reply] Chat ID: ${conversationId}`);
    console.log(`[Telegram Reply] Content: ${messageContent}`);

    try {
        if (!TELEGRAM_BOT_TOKEN) {
             console.warn("TELEGRAM_BOT_TOKEN is missing. Skipping actual Telegram API call.");
             return res.json({ success: true, message: 'Telegram reply simulated. TELEGRAM_BOT_TOKEN is not configured.' });
        }
        
        // Telegram Bot API (sendMessage) ကို ခေါ်ဆိုခြင်း
        const telegramRes = await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: conversationId,
            text: messageContent,
            parse_mode: 'HTML' // Optional: Allows basic HTML formatting
        });
        
        console.log(`[Telegram API] Successfully sent message. Status: ${telegramRes.status}`);
        
        res.json({ success: true, message: 'Telegram reply successfully executed.' });
        
    } catch (error) {
        console.error("Error sending message to Telegram API:", error.message);
        const errorDetails = error.response ? error.response.data : 'Unknown error';
        console.error("Telegram API Error Details:", errorDetails);
        
        res.status(500).json({ success: false, message: 'Failed to send message to Telegram.', errorDetails: errorDetails });
    }
});


// ဆာဗာကို စတင်ခြင်း
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
    console.log('index.html ကို ဖွင့်ကြည့်နိုင်ပါပြီ။');
});
