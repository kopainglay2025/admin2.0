// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const axios = require('axios');

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/admin_messenger';

// ----- parse firebase key (fix \\n -> \n) if provided -----
let FIREBASE_SERVICE_ACCOUNT = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    FIREBASE_SERVICE_ACCOUNT = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, '\n')
    );
  } catch (err) {
    console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', err.message);
  }
}

// ----- Mongoose models -----
mongoose.set('strictQuery', false);
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB error', err); process.exit(1); });

const Schema = mongoose.Schema;

const MessageSchema = new Schema({
  chatId: { type: String, required: true, index: true },
  channel: { type: String, required: true }, // Telegram, Facebook, Viber, WhatsApp
  fromId: String,
  fromName: String,
  text: String,
  attachments: Array,
  ts: { type: Date, default: Date.now },
  direction: { type: String, enum: ['in','out'], default: 'in' }, // in = user->admin, out = admin->user
  meta: Schema.Types.Mixed
});
const Message = mongoose.model('Message', MessageSchema);

const ChatSchema = new Schema({
  chatId: { type: String, required: true, unique: true },
  channel: { type: String, required: true },
  peerName: String,
  lastMessage: String,
  lastTs: Date,
  unread: { type: Number, default: 0 },
  meta: Schema.Types.Mixed
});
const Chat = mongoose.model('Chat', ChatSchema);

const TelegramUserSchema = new Schema({
  telegramId: { type: Number, index: true, unique: true },
  username: String,
  first_name: String,
  last_name: String,
  language_code: String,
  startedAt: { type: Date, default: Date.now },
  meta: Schema.Types.Mixed
});
const TelegramUser = mongoose.model('TelegramUser', TelegramUserSchema);

// ----- Express + Socket.io setup -----
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// simple rate limiter for broadcast endpoint
const broadcastLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // max 3 broadcast requests per minute per IP
  message: 'Too many broadcasts, please try later.'
});

// Utility: upsert chat
async function upsertChat(chatId, channel, peerName, lastMessage, ts, meta) {
  const update = { channel, peerName, lastMessage, lastTs: ts, meta };
  const opts = { upsert: true, new: true, setDefaultsOnInsert: true };
  const chat = await Chat.findOneAndUpdate({ chatId }, update, opts);
  return chat;
}

// ---- socket.io: client connections ----
io.on('connection', (socket) => {
  console.log('Socket connected', socket.id);

  socket.on('join_admin_room', (adminId) => {
    socket.join('admins');
    console.log('Joined admin room:', adminId);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected', socket.id);
  });
});

// ----- Telegram Bot (node-telegram-bot-api) -----
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
let tgBot = null;
if (TELEGRAM_BOT_TOKEN) {
  // Using polling by default (simpler). For production, consider webhook mode (express route).
  tgBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

  tgBot.on('message', async (msg) => {
    try {
      const chatId = `tg:${msg.chat.id}`;
      const channel = 'Telegram';
      const peerName = msg.from.username ? `@${msg.from.username}` : `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || `${msg.chat.id}`;
      const text = msg.text || (msg.caption || '') || '[non-text message]';

      // save message
      const messageDoc = new Message({
        chatId,
        channel,
        fromId: msg.from.id,
        fromName: peerName,
        text,
        ts: msg.date ? new Date(msg.date * 1000) : new Date(),
        direction: 'in',
        meta: msg
      });
      await messageDoc.save();

      // upsert chat
      await upsertChat(chatId, channel, peerName, text, messageDoc.ts, { telegram: msg.chat });

      // increment unread
      await Chat.updateOne({ chatId }, { $inc: { unread: 1 } });

      // If /start, store telegram user for broadcast list
      if (text && text.trim().startsWith('/start')) {
        const u = {
          telegramId: msg.from.id,
          username: msg.from.username,
          first_name: msg.from.first_name,
          last_name: msg.from.last_name,
          language_code: msg.from.language_code
        };
        await TelegramUser.updateOne({ telegramId: u.telegramId || u.telegramId === 0 ? u.telegramId : msg.from.id },
          { $set: { telegramId: msg.from.id, username: u.username, first_name: u.first_name, last_name: u.last_name, language_code: u.language_code, startedAt: new Date() } },
          { upsert: true });
      }

      // emit to admins via socket.io
      io.to('admins').emit('new_message', {
        channel,
        chatId,
        message: {
          id: messageDoc._id,
          text: messageDoc.text,
          fromName: messageDoc.fromName,
          ts: messageDoc.ts,
          direction: messageDoc.direction
        }
      });

    } catch (err) {
      console.error('Telegram message handler error', err);
    }
  });

  console.log('Telegram bot started (polling).');
} else {
  console.warn('TELEGRAM_BOT_TOKEN not provided — Telegram features disabled.');
}

// ----- API: Get chats (filter by channel) -----
app.get('/api/chats', async (req, res) => {
  try {
    const channel = req.query.channel; // optional: Telegram, Viber, Facebook, WhatsApp
    const filter = channel ? { channel } : {};
    const chats = await Chat.find(filter).sort({ lastTs: -1 }).limit(200).lean();
    res.json({ ok: true, chats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ----- API: Get messages for a chat -----
app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const msgs = await Message.find({ chatId }).sort({ ts: 1 }).limit(2000).lean();
    res.json({ ok: true, messages: msgs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ----- API: Telegram users (for broadcast) -----
app.get('/api/telegram/users', async (req, res) => {
  try {
    const users = await TelegramUser.find({}).sort({ startedAt: -1 }).lean();
    res.json({ ok: true, users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ----- API: Broadcast to Telegram users -----
// rate-limited endpoint
app.post('/api/telegram/broadcast', broadcastLimiter, async (req, res) => {
  try {
    if (!tgBot) return res.status(500).json({ ok: false, error: 'Telegram bot not configured on server' });

    const { recipients, message } = req.body; // recipients: array of telegramId or [] to broadcast to all
    if (!message || !message.trim()) return res.status(400).json({ ok: false, error: 'Empty message' });

    let users = [];
    if (Array.isArray(recipients) && recipients.length > 0) {
      users = await TelegramUser.find({ telegramId: { $in: recipients } }).lean();
    } else {
      users = await TelegramUser.find({}).lean();
    }

    // send with throttling to avoid hitting rate limits
    const results = [];
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      try {
        await tgBot.sendMessage(u.telegramId, message, { parse_mode: 'HTML' });
        results.push({ id: u.telegramId, ok: true });
        // save outgoing message
        const outMsg = new Message({
          chatId: `tg:${u.telegramId}`,
          channel: 'Telegram',
          fromId: null,
          fromName: 'admin-broadcast',
          text: message,
          direction: 'out',
          ts: new Date()
        });
        await outMsg.save();
        await upsertChat(`tg:${u.telegramId}`, 'Telegram', u.username || `${u.first_name||''} ${u.last_name||''}`.trim(), message, outMsg.ts, {});
      } catch (err) {
        console.warn('Broadcast send fail for', u.telegramId, err.message);
        results.push({ id: u.telegramId, ok: false, error: err.message });
      }
      // small delay to be gentle (150-350ms)
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    res.json({ ok: true, results });
  } catch (err) {
    console.error('Broadcast error', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ----- Webhook: Facebook Page (basic) -----
// GET for verification
app.get('/webhook/facebook', (req, res) => {
  const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }
  res.sendStatus(400);
});

// POST for page events
app.post('/webhook/facebook', async (req, res) => {
  // Facebook Messenger message format: https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/
  try {
    const body = req.body;
    if (body.object === 'page') {
      body.entry.forEach(async (entry) => {
        if (entry.messaging) {
          for (const ev of entry.messaging) {
            if (ev.message) {
              const senderId = ev.sender?.id;
              const channel = 'Facebook';
              const chatId = `fb:${senderId}`;
              const text = ev.message.text || '[attachment]';
              const peerName = `FB:${senderId}`;

              const messageDoc = new Message({
                chatId,
                channel,
                fromId: senderId,
                fromName: peerName,
                text,
                direction: 'in',
                meta: ev
              });
              await messageDoc.save();
              await upsertChat(chatId, channel, peerName, text, messageDoc.ts, {});
              await Chat.updateOne({ chatId }, { $inc: { unread: 1 } });

              io.to('admins').emit('new_message', { channel, chatId, message: { text, ts: messageDoc.ts } });

              // For simple auto-reply or business logic, you can call Facebook Send API using FB_PAGE_ACCESS_TOKEN
            }
          }
        }
      });
      return res.status(200).send('EVENT_RECEIVED');
    } else {
      return res.sendStatus(404);
    }
  } catch (err) {
    console.error('Facebook webhook error', err);
    res.status(500).send('err');
  }
});

// ----- Webhook: Viber (example) -----
app.post('/webhook/viber', async (req, res) => {
  // Viber webhook events: https://developers.viber.com/docs/api/rest-bot-api/
  try {
    const body = req.body;
    // handle message event
    if (body.event === 'message') {
      const sender = body.sender;
      const chatId = `viber:${sender.id}`;
      const channel = 'Viber';
      const text = body.message && body.message.text ? body.message.text : '[attachment]';
      const peerName = sender.name || sender.id;

      const messageDoc = new Message({ chatId, channel, fromId: sender.id, fromName: peerName, text, direction: 'in', meta: body });
      await messageDoc.save();
      await upsertChat(chatId, channel, peerName, text, messageDoc.ts, {});
      await Chat.updateOne({ chatId }, { $inc: { unread: 1 } });

      io.to('admins').emit('new_message', { channel, chatId, message: { text, ts: messageDoc.ts } });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Viber webhook error', err);
    res.status(500).json({ ok: false });
  }
});

// ----- Webhook: WhatsApp (Twilio-style example) -----
app.post('/webhook/whatsapp', async (req, res) => {
  // Twilio will POST form-encoded data for incoming WhatsApp messages
  // For other providers, adjust accordingly.
  try {
    const body = req.body;
    const from = body.From || body.from || '';
    const text = body.Body || body.body || '[attachment]';
    const chatId = `wa:${from}`;
    const channel = 'WhatsApp';
    const peerName = from;

    const messageDoc = new Message({ chatId, channel, fromId: from, fromName: peerName, text, direction: 'in', meta: body });
    await messageDoc.save();
    await upsertChat(chatId, channel, peerName, text, messageDoc.ts, {});
    await Chat.updateOne({ chatId }, { $inc: { unread: 1 } });

    io.to('admins').emit('new_message', { channel, chatId, message: { text, ts: messageDoc.ts } });

    // Respond OK to Twilio
    res.sendStatus(200);
  } catch (err) {
    console.error('WhatsApp webhook error', err);
    res.status(500).send('err');
  }
});

// ----- Admin action: send message to a chat (admin -> user) -----
// body: { chatId, channel, text }
app.post('/api/send', async (req, res) => {
  try {
    const { chatId, channel, text } = req.body;
    if (!chatId || !channel || !text) return res.status(400).json({ ok:false, error: 'Missing fields' });

    // Save outgoing message to DB
    const outMsg = new Message({
      chatId,
      channel,
      fromName: 'admin',
      text,
      direction: 'out',
      ts: new Date()
    });
    await outMsg.save();

    // update chat
    await upsertChat(chatId, channel, chatId, text, outMsg.ts, {});

    // deliver to channel-specific API
    const parts = chatId.split(':'); // e.g. tg:12345, fb:9876, viber:id
    const prefix = parts[0];
    const dest = parts.slice(1).join(':');

    if (prefix === 'tg' || channel === 'Telegram') {
      if (!tgBot) return res.status(500).json({ ok:false, error: 'Telegram bot not configured' });
      try {
        await tgBot.sendMessage(dest, text, { parse_mode: 'HTML' });
      } catch (err) {
        console.error('Telegram send error', err);
        return res.status(500).json({ ok: false, error: err.message });
      }
    } else if (prefix === 'fb' || channel === 'Facebook') {
      // call Facebook Send API (page access token required)
      try {
        const token = process.env.FB_PAGE_ACCESS_TOKEN;
        if (!token) throw new Error('FB_PAGE_ACCESS_TOKEN not configured');
        await axios.post(`https://graph.facebook.com/v13.0/me/messages?access_token=${token}`, {
          recipient: { id: dest },
          message: { text }
        });
      } catch (err) {
        console.error('FB send error', err.message);
        return res.status(500).json({ ok: false, error: err.message });
      }
    } else if (prefix === 'viber' || channel === 'Viber') {
      // call Viber send API with your auth token
      // placeholder - implement using Viber REST API
      console.warn('Viber send not implemented - add your Viber API call here');
    } else if (prefix === 'wa' || channel === 'WhatsApp') {
      // send via Twilio / WhatsApp Business API
      console.warn('WhatsApp send not implemented - add Twilio or WABA call here');
    } else {
      console.warn('Unknown channel in send', channel);
    }

    // notify frontend
    io.to('admins').emit('message_sent', { chatId, channel, text, ts: outMsg.ts });

    res.json({ ok: true, message: outMsg });
  } catch (err) {
    console.error('send API error', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ----- small utility endpoints -----
app.get('/', (req, res) => res.send('Admin Messenger Server is running'));

// ----- start server -----
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
