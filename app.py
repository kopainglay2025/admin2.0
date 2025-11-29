import os
import json
import logging
import time # Added import for time.time()
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from telegram import Bot
from telegram.error import TelegramError

# Logging ကို စတင်သတ်မှတ်ခြင်း
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- သတ်မှတ်ရန် (Configuration) ---
# သင့်ရဲ့ Bot Token ကို ဤနေရာတွင် ထည့်ပါ။
BOT_TOKEN = os.environ.get('BOT_TOKEN', '8599597818:AAGiAJTpzFxV34rSZdLHrd9s3VrR5P0fb-k')
# Admin Panel ကို ဝင်ရောက်ရန် Password ကို ဤနေရာတွင် ထည့်ပါ။
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'admin130718')
# Webhook URL (သင့် VPS ရဲ့ Public URL/webhook)
WEBHOOK_URL = os.environ.get('WEBHOOK_URL', 'http://178.62.215.102:4210/webhook')
# -----------------------------------

app = Flask(__name__)
# Flask-SocketIO ကို စတင်သတ်မှတ်ခြင်း (Async mode: eventlet သည် VPS တွင် အကောင်းဆုံးဖြစ်သည်)
app.config['SECRET_KEY'] = 'a_very_secret_key'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet') 
# CORS allow ထားခြင်းသည် Local Testing အတွက် အထောက်အကူပြုသည်။ Production တွင် သင့် domain သာ ခွင့်ပြုသင့်သည်။

# Telegram Bot ကို စတင်သတ်မှတ်ခြင်း
try:
    bot = Bot(token=BOT_TOKEN)
    logging.info(f"Telegram Bot ID: {bot.get_me().id}")
    # Webhook ကို တစ်ခါတည်း သတ်မှတ်လိုက်ပါ
    if 'YOUR_PUBLIC_URL_HERE' not in WEBHOOK_URL:
        bot.set_webhook(WEBHOOK_URL)
        logging.info(f"Webhook set to: {WEBHOOK_URL}")
    else:
        logging.warning("Please set WEBHOOK_URL to your actual public server address.")

except Exception as e:
    logging.error(f"Error initializing Telegram Bot: {e}")
    bot = None

# Real-time Chat များကို သိမ်းဆည်းရန် (In-memory storage)
# Key: user_id (int), Value: {'username': str, 'chat_history': list}
active_chats = {}

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
    # chat_history ကို JSON serialization အတွက် ပြင်ဆင်ခြင်း
    return jsonify(active_chats), 200

@app.route('/webhook', methods=['POST'])
def webhook_handler():
    """Telegram ကနေ စာအသစ်ဝင်လာတာကို လက်ခံသည်။"""
    if request.method == "POST":
        try:
            update = json.loads(request.data)
            # Message ရှိမှ ဆက်လုပ်ပါ
            if 'message' in update:
                message = update['message']
                user_id = message['chat']['id']
                text = message.get('text')
                
                # Command (e.g., /start) များကို စစ်ဆေးပါ
                if text and text.startswith('/'):
                    logging.info(f"Received command from {user_id}: {text}")
                    # Command များကို အလိုအလျောက် တုံ့ပြန်လိုလျှင် ဤနေရာတွင် ထည့်ပါ။
                    if text == '/start' and bot:
                         bot.send_message(user_id, "မင်္ဂလာပါရှင်။ သင့်ရဲ့မေးခွန်းကို admin က မကြာခင် တုံ့ပြန်ပေးပါမယ်။")
                    return 'ok' # Command ဖြစ်လို့ Admin Panel ကို မပို့ပါဘူး

                if text:
                    user_info = message['chat']
                    username = user_info.get('username') or user_info.get('first_name') or str(user_id)
                    
                    logging.info(f"New message from {username} ({user_id}): {text}")

                    # Chat History ကို update လုပ်ပါ
                    if user_id not in active_chats:
                        active_chats[user_id] = {
                            'username': username,
                            'chat_history': []
                        }
                    
                    new_msg = {'sender': 'user', 'text': text, 'timestamp': message['date']}
                    active_chats[user_id]['chat_history'].append(new_msg)

                    # Admin Panel သို့ Real-time ဖြင့် ပို့ပါ
                    socketio.emit('new_message', {
                        'user_id': user_id,
                        'username': username,
                        'message': new_msg
                    })

        except Exception as e:
            logging.error(f"Error processing webhook: {e}")

    return 'ok'

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
        if bot:
            # Telegram user ဆီ စာပြန်ပို့ပါ
            bot.send_message(user_id, reply_text)
            
            # Admin Panel အတွက် Chat History ကို update လုပ်ပါ
            if user_id in active_chats:
                # 'os.time()' ကို 'time.time()' ဖြင့် ပြင်ဆင်ထားသည်
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
    # 'eventlet' library ကို အသုံးပြုပြီး SocketIO server ကို run ပါ
    # Production အတွက် eventlet/gevent သည် ပိုကောင်းပါသည်။
    from eventlet import wsgi
    import eventlet
    eventlet.monkey_patch()
    
    # ပုံမှန်အားဖြင့် Port 4210 ဖြင့် run ပါမည်။ 0.0.0.0 ဖြင့် bind လုပ်ခြင်းသည် ပိုမိုကောင်းမွန်ပါသည်။
    host = '0.0.0.0'
    port = 4210
    logging.info(f"Starting SocketIO server on http://{host}:{port}")
    wsgi.server(eventlet.listen((host, port)), app)

# မှတ်ချက်- production အတွက် HTTPS (Nginx/Reverse Proxy) ကို အသုံးပြုရန် မဖြစ်မနေ လိုအပ်ပါသည်။
