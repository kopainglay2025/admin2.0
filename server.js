import json
import os
from flask import Flask, request, jsonify
from firebase_admin import credentials, initialize_app, firestore
from google.cloud.firestore_v1.watch import Watch
from threading import Thread
import time

# --- Environment Variables (Replace with actual values or use environment config) ---
# NOTE: The service account key must be a valid JSON string.
try:
    # Use the service account key provided in the chat context
    FIREBASE_SERVICE_ACCOUNT_KEY = os.environ.get('FIREBASE_SERVICE_ACCOUNT_KEY', '{"type": "service_account", "project_id": "mksadmin-6ffeb", "private_key_id": "d3131f45b11b49bdbf227ab8dcc90363b564aa70", "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDrfYdMxHqnF7OG\nlfFYMRgbuXYMwB36Wz3iX8U7rFHRVREXgmEveinNgmehyJBZFunGZNkv6qcaRVIP\nsWwf5vBdqGStIOejYsAtwFOrcXus6wnnrBkSV2HO8kQv7wf9+9tlHmudscFOfnKa\nkoyrbYK8Ts5YdRC3oe3G/auPt9BiPOwXodO3MyN9W/tVUcdNnseFTXras3e3cYoC\nnFgXhiYIzRtJXkp2bRHS++EPwu6bXv2meAQkpsyQZDblJc8/05mGGvgUPiuxoGjC\nfC9k3KyhIDx05LtpjgLkzwMLJ7ruM6DgyA11cRy/Jlhm18NskRHNP5rJmo7nLOgs\n33qN5Ml3AgMBAAECggEACFh9iAn0Jgg5mfM/oPy0bWvoNB5G5OcagI0cvbdArkBR\nuvL2I/gA+g7wda2LxN+1nAzzT+oEzz7vrPpNUHm49Dv4ijr+52DWwLuIYflDa2bO\nn6hCVAHgYU4sS0QxLoSGscTsBj2uq4Wtsa6wT47+mB/bp9gWP8iV8OLVxq66ZhDQ\nDZppfBjDLUz7trc5XYWozcQ9ExQVyBROjVKA3PfrvyeBTGd3VXfxGZ7gBVLNxdII\n5mqmX1KE7c1WbmTNS5+DZVBOE5FvPfiHaAxzbkfxLAAapYM+YvnrWlxFSnMaRG7j\nZjdeSp5SRM70Hy2MemUuZ+HBBrmAJR7Gg0lRArgAMQKBgQD7H314HIL9qzJXZ0OP\nKG4ikqsHnlvfNNG8r4AtWqejIRwLAGjqgN+bTRFfr5qjHr6dCUP1HvQUb0S7NZyB\nGnFey4dTwOfhO1UQgPU9jlBTl6Pe141QKG92jFh8H6a5lpTglKaGHxqI8jBnUbPX\nSZYg4N0SqT4AUvApBijHdqWcHwKBgQDwEFFAlone624FIln0V9KthSh7hwhXCu+q\nOhsQ+267+CcrwxwRwNvEhRTCePRZFeCZ4SCSoSqL1D9PtwcaHmqxPFy7ETEqzlH7\nik+a1j4bXRG3f9Bz+1DF2alr7KxJi1dCD3f/FUi++JV2MYDmH+58aZnI5+RodlT9\n4eNlBzgnrQKBgQCNyIfEqwRiSKhRpOIGD+Ou3XRV5cUlTuMkT0plUQvZFLaKl56k\n2EJnoqmuhq0ecBta+oI+AU35w6DgujI0ykM8LFmptf61shQjD0xnhtRfffxtsvH8\nUfgszKyg2BYALr671fH3Q9RtgaBGlWCeqtNymML46EkzUaB66RlZFOoILQKBgQDO\nyt+TKZoeIuOlHJAswTKEMr5Kmmk+wbbuBhump1AeL4delTWqvV0Sjijx1Mt3qfbN\n1zX92UMTLIRVIK7HewghIIQoyIh3/T511hD4qjDZ1XQe9d0U65oKtJLS2w8WUyeZ\nSkXtv+HoT65AICiPE1aWaUkF3WvN6JESGfGN54gh8QKBgHVpCh4wphmiT6qfU/Ze\ng/eOC1rfipfz7PDPzziNFAtSDmhYj7ljzsM2cmGtynLa6xsCBzBmus2hfdYP9xJI\njxvk3tYI21dCAsoofgRe+ni8SD1fIQlM5++k7Pu2CfLgvjD7nQ7nxT5mXcWQYDyV\nXVGqzIFXzpRr35lHRyFFE6xV\n-----END PRIVATE KEY-----\n')
    # The key needs to be loaded as a dictionary (JSON object)
    SERVICE_ACCOUNT_INFO = json.loads(FIREBASE_SERVICE_ACCOUNT_KEY)
except json.JSONDecodeError:
    print("ERROR: FIREBASE_SERVICE_ACCOUNT_KEY is not a valid JSON string.")
    SERVICE_ACCOUNT_INFO = None

# You need a real Telegram Bot Token for sending replies
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '8599597818:AAGiAJTpzFxV34rSZdLHrd9s3VrR5P0fb-k')

# Placeholder for the Canvas App ID to match the frontend structure
APP_ID = os.environ.get('APP_ID', 'default-app-id')

# --- Firestore Paths matching the React Frontend ---
CHATS_COLLECTION_PATH = f'artifacts/{APP_ID}/public/data/chats'
MESSAGES_COLLECTION_PATH = lambda chat_id: f'{CHATS_COLLECTION_PATH}/{chat_id}/messages'
TG_USERS_COLLECTION_PATH = f'artifacts/{APP_ID}/public/data/tg_users'
BROADCAST_QUEUE_COLLECTION_PATH = f'artifacts/{APP_ID}/public/data/broadcast_queue'

app = Flask(__name__)
db = None # Firestore client instance

# --- Firebase Initialization ---
def initialize_firebase():
    """Firebase Admin SDK ကို စတင်အသုံးပြုရန်"""
    global db
    if SERVICE_ACCOUNT_INFO:
        try:
            # Use the service account info directly
            cred = credentials.Certificate(SERVICE_ACCOUNT_INFO)
            initialize_app(cred)
            db = firestore.client()
            print("Firebase Admin SDK စတင်အသုံးပြုနိုင်ပါပြီ။")
        except Exception as e:
            print(f"Firebase စတင်ရာတွင် အမှား: {e}")
            db = None
    else:
        print("Firebase Service Account Key မမှန်ကန်ပါ။")

# --- External API Simulation (Telegram) ---
def send_telegram_message(chat_id, text):
    """
    Telegram Bot API ကိုခေါ်ဆိုပြီး စာပြန်ပို့သည့် လုပ်ဆောင်ချက်။
    (ဒီနေရာတွင် actual HTTP request ထည့်သွင်းရန်လိုအပ်သည်)
    """
    print(f"[TG API] Sending message to Chat ID {chat_id}: {text}")
    # Example: response = requests.post(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage", json={'chat_id': chat_id, 'text': text})
    # For this conceptual example, we just print the action.
    return True

# --- Firestore Listeners ---

def chat_listener(col_snapshot, changes, read_time):
    """
    Admin Panel မှ စာပြန်လိုက်သည်ကို စောင့်ကြည့်ပြီး သက်ဆိုင်ရာ Platform ကို စာပြန်ပို့ရန်။
    """
    for change in changes:
        if change.type.name == 'ADDED':
            msg_data = change.document.to_dict()
            if msg_data.get('is_admin') and msg_data.get('status') != 'sent':
                # Message is sent by Admin and needs relaying
                message_id = change.document.id
                chat_id = change.document.reference.parent.parent.id # Get the parent chat ID (e.g., 'TG_12345')

                print(f"[LISTENER] New Admin Reply found in Chat {chat_id}: {msg_data.get('text')}")

                # Determine the channel and target platform ID
                channel = msg_data.get('channel')
                
                # In a real app, 'chat_id' is the platform-specific user ID.
                # Here we assume chat_id = "CHANNEL_PLATFORM_ID" e.g., "telegram_12345"
                platform_id = chat_id.split('_', 1)[-1] 

                success = False
                if channel == 'telegram':
                    success = send_telegram_message(platform_id, msg_data.get('text'))
                elif channel == 'facebook':
                    # send_facebook_message(platform_id, msg_data.get('text'))
                    pass
                # ... Add other channels

                if success:
                    # Update message status to prevent reprocessing
                    msg_ref = change.document.reference
                    msg_ref.update({'status': 'sent', 'sent_time': firestore.SERVER_TIMESTAMP})
                    print(f"Message {message_id} successfully sent via {channel}.")
                else:
                    print(f"ERROR: Message {message_id} failed to send.")


def broadcast_listener(col_snapshot, changes, read_time):
    """
    Broadcast Queue မှ မက်ဆေ့ချ်အသစ်များကို စောင့်ကြည့်ပြီး TG User အားလုံးဆီသို့ ပို့ရန်။
    """
    for change in changes:
        if change.type.name == 'ADDED':
            broadcast_data = change.document.to_dict()
            broadcast_id = change.document.id

            if broadcast_data.get('status') == 'pending' and broadcast_data.get('channel') == 'telegram':
                print(f"[LISTENER] Starting TG Broadcast {broadcast_id}: {broadcast_data.get('text')[:30]}...")
                
                # 1. Update status to processing
                broadcast_ref = change.document.reference
                broadcast_ref.update({'status': 'processing', 'processing_time': firestore.SERVER_TIMESTAMP})

                # 2. Fetch all TG users
                tg_users_ref = db.collection(TG_USERS_COLLECTION_PATH)
                all_users = tg_users_ref.get()

                sent_count = 0
                for user_doc in all_users:
                    user_data = user_doc.to_dict()
                    tg_chat_id = user_data.get('chatId') # This is the unique Telegram chat ID
                    if tg_chat_id:
                        send_telegram_message(tg_chat_id, broadcast_data.get('text'))
                        sent_count += 1
                
                # 3. Update status to completed
                broadcast_ref.update({
                    'status': 'completed', 
                    'completed_time': firestore.SERVER_TIMESTAMP, 
                    'recipients_count': sent_count
                })
                print(f"TG Broadcast {broadcast_id} completed. Sent to {sent_count} users.")


def start_firestore_listeners():
    """Listeners များကို သီးခြား Thread ဖြင့် စတင်ရန်။"""
    if db:
        # 1. Admin Reply Listener (watches all message subcollections)
        # Note: Listening to ALL subcollections is complex/expensive in Firestore. 
        # A more scalable solution is often a Cloud Function trigger on message creation.
        # For demonstration, we listen to a sample thread or rely on polling (not ideal).
        # We will demonstrate the Broadcast Queue listener which is simpler.
        
        # 2. Broadcast Queue Listener
        broadcast_queue_ref = db.collection(BROADCAST_QUEUE_COLLECTION_PATH)
        broadcast_watch = broadcast_queue_ref.on_snapshot(broadcast_listener)
        print("Broadcast Queue Listener စတင်ပါပြီ။")

        # Keep the thread alive (in a real app, the server process does this)
        while True:
            time.sleep(60) # Keep thread alive for demo purposes

# --- Flask Routes (Webhooks) ---

@app.route('/')
def health_check():
    """စနစ်အလုပ်လုပ်ကြောင်း စစ်ဆေးရန်"""
    return "Unified Messenger Backend Service is running.", 200

@app.route('/webhook/telegram', methods=['POST'])
def telegram_webhook():
    """Telegram Webhook မှ စာဝင်လာသည်ကို လက်ခံရန်"""
    if not db:
        return jsonify({"status": "error", "message": "Firestore မချိတ်ဆက်နိုင်သေးပါ။"}), 500

    update = request.get_json()
    if not update or 'message' not in update:
        return jsonify({"status": "ok", "message": "No new message"}), 200

    message = update.get('message', {})
    chat = message.get('chat', {})
    
    # Extract data
    text = message.get('text', '')
    tg_chat_id = str(chat.get('id'))
    user_name = chat.get('first_name', '') + ' ' + chat.get('last_name', '')
    username = chat.get('username')
    
    if not tg_chat_id:
        return jsonify({"status": "error", "message": "Invalid chat ID"}), 200

    # Unified chat identifier for Firestore
    chat_doc_id = f"telegram_{tg_chat_id}"

    # 1. Update/Create TG User Info (needed for Broadcast)
    tg_users_ref = db.collection(TG_USERS_COLLECTION_PATH)
    tg_users_ref.document(tg_chat_id).set({
        'chatId': tg_chat_id,
        'firstName': chat.get('first_name', ''),
        'lastName': chat.get('last_name', ''),
        'username': username,
        'lastSeen': firestore.SERVER_TIMESTAMP,
    }, merge=True)
    
    # 2. Update/Create Parent Chat Document (for Chat List view)
    chat_doc_ref = db.collection(CHATS_COLLECTION_PATH).document(chat_doc_id)
    chat_doc_ref.set({
        'chatId': tg_chat_id,
        'channel': 'telegram',
        'userName': user_name.strip() or username or f"TG User {tg_chat_id}",
        'lastMessage': text,
        'lastMessageTime': firestore.SERVER_TIMESTAMP,
        'unreadCount': firestore.Increment(1) # Increase unread count
    }, merge=True)

    # 3. Add Message to Subcollection
    message_data = {
        'text': text,
        'timestamp': firestore.SERVER_TIMESTAMP,
        'channel': 'telegram',
        'senderId': tg_chat_id,
        'userName': user_name.strip() or username,
        'is_admin': False, # Mark as user message
    }
    db.collection(MESSAGES_COLLECTION_PATH(chat_doc_id)).add(message_data)

    print(f"Telegram message received from {tg_chat_id} and saved to Firestore.")
    return jsonify({"status": "success", "message": "Message received"}), 200

# --- Placeholder Webhooks for Other Channels ---

@app.route('/webhook/facebook', methods=['POST'])
def facebook_webhook():
    """Facebook/Messenger Webhook အတွက် (Placeholder)"""
    # ဤနေရာတွင် Facebook ၏ Message Format ကို ကိုင်တွယ်ရန် လိုအပ်ပါသည်။
    return jsonify({"status": "ok", "message": "Facebook webhook received (not fully implemented)"}), 200

@app.route('/webhook/viber', methods=['POST'])
def viber_webhook():
    """Viber Webhook အတွက် (Placeholder)"""
    return jsonify({"status": "ok", "message": "Viber webhook received (not fully implemented)"}), 200

@app.route('/webhook/whatsapp', methods=['POST'])
def whatsapp_webhook():
    """WhatsApp Webhook အတွက် (Placeholder)"""
    return jsonify({"status": "ok", "message": "WhatsApp webhook received (not fully implemented)"}), 200


# --- Application Setup ---

if __name__ == '__main__':
    initialize_firebase()
    
    # Start the Firestore listeners in a background thread
    # NOTE: For production, use a dedicated service like Cloud Functions or Managed service 
    # to handle listeners for reliability.
    if db:
        listener_thread = Thread(target=start_firestore_listeners)
        listener_thread.daemon = True
        listener_thread.start()
    
    # Run the Flask app
    port = int(os.environ.get('PORT', 80))
    print(f"Flask server is running on port {port}")
    app.run(debug=True, host='0.0.0.0', port=port, use_reloader=False)
