// server.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const { Telegraf } = require("telegraf");
const cors = require("cors");
const path = require("path");

// ----------------------------
// 1. Initialize Express
// ----------------------------
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" }
});

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public")); // for frontend


// ----------------------------
// 2. Firebase Initialization
// ----------------------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();


// ----------------------------
// 3. Admin Login
// ----------------------------
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (username === process.env.ADMIN_USERNAME &&
        password === process.env.ADMIN_PASSWORD) 
    {
        return res.json({ success: true });
    }

    res.json({ success: false, message: "Invalid credentials" });
});


// ----------------------------
// 4. SOCKET.IO — Real Time
// ----------------------------
io.on("connection", (socket) => {
    console.log("Admin connected:", socket.id);

    socket.on("reply_message", async (data) => {
        const { channel, user_id, message } = data;

        console.log("Admin Reply =>", data);

        // Save to Firestore
        await db.collection("messages").add({
            user_id,
            message,
            channel,
            from_admin: true,
            timestamp: Date.now()
        });

        // Send to relevant platform
        if (channel === "telegram") bot.telegram.sendMessage(user_id, message);
        if (channel === "facebook") sendFacebookMessage(user_id, message);
        if (channel === "viber") sendViberMessage(user_id, message);
        if (channel === "whatsapp") sendWhatsAppMessage(user_id, message);

        io.emit("new_message", data);
    });
});


// ----------------------------
// 5. Telegram Bot
// ----------------------------
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.on("text", async (ctx) => {
    const user_id = ctx.from.id.toString();
    const message = ctx.message.text;

    await saveMessage("telegram", user_id, message);

    io.emit("new_message", {
        channel: "telegram",
        user_id,
        message,
        from_admin: false
    });
});

bot.launch();


// ----------------------------
// 6. Facebook Webhook
// ----------------------------
app.post("/facebook/webhook", async (req, res) => {
    const body = req.body;

    if (body.object === "page") {
        body.entry.forEach(entry => {
            const event = entry.messaging[0];
            if (event.message && event.message.text) {
                const user_id = event.sender.id;
                const message = event.message.text;

                saveMessage("facebook", user_id, message);

                io.emit("new_message", {
                    channel: "facebook",
                    user_id,
                    message,
                    from_admin: false
                });
            }
        });
    }

    res.sendStatus(200);
});

// Facebook sender function
function sendFacebookMessage(psid, message) {
    const PAGE_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;

    fetch(`https://graph.facebook.com/v12.0/me/messages?access_token=${PAGE_TOKEN}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            recipient: { id: psid },
            message: { text: message }
        })
    });
}


// ----------------------------
// 7. Viber Handler (Simple)
// ----------------------------
function sendViberMessage(id, text) {
    // Add Viber API sender
}


// ----------------------------
// 8. WhatsApp Handler (Cloud API)
// ----------------------------
function sendWhatsAppMessage(id, text) {
    // Add WhatsApp Cloud API sender
}


// ----------------------------
// Save message to Firestore
// ----------------------------
async function saveMessage(channel, user_id, message) {
    await db.collection("messages").add({
        channel,
        user_id,
        message,
        from_admin: false,
        timestamp: Date.now()
    });
}


// ----------------------------
// 10. Start Server
// ----------------------------
server.listen(process.env.PORT, () => {
    console.log("Server running on port " + process.env.PORT);
});
