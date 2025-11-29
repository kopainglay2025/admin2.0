import os
import json
import logging
import time
from threading import Thread # Bot ကို thread သီးသန့် run ရန်
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

# Long Polling အတွက် လိုအပ်သော imports များ
from telegram import Bot, Update
from telegram.ext import Application, MessageHandler, filters, ContextTypes, CommandHandler
from telegram.error import TelegramError

# Logging ကို စတင်သတ်မှတ်ခြင်း
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- သတ်မှတ်ရန် (Configuration) ---
# သင့်ရဲ့ Bot Token ကို ဤနေရာတွင် ထည့်ပါ။
BOT_TOKEN = os.environ.get('BOT_TOKEN', '8599597818:AAGiAJTpzFxV34rSZdLHrd9s3VrR5P0fb-k')
# Admin Panel ကို ဝင်ရောက်ရန် Password ကို ဤနေရာတွင် ထည့်ပါ။
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin130718')
# Long Polling စနစ်သို့ ပြောင်းလိုက်ပြီဖြစ်၍ WEBHOOK_URL သည် မလိုအပ်တော့ပါ။
# -----------------------------------

app = Flask(__name__)
# Flask-SocketIO ကို စတင်သတ်မှတ်ခြင်း (Async mode: eventlet သည် VPS တွင် အကောင်းဆုံးဖြစ်သည်)
app.config['SECRET_KEY'] = 'a_very_secret_key'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet') 
# CORS allow ထားခြင်းသည် Local Testing အတွက် အထောက်အကူပြုသည်။

# Real-time Chat များကို သိမ်းဆည်းရန် (In-memory storage)
# Key: user_id (int), Value: {'username': str, 'chat_history': list}
active_chats = {}

# --- Telegram Bot Long Polling Handlers ---

async def handle_telegram_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Telegram message received handler for long polling."""
    # Message ရှိမှသာ ဆက်လုပ်ပါ
    if update.message and update.message.text:
        message = update.message
        user_id = message.chat.id
        text = message.text

        # Command handling (e.g., /start)
        if text.startswith('/'):
            logging.info(f"Received command from {user_id}: {text}")
            if text == '/start':
                await message.reply_text("မင်္ဂလာပါရှင်။ သင့်ရဲ့မေးခွန်းကို admin က မကြာခင် တုံ့ပြန်ပေးပါမယ်။")
            return # Command ဖြစ်လို့ Admin Panel ကို မပို့ပါဘူး

        # Regular message handling
        user_info = message.chat
        username = user_info.username or user_info.first_name or str(user_id)
        
        logging.info(f"New message from {username} ({user_id}): {text}")

        # Flask/SocketIO context ကိုသုံးပြီး active_chats ကို update လုပ်ကာ emit လုပ်ပါ
        with app.app_context():
            if user_id not in active_chats:
                active_chats[user_id] = {
                    'username': username,
                    'chat_history': []
                }
            
            # message.date သည် datetime object ဖြစ်သောကြောင့် timestamp() ကို ခေါ်ရမည်
            new_msg = {'sender': 'user', 'text': text, 'timestamp': message.date.timestamp()}
            active_chats[user_id]['chat_history'].append(new_msg)

            # Admin Panel သို့ Real-time ဖြင့် ပို့ပါ
            socketio.emit('new_message', {
                'user_id': user_id,
                'username': username,
                'message': new_msg
            })

# Telegram Bot Polling Setup
def start_telegram_bot_polling():
    """Runs the Telegram bot in long polling mode."""
    try:
        # Application builder ကို အသုံးပြုပြီး Polling စတင်ပါ
        application = Application.builder().token(BOT_TOKEN).build()
        
        # Handlers များ ထည့်သွင်းခြင်း
        application.add_handler(CommandHandler("start", handle_telegram_message))
        # စာသား message များကို လက်ခံပြီး Command မဟုတ်သည်များကို စစ်ထုတ်ခြင်း
        application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_telegram_message))

        # Start Polling
        logging.info("Starting Telegram Bot Long Polling...")
        # poll_interval=1.0 ဆိုသည်မှာ စက္ကန့်တိုင်း Telegram API ကို စစ်ဆေးနေခြင်းဖြစ်သည်
        application.run_polling(poll_interval=1.0, timeout=10)
    except Exception as e:
        logging.error(f"Error starting Telegram Long Polling: {e}")


# --- Flask Routes ---

@app.route('/')
def admin_panel():
    """Admin Panel UI ကို ပြသပေးသည်။"""
    return render_template('index.html')

@app.route('/login', methods=['POST'])
def login():
    """Admin Login ကို စစ်ဆေးသည်။"""
    data = request.json
    if data.get('password') == ADMIN_PASSWORD:
        return jsonify({'success': True}), 200
    return jsonify({'success': False, 'message': 'Incorrect Password'}), 401

@app.route('/get_chats', methods=['GET'])
def get_chats():
    """လက်ရှိ active ဖြစ်နေသော chats များကို ပြန်ပေးသည်။"""
    return jsonify(active_chats), 200

# /webhook route ကို ဖယ်ရှားထားပါသည်။

# --- SocketIO Events ---

@socketio.on('connect')
def handle_connect():
    """Admin Panel Connect လုပ်ရင် Log ထုတ်သည်။"""
    logging.info('Admin connected via SocketIO')

@socketio.on('send_reply')
def handle_send_reply(data):
    """Admin က စာပြန်ရင် Telegram user ဆီ ပို့ပေးသည်။"""
    user_id = data.get('user_id')
    reply_text = data.get('text')
    
    if not user_id or not reply_text:
        return

    logging.info(f"Admin replying to {user_id}: {reply_text}")

    try:
        # Bot instance ကို reply ပို့ရန်အတွက် အသုံးပြုခြင်း
        # Send message သည် synchronous ဖြစ်သောကြောင့် Flask thread တွင် သုံးနိုင်သည်
        bot = Bot(token=BOT_TOKEN) 
        
        # Telegram user ဆီ စာပြန်ပို့ပါ
        bot.send_message(user_id, reply_text)
        
        # Admin Panel အတွက် Chat History ကို update လုပ်ပါ
        if user_id in active_chats:
            new_msg = {'sender': 'admin', 'text': reply_text, 'timestamp': int(time.time())}
            active_chats[user_id]['chat_history'].append(new_msg)
            
            # စာပြန်တာ အောင်မြင်ကြောင်း Admin Panel သို့ ပြန်ပို့ပါ
            emit('reply_sent', {
                'user_id': user_id,
                'message': new_msg
            }, broadcast=True)
            
        logging.info(f"Successfully sent reply to {user_id}")

    except TelegramError as e:
        logging.error(f"Telegram API Error sending message to {user_id}: {e.message}")
        emit('reply_error', {'user_id': user_id, 'error': e.message})
    except Exception as e:
        logging.error(f"Unexpected error when sending message: {e}")
        emit('reply_error', {'user_id': user_id, 'error': 'Unknown error occurred'})


if __name__ == '__main__':
    # 1. Long Polling ကို Thread အသစ်မှာ စတင် run ပါ
    bot_thread = Thread(target=start_telegram_bot_polling)
    bot_thread.start()
    
    # 2. Flask/SocketIO Server ကို eventlet ဖြင့် run ပါ
    from eventlet import wsgi
    import eventlet
    eventlet.monkey_patch()
    
    # 0.0.0.0 ဖြင့် bind လုပ်ပြီး Port 4210 ဖြင့် run ပါ
    host = '0.0.0.0'
    port = 4210
    logging.info(f"Starting SocketIO server on http://{host}:{port}")
    wsgi.server(eventlet.listen((host, port)), app)

# မှတ်ချက်- Webhook ကို အသုံးမပြုတော့ပါ၊ Long Polling ဖြင့် IP ပေါ်တွင် အလုပ်လုပ်နိုင်ပါပြီ။
